// Monsters as the shared world (sim/world.js) reports them: procedural slimes and KayKit humanoids
// (bandits, cultists, skeletons, the bosses), drawn, animated and moved smoothly between updates, with
// their attacks played out here. A blow, bolt, slam or grave circle that reaches our hero hurts it
// here (we know best where our hero stands); the damage we deal goes to the world, which keeps score.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { heightAt } from './world.js';
import { ENEMY_TYPES, monsterDmg } from './monsters.js';
import { STATES } from './sim/world.js';
import { rand, angleDiff, yawTo, lerp, clamp, TAU, has } from './util.js';

export { ENEMY_TYPES, SPAWNS } from './monsters.js';

const UP = new THREE.Vector3(0, 1, 0);
// what the log calls a boss: Morvain, Hrimgar, Forgemaster Kaldur…
const shortName = (d) => d.name.split(/,| the /)[0];
const JUMP = 5; // m between two updates: a blink, not a walk (no sliding across)
const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

function buildSlime(def) {
  const group = new THREE.Group();
  const bodyGeo = new THREE.SphereGeometry(0.62, 26, 18);
  bodyGeo.scale(1, 0.82, 1);
  bodyGeo.translate(0, 0.508, 0);
  const baseEmissive = new THREE.Color(def.color).multiplyScalar(def.glow || 0.12);
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.9, emissive: baseEmissive.clone() });
  const body = new THREE.Mesh(bodyGeo, mat);
  body.castShadow = true;
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).multiplyScalar(0.55), roughness: 0.5, flatShading: true }));
  core.position.set(0, 0.42, -0.05);
  body.add(core);
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.2 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), white);
    eye.scale.set(1, 1.25, 0.55);
    eye.position.set(s * 0.19, 0.64, 0.555);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), black);
    pupil.scale.set(1, 1.2, 0.5);
    pupil.position.set(s * 0.19, 0.62, 0.615);
    body.add(eye, pupil);
  }
  group.add(body);
  return { group, body, mat, baseEmissive };
}

export class Enemy {
  // r: the world's full record { i, t, l, x, z, y, h, mh, s, st, sp, e } (see WorldSim.snapshot)
  constructor(game, r, ts) {
    const d = ENEMY_TYPES[r.t];
    this.game = game;
    this.id = r.i;
    this.type = r.t;
    this.def = d;
    this.level = r.l;
    this.maxHp = r.mh;
    this.hp = r.h;
    this.dmg = monsterDmg(d, this.level);
    this.radius = d.radius * (d.scale || 1);
    this.height = d.kind === 'slime' ? 1.05 * d.size : 2.45 * (d.scale || 1);
    this.pos = new THREE.Vector3(r.x, heightAt(r.x, r.z), r.z);
    this.yaw = r.y;
    this.state = STATES[r.s] || 'idle';
    this.speed = r.sp || 0;
    this.samples = [{ t: ts, x: r.x, z: r.z, yaw: r.y, sp: r.sp || 0, hp: r.h, s: r.s }];
    this.attack = null;
    this.hover = false;
    this.hopT = rand(0, 1);
    this.deadT = 0;
    this.predictUntil = 0; // our own hits show before the world confirms them
    this.predicted = 0; // when our hit looked deadly (the world confirms the kill, or it gets up again)
    this.enraged = false;
    this.stunT = 0; // what skills did to it, for the looks (the world applies the effects)
    this.slowT = 0;
    this.dotT = 0; // poisoned or burning
    this.weakT = 0; // weakened: hits softer (a plague)
    this.weakBy = 0;
    this.vulnT = 0; // exposed: takes more from everyone
    this.vulnBy = 0;

    const rising = this.state === 'spawn' && (r.st || 0) < 0.4;
    if (d.kind === 'slime') {
      const s = buildSlime(d);
      this.slime = s;
      this.obj = s.group;
      this.grow = rising ? 0 : 1;
      this.obj.scale.setScalar(rising ? 0.01 : d.size);
    } else {
      this.h = new Humanoid(d.model, { scale: d.scale || 1, tint: d.tint ?? null });
      this.h.equip(d.archer ? 'l' : 'r', d.weapon, d.weaponGlow ?? null); // (a bow in the left hand)
      if (d.offhand) this.h.equip('l', d.offhand);
      else if (this.type === 'bandit' && this.id % 2) this.h.equip('l', 'shield_round'); // (the same for everyone)
      if (d.eyes) this.h.setGlow('Glow', d.eyes, 2.6);
      this.obj = this.h.group;
      if (rising) {
        this.h.anim.play('Spawn_Ground', { timeScale: d.undead ? 0.9 : 1.2 });
        if (d.undead) game.fx.dust(new THREE.Vector3(this.pos.x, this.pos.y + 0.1, this.pos.z), 16);
      }
    }
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
    game.scene.add(this.obj);
    this.plate = game.ui.createPlate(this);
    if (r.e) this.enrage(true);
  }

  get alive() {
    return this.state !== 'dead';
  }

  get center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
  }

  platePos(out) {
    return out.set(this.pos.x, this.pos.y + this.height + 0.35, this.pos.z);
  }

  // How loud its sounds are for us: full up close, nothing from 28 m.
  vol() {
    const p = this.game.player.pos;
    return clamp(1 - Math.hypot(p.x - this.pos.x, p.z - this.pos.z) / 28, 0, 1);
  }

  sample(ts, x, z, yaw, sp, hp, s) {
    this.samples.push({ t: ts, x, z, yaw, sp, hp, s });
  }

  dispose() {
    this.game.scene.remove(this.obj);
    this.game.ui.removePlate(this.plate);
    this.plate = null;
  }

  // ---------------------------------------------------------------- hits
  // Our own hit: shown straight away (the world confirms it a moment later).
  hurt(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.predictUntil = this.game.link.clock + 0.8;
    this.flinch();
    if (this.hp <= 0) {
      this.predicted = this.game.link.clock;
      this.die();
    }
  }

  // Someone else's hit (the world tells us); tick: their poison or fire.
  struck(dmg, crit, tick = false) {
    if (!this.alive) return;
    const g = this.game;
    g.ui.floater(new THREE.Vector3(this.pos.x, this.pos.y + this.height + 0.1, this.pos.z), String(dmg), crit ? 'crit other' : 'other');
    if (tick) return;
    g.fx.sparks(this.center, crit ? 0xffe070 : 0xfff0c0, crit ? 14 : 6, crit ? 6 : 4);
    if (this.slime) g.fx.goo(this.center, this.def.color, 4);
    const vol = this.vol();
    if (vol) g.sfx.play(crit ? 'crit' : 'hit', 0.6 * vol);
    this.flinch();
  }

  flinch() {
    if (this.h) this.h.hitFlash(0xffffff, 1);
    else { this.slimeFlash = 1; this.squash = 0.35; }
    if (this.def.boss) return;
    if (this.attack && this.attack.t < this.attack.hitAt) this.cancelAttack(); // a hit interrupts the wind-up
    if (this.h && this.h.anim.oneName !== 'Death_A') this.h.anim.play('Hit_A', { timeScale: 1.6 });
  }

  // Stunned (stars over its head), slowed (frosted), taunted (it flashes red), poisoned or burning, weakened
  // or exposed: { stun, slow: [f, s], taunt, dot: [dps, s], weak: [f, s], vuln: [f, s] } from our hit, or
  // { s, w, t, p, k, kf, v, vf } (seconds, and how much) from someone else's (the world tells us). Bosses shrug
  // most of a stun off, as in the world.
  applyStatus(eff) {
    if (!eff || !this.alive) return;
    const stun = Number(eff.stun ?? eff.s) || 0, slow = Number(Array.isArray(eff.slow) ? eff.slow[1] : eff.w) || 0;
    if (stun > 0) {
      this.stunT = Math.max(this.stunT, Math.min(3, stun) * (this.def.boss ? 0.4 : 1));
      if (!this.def.boss && this.attack) this.cancelAttack();
    }
    if (slow > 0) this.slowT = Math.max(this.slowT, Math.min(6, slow));
    if (Number(eff.taunt ?? eff.t) > 0) this.h?.hitFlash(0xff3a2a, 0.8);
    const dot = Array.isArray(eff.dot) ? eff.dot[1] : eff.p;
    if (Number(dot) > 0) { this.dotT = Math.max(this.dotT, Math.min(10, Number(dot))); this.dotKind = Array.isArray(eff.dot) ? eff.dot[2] : eff.pk || 'poison'; }
    const weak = Array.isArray(eff.weak) ? eff.weak : eff.k ? [eff.kf, eff.k] : null;
    if (weak && Number(weak[1]) > 0) { this.weakT = Math.min(12, Number(weak[1])); this.weakBy = Math.min(0.5, Number(weak[0]) || 0.3); }
    const vuln = Array.isArray(eff.vuln) ? eff.vuln : eff.v ? [eff.vf, eff.v] : null;
    if (vuln && Number(vuln[1]) > 0) { this.vulnT = Math.min(12, Number(vuln[1])); this.vulnBy = Math.min(0.5, Number(vuln[0]) || 0.2); }
  }

  cancelAttack() {
    this.attack = null;
    if (!this.h) return;
    this.h.swing = null;
    if (['Throw', 'Use_Item', 'Interact'].includes(this.h.anim.oneName)) this.h.anim.stopOne();
  }

  die() {
    if (this.state === 'dead') return;
    const g = this.game;
    this.state = 'dead';
    this.deadT = 0;
    this.attack = null;
    g.ui.removePlate(this.plate);
    this.plate = null;
    const vol = this.vol();
    if (this.h) {
      this.h.swing = null;
      this.h.anim.play('Death_A', { hold: true, timeScale: 0.9 });
      if (this.def.undead) {
        this.h.setGlow('Glow', 0x000000, 0); // eyes go dark
        g.fx.bones(this.center, this.def.eyes);
      }
    } else {
      g.fx.goo(this.center, this.def.color, 34);
      g.fx.burst(this.center, this.def.color, 16, 3, 0.3, 0.5);
      this.obj.visible = false;
      if (vol) g.sfx.play('slime', vol);
    }
  }

  // Our hit looked deadly, but the world says it lives on (it healed, or the hit didn't count).
  revive() {
    this.predicted = 0;
    this.state = 'idle';
    this.plate = this.game.ui.createPlate(this);
    if (this.h) {
      this.h.anim.stopOne();
      if (this.def.eyes) this.h.setGlow('Glow', this.def.eyes, 2.6);
    } else {
      this.obj.visible = true;
    }
  }

  // ---------------------------------------------------------------- what the world says it does
  event(ev) {
    const g = this.game;
    if (!this.alive) return;
    switch (ev[0]) {
      case 'a': // a swing (style, duration)
        this.attack = { kind: 'melee', t: 0, dur: ev[3], hitAt: 0.45 * ev[3], hit: false };
        this.h?.startSwing(ev[3], ev[2]);
        break;
      case 'l': // a slime's lunge
        this.attack = { kind: 'melee', lunge: true, t: 0, dur: 0.75, hitAt: 0.45, hit: false };
        break;
      case 's': { // a boss's ground slam at (x, z)
        const at = new THREE.Vector3(ev[2], heightAt(ev[2], ev[3]), ev[3]);
        this.attack = { kind: 'slam', t: 0, dur: ev[4], hitAt: ev[5], hit: false, at };
        g.fx.telegraph(at, 3.6, ev[5]);
        this.h?.startSwing(ev[4], 'chop');
        break;
      }
      case 'c': // a spell at hero ev[2], ev[3] bolts
        this.attack = { kind: 'cast', t: 0, dur: 1, hitAt: 0.5, hit: false, target: ev[2], n: ev[3] };
        this.h?.anim.play('Throw', { timeScale: 1.4 });
        break;
      case 'u': // a boss calls for help: the Lich raises the dead, a jarl calls his raiders (the world spawns them)
        this.attack = { kind: 'summon', t: 0, dur: 1.5, hitAt: 0.8, hit: false };
        this.h?.anim.play(this.def.kind === 'caster' ? 'Use_Item' : 'Interact', { timeScale: 0.9 });
        g.places.pulse(1.6);
        g.sfx.play('summon', this.vol());
        g.ui.log(`<b>${shortName(this.def)}</b> ${this.def.summons?.[0]?.includes('skeleton') || this.def.lich ? 'calls the dead to rise!' : 'calls for help!'}`, 'bad');
        break;
      case 'o': // the Lich draws grave circles…
        this.attack = { kind: 'circles', t: 0, dur: 1.1, hitAt: 0.5, hit: false };
        this.h?.anim.play('Interact', { timeScale: 1.2 });
        g.places.pulse(0.8);
        break;
      case 'O': { // …here (x, z pairs); they erupt a moment later
        const s = ev[2] || [];
        for (let i = 0; i + 1 < s.length; i += 2) {
          const at = new THREE.Vector3(s[i], heightAt(s[i], s[i + 1]), s[i + 1]);
          g.fx.telegraph(at, 2.2, 1.25, () => this.erupt(at), 0xb05cff);
        }
        g.sfx.play('cast', this.vol());
        break;
      }
      case 'b': this.blinkFx(ev[2], ev[3]); break; // the Lich vanished from (x, z)
      case 'e': this.enrage(); break;
      case 'x': this.cancelAttack(); break; // someone interrupted it
      case 'h': // a hit: [h, id, damage, crit, by, effects] (by 0: poison or fire ticking)
        if (ev[4] !== g.link.pid) {
          if (ev[2] > 0) this.struck(ev[2], ev[3], ev[4] === 0);
          if (ev[5]) this.applyStatus(ev[5]);
        }
        break;
      case 'P': // poison or fire ticking that we put on it: [P, id, damage]
        if (ev[2] > 0) g.ui.floater(new THREE.Vector3(this.pos.x + rand(-0.3, 0.3), this.pos.y + this.height + 0.1, this.pos.z), String(ev[2]), 'dot');
        break;
      default: break;
    }
  }

  updateAttack(dt) {
    const a = this.attack, g = this.game, p = g.player, d = this.def;
    a.t += dt;
    if (!a.hit && a.t >= a.hitAt) {
      a.hit = true;
      const vol = this.vol();
      if (a.kind === 'melee') {
        const dist = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        const ang = Math.abs(angleDiff(this.yaw, yawTo(p.pos.x - this.pos.x, p.pos.z - this.pos.z)));
        if (p.alive && dist <= d.range + p.radius + 0.5 && ang < 1.3) g.damagePlayer(this.dmg, this);
        if (this.h && vol) g.sfx.play('swing', 0.5 * vol);
      } else if (a.kind === 'cast') {
        this.castBolts(a);
      } else if (a.kind === 'slam') {
        const at = a.at;
        g.fx.ring(at, 0.5, 4.2, 0xff8a3a, 0.5);
        g.fx.dust(new THREE.Vector3(at.x, at.y + 0.2, at.z), 30);
        g.fx.burst(new THREE.Vector3(at.x, at.y + 0.3, at.z), 0xff9a4a, 30, 5);
        if (vol) { g.shake(0.6 * vol); g.sfx.play('slam', vol); }
        if (p.alive && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < 3.6 + p.radius) g.damagePlayer(this.dmg * 1.8, this);
      }
    }
    if (a.t >= a.dur) {
      this.attack = null;
      if (a.kind === 'cast' || a.kind === 'summon' || a.kind === 'circles') this.h?.anim.stopOne();
    }
  }

  // Bolts from the staff hand at the hero it targets (where we see that hero).
  castBolts(a) {
    const g = this.game, d = this.def;
    const hand = new THREE.Vector3();
    this.h.bones.handslotr.getWorldPosition(hand);
    const who = a.target === g.link.pid ? g.player : g.others.byId.get(a.target);
    const tp = who ? who.pos : new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 6, this.pos.y, this.pos.z + Math.cos(this.yaw) * 6);
    const aim = new THREE.Vector3(tp.x, tp.y + 1.1, tp.z).sub(hand);
    const n = Math.max(1, Math.min(7, a.n | 0));
    for (let i = 0; i < n; i++) {
      const dir = aim.clone().applyAxisAngle(UP, (i - (n - 1) / 2) * 0.2); // the Lich fans out a volley
      g.projectiles.spawn({ from: hand.clone(), dir, owner: 'enemy', dmg: this.dmg, speed: d.lich ? 12 : d.archer ? 17 : 11, color: d.bolt || 0xb070ff, radius: 0.35, range: d.lich ? 20 : 16, size: d.archer ? 0.18 : 0.3, small: d.archer });
    }
  }

  // A grave circle bursts: bones and violet fire, and it hurts if our hero is still standing in it.
  erupt(at) {
    const g = this.game, p = g.player;
    g.fx.ring(at, 0.4, 2.6, 0xb57dff, 0.5);
    g.fx.burst(new THREE.Vector3(at.x, at.y + 0.3, at.z), 0xb57dff, 26, 5);
    g.fx.soft.emit({ pos: { x: at.x, y: at.y + 0.3, z: at.z }, count: 10, spread: 0.8, velSpread: 1.5, vel: { x: 0, y: 3, z: 0 }, color: new THREE.Color(0xe8e0d0), size: 0.18, sizeEnd: 0.1, life: 0.8, gravity: 12, drag: 0.6 });
    g.sfx.play('nova', 0.7 * this.vol());
    if (this.alive && p.alive && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < 2.2 + p.radius * 0.5) {
      g.damagePlayer(this.dmg * 1.3, this);
      g.shake(0.3);
    }
  }

  blinkFx(fromX, fromZ) {
    const g = this.game, to = this.samples[this.samples.length - 1];
    const puff = (x, z) => {
      const y = heightAt(x, z);
      g.fx.burst(new THREE.Vector3(x, y + 1.4, z), 0xb57dff, 30, 4);
      g.fx.soft.emit({ pos: { x, y: y + 1.2, z }, count: 14, spread: 0.6, velSpread: 1.2, vel: { x: 0, y: 1, z: 0 }, color: new THREE.Color(0x2e2438), alpha: 0.5, size: 1.2, sizeEnd: 2.4, life: 1.2, drag: 2 });
    };
    puff(fromX, fromZ);
    puff(to.x, to.z);
    g.sfx.play('blink', this.vol());
  }

  enrage(quiet = false) {
    const g = this.game;
    this.enraged = true;
    this.h?.setGlow('Glow', 0xff5ad8, 4);
    if (quiet) return;
    const vol = this.vol();
    g.ui.log(`<b>${shortName(this.def)}</b> is enraged!`, 'bad');
    g.sfx.play('enrage', vol);
    g.fx.ring(this.pos, 0.5, 6, 0xff5ad8, 0.7);
    g.places.pulse(2);
    g.shake(0.4 * vol);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, d = this.def, T = g.link.renderT;
    // where the world says it was at T: between the two updates around it, or a little past the newest
    const S = this.samples;
    while (S.length > 2 && S[1].t <= T) S.shift();
    const a = S[0], b = S[1];
    let x = a.x, z = a.z, yaw = a.yaw, cur = a;
    if (b) {
      const jump = Math.hypot(b.x - a.x, b.z - a.z) > JUMP;
      if (T >= b.t) {
        cur = b;
        x = b.x; z = b.z; yaw = b.yaw;
        if (b.sp > 0 && !jump) { // a late update: carry on the way it was going, briefly
          const k = Math.min(T - b.t, 200) / Math.max(1, b.t - a.t);
          x += (b.x - a.x) * k;
          z += (b.z - a.z) * k;
        }
      } else if (T > a.t && !jump) {
        const k = (T - a.t) / (b.t - a.t);
        x = lerp(a.x, b.x, k);
        z = lerp(a.z, b.z, k);
        yaw = lerpAngle(a.yaw, b.yaw, k);
      }
    }
    // life: the world's word, unless our own hit is still on its way there
    this.hp = g.link.clock > this.predictUntil ? cur.hp : Math.min(this.hp, cur.hp);
    const st = STATES[cur.s];
    if (this.predicted) {
      if (st !== 'dead' && cur.hp > 0 && g.link.clock - this.predicted > 1.5) this.revive();
    } else if (st === 'dead') {
      this.die(); // (normally the world's death message did that already)
    } else if (this.state !== 'dead') {
      this.state = st;
    }

    if (this.state === 'dead') {
      this.deadT += dt;
      if (this.h) {
        this.h.update(dt);
        if (this.deadT > 2.4) this.obj.position.y -= dt * 0.9;
      }
      if (this.deadT > 3.6) this.removed = true;
      return;
    }

    this.pos.set(x, heightAt(x, z), z);
    this.yaw = yaw;
    this.speed = cur.sp;
    if (this.attack) this.updateAttack(dt);
    this.statusLooks(dt);
    this.sync(dt);
    if (d.lich && Math.random() < dt * 14) { // a cold violet haze around him
      const ang = rand(0, TAU), r = rand(0.3, 1.1);
      g.fx.add.emit({ pos: { x: this.pos.x + Math.cos(ang) * r, y: this.pos.y + rand(0.2, 2.6), z: this.pos.z + Math.sin(ang) * r }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: 0.9, z: 0 }, color: new THREE.Color(this.enraged ? 0xff5ad8 : 0xb57dff).multiplyScalar(2.2), size: 0.2, sizeEnd: 0.02, life: 1.1, drag: 1 });
    }
  }

  statusLooks(dt) {
    this.stunT = Math.max(0, this.stunT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.dotT = Math.max(0, this.dotT - dt);
    this.weakT = Math.max(0, this.weakT - dt);
    this.vulnT = Math.max(0, this.vulnT - dt);
    const fx = this.game.fx;
    if (this.dotT > 0 && Math.random() < dt * 10) { // green bubbles, or flames
      const burn = this.dotKind === 'burn', c = burn ? 0xff7a2a : 0x8aff4a;
      fx.add.emit({ pos: { x: this.pos.x + rand(-0.4, 0.4), y: this.pos.y + rand(0.3, this.height), z: this.pos.z + rand(-0.4, 0.4) }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: 1.1, z: 0 }, color: new THREE.Color(c).multiplyScalar(2.2), size: 0.16, sizeEnd: 0.03, life: 0.7, drag: 1 });
    }
    if (this.weakT > 0 && Math.random() < dt * 5) {
      fx.soft.emit({ pos: { x: this.pos.x + rand(-0.4, 0.4), y: this.pos.y + this.height * 0.6, z: this.pos.z + rand(-0.4, 0.4) }, count: 1, spread: 0.2, velSpread: 0.2, vel: { x: 0, y: 0.3, z: 0 }, color: new THREE.Color(0x5a8a3a), alpha: 0.35, size: 0.5, sizeEnd: 1.1, life: 1.2, drag: 1 });
    }
    if (this.stunT > 0 && Math.random() < dt * 16) { // dizzy stars circling its head
      const ang = this.game.time * 6 + rand(0, 0.5), y = this.pos.y + this.height + 0.15;
      this.game.fx.add.emit({ pos: { x: this.pos.x + Math.cos(ang) * 0.45, y, z: this.pos.z + Math.sin(ang) * 0.45 }, count: 1, spread: 0.05, velSpread: 0.1, vel: { x: -Math.sin(ang) * 1.2, y: 0.1, z: Math.cos(ang) * 1.2 }, color: new THREE.Color(0xffe066).multiplyScalar(2.4), size: 0.16, sizeEnd: 0.04, life: 0.45, drag: 0.5 });
    }
    const frost = this.slowT > 0 ? Math.min(1, this.slowT * 2) : 0;
    if (this.h) this.h.frost = frost;
    else this.frost = frost;
  }

  sync(dt) {
    const d = this.def, speed = this.speed;
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
    if (this.h) {
      const s = d.scale || 1;
      if (speed > d.speed * 0.6) this.h.anim.setBase('Running_A', speed / (4.6 * s));
      else if (speed > 0.1) this.h.anim.setBase('Walking_A', Math.max(0.6, speed / (1.7 * s)));
      else this.h.anim.setBase('Idle_A');
      this.h.highlight = this.hover || this.selected ? 1 : 0;
      this.h.update(dt);
      return;
    }
    // slime: rises out of the ground, hops while moving, squash & stretch
    const s = this.slime;
    if (this.grow < 1) {
      this.grow = Math.min(1, this.grow + dt / 0.5);
      const t = this.grow;
      this.obj.scale.setScalar(d.size * (t < 1 ? 1 + Math.sin(t * Math.PI) * 0.35 : 1) * Math.max(0.01, t));
    }
    const moving = speed > 0.1 || this.attack?.lunge;
    this.hopT += dt * (moving ? 2.6 : 1.1);
    const ph = this.hopT % 1;
    let lift = 0, sq = 0;
    if (moving) {
      lift = Math.max(0, Math.sin(ph * Math.PI)) * 0.45 * (this.attack?.lunge ? 1.8 : 1);
      sq = Math.cos(ph * Math.PI * 2) * 0.12;
    } else {
      sq = Math.sin(this.hopT * Math.PI * 2) * 0.05;
    }
    this.squash = Math.max(0, (this.squash || 0) - dt * 2);
    sq += this.squash * Math.sin(this.hopT * 30);
    s.body.position.y = lift;
    s.body.scale.set(1 + sq, 1 - sq * 1.4, 1 + sq);
    this.slimeFlash = Math.max(0, (this.slimeFlash || 0) - dt * 6);
    s.mat.emissive.copy(s.baseEmissive).addScalar(this.slimeFlash * 0.8 + (this.hover || this.selected ? 0.12 : 0));
    if (this.frost) { s.mat.emissive.g += this.frost * 0.15; s.mat.emissive.b += this.frost * 0.45; }
    if (d.glow && Math.random() < dt * 6) {
      this.game.fx.add.emit({ pos: { x: this.pos.x, y: this.pos.y + 0.9 * d.size, z: this.pos.z }, count: 1, spread: 0.3, velSpread: 0.3, vel: { x: 0, y: 1.4, z: 0 }, color: new THREE.Color(0xffa040).multiplyScalar(3), size: 0.12, sizeEnd: 0.02, life: 0.9, drag: 1 });
    }
  }
}

// The monsters our hero can see, by the world's id.
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
  }

  // Full records (a monster comes into sight) and updates ([id, x, z, yaw, speed, life, state]).
  records(recs, ts) {
    for (const r of recs) {
      if (Array.isArray(r)) {
        this.byId.get(r[0])?.sample(ts, r[1], r[2], r[3], r[4], r[5], r[6]);
        continue;
      }
      if (!r || !has(ENEMY_TYPES, r.t) || r.s === 4) continue; // (already dead: nothing to see)
      this.remove(r.i);
      const e = new Enemy(this.game, r, ts);
      this.byId.set(r.i, e);
      this.list.push(e);
    }
  }

  remove(id) {
    const e = this.byId.get(id);
    if (!e) return;
    e.dispose();
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(e), 1);
  }

  clear() {
    for (const e of this.list) e.dispose();
    this.list = [];
    this.byId.clear();
  }

  event(ev) {
    this.byId.get(ev[1])?.event(ev);
  }

  // [d, id, x, z, credits: [[hero, XP share, loot]], killer, type, level]: it fell. If we have a share
  // (we hurt it, or our party did nearby), it comes now.
  died(ev) {
    const [, id, x, z, credits, , type, level] = ev;
    const e = this.byId.get(id), g = this.game;
    if (e) {
      e.die();
      e.predicted = 0;
    }
    const mine = Array.isArray(credits) && credits.find((c) => (Array.isArray(c) ? c[0] : c) === g.link.pid);
    if (!mine || !has(ENEMY_TYPES, type)) return;
    const share = Array.isArray(mine) ? clamp(Number(mine[1]) || 0, 0, 3) : 1, loot = Array.isArray(mine) ? mine[2] === 1 : true;
    const pos = e ? e.pos.clone() : new THREE.Vector3(x, heightAt(x, z), z);
    g.rewardKill({ type, level, def: ENEMY_TYPES[type], pos, height: e ? e.height : 2, share, loot });
  }

  update(dt) {
    for (const e of this.list) e.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.removed) continue;
      e.dispose();
      this.byId.delete(e.id);
      this.list.splice(i, 1);
    }
  }

  // A boss in a fight near our hero (the boss bar and its music).
  get boss() {
    const p = this.game.player.pos;
    return this.list.find((e) => e.def.boss && e.alive && e.state === 'chase' && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < (e.def.worldBoss ? 60 : 40)) || null;
  }
}

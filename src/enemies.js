// Monsters: procedural slimes + KayKit humanoids (bandits, cultists, the bosses), their AI and respawning.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { heightAt, resolveCollision, randomWalkablePoint, isWalkable, zoneAt } from './world.js';
import { inDungeon, steer, lineClear, CRYPT_SPAWNS, ROOMS } from './dungeon.js';
import { rand, randInt, chance, angleDiff, dampAngle, yawTo, clamp, TAU } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);

export const ENEMY_TYPES = {
  slime: { name: 'Slime', kind: 'slime', color: 0x7ed957, size: 0.9, hp: 26, dmg: 5, speed: 3.0, range: 1.35, atkCd: 1.4, aggro: 8.5, xp: 12, radius: 0.55, gold: [1, 4], drop: 0.12 },
  slime_blue: { name: 'Bog Slime', kind: 'slime', color: 0x57c7ff, size: 1.0, hp: 36, dmg: 7, speed: 3.1, range: 1.45, atkCd: 1.3, aggro: 9, xp: 18, radius: 0.6, gold: [2, 6], drop: 0.16 },
  slime_red: { name: 'Magma Slime', kind: 'slime', color: 0xff5a24, glow: 0.55, size: 1.2, hp: 60, dmg: 11, speed: 3.3, range: 1.6, atkCd: 1.3, aggro: 10, xp: 30, radius: 0.72, gold: [4, 9], drop: 0.22 },
  bandit: { name: 'Bandit', kind: 'humanoid', model: 'Rogue_Hooded', weapon: 'dagger', hp: 70, dmg: 10, speed: 4.3, range: 1.9, atkCd: 1.35, atkDur: 0.6, aggro: 11, xp: 34, radius: 0.5, gold: [4, 12], drop: 0.3 },
  cultist: { name: 'Cultist', kind: 'caster', model: 'Mage', weapon: 'wand', tint: 0xc9a8ff, hp: 52, dmg: 12, speed: 3.6, range: 11, keep: 7, atkCd: 2.3, aggro: 14, xp: 40, radius: 0.5, gold: [5, 12], drop: 0.3 },
  // KayKit Skeletons pack — same rig, so they share every animation with the adventurers
  skeleton_minion: { name: 'Skeleton Minion', kind: 'humanoid', model: 'Skeleton_Minion', weapon: 'Skeleton_Blade', undead: true, eyes: 0x6dffd8, hp: 55, dmg: 10, speed: 4.1, range: 1.9, atkCd: 1.3, atkDur: 0.6, aggro: 11, xp: 30, radius: 0.5, gold: [3, 9], drop: 0.25, loot: 'bone' },
  skeleton_warrior: { name: 'Skeleton Warrior', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', offhand: 'Skeleton_Shield_Large_A', style: 'chop', scale: 1.1, undead: true, eyes: 0xff8a3a, hp: 120, dmg: 16, speed: 3.4, range: 2.2, atkCd: 1.8, atkDur: 0.85, aggro: 11, xp: 55, radius: 0.6, gold: [6, 14], drop: 0.35, loot: 'bone' },
  skeleton_rogue: { name: 'Skeleton Rogue', kind: 'humanoid', model: 'Skeleton_Rogue', weapon: 'Skeleton_Blade', offhand: 'Skeleton_Shield_Small_A', undead: true, eyes: 0xff4a6a, hp: 62, dmg: 11, speed: 5.4, range: 1.8, atkCd: 0.95, atkDur: 0.45, aggro: 12, xp: 38, radius: 0.5, gold: [4, 10], drop: 0.3, loot: 'bone' },
  skeleton_mage: { name: 'Skeleton Mage', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', undead: true, eyes: 0x7dff6a, bolt: 0x5dff8a, hp: 58, dmg: 14, speed: 3.4, range: 12, keep: 8, atkCd: 2.2, aggro: 15, xp: 50, radius: 0.5, gold: [5, 12], drop: 0.35, loot: 'bone' },
  brute: { name: 'Grok the Brute', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', scale: 1.5, boss: true, hp: 270, dmg: 24, speed: 4.0, range: 2.9, atkCd: 1.7, atkDur: 1.0, aggro: 13, xp: 320, radius: 0.95, gold: [60, 110], drop: 1, respawn: 75 },
  // the crypt's boss: bolt volleys, erupting grave circles, raises the dead, blinks away when crowded
  lich: { name: 'Morvain the Lich', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', weaponGlow: 0x8a4dff, tint: 0xd6ccf2, scale: 1.7, boss: true, lich: true, undead: true, eyes: 0xb57dff, bolt: 0xb57dff, hp: 450, dmg: 22, speed: 3.3, range: 15, keep: 7, atkCd: 2.0, aggro: 16, xp: 720, radius: 0.85, gold: [140, 220], drop: 1, respawn: 150 },
};

export const SPAWNS = [
  { type: 'slime', x: 0, z: -30, r: 10, n: 6, lvl: 1 },
  { type: 'slime', x: 26, z: 12, r: 7, n: 4, lvl: 1 },
  { type: 'slime_blue', x: -27, z: 20, r: 13, n: 5, lvl: 2, ring: true },
  { type: 'slime', x: 14, z: -14, r: 5, n: 2, lvl: 1 },
  { type: 'bandit', x: 38, z: -46, r: 8, n: 4, lvl: 3 },
  { type: 'cultist', x: 38, z: -46, r: 5, n: 1, lvl: 3 },
  { type: 'slime_red', x: -38, z: -44, r: 9, n: 3, lvl: 4 },
  { type: 'cultist', x: -38, z: -44, r: 5, n: 3, lvl: 5 },
  { type: 'bandit', x: 22, z: -58, r: 6, n: 2, lvl: 4 },
  { type: 'brute', x: 0, z: -71, r: 1, n: 1, lvl: 6 },
  { type: 'bandit', x: 0, z: -66, r: 6, n: 2, lvl: 5 },
  // Forgotten Graveyard
  { type: 'skeleton_minion', x: 3, z: 45, r: 10, n: 4, lvl: 5 },
  { type: 'skeleton_rogue', x: 3, z: 45, r: 9, n: 2, lvl: 6 },
  { type: 'skeleton_warrior', x: 3, z: 47, r: 7, n: 2, lvl: 6 },
  { type: 'skeleton_mage', x: 3, z: 49, r: 6, n: 2, lvl: 7 },
  ...CRYPT_SPAWNS, // the Forgotten Crypt (dungeon.js); they only rise once someone goes down
];

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
  constructor(game, slot) {
    this.game = game;
    this.slot = slot;
    this.type = slot.type;
    this.def = ENEMY_TYPES[slot.type];
    this.level = slot.lvl;
    const d = this.def;
    this.maxHp = Math.round(d.hp * (1 + 0.32 * (this.level - 1)));
    this.hp = this.maxHp;
    this.dmg = d.dmg * (1 + 0.22 * (this.level - 1));
    this.radius = d.radius * (d.scale || 1);
    this.home = slot.ring ? this.ringPoint(slot) : randomWalkablePoint(slot.x, slot.z, slot.r);
    this.crypt = inDungeon(slot.x, slot.z); // walls: path around them, and no seeing through them
    this.pos = this.home.clone();
    this.yaw = rand(0, TAU);
    this.state = 'spawn';
    this.stateT = 0;
    this.atkCd = rand(0.5, d.atkCd);
    this.attack = null;
    this.stagger = 0;
    this.wanderT = rand(1, 4);
    this.wanderTarget = null;
    this.hopT = rand(0, 1);
    this.deadT = 0;
    this.hover = false;
    this.swingCount = 0;
    this.height = d.kind === 'slime' ? 1.05 * d.size : 2.45 * (d.scale || 1);

    if (d.kind === 'slime') {
      const s = buildSlime(d);
      this.slime = s;
      this.obj = s.group;
      this.obj.scale.setScalar(0.01);
    } else {
      this.h = new Humanoid(d.model, { scale: d.scale || 1, tint: d.tint ?? null });
      this.h.equip('r', d.weapon, d.weaponGlow ?? null);
      if (d.offhand) this.h.equip('l', d.offhand);
      else if (this.type === 'bandit' && chance(0.5)) this.h.equip('l', 'shield_round');
      if (d.eyes) this.h.setGlow('Glow', d.eyes, 2.6);
      this.obj = this.h.group;
      this.h.anim.play('Spawn_Ground', { timeScale: d.undead ? 0.9 : 1.2 });
      if (d.undead) game.fx.dust(new THREE.Vector3(this.pos.x, this.pos.y + 0.1, this.pos.z), 16);
    }
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
    game.scene.add(this.obj);
    this.plate = game.ui.createPlate(this);
    if (d.lich) {
      this.circleT = 5;
      this.blinkCd = 6;
      this.closeT = 0;
      this.raised = [];
      this.enraged = false;
    }
  }

  ringPoint(slot) {
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), r = rand(slot.r * 0.72, slot.r);
      const p = randomWalkablePoint(slot.x + Math.cos(a) * r, slot.z + Math.sin(a) * r, 1.5);
      if (p) return p;
    }
    return randomWalkablePoint(slot.x, slot.z, slot.r);
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

  faceTo(x, z, dt, rate = 10) {
    this.yaw = dampAngle(this.yaw, yawTo(x - this.pos.x, z - this.pos.z), rate, dt);
  }

  // Can this monster see the player? Always, outside; in the crypt, not through walls (re-checked 5×/s).
  sees(p) {
    if (!this.crypt) return true;
    const t = this.game.time;
    if (t >= (this.seeAt || 0)) {
      this.seeAt = t + 0.2;
      this.canSee = lineClear(this.pos.x, this.pos.z, p.pos.x, p.pos.z, 0.15);
    }
    return this.canSee;
  }

  moveToward(x, z, speed, dt) {
    if (this.crypt) { // head for the next corner of the path instead of into the wall
      const t = this.game.time;
      if (t >= (this.navAt || 0) || (this.nav && Math.hypot(this.nav.x - this.pos.x, this.nav.z - this.pos.z) < 0.6)) {
        this.navAt = t + 0.25;
        this.nav = steer(this.pos.x, this.pos.z, x, z, this.radius);
      }
      if (this.nav) { x = this.nav.x; z = this.nav.z; }
    }
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.yaw = dampAngle(this.yaw, yawTo(dx, dz), 10, dt);
    return speed;
  }

  takeDamage(amount, fromPos, knock = 0.4) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.state === 'idle' || this.state === 'return') this.aggro(true);
    if (this.h) this.h.hitFlash(0xffffff, 1);
    else { this.slimeFlash = 1; this.squash = 0.35; }
    if (fromPos && !this.def.boss) {
      const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.pos.x += (dx / d) * knock;
      this.pos.z += (dz / d) * knock;
    }
    if (this.hp > 0 && !this.def.boss) {
      // interrupt wind-ups: rewards aggressive play
      if (this.attack && this.attack.t < this.attack.hitAt) {
        this.attack = null;
        if (this.h) this.h.swing = null;
        this.atkCd = Math.max(this.atkCd, 0.6);
      }
      this.stagger = 0.28;
      if (this.h && this.h.anim.oneName !== 'Death_A') this.h.anim.play('Hit_A', { timeScale: 1.6 });
    }
  }

  aggro(alertPack) {
    if (this.state === 'dead' || this.state === 'spawn') return;
    this.state = 'chase';
    this.stateT = 0;
    if (alertPack) {
      for (const e of this.game.enemies.list) {
        if (e !== this && e.alive && e.slot === this.slot && e.state === 'idle' && e.pos.distanceTo(this.pos) < 12) e.aggro(false);
      }
    }
  }

  die() {
    this.state = 'dead';
    this.deadT = 0;
    this.attack = null;
    this.game.ui.removePlate(this.plate);
    this.plate = null;
    if (this.h) {
      this.h.swing = null;
      this.h.anim.play('Death_A', { hold: true, timeScale: 0.9 });
      if (this.def.undead) {
        this.h.setGlow('Glow', 0x000000, 0); // eyes go dark
        this.game.fx.bones(this.center, this.def.eyes);
      }
    } else {
      this.game.fx.goo(this.center, this.def.color, 34);
      this.game.fx.burst(this.center, this.def.color, 16, 3, 0.3, 0.5);
      this.obj.visible = false;
    }
  }

  update(dt) {
    const g = this.game, d = this.def, p = g.player;
    this.stateT += dt;
    this.atkCd -= dt;
    this.stagger -= dt;

    if (this.state === 'dead') {
      this.deadT += dt;
      if (this.h) {
        this.h.update(dt);
        if (this.deadT > 2.4) this.obj.position.y -= dt * 0.9;
      }
      if (this.deadT > 3.6) {
        g.scene.remove(this.obj);
        this.removed = true;
      }
      return;
    }

    if (this.state === 'spawn') {
      if (this.slime) {
        const t = Math.min(1, this.stateT / 0.5);
        this.obj.scale.setScalar(d.size * (t < 1 ? 1 + Math.sin(t * Math.PI) * 0.35 : 1) * t);
      }
      if (this.stateT > (this.h ? 1.0 : 0.5)) {
        this.state = 'idle';
        if (this.slot.summoned) this.aggro(false); // raised by the Lich: straight into the fight
      }
      this.sync(dt, 0);
      return;
    }

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const playerZone = zoneAt(p.pos.x, p.pos.z);
    // (not in camp, and on the same side of the crypt door)
    const targetable = p.alive && !(playerZone && playerZone.safe) && this.crypt === inDungeon(p.pos.x, p.pos.z);
    const distHome = this.pos.distanceTo(this.home);
    let speed = 0;

    if (this.attack) {
      this.updateAttack(dt, dist);
    } else if (this.stagger > 0) {
      // stunned
    } else if (this.state === 'idle') {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderTarget = randomWalkablePoint(this.home.x, this.home.z, 4);
        this.wanderT = rand(3, 7);
        const w = this.wanderTarget; // in the crypt, stay in your own room
        if (this.crypt && !lineClear(this.home.x, this.home.z, w.x, w.z, this.radius)) this.wanderTarget = null;
      }
      if (this.wanderTarget) {
        speed = this.moveToward(this.wanderTarget.x, this.wanderTarget.z, d.speed * 0.35, dt);
        if (this.pos.distanceTo(this.wanderTarget) < 0.3) this.wanderTarget = null;
      }
      if (targetable && dist < d.aggro && this.sees(p)) this.aggro(true);
    } else if (this.state === 'chase') {
      if (!targetable || distHome > d.aggro * 2.4) {
        this.state = 'return';
      } else if (d.lich) {
        speed = this.lichChase(dt, dist, dx, dz);
      } else if (d.kind === 'caster') {
        const sees = this.sees(p);
        if (dist < d.keep * 0.55 && sees) {
          speed = this.moveToward(this.pos.x - dx, this.pos.z - dz, d.speed * 0.8, dt);
        } else if (dist <= d.range && this.atkCd <= 0 && sees) {
          this.startCast();
        } else if (dist > d.range * 0.85 || !sees) {
          speed = this.moveToward(p.pos.x, p.pos.z, d.speed, dt);
        } else {
          this.faceTo(p.pos.x, p.pos.z, dt);
        }
      } else if (dist <= d.range + p.radius && this.atkCd <= 0) {
        this.startAttack();
      } else if (dist > d.range * 0.8) {
        speed = this.moveToward(p.pos.x, p.pos.z, d.speed, dt);
      } else {
        this.faceTo(p.pos.x, p.pos.z, dt);
      }
    } else if (this.state === 'return') {
      speed = this.moveToward(this.home.x, this.home.z, d.speed * 1.2, dt);
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.4 * dt);
      if (distHome < 0.6) this.state = 'idle';
      if (targetable && dist < d.aggro * 0.6 && distHome < d.aggro && this.sees(p)) this.aggro(false);
    }

    // separation from other enemies and the player
    for (const o of g.enemies.list) {
      if (o === this || !o.alive) continue;
      const ex = this.pos.x - o.pos.x, ez = this.pos.z - o.pos.z;
      const rr = this.radius + o.radius;
      const dd = ex * ex + ez * ez;
      if (dd < rr * rr && dd > 1e-6) {
        const k = (rr - Math.sqrt(dd)) * 0.5 / Math.sqrt(dd);
        this.pos.x += ex * k; this.pos.z += ez * k;
      }
    }
    if (p.alive) {
      const rr = this.radius + p.radius;
      if (dist < rr && dist > 1e-4) {
        this.pos.x -= (dx / dist) * (rr - dist);
        this.pos.z -= (dz / dist) * (rr - dist);
      }
    }
    resolveCollision(this.pos, this.radius);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.sync(dt, speed);
    if (d.lich && Math.random() < dt * 14) { // a cold violet haze around him
      const a = rand(0, TAU), r = rand(0.3, 1.1);
      g.fx.add.emit({ pos: { x: this.pos.x + Math.cos(a) * r, y: this.pos.y + rand(0.2, 2.6), z: this.pos.z + Math.sin(a) * r }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: 0.9, z: 0 }, color: new THREE.Color(this.enraged ? 0xff5ad8 : 0xb57dff).multiplyScalar(2.2), size: 0.2, sizeEnd: 0.02, life: 1.1, drag: 1 });
    }
  }

  // ---------------------------------------------------------------- Morvain the Lich
  lichChase(dt, dist, dx, dz) {
    const p = this.game.player, d = this.def;
    const frac = this.hp / this.maxHp;
    for (const th of [0.7, 0.4]) { // raises the dead at 70% and 40% life
      if (frac < th && !this.raised.includes(th)) { this.raised.push(th); this.startSummon(); return 0; }
    }
    if (frac < 0.3 && !this.enraged) this.enrage();
    this.circleT -= dt;
    this.blinkCd -= dt;
    this.closeT = dist < 3.6 ? this.closeT + dt : Math.max(0, this.closeT - dt);
    if (this.closeT > 1.8 && this.blinkCd <= 0) { this.blink(); return 0; }
    const sees = this.sees(p);
    if (sees && this.circleT <= 0 && dist < 20) { this.startCircles(); return 0; }
    if (sees && dist <= d.range && this.atkCd <= 0) { this.startCast(); return 0; }
    if (dist < d.keep * 0.5) return this.moveToward(this.pos.x - dx, this.pos.z - dz, d.speed * 0.8, dt);
    if (!sees || dist > d.range * 0.85) return this.moveToward(p.pos.x, p.pos.z, d.speed, dt);
    this.faceTo(p.pos.x, p.pos.z, dt);
    return 0;
  }

  startSummon() {
    const g = this.game;
    this.attack = { t: 0, dur: 1.5, hitAt: 0.8, hit: false, summon: true };
    this.h.anim.play('Use_Item', { timeScale: 0.9 });
    g.dungeon.pulse(1.6);
    g.sfx.play('summon');
    g.ui.log('<b>Morvain</b> calls the dead to rise!', 'bad');
  }

  startCircles() {
    this.attack = { t: 0, dur: 1.1, hitAt: 0.5, hit: false, circles: true };
    this.h.anim.play('Interact', { timeScale: 1.2 });
    this.circleT = this.enraged ? 5.5 : 8;
    this.game.dungeon.pulse(0.8);
  }

  // A grave circle bursts: bones and violet fire, and it hurts if you're still standing in it.
  erupt(at) {
    const g = this.game, p = g.player;
    g.fx.ring(at, 0.4, 2.6, 0xb57dff, 0.5);
    g.fx.burst(new THREE.Vector3(at.x, at.y + 0.3, at.z), 0xb57dff, 26, 5);
    g.fx.soft.emit({ pos: { x: at.x, y: at.y + 0.3, z: at.z }, count: 10, spread: 0.8, velSpread: 1.5, vel: { x: 0, y: 3, z: 0 }, color: new THREE.Color(0xe8e0d0), size: 0.18, sizeEnd: 0.1, life: 0.8, gravity: 12, drag: 0.6 });
    g.sfx.play('nova', 0.7);
    if (this.alive && p.alive && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < 2.2 + p.radius * 0.5) {
      g.damagePlayer(this.dmg * 1.3, this);
      g.shake(0.3);
    }
  }

  // Too close for comfort: vanish and reappear across the sanctum.
  blink() {
    const g = this.game, p = g.player, B = ROOMS.B;
    let to = null;
    for (let i = 0; i < 12 && !to; i++) {
      const c = randomWalkablePoint(B.cx, B.cz, 8, 1.2);
      if (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) > 8) to = c;
    }
    if (!to) return;
    const puff = (v) => {
      g.fx.burst(new THREE.Vector3(v.x, v.y + 1.4, v.z), 0xb57dff, 30, 4);
      g.fx.soft.emit({ pos: { x: v.x, y: v.y + 1.2, z: v.z }, count: 14, spread: 0.6, velSpread: 1.2, vel: { x: 0, y: 1, z: 0 }, color: new THREE.Color(0x2e2438), alpha: 0.5, size: 1.2, sizeEnd: 2.4, life: 1.2, drag: 2 });
    };
    puff(this.pos);
    this.pos.copy(to);
    puff(this.pos);
    this.blinkCd = this.enraged ? 5 : 7;
    this.closeT = 0;
    this.atkCd = Math.min(this.atkCd, 0.5);
    this.nav = null;
    g.sfx.play('blink');
  }

  enrage() {
    const g = this.game;
    this.enraged = true;
    this.h.setGlow('Glow', 0xff5ad8, 4);
    g.ui.log('<b>Morvain</b> is enraged!', 'bad');
    g.sfx.play('enrage');
    g.fx.ring(this.pos, 0.5, 6, 0xff5ad8, 0.7);
    g.dungeon.pulse(2);
    g.shake(0.4);
  }

  startAttack() {
    const d = this.def;
    this.swingCount++;
    if (d.boss && this.swingCount % 3 === 0) {
      // telegraphed ground slam
      const dur = 1.25;
      this.attack = { t: 0, dur, hitAt: 0.62 * dur, hit: false, slam: true };
      const f = { x: this.pos.x + Math.sin(this.yaw) * 2.2, y: this.pos.y, z: this.pos.z + Math.cos(this.yaw) * 2.2 };
      this.attack.at = f;
      this.game.fx.telegraph(f, 3.6, this.attack.hitAt);
      this.h.startSwing(dur, 'chop');
      return;
    }
    if (this.h) {
      const dur = d.atkDur;
      this.attack = { t: 0, dur, hitAt: 0.45 * dur, hit: false };
      this.h.startSwing(dur, d.style || (d.boss ? 'chop' : this.swingCount % 2 ? 'slash' : 'backslash'));
    } else {
      this.attack = { t: 0, dur: 0.75, hitAt: 0.45, hit: false, lunge: true };
    }
  }

  startCast() {
    this.attack = { t: 0, dur: 1.0, hitAt: 0.5, hit: false, cast: true };
    this.h.anim.play('Throw', { timeScale: 1.4 });
  }

  updateAttack(dt, dist) {
    const a = this.attack, g = this.game, p = g.player, d = this.def;
    a.t += dt;
    if (a.t < a.hitAt) this.faceTo(p.pos.x, p.pos.z, dt, a.slam ? 3 : 8);
    if (!a.hit && a.t >= a.hitAt && (a.summon || a.circles)) { // the Lich's spells
      a.hit = true;
      if (a.summon) {
        const n = this.enraged ? 4 : 3;
        for (let i = 0; i < n; i++) {
          const ang = this.yaw + (i / n) * TAU;
          g.enemies.summon(i === 0 && this.raised.length > 1 ? 'skeleton_warrior' : 'skeleton_minion', this.level - 1,
            this.pos.x + Math.sin(ang) * 3.2, this.pos.z + Math.cos(ang) * 3.2, this);
        }
      } else {
        const spots = [{ x: p.pos.x, z: p.pos.z }];
        for (let i = 1, tries = 0; i < (this.enraged ? 5 : 3) && tries < 30; tries++) {
          const ang = rand(0, TAU), r = rand(2.5, 5); // on open floor, clear of the walls
          const x = p.pos.x + Math.cos(ang) * r, z = p.pos.z + Math.sin(ang) * r;
          if (isWalkable(x, z, 2)) { spots.push({ x, z }); i++; }
        }
        for (const s of spots) {
          const at = new THREE.Vector3(s.x, heightAt(s.x, s.z), s.z);
          g.fx.telegraph(at, 2.2, 1.25, () => this.erupt(at), 0xb05cff);
        }
        g.sfx.play('cast');
      }
    }
    if (a.lunge && a.t > 0.2 && a.t < 0.5) {
      const f = Math.min(1, dist / 1.2);
      this.pos.x += Math.sin(this.yaw) * 4 * f * dt;
      this.pos.z += Math.cos(this.yaw) * 4 * f * dt;
    }
    if (!a.hit && a.t >= a.hitAt) {
      a.hit = true;
      if (a.cast) {
        const hand = new THREE.Vector3();
        this.h.bones.handslotr.getWorldPosition(hand);
        const target = p.pos.clone().setY(p.pos.y + 1.1);
        const aim = target.clone().sub(hand);
        const n = d.lich ? (this.enraged ? 5 : 3) : 1; // the Lich fans out a volley
        for (let i = 0; i < n; i++) {
          const dir = aim.clone().applyAxisAngle(UP, (i - (n - 1) / 2) * 0.2);
          g.projectiles.spawn({ from: hand.clone(), dir, owner: 'enemy', dmg: this.dmg, speed: d.lich ? 12 : 11, color: d.bolt || 0xb070ff, radius: 0.35, range: d.lich ? 20 : 16, size: 0.3 });
        }
      } else if (a.slam) {
        const r = Math.hypot(p.pos.x - a.at.x, p.pos.z - a.at.z);
        g.fx.ring(a.at, 0.5, 4.2, 0xff8a3a, 0.5);
        g.fx.dust(new THREE.Vector3(a.at.x, a.at.y + 0.2, a.at.z), 30);
        g.fx.burst(new THREE.Vector3(a.at.x, a.at.y + 0.3, a.at.z), 0xff9a4a, 30, 5);
        g.shake(0.6);
        g.sfx.play('slam');
        if (r < 3.6 + p.radius) g.damagePlayer(this.dmg * 1.8, this);
      } else {
        const ang = Math.abs(angleDiff(this.yaw, yawTo(p.pos.x - this.pos.x, p.pos.z - this.pos.z)));
        if (dist <= d.range + p.radius + 0.5 && ang < 1.3) g.damagePlayer(this.dmg, this);
        if (this.h) g.sfx.play('swing', 0.5);
      }
    }
    if (a.t >= a.dur) {
      this.attack = null;
      if (!a.summon && !a.circles) this.atkCd = d.atkCd * (this.enraged ? 0.7 : 1) * rand(0.85, 1.15);
      if (a.cast || a.summon || a.circles) this.h.anim.stopOne();
    }
  }

  sync(dt, speed) {
    this.obj.position.copy(this.pos);
    if (this.h) {
      this.obj.rotation.y = this.yaw;
      const s = this.def.scale || 1;
      if (speed > this.def.speed * 0.6) this.h.anim.setBase('Running_A', speed / (4.6 * s));
      else if (speed > 0.1) this.h.anim.setBase('Walking_A', Math.max(0.6, speed / (1.7 * s)));
      else this.h.anim.setBase('Idle_A');
      this.h.highlight = this.hover ? 1 : 0;
      this.h.update(dt);
      return;
    }
    // slime: hop while moving, squash & stretch
    const s = this.slime;
    const moving = speed > 0.1 || (this.attack && this.attack.lunge);
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
    sq += this.squash * Math.sin(this.stateT * 30);
    s.body.position.y = lift;
    s.body.scale.set(1 + sq, 1 - sq * 1.4, 1 + sq);
    this.obj.rotation.y = this.yaw;
    this.slimeFlash = Math.max(0, (this.slimeFlash || 0) - dt * 6);
    s.mat.emissive.copy(s.baseEmissive).addScalar(this.slimeFlash * 0.8 + (this.hover ? 0.12 : 0));
    if (this.def.glow && Math.random() < dt * 6) {
      this.game.fx.add.emit({ pos: { x: this.pos.x, y: this.pos.y + 0.9 * this.def.size, z: this.pos.z }, count: 1, spread: 0.3, velSpread: 0.3, vel: { x: 0, y: 1.4, z: 0 }, color: new THREE.Color(0xffa040).multiplyScalar(3), size: 0.12, sizeEnd: 0.02, life: 0.9, drag: 1 });
    }
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.slots = [];
    for (const sp of SPAWNS) {
      for (let i = 0; i < sp.n; i++) this.slots.push({ ...sp, enemy: null, timer: rand(0, 1.5) });
    }
  }

  update(dt) {
    const p = this.game.player, inside = this.game.dungeon.inside;
    for (const s of this.slots) {
      if (s.enemy || (s.crypt && !inside)) continue;
      s.timer -= dt;
      const far = Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > s.r + 6 || s.timer < -20;
      if (s.timer <= 0 && far) {
        s.enemy = new Enemy(this.game, s);
        this.list.push(s.enemy);
      }
    }
    for (const e of this.list) {
      // nobody near (the other side of the crypt door): don't draw them, and let idle ones rest
      const far = Math.abs(e.pos.x - p.pos.x) > 90 || Math.abs(e.pos.z - p.pos.z) > 90;
      if (e.alive) e.obj.visible = !far;
      if (far && (e.state === 'idle' || e.state === 'spawn')) continue;
      e.update(dt);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.removed) {
        this.list.splice(i, 1);
        e.slot.enemy = null;
        e.slot.timer = e.def.respawn || rand(18, 28);
      }
    }
  }

  // A monster raised mid-fight (by the Lich): no spawn slot, so it never comes back.
  summon(type, lvl, x, z, master) {
    const slot = { type, x, z, r: 1, n: 1, lvl, summoned: true };
    const e = new Enemy(this.game, slot);
    e.summoner = master;
    slot.enemy = e;
    this.list.push(e);
    return e;
  }

  get boss() {
    return this.list.find((e) => e.def.boss && e.alive && e.state === 'chase') || null;
  }
}

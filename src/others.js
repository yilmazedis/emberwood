// Other heroes in the world, as the world reports them: their class's model in their gear, a name tag
// with their life, smooth movement between updates, and what they do (swings, skills, ale, falling and
// rising) played out. Only for show: their own games deal their damage and take their hits. In the
// arena's pit they're foes (all but our party): our attacks treat them like monsters (game.foes) and the
// blows go to their games through the world.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { heightAt, zoneAt } from './world.js';
import { applyEquipmentVisuals, equipmentFromLook, boltAction, arrowAction } from './player.js';
import { SKILLS, auraTick } from './skills.js';
import { blessFx } from './skills/common.js';
import { CLASSES, lookOf } from './classes.js';
import { lerp, angleDiff, clamp, yawTo, has } from './util.js';

const JUMP = 6; // m between two updates: a teleport (respawn), not a run
const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

export class RemotePlayer {
  // r: { i, n: name, c: class, l: level, k: looks, u: [i, x, z, yaw, move, speed, alive, life, away] }
  constructor(game, r, ts) {
    this.game = game;
    this.id = r.i;
    this.name = String(r.n || '?');
    this.cls = has(CLASSES, r.c) ? r.c : 'warrior';
    this.level = 1;
    this.look = Number.isInteger(r.k?.m) ? r.k.m : 0;
    const L = lookOf(this.cls, this.look);
    this.h = new Humanoid(L.model, { palette: L.palette || null });
    this.group = this.h.group;
    this.pos = this.group.position;
    this.radius = 0.5;
    this.yaw = 0;
    this.samples = [];
    this.hp = 1;
    this.away = false;
    this.hostile = false; // in the pit with us, and not in our party
    this.hover = false;
    this.stunT = 0;
    this.slowT = 0;
    this.action = null;
    this.auras = {}; // buffs' looks (skills.js)
    this.sample(ts, r.u);
    const s = this.samples[0] || { x: 0, z: 0, yaw: 0, a: 1 };
    this.pos.set(s.x, heightAt(s.x, s.z), s.z);
    this.alive = s.a !== 0;
    this.setLook(r.k, r.l);
    game.scene.add(this.group);
    this.plate = game.ui.createPlayerPlate(this);
    if (!this.alive) this.h.anim.play('Death_A', { hold: true, startAt: 5 });
  }

  // A full record again: their looks or level changed.
  setInfo(r, ts) {
    this.setLook(r.k, r.l);
    this.sample(ts, r.u);
  }

  setLook(k, level) {
    this.level = clamp(Math.round(Number(level) || this.level), 1, 99);
    applyEquipmentVisuals(this.h, equipmentFromLook(k), this.cls, this.look);
    if (this.plate) this.game.ui.refreshPlayerPlate(this);
  }

  sample(ts, u) {
    if (!Array.isArray(u)) return;
    const [, x, z, yaw, m, sp, a, hp, w] = u.map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
    this.samples.push({ t: ts, x, z, yaw, m, sp: clamp(sp || 0, 0, 20), a, hp: clamp(hp || 0, 0, 1), w });
  }

  get headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 2.7, this.pos.z);
  }

  // ---- as a foe in the arena: the same shape as a monster to our attacks (see game.foes)
  get isHero() { return true; }
  get state() { return 'chase'; }
  get height() { return 2.4; }
  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z); }

  // our blow lands (their game takes it; the world tells everyone the number)
  hurt() {
    this.h.hitFlash(0xffffff, 1);
  }

  // stunned or slowed by a skill: { stun, slow: [f, s] } from our hit, or { s, w } from the world
  applyStatus(eff) {
    if (!eff || !this.alive) return;
    const stun = Number(eff.stun ?? eff.s) || 0, slow = Number(Array.isArray(eff.slow) ? eff.slow[1] : eff.w) || 0;
    if (stun > 0) this.stunT = Math.max(this.stunT, Math.min(1.5, stun));
    if (slow > 0) this.slowT = Math.max(this.slowT, Math.min(6, slow));
  }

  vol() {
    const p = this.game.player.pos;
    return clamp(1 - Math.hypot(p.x - this.pos.x, p.z - this.pos.z) / 28, 0, 1);
  }

  // (until the next update says otherwise: they turned to face it in their game too)
  faceToward(p) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    this.yaw = yawTo(dx, dz);
    this.group.rotation.y = this.yaw;
  }

  aura(id, dur) {
    this.auras[id] = dur;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.game.ui.removePlate(this.plate);
    this.plate = null;
  }

  update(dt) {
    const T = this.game.link.renderT, S = this.samples;
    if (!S.length) return;
    while (S.length > 2 && S[1].t <= T) S.shift();
    const a = S[0], b = S[1];
    let x = a.x, z = a.z, yaw = a.yaw, cur = a;
    if (b) {
      const jump = Math.hypot(b.x - a.x, b.z - a.z) > JUMP;
      if (T >= b.t) {
        cur = b;
        x = b.x; z = b.z; yaw = b.yaw;
        if (b.sp > 0 && !jump) {
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
    this.pos.set(x, heightAt(x, z), z);
    this.yaw = yaw;
    this.group.rotation.y = yaw;
    this.hp = cur.hp;
    this.away = cur.w === 1;
    if (!cur.a && this.alive) this.fall();
    else if (cur.a && !this.alive) this.rise();

    const anim = this.h.anim;
    if (this.alive) {
      if (cur.m === 2) anim.setBase('Running_A', Math.max(0.8, cur.sp / 5.4));
      else if (cur.m === 1) anim.setBase('Walking_A', Math.max(0.7, cur.sp / 2.2));
      else anim.setBase('Idle_A');
      if (cur.m && anim.oneName === 'Hit_A') anim.stopOne();
    }
    const act = this.action;
    if (act) {
      act.t += dt;
      act.tick?.(dt, act);
      if (act.t >= act.dur) {
        this.action = null;
        act.end?.();
      }
    }
    auraTick(this, dt);
    this.statusLooks(dt);
    this.h.highlight = this.hover ? 1 : 0;
    this.h.update(dt);
  }

  statusLooks(dt) {
    this.stunT = Math.max(0, this.stunT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    if (this.stunT > 0 && Math.random() < dt * 16) {
      const ang = this.game.time * 6, y = this.pos.y + 2.55;
      this.game.fx.add.emit({ pos: { x: this.pos.x + Math.cos(ang) * 0.45, y, z: this.pos.z + Math.sin(ang) * 0.45 }, count: 1, spread: 0.05, velSpread: 0.1, vel: { x: -Math.sin(ang) * 1.2, y: 0.1, z: Math.cos(ang) * 1.2 }, color: new THREE.Color(0xffe066).multiplyScalar(2.4), size: 0.16, sizeEnd: 0.04, life: 0.45, drag: 0.5 });
    }
    this.h.frost = this.slowT > 0 ? Math.min(1, this.slowT * 2) : 0;
  }

  fall() {
    this.alive = false;
    this.endAction();
    this.h.swing = null;
    this.h.anim.play('Death_A', { hold: true });
    const vol = this.vol();
    if (vol) this.game.sfx.play('death', 0.5 * vol);
  }

  rise() {
    this.alive = true;
    this.h.anim.play('Spawn_Ground', { timeScale: 1.2 });
  }

  endAction() {
    const act = this.action;
    this.action = null;
    act?.end?.();
  }

  // ---------------------------------------------------------------- what they did (from their game)
  act(a) {
    if (!a || typeof a !== 'object') return;
    const g = this.game, vol = this.vol();
    switch (a.k) {
      case 'sw': { // a weapon swing: { s: style, d: duration }
        if (!this.alive) return;
        const dur = clamp(Number(a.d) || 0.5, 0.15, 2), style = ['slash', 'backslash', 'chop', 'stab', 'cleave'].includes(a.s) ? a.s : 'slash';
        this.endAction();
        this.h.startSwing(dur, style);
        if (vol) g.sfx.play('swing', 0.45 * vol);
        this.action = {
          t: 0, dur, hit: false,
          tick: (dt, s) => {
            if (s.hit || s.t < dur * 0.45) return;
            s.hit = true;
            if (style === 'chop' || style === 'cleave') g.fx.arc(this.pos, this.yaw, { span: 1.3, rIn: 0.5, rOut: 2.8, color: 0xfff2d0, dur: 0.2 });
            else g.fx.arc(this.pos, this.yaw, { span: 2.1, rIn: 0.6, rOut: 2.4, color: 0xfff2d0, dur: 0.22, reverse: style === 'backslash' });
          },
        };
        break;
      }
      case 'sk': this.skill(a); break; // a skill: { id, x, z: where it was aimed, or where they went }
      case 'bo': case 'ar': { // a staff's bolt or an arrow: { x, z }
        if (!this.alive) return;
        const x = Number(a.x), z = Number(a.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        const at = new THREE.Vector3(x, heightAt(x, z), z);
        this.endAction();
        this.faceToward(at);
        this.action = { t: 0, dur: 0.4, ...(a.k === 'ar' ? arrowAction(this, at, false) : boltAction(this, at, false)) };
        break;
      }
      case 'dr': g.fx.heal(this.pos); if (vol) g.sfx.play('drink', 0.6 * vol); break;
      case 'hu': this.h.hitFlash(0xff2a1a, 0.9); break;
      case 'de': if (this.alive) this.fall(); break;
      case 're': if (!this.alive) this.rise(); break;
      case 'lv':
        g.fx.levelUp(this.pos);
        if (vol) g.sfx.play('levelup', 0.6 * vol);
        break;
      default: break;
    }
  }

  // A skill they used: the same show as ours (skills.js), without the damage (their game deals it).
  // { id, x, z: where it went, t: what it was cast at (a monster's id, h<hero id>, or 0: themselves), pw }
  skill(a) {
    if (!this.alive || typeof a.id !== 'string' || !has(SKILLS, a.id)) return;
    const g = this.game, tx = Number(a.x), tz = Number(a.z);
    const at = Number.isFinite(tx) && Number.isFinite(tz) ? new THREE.Vector3(tx, heightAt(tx, tz), tz) : null;
    let target = null;
    if (a.t === 0) target = this;
    else if (typeof a.t === 'string' && a.t[0] === 'h') { const id = Number(a.t.slice(1)); target = id === g.link.pid ? g.player : g.others.byId.get(id) || null; }
    else if (Number.isFinite(a.t)) target = g.enemies.byId.get(a.t) || null;
    this.endAction();
    this.action = SKILLS[a.id].cast(this, { at, target, pw: clamp(Number(a.pw) || 1, 1, 2) }, false);
  }
}

// The other heroes our hero can see, by the world's id.
export class RemotePlayers {
  // A hero helped another we can see ([B, them, kind, value, by]): the glow of it.
  helped([, id, kind]) {
    const o = this.byId.get(id), g = this.game;
    if (!o) return;
    if (kind === 'heal') g.fx.heal(o.pos);
    else if (kind === 'buff') blessFx(g, o.pos, 0xffe08a, 16);
    else if (kind === 'rez') g.fx.levelUp(o.pos);
  }

  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
  }

  records(recs, ts) {
    for (const r of recs) {
      if (Array.isArray(r)) {
        this.byId.get(r[0])?.sample(ts, r);
        continue;
      }
      if (!r || !Array.isArray(r.u)) continue;
      const known = this.byId.get(r.i);
      if (known) { known.setInfo(r, ts); continue; }
      const o = new RemotePlayer(this.game, r, ts);
      this.byId.set(r.i, o);
      this.list.push(o);
    }
  }

  remove(id) {
    const o = this.byId.get(id);
    if (!o) return;
    o.dispose();
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(o), 1);
  }

  clear() {
    for (const o of this.list) o.dispose();
    this.list = [];
    this.byId.clear();
  }

  act(id, a) {
    this.byId.get(id)?.act(a);
  }

  update(dt) {
    const g = this.game;
    for (const o of this.list) {
      o.update(dt);
      const hostile = !!g.pvp && o.alive && !g.party.has(o.id) && !!zoneAt(o.pos.x, o.pos.z)?.pvp;
      if (hostile !== o.hostile) {
        o.hostile = hostile;
        o.plate?.el.classList.toggle('hostile', hostile);
      }
    }
  }
}

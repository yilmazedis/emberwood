// Other heroes in the world, as the world reports them: their class's model in their gear, a name tag
// with their life, smooth movement between updates, and what they do (swings, skills, ale, falling and
// rising) played out. Only for show: their own games deal their damage and take their hits.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { heightAt } from './world.js';
import { applyEquipmentVisuals, equipmentFromLook } from './player.js';
import { CLASSES } from './classes.js';
import { hdr } from './fx.js';
import { lerp, angleDiff, clamp } from './util.js';

const JUMP = 6; // m between two updates: a teleport (respawn), not a run
const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

export class RemotePlayer {
  // r: { i, n: name, c: class, l: level, k: looks, u: [i, x, z, yaw, move, speed, alive, life, away] }
  constructor(game, r, ts) {
    this.game = game;
    this.id = r.i;
    this.name = String(r.n || '?');
    this.cls = Object.hasOwn(CLASSES, r.c) ? r.c : 'knight';
    this.level = 1;
    this.h = new Humanoid(CLASSES[this.cls].model);
    this.group = this.h.group;
    this.pos = this.group.position;
    this.radius = 0.5;
    this.yaw = 0;
    this.samples = [];
    this.hp = 1;
    this.away = false;
    this.action = null;
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
    applyEquipmentVisuals(this.h, equipmentFromLook(k), this.cls);
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

  vol() {
    const p = this.game.player.pos;
    return clamp(1 - Math.hypot(p.x - this.pos.x, p.z - this.pos.z) / 28, 0, 1);
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
    this.h.update(dt);
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
        const dur = clamp(Number(a.d) || 0.5, 0.15, 2), style = ['slash', 'backslash', 'chop'].includes(a.s) ? a.s : 'slash';
        this.endAction();
        this.h.startSwing(dur, style);
        if (vol) g.sfx.play('swing', 0.45 * vol);
        this.action = {
          t: 0, dur, hit: false,
          tick: (dt, s) => {
            if (s.hit || s.t < dur * 0.45) return;
            s.hit = true;
            if (style === 'chop') g.fx.arc(this.pos, this.yaw, { span: 1.3, rIn: 0.5, rOut: 2.8, color: 0xfff2d0, dur: 0.2 });
            else g.fx.arc(this.pos, this.yaw, { span: 2.1, rIn: 0.6, rOut: 2.4, color: 0xfff2d0, dur: 0.22, reverse: style === 'backslash' });
          },
        };
        break;
      }
      case 'sk': this.skill(a); break; // a skill: { id, x, z: where it was aimed }
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

  skill(a) {
    if (!this.alive) return;
    const g = this.game, vol = this.vol();
    const tx = Number(a.x), tz = Number(a.z);
    const target = Number.isFinite(tx) && Number.isFinite(tz) ? new THREE.Vector3(tx, heightAt(tx, tz), tz) : null;
    this.endAction();
    switch (a.id) {
      case 'cleave': {
        const dur = 0.78;
        this.h.startSwing(dur, 'cleave');
        if (vol) g.sfx.play('swing', vol);
        this.action = {
          t: 0, dur, hit: false,
          tick: (dt, s) => {
            if (s.hit || s.t < dur * 0.5) return;
            s.hit = true;
            g.fx.arc(this.pos, this.yaw, { span: 3.4, rIn: 0.7, rOut: 3.6, color: 0xffc070, dur: 0.3 });
            g.fx.dust(new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 2, this.pos.y + 0.1, this.pos.z + Math.cos(this.yaw) * 2), 10);
            if (vol) g.sfx.play('cleave', vol);
          },
        };
        break;
      }
      case 'fireball': {
        this.h.anim.play('Throw', { timeScale: 2.1, startAt: 0.2 });
        if (vol) g.sfx.play('cast', vol);
        this.action = {
          t: 0, dur: 0.5, fired: false,
          tick: (dt, s) => {
            if (s.fired || s.t < 0.24) return;
            s.fired = true;
            const from = new THREE.Vector3();
            this.h.bones.handslotr.getWorldPosition(from);
            from.y = Math.max(from.y, this.pos.y + 1.3);
            const to = target ? new THREE.Vector3(target.x, from.y, target.z) : new THREE.Vector3(from.x + Math.sin(this.yaw) * 10, from.y, from.z + Math.cos(this.yaw) * 10);
            if (to.distanceTo(from) < 1) to.set(from.x + Math.sin(this.yaw), from.y, from.z + Math.cos(this.yaw));
            g.projectiles.spawn({ from, to, owner: 'remote', speed: 19, color: 0xff7a2a, trail: 0xff2a00, radius: 0.45, range: 20, aoe: 2.8, size: 0.32 });
            if (vol) g.sfx.play('fireball', vol);
          },
          end: () => this.h.anim.stopOne(),
        };
        break;
      }
      case 'whirlwind':
        this.h.armsOut = 1;
        if (vol) g.sfx.play('whirl', vol);
        this.action = {
          t: 0, dur: 1.4, next: 0.05,
          tick: (dt, s) => {
            this.h.model.rotation.y += dt * 17;
            if (s.t >= s.next) {
              s.next += 0.27;
              g.fx.ring(this.pos, 0.8, 3.1, 0xffd9a0, 0.28, 0.9, 0.7);
            }
            if (Math.random() < 0.5) {
              const ang = this.h.model.rotation.y + this.yaw;
              g.fx.add.emit({ pos: { x: this.pos.x + Math.sin(ang) * 1.9, y: this.pos.y + 1.0, z: this.pos.z + Math.cos(ang) * 1.9 }, count: 2, spread: 0.1, velSpread: 0.6, color: hdr(0xfff0c0, 2), colorEnd: hdr(0xffa040, 0.3), size: 0.18, sizeEnd: 0.02, life: 0.3 });
            }
          },
          end: () => { this.h.armsOut = 0; this.h.model.rotation.y = 0; },
        };
        break;
      case 'heal':
        this.h.anim.play('Use_Item', { timeScale: 2 });
        this.action = {
          t: 0, dur: 0.6, done: false,
          tick: (dt, s) => {
            if (s.done || s.t < 0.25) return;
            s.done = true;
            g.fx.heal(this.pos);
            g.fx.ring(this.pos, 0.3, 2.4, 0x6dff8a, 0.6);
            if (vol) g.sfx.play('heal', 0.7 * vol);
          },
          end: () => this.h.anim.stopOne(),
        };
        break;
      default: break;
    }
  }
}

// The other heroes our hero can see, by the world's id.
export class RemotePlayers {
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
    for (const o of this.list) o.update(dt);
  }
}

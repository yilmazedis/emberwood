// What every class's skills share: where things are (ahead of a hero, its weapon hand), how far a leap or a
// blink can go, how a shot is aimed, and sounds that fade with distance. See skills.js for how a skill works.
import * as THREE from 'three';
import { heightAt, isWalkable, wallAt } from '../world.js';
import { hdr } from '../fx.js';
import { rand, TAU } from '../util.js';

export const UP = new THREE.Vector3(0, 1, 0);
export const ahead = (a, d) => new THREE.Vector3(a.pos.x + Math.sin(a.yaw) * d, a.pos.y, a.pos.z + Math.cos(a.yaw) * d);
export const play = (a, name, vol = 1) => { const v = a.vol() * vol; if (v > 0.01) a.game.sfx.play(name, v); };
export const flat = (x, z) => new THREE.Vector3(x, heightAt(x, z), z);

// The farthest spot toward `to`, at most `max` away, where a hero can stand, never through a dungeon
// wall: where leaps, charges and teleports end.
export function reachable(from, to, max) {
  const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
  const d = Math.min(max, len);
  let best = from.clone();
  if (len < 0.01) return best;
  for (let s = 0.3; s <= d + 1e-6; s += 0.3) {
    const x = from.x + (dx / len) * s, z = from.z + (dz / len) * s;
    if (wallAt(x, z)) break;
    if (isWalkable(x, z, 0.4)) best = new THREE.Vector3(x, heightAt(x, z), z);
  }
  return best;
}

// A spot beside (behind, if it can) a foe, as seen from `from`: where a rogue steps out of the shadows.
export function behind(target, from) {
  const base = Math.atan2(target.pos.x - from.x, target.pos.z - from.z), r = target.radius + 0.9;
  for (const off of [0, 0.9, -0.9, 1.8, -1.8, Math.PI]) {
    const x = target.pos.x + Math.sin(base + off) * r, z = target.pos.z + Math.cos(base + off) * r;
    if (isWalkable(x, z, 0.4) && !wallAt(x, z)) return flat(x, z);
  }
  return reachable(from, target.pos, 12);
}

export function puff(g, p, hex) {
  g.fx.burst(new THREE.Vector3(p.x, p.y + 1.2, p.z), hex, 26, 3.5);
  g.fx.soft.emit({ pos: { x: p.x, y: p.y + 1, z: p.z }, count: 12, spread: 0.5, velSpread: 1, vel: { x: 0, y: 0.8, z: 0 }, color: new THREE.Color(0x2e2638), alpha: 0.45, size: 1, sizeEnd: 2.2, life: 1, drag: 2 });
}

// Which way a shot from `from` should fly: toward what was aimed at, or straight ahead if nothing was
// (or it's right under our nose). Heroes' shots then glide over the ground (see Projectiles).
export function aimedAt(a, from, point) {
  const ahead10 = new THREE.Vector3(from.x + Math.sin(a.yaw) * 10, from.y, from.z + Math.cos(a.yaw) * 10);
  if (!point || Math.hypot(point.x - from.x, point.z - from.z) < 1.2) return ahead10;
  return new THREE.Vector3(point.x, from.y, point.z);
}

// The weapon hand (the left one for a bow), for things thrown, shot or cast from it (at least chest high).
export function handPos(a, left = false) {
  const p = new THREE.Vector3();
  a.h.bones[left ? 'handslotl' : 'handslotr'].getWorldPosition(p);
  p.y = Math.max(p.y, a.pos.y + 1.2);
  return p;
}

// The point a skill went to: the foe it was aimed at, the spot, or a few metres ahead.
export const pointOf = (a, ctx, d = 6) => (ctx.target ? ctx.target.pos.clone() : ctx.at ? ctx.at.clone() : ahead(a, d));

// A glowing ring of motes rising from the ground (heals, tonics, buffs landing on a hero).
export function blessFx(g, p, hex, count = 30) {
  g.fx.add.emit({ pos: { x: p.x, y: p.y + 0.2, z: p.z }, count, spread: 0.6, velSpread: 0.4, vel: { x: 0, y: 2.2, z: 0 }, color: hdr(hex, 2.2), colorEnd: hdr(hex, 0.25), size: 0.2, sizeEnd: 0.04, life: 1.0, drag: 1.2, flat: true });
  g.fx.ring(p, 0.3, 1.6, hex, 0.5);
}

// Swirling bits around a spot for a while (poison clouds, burning ground, blizzards, holy ground): calls
// tick(dt) every frame for `dur` seconds while the visuals run.
export function lingering(g, at, { dur, radius, color, soft = null, rate = 30, rise = 0.6, tick = null }) {
  let t = 0;
  const run = (dt) => {
    t += dt;
    const n = Math.floor(rate * dt + Math.random());
    for (let i = 0; i < n; i++) {
      const ang = rand(0, TAU), r = Math.sqrt(Math.random()) * radius;
      const x = at.x + Math.cos(ang) * r, z = at.z + Math.sin(ang) * r;
      const y = heightAt(x, z) + 0.1;
      if (soft !== null) g.fx.soft.emit({ pos: { x, y: y + 0.3, z }, count: 1, spread: 0.2, velSpread: 0.2, vel: { x: 0, y: rise * 0.6, z: 0 }, color: new THREE.Color(soft), alpha: 0.4, size: 0.9, sizeEnd: 2, life: 1.4, drag: 1.5 });
      else g.fx.add.emit({ pos: { x, y, z }, count: 1, spread: 0.1, velSpread: 0.3, vel: { x: 0, y: rise * 2, z: 0 }, color: hdr(color, 2.2), colorEnd: hdr(color, 0.2), size: 0.22, sizeEnd: 0.04, life: 0.8, drag: 1 });
    }
    tick?.(dt, t);
    return t < dur;
  };
  g.fx.ring(at, radius * 0.9, radius, color, Math.min(dur, 1.2), 0.1, 1.2);
  g.addTicker(run);
}

// A land of its own beyond the waystones (Frostfang, Cinderfall, Shadowmere): rolling ground walled in by
// hills, pools that block the way (lava, black water) or don't (a frozen lake), zones and their monsters, a
// camp with a waystone and the door of a dungeon. Shared by the game (lands.js draws it) and the game
// server (its monsters walk it), so plain numbers only. Each land sits far from the others in the same
// coordinates (centred on cx, cz); a definition is written around (0, 0) and moved there.
import { registerRegion, addCollider } from './terrain.js';
import { fbm, noise2 } from './noise.js';
import { clamp, lerp, smoothstep, mulberry32 } from './util.js';

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export class OutdoorMap {
  // def: { id, cx, cz, radius, seed, ground: { base, hills, rough, freq }, camp: { x, z, r }, zones, pools,
  //   paths, door: { x, z, yaw } (the dungeon's), trees: { kinds: { kind: weight }, density }, rocks, props(map, put, rng) }
  constructor(def) {
    this.id = def.id;
    this.def = def;
    const cx = def.cx, cz = def.cz;
    this.cx = cx;
    this.cz = cz;
    this.R = def.radius;
    const g = def.ground || {};
    this.ground = { base: 1.3, hills: 2.4, rough: 0.2, freq: 0.028, ...g };
    this.noiseX = (def.seed % 997) * 3.1; // each land its own hills
    this.noiseZ = (def.seed % 991) * 1.7;
    const at = (p) => ({ ...p, x: p.x + cx, z: p.z + cz });
    this.camp = at(def.camp);
    this.zones = def.zones.map(at);
    this.pools = (def.pools || []).map(at);
    this.paths = (def.paths || []).map((pts) => pts.map(([x, z]) => [x + cx, z + cz]));
    this.door = def.door ? at(def.door) : null;
    this.bounds = { x0: cx - this.R - 34, x1: cx + this.R + 34, z0: cz - this.R - 34, z1: cz + this.R + 34 };
    registerRegion({
      contains: (x, z) => this.contains(x, z),
      heightAt: (x, z) => this.heightAt(x, z),
      resolve: (pos, radius) => this.resolve(pos, radius),
      clear: (x, z, radius) => this.clear(x, z, radius),
      zoneAt: (x, z) => this.zoneAt(x, z),
    });
    this.plan = this.makePlan();
  }

  contains(x, z) { const b = this.bounds; return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; }
  toLocal(x, z) { return [x - this.cx, z - this.cz]; }

  pathDist(x, z) {
    let d = Infinity;
    for (const p of this.paths) for (let i = 0; i < p.length - 1; i++) d = Math.min(d, distToSeg(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
    return d;
  }

  heightAt(x, z) {
    const G = this.ground, lx = x - this.cx, lz = z - this.cz;
    let h = G.base + fbm(lx * G.freq + this.noiseX, lz * G.freq + this.noiseZ, 4) * G.hills + noise2(lx * 0.13 + this.noiseZ, lz * 0.13) * G.rough;
    h = 0.8 + Math.log1p(Math.exp((h - 0.8) * 3)) / 3; // soft floor: flat lowlands
    const dc = Math.hypot(x - this.camp.x, z - this.camp.z);
    h = lerp(1.25, h, smoothstep(this.camp.r - 4, this.camp.r + 5, dc)); // flat camp
    const dd = this.door ? Math.hypot(x - this.door.x, z - this.door.z) : Infinity;
    if (dd < 9) h = lerp(1.25, h, smoothstep(4, 9, dd)); // and level ground at the dungeon's door
    const edge = Math.hypot(lx, lz) - (this.R - 6);
    if (edge > 0) h += Math.pow(edge, 1.5) * 0.18; // hills that wall the land in
    for (const p of this.pools) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 4) h = lerp(h, p.kind === 'ice' ? 0.55 : -0.9, 1 - smoothstep(p.r * (p.kind === 'ice' ? 0.85 : 0.3), p.r + (p.kind === 'ice' ? 1.5 : 4), d));
    }
    return h;
  }

  zoneAt(x, z) {
    for (const zn of this.zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn;
    return null;
  }

  // lava and black water block the way; a frozen lake is walked on
  blocks(p) { return p.kind !== 'ice'; }

  resolve(pos, radius) {
    const lx = pos.x - this.cx, lz = pos.z - this.cz, d = Math.hypot(lx, lz), maxR = this.R - 2;
    if (d > maxR) { pos.x = this.cx + (lx * maxR) / d; pos.z = this.cz + (lz * maxR) / d; }
    for (const p of this.pools) {
      if (!this.blocks(p)) continue;
      const px = pos.x - p.x, pz = pos.z - p.z, dp = Math.hypot(px, pz), pr = p.r - 0.4 + radius;
      if (dp < pr && dp > 1e-4) { pos.x = p.x + (px / dp) * pr; pos.z = p.z + (pz / dp) * pr; }
    }
  }

  clear(x, z, radius) {
    if (Math.hypot(x - this.cx, z - this.cz) > this.R - 3) return false;
    for (const p of this.pools) if (this.blocks(p) && Math.hypot(x - p.x, z - p.z) < p.r + radius) return false;
    return true;
  }

  // Open ground: away from camp, the door, paths, pools and the middle of every zone (trees and rocks go here).
  openGround(x, z, margin = 0) {
    if (Math.hypot(x - this.camp.x, z - this.camp.z) < this.camp.r + 3 + margin) return false;
    if (this.door && Math.hypot(x - this.door.x, z - this.door.z) < 8 + margin) return false;
    if (this.pathDist(x, z) < 3 + margin) return false;
    for (const p of this.pools) if (Math.hypot(x - p.x, z - p.z) < p.r + 3 + margin) return false;
    for (const zn of this.zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.r * 0.72 + margin) return false;
    return true;
  }

  // ---------------------------------------------------------------- what stands where (colliders too)
  makePlan() {
    const def = this.def, rng = mulberry32(def.seed), R = this.R;
    const plan = { trees: {}, rocks: [], props: [], mapDots: [] };
    const T = def.trees || { kinds: { pine: 1 }, density: 0.6 };
    const kinds = Object.entries(T.kinds), total = kinds.reduce((n, [, w]) => n + w, 0);
    for (const [k] of kinds) plan.trees[k] = [];
    const STEP = 3.1, EXT = R + 26;
    for (let gx = -EXT; gx <= EXT; gx += STEP) {
      for (let gz = -EXT; gz <= EXT; gz += STEP) {
        const lx = gx + (rng() - 0.5) * STEP * 0.9, lz = gz + (rng() - 0.5) * STEP * 0.9;
        const dc = Math.hypot(lx, lz);
        if (dc > EXT) continue;
        const x = lx + this.cx, z = lz + this.cz;
        const wall = dc > R - 5;
        const density = wall ? 0.9 : clamp((fbm(lx * 0.045 + 100 + this.noiseX, lz * 0.045 - 50, 3) - 0.02) * 2.4, 0, 0.8) * (T.density ?? 0.6) / 0.6;
        if (!wall && !this.openGround(x, z)) continue;
        if (rng() > density) continue;
        let r = rng() * total, kind = kinds[0][0];
        for (const [k, w] of kinds) { r -= w; if (r <= 0) { kind = k; break; } }
        const s = wall ? 1.1 + rng() * 0.8 : 0.85 + rng() * 0.6;
        plan.trees[kind].push({ x, y: this.heightAt(x, z) - 0.1, z, s, rotY: rng() * 6.28, tiltX: (rng() - 0.5) * 0.08, tiltZ: (rng() - 0.5) * 0.08, tint: 0.85 + rng() * 0.25 });
        if (dc < R + 2) addCollider(x, z, 0.42 * s);
        plan.mapDots.push([x, z, T.dots?.[kind] || '#2f4a3a']);
      }
    }
    for (let i = 0; i < (def.rocks ?? 240); i++) {
      const lx = (rng() - 0.5) * 2 * (R + 10), lz = (rng() - 0.5) * 2 * (R + 10);
      const dc = Math.hypot(lx, lz), x = lx + this.cx, z = lz + this.cz;
      if (dc > R + 10 || !this.openGround(x, z, -1.5)) continue;
      const s = rng() < 0.15 ? 1.4 + rng() * 1.2 : 0.35 + rng() * 0.8;
      plan.rocks.push({ x, y: this.heightAt(x, z) - 0.1, z, s, sy: s * (0.7 + rng() * 0.6), rotY: rng() * 6.28, tint: 0.85 + rng() * 0.3, b: rng() < 0.5 });
      if (s > 0.6 && dc < R + 2) addCollider(x, z, 0.8 * s);
      plan.mapDots.push([x, z, '#77756e']);
    }
    // camps, ruins and the rest: { kind, x, z, … } (lands.js builds each kind); r: collider radius
    const put = (kind, lx, lz, o = {}, r = 0) => {
      const x = lx + this.cx, z = lz + this.cz;
      plan.props.push({ kind, x, z, ...o });
      if (r) addCollider(x, z, r);
    };
    def.props?.(this, put, rng);
    if (this.door) { // the door's structure: solid behind and beside the way in
      const d = this.door, fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), rx = fz, rz = -fx;
      for (const [side, back, r] of [[-2.7, -0.9, 1.3], [2.7, -0.9, 1.3], [-1.9, -3.0, 1.9], [1.9, -3.0, 1.9], [0, -3.8, 1.9]]) {
        addCollider(d.x + rx * side + fx * back, d.z + rz * side + fz * back, r);
      }
    }
    return plan;
  }
}

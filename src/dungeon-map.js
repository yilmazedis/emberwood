// A hand-made dungeon on a 4 m grid: its walls, sight lines and paths, and the KayKit Dungeon pieces that
// dress it. Shared by the game (dungeon.js draws it) and the game server (its monsters walk it), so plain
// data and numbers only, no three.js. Each dungeon sits far from everything else in the same coordinates
// (centred on cx, cz), so combat, loot and particles work there unchanged.
//
// The map is rows of letters, north up: '#' rock, 'U' the stairs up (solid; the way out, north of the
// start room), anything else is floor. Letters name the rooms: S is where you arrive, B the boss's room.
import { registerRegion, addCollider } from './terrain.js';
import { mulberry32, clamp } from './util.js';

export const CELL = 4;
export const FLOOR_Y = 0.05;
export const CUT_Y = 1.3; // camera-side walls end here
export const WALL = 0.5; // walls are 1 m thick, centred on the cell edges
const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
// wall-mounted things face into the room: a north wall faces south (+z), a west wall east (+x)…
const FACE = { n: 0, w: Math.PI / 2, e: -Math.PI / 2 };

export class DungeonMap {
  // def: { id, map: [rows], cx, cz, zone: { id, name, sub }, boss: { id, name, sub } (the B room's zone) }
  constructor(def) {
    this.id = def.id;
    this.map = def.map;
    this.ROWS = def.map.length;
    this.COLS = def.map[0].length;
    this.OX = def.cx - (this.COLS * CELL) / 2;
    this.OZ = def.cz - (this.ROWS * CELL) / 2;
    this.zone = def.zone;
    this.bossZone = def.boss;
    // room rectangles by letter: { x0, x1, z0, z1, cx, cz }
    this.rooms = {};
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const t = this.map[r][c];
        if (t === 'U') this.stairs = { r, c };
        if (!/[A-TV-Z]/.test(t)) continue;
        const b = this.rooms[t] || (this.rooms[t] = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
        b.x0 = Math.min(b.x0, this.cellX(c)); b.x1 = Math.max(b.x1, this.cellX(c) + CELL);
        b.z0 = Math.min(b.z0, this.cellZ(r)); b.z1 = Math.max(b.z1, this.cellZ(r) + CELL);
      }
    }
    for (const b of Object.values(this.rooms)) { b.cx = (b.x0 + b.x1) / 2; b.cz = (b.z0 + b.z1) / 2; }
    this.bounds = { x0: this.OX - CELL, x1: this.OX + (this.COLS + 1) * CELL, z0: this.OZ - CELL, z1: this.OZ + (this.ROWS + 1) * CELL };
    const S = this.rooms.S, st = this.stairs;
    this.arrive = { x: this.midX(st.c), z: S.z0 + 2.4, yaw: 0 }; // at the foot of the stairs
    this.exit = { x: this.midX(st.c), z: S.z0 + 1.3 }; // where you use them
    this.flows = new Map();
    this.pieces = []; // { m: model, x, y, z, rot, cut, ox, scale }
    this.flames = []; // torch flames { x, y, z }
    this.flameDirs = []; // which way each torch faces { x, z }
    this.chests = []; // { id, model, x, z, rot, name, title, hoard? }
    registerRegion({
      contains: (x, z) => this.contains(x, z),
      heightAt: () => FLOOR_Y,
      resolve: (pos, radius) => this.pushOutOfWalls(pos, radius),
      clear: (x, z, radius) => this.clearOfWalls(x, z, radius),
      wallAt: (x, z) => this.wallAt(x, z),
      zoneAt: (x, z) => (this.rooms.B && this.inRoom(this.rooms.B, x, z) ? this.bossZone : this.zone),
    });
  }

  tile(r, c) { return r >= 0 && r < this.ROWS && c >= 0 && c < this.COLS ? this.map[r][c] : '#'; }
  open(r, c) { const t = this.tile(r, c); return t !== '#' && t !== 'U'; }
  cellX(c) { return this.OX + c * CELL; } // north-west corner of a cell
  cellZ(r) { return this.OZ + r * CELL; }
  midX(c) { return this.cellX(c) + CELL / 2; }
  midZ(r) { return this.cellZ(r) + CELL / 2; }
  colOf(x) { return Math.floor((x - this.OX) / CELL); }
  rowOf(z) { return Math.floor((z - this.OZ) / CELL); }
  inRoom(b, x, z) { return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; }
  contains(x, z) { const b = this.bounds; return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; }

  // ---------------------------------------------------------------- walls, sight lines, paths
  // Every rock cell is a box that reaches WALL metres into the floor next to it (where the wall stands).
  pushOutOfWalls(pos, radius) {
    const r0 = this.rowOf(pos.z), c0 = this.colOf(pos.x);
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (this.open(r, c)) continue;
        const minX = this.cellX(c) - WALL, maxX = this.cellX(c) + CELL + WALL, minZ = this.cellZ(r) - WALL, maxZ = this.cellZ(r) + CELL + WALL;
        const qx = clamp(pos.x, minX, maxX), qz = clamp(pos.z, minZ, maxZ);
        const dx = pos.x - qx, dz = pos.z - qz, d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = qx + (dx / d) * radius;
          pos.z = qz + (dz / d) * radius;
        } else { // centre inside the wall: leave by the nearest side
          const out = [[pos.x - minX, 'x', minX - radius], [maxX - pos.x, 'x', maxX + radius], [pos.z - minZ, 'z', minZ - radius], [maxZ - pos.z, 'z', maxZ + radius]]
            .sort((a, b) => a[0] - b[0])[0];
          pos[out[1]] = out[2];
        }
      }
    }
  }

  clearOfWalls(x, z, radius) {
    const r0 = this.rowOf(z), c0 = this.colOf(x);
    if (!this.open(r0, c0)) return false;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (this.open(r, c)) continue;
        const qx = clamp(x, this.cellX(c) - WALL, this.cellX(c) + CELL + WALL), qz = clamp(z, this.cellZ(r) - WALL, this.cellZ(r) + CELL + WALL);
        if ((x - qx) ** 2 + (z - qz) ** 2 <= radius * radius) return false;
      }
    }
    return true;
  }

  wallAt(x, z) { return !this.clearOfWalls(x, z, 0); }

  // Nothing but floor between a and b (with `radius` of room to spare)?
  lineClear(ax, az, bx, bz, radius = 0) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.clearOfWalls(ax + (bx - ax) * t, az + (bz - az) * t, radius)) return false;
    }
    return true;
  }

  // Breadth-first distances (in cells) to a target cell; the grid never changes, so they are cached.
  flowTo(tr, tc) {
    const COLS = this.COLS, key = tr * COLS + tc;
    let dist = this.flows.get(key);
    if (dist) return dist;
    dist = new Int16Array(this.ROWS * COLS).fill(-1);
    dist[key] = 0;
    const queue = [key];
    for (let h = 0; h < queue.length; h++) {
      const k = queue[h], r = Math.floor(k / COLS), c = k % COLS;
      for (const [dr, dc] of N4) {
        const nk = (r + dr) * COLS + (c + dc);
        if (!this.open(r + dr, c + dc) || dist[nk] >= 0) continue;
        dist[nk] = dist[k] + 1;
        queue.push(nk);
      }
    }
    this.flows.set(key, dist);
    return dist;
  }

  // Where a monster at f should head to reach t: null when it can walk straight there, otherwise the
  // farthest cell centre along the shortest path that it can still see (so paths don't zig-zag).
  steer(fx, fz, tx, tz, radius) {
    const COLS = this.COLS;
    let r = this.rowOf(fz), c = this.colOf(fx);
    const tr = this.rowOf(tz), tc = this.colOf(tx);
    if ((r === tr && c === tc) || !this.open(r, c) || !this.open(tr, tc)) return null;
    if (this.lineClear(fx, fz, tx, tz, radius * 0.9)) return null;
    const dist = this.flowTo(tr, tc);
    if (dist[r * COLS + c] < 0) return null;
    let best = null;
    for (let step = 0; step < 5 && dist[r * COLS + c] > 0; step++) {
      let next = null;
      for (const [dr, dc] of N4) {
        const d = this.open(r + dr, c + dc) ? dist[(r + dr) * COLS + (c + dc)] : -1;
        if (d >= 0 && d < dist[r * COLS + c]) { next = [r + dr, c + dc]; break; }
      }
      if (!next) break;
      [r, c] = next;
      const p = { x: this.midX(c), z: this.midZ(r) };
      if (step > 0 && !this.lineClear(fx, fz, p.x, p.z, radius * 0.9)) break;
      best = p;
    }
    return best;
  }

  // ---------------------------------------------------------------- dressing (pure data; meshes load later)
  put(m, x, z, o = {}) {
    this.pieces.push({ m, x, z, y: o.y || 0, rot: o.rot || 0, cut: !!o.cut, ox: o.ox || 0, scale: o.scale || null });
    if (o.collide) addCollider(x, z, o.collide);
  }

  wallFace(r, c, side) {
    return side === 'n' ? [this.midX(c), this.cellZ(r) + WALL] : side === 'w' ? [this.cellX(c) + WALL, this.midZ(r)] : [this.cellX(c) + CELL - WALL, this.midZ(r)];
  }

  torch(r, c, side) {
    const [x, z] = this.wallFace(r, c, side), rot = FACE[side];
    this.put('torch_mounted', x, z, { rot, y: 2.05 });
    const dir = { x: Math.sin(rot), z: Math.cos(rot) };
    this.flames.push({ x: x + dir.x * 0.36, y: 2.05 + 0.58, z: z + dir.z * 0.36 });
    this.flameDirs.push(dir);
  }

  banner(m, r, c, side) {
    const x = side === 'n' ? this.midX(c) : side === 'w' ? this.cellX(c) : this.cellX(c) + CELL;
    const z = side === 'n' ? this.cellZ(r) : this.midZ(r);
    this.put(m, x, z, { rot: FACE[side] });
  }

  chest(c) {
    this.chests.push(c);
    addCollider(c.x, c.z, 0.85);
  }

  // Floors, walls (and the posts where they meet) and the stairs out. opts: { seed, floors: { 'r,c': model },
  // walls: { 'r,c,side': model }, plain: walls to pick from, dirt: rough cave floors }
  shell({ seed = 1, floors = {}, walls = {}, plain = ['wall', 'wall', 'wall', 'wall_arched'], dirt = false } = {}) {
    const rng = mulberry32(seed);
    const quarter = () => Math.floor(rng() * 4) * (Math.PI / 2);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        if (!this.open(r, c)) continue;
        const x = this.midX(c), z = this.midZ(r), k = rng();
        if (floors[`${r},${c}`]) this.put(floors[`${r},${c}`], x, z);
        else if (dirt) this.put(k < 0.3 ? 'floor_dirt_large_rocky' : 'floor_dirt_large', x, z, { rot: quarter() });
        else if (k < 0.1) this.put('floor_tile_large_rocks', x, z, { rot: quarter() });
        else if (k < 0.3) {
          for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const v = rng();
            const m = v < 0.22 ? 'floor_tile_small_broken_A' : v < 0.4 ? 'floor_tile_small_broken_B' : v < 0.46 ? 'floor_tile_small_decorated' : 'floor_tile_small';
            this.put(m, x + dx, z + dz, { rot: quarter() });
          }
        } else this.put('floor_tile_large', x, z, { rot: quarter() });
      }
    }
    // walls on every floor/rock edge. Those south of the floor face the camera and get cut down.
    const edge = (r, c, side) => {
      const [dr, dc] = { n: [-1, 0], s: [1, 0], w: [0, -1], e: [0, 1] }[side];
      return !this.open(r + dr, c + dc) && this.tile(r + dr, c + dc) !== 'U'; // the stairs cell stays open to the room
    };
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        if (!this.open(r, c)) continue;
        const variant = (side) => walls[`${r},${c},${side}`] || pick(plain);
        if (edge(r, c, 'n')) this.put(variant('n'), this.midX(c), this.cellZ(r));
        if (edge(r, c, 's')) this.put('wall', this.midX(c), this.cellZ(r) + CELL, { rot: Math.PI, cut: true });
        if (edge(r, c, 'w')) this.put(variant('w'), this.cellX(c), this.midZ(r), { rot: Math.PI / 2 });
        if (edge(r, c, 'e')) this.put(variant('e'), this.cellX(c) + CELL, this.midZ(r), { rot: -Math.PI / 2 });
      }
    }
    // a post wherever walls meet or end, so corners have no gaps; slightly proud of the wall faces
    const wallOn = (r1, c1, r2, c2) => this.open(r1, c1) !== this.open(r2, c2) && this.tile(r1, c1) !== 'U' && this.tile(r2, c2) !== 'U';
    for (let r = 0; r <= this.ROWS; r++) {
      for (let c = 0; c <= this.COLS; c++) {
        const up = wallOn(r - 1, c - 1, r - 1, c), down = wallOn(r, c - 1, r, c);
        const left = wallOn(r - 1, c - 1, r, c - 1), right = wallOn(r - 1, c, r, c);
        const n = up + down + left + right;
        if (!n || (n === 2 && ((up && down) || (left && right)))) continue;
        // a horizontal wall is cut when its floor is on the north side
        const cutH = (on, cNorth) => !on || this.open(r - 1, cNorth);
        const cut = !up && !down && cutH(left, c - 1) && cutH(right, c);
        this.put('wall_endcap', this.cellX(c), this.cellZ(r), { ox: -0.535, scale: [1, 1.02, 1.06], cut });
      }
    }
    // the stairs up, rising north out of the start room
    this.put('stairs', this.midX(this.stairs.c), this.cellZ(this.stairs.r));
  }

  // Dress a whole dungeon from its plan (the deeper floors): the shell, torches along the north walls,
  // banners between them, pillars in the big rooms, a chest in each side room, the boss's hoard, odds and ends
  // in the start room. opts: { seed, banner: model, plain: walls to pick from, dirt }
  autoDress({ seed = 7, banner = 'banner_patternA_red', plain, dirt = false } = {}) {
    this.shell({ seed, plain, dirt });
    const rng = mulberry32(seed + 99);
    for (const [letter, R] of Object.entries(this.rooms)) {
      const r0 = this.rowOf(R.z0 + 0.1), c0 = this.colOf(R.x0 + 0.1), c1 = this.colOf(R.x1 - 0.1), wide = c1 - c0 + 1;
      // torches (and a banner now and then) on the north wall
      let k = 0;
      for (let c = c0; c <= c1; c++) {
        if (this.open(r0 - 1, c) || this.tile(r0 - 1, c) === 'U') continue;
        if ((c - c0) % 2 === (wide > 3 ? 1 : 0)) this.torch(r0, c, 'n');
        else if (letter !== 'S' && k++ % 2 === 0 && rng() < 0.8) this.banner(banner, r0, c, 'n');
      }
      const w = R.x1 - R.x0, h = R.z1 - R.z0;
      if (letter === 'B') {
        for (const sx of [-1, 1]) for (const dz of [-h / 4, h / 4]) this.put('pillar_decorated', R.cx + sx * (w / 2 - 3.5), R.cz + dz, { collide: 1.0 });
        this.chest({ id: 'hoard', model: 'chest_gold', x: R.cx, z: R.z0 + 1.6, rot: 0, hoard: true, name: 'The Hoard', title: 'Sealed while its keeper lives' });
        this.put('coin_stack_large', R.cx - 2.6, R.z0 + 1.3, { collide: 0.7 });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.4;
          this.put('candle_triple', R.cx + Math.cos(a) * Math.min(7, w / 3), R.cz + Math.sin(a) * Math.min(5, h / 3), { rot: rng() * 6 });
        }
        continue;
      }
      if (letter === 'S') {
        this.put('barrel_small', R.x0 + 1.2, R.z1 - 1.2, { collide: 0.5 });
        this.put('box_stacked', R.x1 - 1.4, R.z1 - 1.4, { rot: 0.4, collide: 0.9 });
        continue;
      }
      if (w >= 16 && h >= 8) for (const sx of [-1, 1]) this.put(rng() < 0.5 ? 'pillar' : 'pillar_decorated', R.cx + sx * (w / 2 - 4), R.cz, { collide: 0.95 });
      const corner = rng() < 0.5 ? -1 : 1;
      this.chest({ id: `chest_${letter}`, model: 'chest', x: R.cx + corner * (w / 2 - 1.5), z: R.z1 - 1.6, rot: Math.PI, name: 'Old Chest', title: 'Left in the dark' });
      const odd = ['barrel_large', 'crates_stacked', 'rubble_half', 'box_large', 'keg'][Math.floor(rng() * 5)];
      this.put(odd, R.cx - corner * (w / 2 - 1.5), R.z0 + 1.5, { rot: rng() * 3, collide: 0.8 });
    }
  }
}

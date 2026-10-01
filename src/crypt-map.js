// The Forgotten Crypt's plan: a hand-made dungeon beneath the graveyard on a 4 m grid, its walls, sight
// lines and paths, its monsters and the pieces that dress it. Shared by the game (dungeon.js draws it)
// and the game server (its skeletons walk it), so plain data and numbers only, no three.js.
// It sits far north of the overworld in the same coordinates, so everything else works unchanged.
import { registerRegion, addCollider } from './terrain.js';
import { mulberry32, clamp } from './util.js';

// ---------------------------------------------------------------- layout
// '#' rock, 'U' the stairs up (solid), anything else is floor. The letters name the rooms:
// S start, H hall of bones, C chapel, O ossuary, V vault, B the Lich's sanctum. North is up.
const MAP = [
  '###############',
  '###BBBBBBBBB###',
  '###BBBBBBBBB###',
  '###BBBBBBBBB###',
  '###BBBBBBBBB###',
  '###BBBBBBBBB###',
  '#######.#######',
  '#######.#######',
  '#CCC#OOOOO#VVV#',
  '#CCC.OOOOO.VVV#',
  '#CCC#OOOOO#VVV#',
  '##.############',
  '##.######U#####',
  '#HHHHH##SSS####',
  '#HHHHH..SSS####',
  '#HHHHH##SSS####',
  '###############',
];
export const CELL = 4;
export const ROWS = MAP.length, COLS = MAP[0].length;
export const OX = -(COLS * CELL) / 2, OZ = -400 - (ROWS * CELL) / 2; // centred on (0, -400), far north of the overworld
export const FLOOR_Y = 0.05;
export const CUT_Y = 1.3; // camera-side walls end here
export const WALL = 0.5; // walls are 1 m thick, centred on the cell edges

export const tile = (r, c) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? MAP[r][c] : '#');
export const open = (r, c) => { const t = tile(r, c); return t !== '#' && t !== 'U'; };
export const cellX = (c) => OX + c * CELL, cellZ = (r) => OZ + r * CELL; // north-west corner of a cell
export const midX = (c) => cellX(c) + CELL / 2, midZ = (r) => cellZ(r) + CELL / 2;
const colOf = (x) => Math.floor((x - OX) / CELL), rowOf = (z) => Math.floor((z - OZ) / CELL);
const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// room rectangles by letter: { x0, x1, z0, z1, cx, cz }
export const ROOMS = {};
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const t = MAP[r][c];
    if (!/[A-TV-Z]/.test(t)) continue;
    const b = ROOMS[t] || (ROOMS[t] = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
    b.x0 = Math.min(b.x0, cellX(c)); b.x1 = Math.max(b.x1, cellX(c) + CELL);
    b.z0 = Math.min(b.z0, cellZ(r)); b.z1 = Math.max(b.z1, cellZ(r) + CELL);
  }
}
for (const b of Object.values(ROOMS)) { b.cx = (b.x0 + b.x1) / 2; b.cz = (b.z0 + b.z1) / 2; }
export const inRoom = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;

export const CRYPT_ZONE = { id: 'crypt', name: 'Forgotten Crypt', sub: 'Undead · Level 7 – 9' };
export const SANCTUM_ZONE = { id: 'sanctum', name: "Morvain's Sanctum", sub: 'Boss · Level 9' };

// ---------------------------------------------------------------- walls, sight lines, paths
const BOUNDS = { x0: OX - CELL, x1: OX + (COLS + 1) * CELL, z0: OZ - CELL, z1: OZ + (ROWS + 1) * CELL };
export const inDungeon = (x, z) => x > BOUNDS.x0 && x < BOUNDS.x1 && z > BOUNDS.z0 && z < BOUNDS.z1;

// Every rock cell is a box that reaches WALL metres into the floor next to it (where the wall stands).
function pushOutOfWalls(pos, radius) {
  const r0 = rowOf(pos.z), c0 = colOf(pos.x);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (open(r, c)) continue;
      const minX = cellX(c) - WALL, maxX = cellX(c) + CELL + WALL, minZ = cellZ(r) - WALL, maxZ = cellZ(r) + CELL + WALL;
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

function clearOfWalls(x, z, radius) {
  const r0 = rowOf(z), c0 = colOf(x);
  if (!open(r0, c0)) return false;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (open(r, c)) continue;
      const qx = clamp(x, cellX(c) - WALL, cellX(c) + CELL + WALL), qz = clamp(z, cellZ(r) - WALL, cellZ(r) + CELL + WALL);
      if ((x - qx) ** 2 + (z - qz) ** 2 <= radius * radius) return false;
    }
  }
  return true;
}

export const wallAt = (x, z) => !clearOfWalls(x, z, 0);

// Nothing but floor between a and b (with `radius` of room to spare)?
export function lineClear(ax, az, bx, bz, radius = 0) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (!clearOfWalls(ax + (bx - ax) * t, az + (bz - az) * t, radius)) return false;
  }
  return true;
}

// Breadth-first distances (in cells) to a target cell; the grid never changes, so they are cached.
const flows = new Map();
function flowTo(tr, tc) {
  const key = tr * COLS + tc;
  let dist = flows.get(key);
  if (dist) return dist;
  dist = new Int16Array(ROWS * COLS).fill(-1);
  dist[key] = 0;
  const queue = [key];
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h], r = Math.floor(k / COLS), c = k % COLS;
    for (const [dr, dc] of N4) {
      const nk = (r + dr) * COLS + (c + dc);
      if (!open(r + dr, c + dc) || dist[nk] >= 0) continue;
      dist[nk] = dist[k] + 1;
      queue.push(nk);
    }
  }
  flows.set(key, dist);
  return dist;
}

// Where a monster at f should head to reach t: null when it can walk straight there, otherwise the
// farthest cell centre along the shortest path that it can still see (so paths don't zig-zag).
export function steer(fx, fz, tx, tz, radius) {
  let r = rowOf(fz), c = colOf(fx);
  const tr = rowOf(tz), tc = colOf(tx);
  if ((r === tr && c === tc) || !open(r, c) || !open(tr, tc)) return null;
  if (lineClear(fx, fz, tx, tz, radius * 0.9)) return null;
  const dist = flowTo(tr, tc);
  if (dist[r * COLS + c] < 0) return null;
  let best = null;
  for (let step = 0; step < 5 && dist[r * COLS + c] > 0; step++) {
    let next = null;
    for (const [dr, dc] of N4) {
      const d = open(r + dr, c + dc) ? dist[(r + dr) * COLS + (c + dc)] : -1;
      if (d >= 0 && d < dist[r * COLS + c]) { next = [r + dr, c + dc]; break; }
    }
    if (!next) break;
    [r, c] = next;
    const p = { x: midX(c), z: midZ(r) };
    if (step > 0 && !lineClear(fx, fz, p.x, p.z, radius * 0.9)) break;
    best = p;
  }
  return best;
}

registerRegion({
  contains: inDungeon,
  floorY: FLOOR_Y,
  resolve: pushOutOfWalls,
  clear: clearOfWalls,
  zoneAt: (x, z) => (inRoom(ROOMS.B, x, z) ? SANCTUM_ZONE : CRYPT_ZONE),
});

// ---------------------------------------------------------------- monsters
const S = ROOMS;
export const CRYPT_SPAWNS = [
  { type: 'skeleton_minion', x: S.H.cx, z: S.H.cz, r: 7, n: 4, lvl: 7 },
  { type: 'skeleton_warrior', x: S.H.cx + 5, z: S.H.cz, r: 2, n: 1, lvl: 7 },
  { type: 'skeleton_mage', x: S.C.cx, z: S.C.cz - 2, r: 3, n: 2, lvl: 7 },
  { type: 'skeleton_rogue', x: S.C.cx, z: S.C.cz + 1, r: 3, n: 2, lvl: 8 },
  { type: 'skeleton_minion', x: S.O.cx, z: S.O.cz + 1, r: 7, n: 3, lvl: 8 },
  { type: 'skeleton_warrior', x: S.O.cx, z: S.O.cz - 2, r: 5, n: 2, lvl: 8 },
  { type: 'skeleton_mage', x: S.O.cx, z: S.O.cz - 3.5, r: 2, n: 1, lvl: 8 },
  { type: 'skeleton_warrior', x: S.V.cx - 1, z: S.V.cz, r: 3, n: 2, lvl: 8 },
  { type: 'lich', x: S.B.cx, z: S.B.cz - 4.5, r: 0.5, n: 1, lvl: 9 },
].map((s) => ({ ...s, crypt: true }));
export const LICH_HOME = { x: S.B.cx, z: S.B.cz - 4.5 };

// ---------------------------------------------------------------- dressing (pure data; meshes load later)
export const PIECES = []; // { m: model, x, y, z, rot, cut, ox, scale }
export const FLAMES = []; // torch flame positions { x, y, z }
export const FLAME_DIRS = []; // which way each torch faces { x, z } (lights sit a little in front)
export const CHESTS = [];

function put(m, x, z, o = {}) {
  PIECES.push({ m, x, z, y: o.y || 0, rot: o.rot || 0, cut: !!o.cut, ox: o.ox || 0, scale: o.scale || null });
  if (o.collide) addCollider(x, z, o.collide);
}

// wall-mounted things face into the room: a north wall faces south (+z), a west wall east (+x)…
const FACE = { n: 0, w: Math.PI / 2, e: -Math.PI / 2 };
const wallFace = (r, c, side) => (side === 'n' ? [midX(c), cellZ(r) + WALL] : side === 'w' ? [cellX(c) + WALL, midZ(r)] : [cellX(c) + CELL - WALL, midZ(r)]);

function torch(r, c, side) {
  const [x, z] = wallFace(r, c, side), rot = FACE[side];
  put('torch_mounted', x, z, { rot, y: 2.05 });
  const dir = { x: Math.sin(rot), z: Math.cos(rot) };
  FLAMES.push({ x: x + dir.x * 0.36, y: 2.05 + 0.58, z: z + dir.z * 0.36 });
  FLAME_DIRS.push(dir);
}

function banner(m, r, c, side) {
  const x = side === 'n' ? midX(c) : side === 'w' ? cellX(c) : cellX(c) + CELL;
  const z = side === 'n' ? cellZ(r) : midZ(r);
  put(m, x, z, { rot: FACE[side] });
}

function plan() {
  const rng = mulberry32(0xc0ffee);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const quarter = () => Math.floor(rng() * 4) * (Math.PI / 2);

  // floors (a few cells get broken or rocky tiles, the ossuary has two grated pits)
  const FLOOR = { '10,6': 'floor_tile_big_grate', '10,8': 'floor_tile_big_grate' };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!open(r, c)) continue;
      const x = midX(c), z = midZ(r), k = rng();
      if (FLOOR[`${r},${c}`]) put(FLOOR[`${r},${c}`], x, z);
      else if (k < 0.1) put('floor_tile_large_rocks', x, z, { rot: quarter() });
      else if (k < 0.3) {
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const v = rng();
          const m = v < 0.22 ? 'floor_tile_small_broken_A' : v < 0.4 ? 'floor_tile_small_broken_B' : v < 0.46 ? 'floor_tile_small_decorated' : 'floor_tile_small';
          put(m, x + dx, z + dz, { rot: quarter() });
        }
      } else put('floor_tile_large', x, z, { rot: quarter() });
    }
  }

  // walls on every floor/rock edge. Those south of the floor face the camera and get cut down.
  // a few hand-placed variants (cracked walls are 4× the triangles of plain ones, so they stay rare)
  const WALLS = {
    '8,3,n': 'wall_shelves', '8,12,n': 'wall_shelves', '13,4,n': 'wall_shelves',
    '15,1,w': 'wall_cracked', '10,5,w': 'wall_cracked', '3,11,e': 'wall_cracked', '1,4,n': 'wall_cracked',
  };
  const edge = (r, c, side) => {
    const [dr, dc] = { n: [-1, 0], s: [1, 0], w: [0, -1], e: [0, 1] }[side];
    return !open(r + dr, c + dc) && tile(r + dr, c + dc) !== 'U'; // the stairs cell stays open to the room
  };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!open(r, c)) continue;
      const variant = (side) => WALLS[`${r},${c},${side}`] || pick(['wall', 'wall', 'wall', 'wall_arched']);
      if (edge(r, c, 'n')) put(variant('n'), midX(c), cellZ(r));
      if (edge(r, c, 's')) put('wall', midX(c), cellZ(r) + CELL, { rot: Math.PI, cut: true });
      if (edge(r, c, 'w')) put(variant('w'), cellX(c), midZ(r), { rot: Math.PI / 2 });
      if (edge(r, c, 'e')) put(variant('e'), cellX(c) + CELL, midZ(r), { rot: -Math.PI / 2 });
    }
  }
  // a post wherever walls meet or end, so corners have no gaps; slightly proud of the wall faces
  const wallOn = (r1, c1, r2, c2) => open(r1, c1) !== open(r2, c2) && tile(r1, c1) !== 'U' && tile(r2, c2) !== 'U';
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c <= COLS; c++) {
      const up = wallOn(r - 1, c - 1, r - 1, c), down = wallOn(r, c - 1, r, c);
      const left = wallOn(r - 1, c - 1, r, c - 1), right = wallOn(r - 1, c, r, c);
      const n = up + down + left + right;
      if (!n || (n === 2 && ((up && down) || (left && right)))) continue;
      // a horizontal wall is cut when its floor is on the north side
      const cutH = (on, cNorth) => !on || open(r - 1, cNorth);
      const cut = !up && !down && cutH(left, c - 1) && cutH(right, c);
      put('wall_endcap', cellX(c), cellZ(r), { ox: -0.535, scale: [1, 1.02, 1.06], cut });
    }
  }

  // stairs up to the graveyard, rising north out of the start room
  put('stairs', midX(9), cellZ(12));

  const { S: St, H, C, O, V, B } = ROOMS;
  // start room
  torch(13, 8, 'w'); torch(13, 10, 'e');
  put('barrel_large', St.x0 + 1.4, St.z1 - 1.5, { collide: 0.85 });
  put('barrel_small', St.x0 + 3.1, St.z1 - 1.1, { collide: 0.5 });
  put('crates_stacked', St.x1 - 1.6, St.z1 - 1.5, { rot: 0.3, collide: 1.05 });
  put('box_small', St.x1 - 1.3, St.cz - 0.5, { rot: 0.5, collide: 0.6 });
  put('candle_triple', St.x0 + 1.2, St.z0 + 1.0);
  put('candle_triple', St.x1 - 1.2, St.z0 + 1.0, { rot: 2 });

  // hall of bones
  torch(13, 1, 'n'); torch(13, 4, 'n'); torch(14, 1, 'w');
  banner('banner_patternA_red', 13, 3, 'n');
  banner('banner_thin_red', 13, 5, 'n');
  put('pillar', H.x0 + 5, H.cz - 1.5, { collide: 0.85 });
  put('pillar', H.x1 - 5, H.cz - 1.5, { collide: 0.85 });
  put('table_medium_broken', H.x1 - 3.2, H.z1 - 2.2, { rot: 0.5, collide: 1.1 });
  put('sword_shield_broken', H.x0 + 1.6, H.z1 - 1.4, { rot: 0.6 });
  put('barrel_small', H.x0 + 1.2, H.z0 + 1.3, { collide: 0.5 });
  put('box_small', H.x0 + 2.5, H.z0 + 1.2, { rot: 0.4, collide: 0.6 });
  put('candle_triple', H.x1 - 1.2, H.z0 + 1.1);

  // chapel
  torch(8, 2, 'n'); torch(9, 1, 'w');
  banner('banner_shield_red', 8, 1, 'n');
  CHESTS.push({ id: 'chapel', model: 'chest', x: C.x0 + 2, z: C.z0 + 1.45, rot: 0, name: 'Old Chest', title: 'Crypt offerings' });
  put('candle_triple', C.x1 - 1.1, C.z0 + 1.1);
  put('candle_triple', C.x0 + 1.0, C.z1 - 1.2, { rot: 1 });
  put('candle_lit', C.cx + 1.6, C.z0 + 0.9);

  // ossuary
  torch(8, 5, 'n'); torch(8, 9, 'n');
  banner('banner_patternB_brown', 8, 6, 'n');
  banner('banner_patternB_brown', 8, 8, 'n');
  put('pillar_decorated', O.cx - 5.5, O.z0 + 3, { collide: 1.0 });
  put('pillar_decorated', O.cx + 5.5, O.z0 + 3, { collide: 1.0 });
  put('sword_shield_broken', O.x1 - 1.6, O.z1 - 1.4, { rot: -0.5 });
  put('box_small', O.x0 + 1.3, O.z1 - 1.3, { rot: 0.3, collide: 0.6 });
  put('barrel_small', O.x0 + 1.2, O.z0 + 1.2, { collide: 0.5 });

  // vault
  torch(8, 12, 'n'); torch(9, 13, 'e');
  CHESTS.push({ id: 'vault', model: 'chest', x: V.x1 - 1.5, z: V.cz, rot: -Math.PI / 2, name: 'Iron-bound Chest', title: 'The vault' });
  put('coin_stack_large', V.x1 - 1.3, V.cz - 2.6, { collide: 0.7 });
  put('coin_stack_medium', V.x1 - 1.2, V.cz + 2.6, { rot: 1, collide: 0.6 });
  put('barrel_large', V.x0 + 1.4, V.z0 + 1.4, { collide: 0.85 });
  put('keg', V.x0 + 3.6, V.z0 + 1.3, { collide: 0.9 });
  put('crates_stacked', V.x1 - 1.6, V.z0 + 1.5, { rot: -0.2, collide: 1.05 });
  put('box_large', V.x0 + 1.3, V.z1 - 1.3, { rot: 0.2, collide: 0.8 });
  put('barrel_small', V.x0 + 3.1, V.z1 - 1.1, { collide: 0.5 });

  // the sanctum
  torch(1, 3, 'n'); torch(1, 11, 'n'); torch(2, 3, 'w'); torch(4, 3, 'w'); torch(2, 11, 'e'); torch(4, 11, 'e');
  banner('banner_triple_red', 1, 5, 'n');
  banner('banner_triple_red', 1, 9, 'n');
  banner('banner_shield_red', 1, 7, 'n');
  for (const sx of [-1, 1]) for (const dz of [-4.5, 4.5]) put('pillar_decorated', B.cx + sx * 10.5, B.cz + dz, { collide: 1.0 });
  CHESTS.push({ id: 'hoard', model: 'chest_gold', x: B.cx, z: B.z0 + 1.6, rot: 0, hoard: true, name: "Morvain's Hoard", title: 'Sealed while Morvain lives' });
  put('coin_stack_large', B.cx - 2.6, B.z0 + 1.3, { collide: 0.7 });
  put('coin_stack_medium', B.cx + 2.6, B.z0 + 1.2, { rot: 2, collide: 0.6 });
  for (const deg of [30, 150, 210, 270, 330]) {
    const a = (deg * Math.PI) / 180;
    put('candle_triple', B.cx + Math.cos(a) * 6.4, B.cz + Math.sin(a) * 6.4, { rot: rng() * 6 });
  }

  // corridors
  torch(11, 2, 'w'); torch(14, 6, 'n'); torch(6, 7, 'w'); torch(7, 7, 'e');

  for (const ch of CHESTS) addCollider(ch.x, ch.z, 0.85);
}
plan();

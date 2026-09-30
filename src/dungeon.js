// The Forgotten Crypt: a hand-made dungeon beneath the graveyard, built from the KayKit Dungeon
// pack on a 4 m grid. It sits far north of the overworld in the same scene, so combat, loot and
// particles work unchanged; going down swaps the lighting, fog and minimap (setInside).
// Walls on the camera side of a room are cut down to knee height so they never hide the fight.
// The pieces come packed in one file (tools/pack-dungeon.mjs), fetched when you near the graveyard.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerRegion, addCollider, heightAt, CRYPT } from './world.js';
import { randomItem } from './items.js';
import { hdr } from './fx.js';
import { mulberry32, clamp, randInt, chance } from './util.js';

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
const ROWS = MAP.length, COLS = MAP[0].length;
const OX = -(COLS * CELL) / 2, OZ = -400 - (ROWS * CELL) / 2; // centred on (0, -400), far north of the overworld
export const FLOOR_Y = 0.05;
const CUT_Y = 1.3; // camera-side walls end here
const WALL = 0.5; // walls are 1 m thick, centred on the cell edges

const tile = (r, c) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? MAP[r][c] : '#');
const open = (r, c) => { const t = tile(r, c); return t !== '#' && t !== 'U'; };
const cellX = (c) => OX + c * CELL, cellZ = (r) => OZ + r * CELL; // north-west corner of a cell
const midX = (c) => cellX(c) + CELL / 2, midZ = (r) => cellZ(r) + CELL / 2;
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
const inRoom = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;

const CRYPT_ZONE = { id: 'crypt', name: 'Forgotten Crypt', sub: 'Undead · Level 7 – 9' };
const SANCTUM_ZONE = { id: 'sanctum', name: "Morvain's Sanctum", sub: 'Boss · Level 9' };

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
const PIECES = []; // { m: model, x, y, z, rot, cut, ox, scale }
const FLAMES = []; // torch flame positions
const FLAME_DIRS = []; // which way each torch faces (lights sit a little in front)
const CHESTS = [];

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
  const dir = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  FLAMES.push(new THREE.Vector3(x, 2.05 + 0.58, z).addScaledVector(dir, 0.36));
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

// ---------------------------------------------------------------- minimap
function buildMinimap() {
  const SIZE = 360, R = 36;
  const mid = { x: OX + (COLS * CELL) / 2, z: OZ + (ROWS * CELL) / 2 };
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');
  const k = SIZE / (2 * R), px = (x) => (x - mid.x + R) * k, pz = (z) => (z - mid.z + R) * k;
  ctx.fillStyle = '#0d0b10';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#4d4640';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (open(r, c)) ctx.fillRect(px(cellX(c) - 0.9), pz(cellZ(r) - 0.9), (CELL + 1.8) * k, (CELL + 1.8) * k);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!open(r, c)) continue;
      const l = open(r, c - 1) ? 0 : WALL, rt = open(r, c + 1) ? 0 : WALL, t = open(r - 1, c) ? 0 : WALL, b = open(r + 1, c) ? 0 : WALL;
      ctx.fillStyle = tile(r, c) === 'B' ? '#8f7f8f' : '#9a8f7c';
      ctx.fillRect(px(cellX(c) + l), pz(cellZ(r) + t), (CELL - l - rt) * k, (CELL - t - b) * k);
    }
  }
  // the stairs up
  ctx.fillStyle = '#d8d0bc';
  for (let i = 0; i < 4; i++) ctx.fillRect(px(midX(9) - 1.8), pz(cellZ(12) + 0.6 + i * 0.9), 3.6 * k, 0.45 * k);
  return { canvas: cv, range: R, cx: mid.x, cz: mid.z };
}

// ---------------------------------------------------------------- the rune circle in the sanctum
function runeCircle() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uPulse: { value: 0 }, uCol: { value: hdr(0x8a4dff, 1.5) } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT, uPulse; uniform vec3 uCol; varying vec2 vP;
      float band(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
      void main() {
        float r = length(vP), a = atan(vP.y, vP.x);
        float rings = band(r, 0.95, 0.03) + band(r, 0.8, 0.02) * 0.8 + band(r, 0.42, 0.018) * 0.7;
        float runes = step(0.83, r) * step(r, 0.92) * step(0.62, fract(a * 3.8197 + uT * 0.06)) * 0.55;
        float u = a * 0.95493 - uT * 0.04;
        float spokes = step(0.42, r) * step(r, 0.8) * smoothstep(0.02, 0.0, abs(fract(u + 0.5) - 0.5) * 1.0472 * r) * 0.7;
        float v = (rings + runes + spokes) * (0.6 + 0.2 * sin(uT * 2.1) + uPulse) + smoothstep(1.0, 0.0, r) * 0.06 * (1.0 + uPulse);
        gl_FragColor = vec4(uCol * v, v);
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 72), mat);
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(4.6);
  m.position.set(ROOMS.B.cx, FLOOR_Y + 0.02, ROOMS.B.cz);
  m.renderOrder = 3;
  return m;
}

// ---------------------------------------------------------------- the dungeon at runtime
const LOOK = { fog: 0x0b0a0e, near: 26, far: 64, hemiSky: 0x9aa0c8, hemiGround: 0x3a3028, hemi: 1.0, sun: 0xa4b0e0, sunI: 1.2 };
const REACH = 2.4;
const CHEST_REFILL = 5 * 60 * 1000;
const PACK = 'assets/dungeon/crypt.glb';

export class Dungeon {
  constructor(game) {
    this.game = game;
    this.inside = false;
    this.flames = FLAMES;
    this.minimap = buildMinimap();
    this.group = new THREE.Group();
    this.group.visible = false;
    game.scene.add(this.group);
    this.loading = null;
    this.circle = null;
    this.pulseV = 0;
    this.lightSlots = [];
    this.near = null;
    const g = game;
    // the overworld's look, restored on the way out
    this.outside = {
      fog: g.scene.fog.color.getHex(), near: g.scene.fog.near, far: g.scene.fog.far,
      hemiSky: g.hemi.color.getHex(), hemiGround: g.hemi.groundColor.getHex(), hemi: g.hemi.intensity,
      sun: g.sun.color.getHex(), sunI: g.sun.intensity,
    };
    this.arrival = { x: ROOMS.S.cx, z: ROOMS.S.z0 + 2.4, yaw: 0 };
    this.exitPoint = { x: CRYPT.x - 3.2, z: CRYPT.z, yaw: -Math.PI / 2 };

    const ui = game.ui;
    const doorTop = new THREE.Vector3(CRYPT.x - 2.0, heightAt(CRYPT.x - 2.0, CRYPT.z) + 3.5, CRYPT.z);
    const stairsTop = new THREE.Vector3(ROOMS.S.cx, FLOOR_Y + 3.4, ROOMS.S.z0 - 0.4);
    this.spots = [
      {
        id: 'enter', x: CRYPT.x - 3.0, z: CRYPT.z, can: () => !this.inside, use: () => game.travel(true),
        label: ui.createNpcLabel('Forgotten Crypt', 'Dungeon · Level 7 – 9', 'Enter', () => this.use('enter'), (o) => o.copy(doorTop)),
      },
      {
        id: 'leave', x: ROOMS.S.cx, z: ROOMS.S.z0 + 1.3, can: () => this.inside, use: () => game.travel(false),
        label: ui.createNpcLabel('Stairs', 'Up to the graveyard', 'Leave', () => this.use('leave'), (o) => o.copy(stairsTop)),
      },
    ];
    this.chests = CHESTS.map((def) => {
      const c = { ...def, group: null, lid: null, lidT: 0, opened: false, readyAt: 0, unlocked: false };
      const top = new THREE.Vector3(c.x, FLOOR_Y + 2.3, c.z);
      c.label = ui.createNpcLabel(c.name, c.title, 'Open', () => this.use(c.id), (o) => o.copy(top));
      this.spots.push({
        id: c.id, x: c.x + Math.sin(c.rot) * 1.5, z: c.z + Math.cos(c.rot) * 1.5, label: c.label,
        can: () => this.inside && !!c.group && !c.opened && (!c.hoard || c.unlocked),
        use: () => this.openChest(c),
      });
      return c;
    });
    this.hoard = this.chests.find((c) => c.hoard);

    // light sources down here: torches, the rune circle, and the hoard once it's unguarded
    this.sources = FLAMES.map((f, i) => ({ pos: f.clone().addScaledVector(FLAME_DIRS[i], 0.55), color: 0xff8a3a, power: 13, dist: 12, flicker: i }));
    this.sources.push({ pos: new THREE.Vector3(ROOMS.B.cx, 1.6, ROOMS.B.cz), color: 0x9a5cff, power: 9, dist: 15, gain: () => 0.7 + this.pulseV * 0.8 });
    this.sources.push({ pos: new THREE.Vector3(this.hoard.x, 1.8, this.hoard.z + 1.2), color: 0xffc860, power: 7, dist: 8, gain: () => (this.hoard.unlocked ? 1 : 0) });
  }

  // The packed models: downloaded once, early (see update), and parsed when someone goes down.
  fetchPack() {
    if (!this.pack) {
      this.pack = fetch(PACK)
        .then((r) => { if (!r.ok) throw new Error(`${PACK}: ${r.status}`); return r.arrayBuffer(); })
        .catch((err) => { this.pack = null; throw err; });
    }
    return this.pack;
  }

  // Builds the crypt the first time someone goes down (behind the fade).
  load() {
    if (!this.loading) this.loading = this.build().catch((err) => { this.loading = null; throw err; });
    return this.loading;
  }

  async build() {
    const gltf = await new GLTFLoader().parseAsync(await this.fetchPack(), '');
    this.pack = null; // parsed: let the download go
    const models = {};
    for (const root of gltf.scene.children) models[root.userData.model] = root;

    let map = null;
    const parts = {};
    for (const [n, root] of Object.entries(models)) {
      root.updateMatrixWorld(true);
      parts[n] = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        map = map || o.material.map;
        parts[n].push({ geo: o.geometry, matrix: o.matrixWorld.clone() });
      });
    }
    // one material for the whole pack (it shares a single texture), so everything merges
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0 });
    // camera-side walls: clipped at CUT_Y; the inside faces seen through the cut are painted as dark stone
    const cutMat = mat.clone();
    cutMat.side = THREE.DoubleSide;
    cutMat.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_Y)];
    cutMat.clipShadows = true;
    cutMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `if (!gl_FrontFacing) gl_FragColor.rgb = vec3(0.028, 0.026, 0.032);
        #include <fog_fragment>`);
    };

    const full = [], cut = [];
    const place = new THREE.Matrix4(), local = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const at = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const p of PIECES) {
      if (!parts[p.m]) { console.warn(`crypt: ${p.m} is missing from ${PACK} (run tools/pack-dungeon.mjs)`); continue; }
      place.compose(at.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rot), p.scale ? sc.fromArray(p.scale) : sc.set(1, 1, 1));
      if (p.ox) place.multiply(local.makeTranslation(p.ox, 0, 0));
      for (const part of parts[p.m]) {
        const geo = part.geo.clone();
        for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
        geo.applyMatrix4(local.multiplyMatrices(place, part.matrix));
        (p.cut ? cut : full).push(geo);
      }
    }
    for (const [list, m] of [[full, mat], [cut, cutMat]]) {
      const mesh = new THREE.Mesh(mergeGeometries(list), m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    for (const c of this.chests) {
      const obj = models[c.model].clone(true);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mat;
        o.castShadow = true;
        o.receiveShadow = true;
      });
      obj.position.set(c.x, FLOOR_Y, c.z);
      obj.rotation.y = c.rot;
      c.lid = obj.getObjectByName(`${c.model}_lid`);
      c.group = obj;
      this.group.add(obj);
    }
    this.circle = runeCircle();
    this.group.add(this.circle);
  }

  // ---------------------------------------------------------------- going up and down
  setInside(inside) {
    const g = this.game, L = inside ? LOOK : this.outside;
    this.inside = inside;
    this.group.visible = inside;
    g.world.sky.visible = !inside;
    g.scene.background = inside ? new THREE.Color(LOOK.fog) : null;
    g.scene.fog.color.setHex(L.fog);
    g.scene.fog.near = L.near;
    g.scene.fog.far = L.far;
    g.hemi.color.setHex(L.hemiSky);
    g.hemi.groundColor.setHex(L.hemiGround);
    g.hemi.intensity = L.hemi;
    g.sun.color.setHex(L.sun);
    g.sun.intensity = L.sunI;
    // The overworld's fire and crystal lights double as the nearest torches down here
    // (the number of lights never changes, so no shader recompiles).
    if (inside) {
      // one follows you from the camera side (a Diablo-style light radius), the rest go to torches
      const [own, ...rest] = g.staticLights;
      this.playerLight = own.light;
      this.playerLight.color.setHex(0xffd6a8);
      this.playerLight.distance = 12;
      this.playerLight.decay = 1.3;
      this.lightSlots = rest.map((s) => ({ light: s.light, src: null, fade: 0 }));
      for (const sl of this.lightSlots) sl.light.intensity = 0;
    } else {
      for (const s of g.staticLights) {
        s.light.position.copy(s.pos);
        s.light.color.copy(s.color);
        s.light.distance = s.distance;
        s.light.decay = s.decay;
        s.light.intensity = s.intensity;
      }
      this.lightSlots = [];
    }
  }

  use(id) {
    if (this.near && this.near.id === id) this.near.use();
  }

  interact() {
    if (this.near) this.near.use();
  }

  pulse(amount) {
    this.pulseV = Math.max(this.pulseV, amount);
  }

  // ---------------------------------------------------------------- chests
  openChest(c) {
    const g = this.game, p = g.player;
    c.opened = true;
    c.readyAt = Date.now() + (c.hoard ? 12000 : CHEST_REFILL);
    c.label.el.style.display = 'none';
    g.sfx.play('chest');
    const at = new THREE.Vector3(c.x + Math.sin(c.rot) * 0.7, FLOOR_Y, c.z + Math.cos(c.rot) * 0.7);
    const lvl = Math.max(p.level, 8);
    if (c.hoard) {
      c.unlocked = false; // sealed again until Morvain is slain again
      g.loot.dropGold(randInt(150, 240), at);
      g.loot.dropGold(randInt(60, 110), at);
      g.loot.dropItem(randomItem(lvl + 1, { minRarity: 'rare', boost: 2 }), at);
      g.loot.dropItem(randomItem(lvl, { minRarity: 'magic', boost: 1.5 }), at);
      g.loot.dropPotion(at);
      g.fx.burst(new THREE.Vector3(c.x, FLOOR_Y + 1.2, c.z), 0xffc860, 40, 4);
      g.ui.log("You loot <b>Morvain's Hoard</b>.", 'gold');
    } else {
      g.loot.dropGold(Math.round(randInt(30, 60) * (1 + 0.2 * (lvl - 1))), at);
      g.loot.dropItem(randomItem(lvl, { minRarity: 'magic' }), at);
      if (chance(0.5)) g.loot.dropPotion(at);
    }
  }

  onLichDefeated(lich) {
    const g = this.game, h = this.hoard;
    for (const o of g.enemies.list) if (o.summoner === lich && o.alive) o.die(); // his minions crumble
    h.unlocked = true;
    h.opened = false;
    h.label.el.style.display = '';
    h.label.el.querySelector('.npc-title').textContent = 'Unguarded';
    g.ui.log("Morvain's hoard lies open at the back of the sanctum.", 'gold');
    this.pulse(2.5);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, p = g.player;
    // walking toward the graveyard: start downloading the crypt so the door opens without a wait
    if (!this.pack && !this.loading && Math.hypot(p.pos.x - CRYPT.x, p.pos.z - CRYPT.z) < 32 && performance.now() > (this.retryAt || 0)) {
      this.retryAt = performance.now() + 15000; // offline or a failed download: try again later, not every frame
      this.fetchPack().catch(() => {});
    }
    let best = null, bd = REACH;
    if (p.alive && !g.traveling) {
      for (const s of this.spots) {
        if (!s.can()) continue;
        const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        if (d < bd) { bd = d; best = s; }
      }
    }
    this.near = best;
    for (const s of this.spots) s.label.el.classList.toggle('near', s === best);
    if (!this.inside || !this.circle) return;

    const now = Date.now();
    for (const c of this.chests) {
      if (c.opened && now >= c.readyAt) { // refilled (or, for the hoard, sealed again)
        c.opened = false;
        c.label.el.style.display = '';
        if (c.hoard) c.label.el.querySelector('.npc-title').textContent = 'Sealed while Morvain lives';
      }
      c.lidT += ((c.opened ? 1 : 0) - c.lidT) * (1 - Math.exp(-6 * dt));
      if (c.lid) c.lid.rotation.x = -1.9 * c.lidT;
    }
    if (this.hoard.unlocked && Math.random() < dt * 10) {
      g.fx.add.emit({ pos: { x: this.hoard.x, y: FLOOR_Y + 1.1, z: this.hoard.z }, count: 1, spread: 0.6, velSpread: 0.3, vel: { x: 0, y: 1.2, z: 0 }, color: hdr(0xffd070, 2.4), size: 0.12, sizeEnd: 0.02, life: 1.2, drag: 1 });
    }
    this.pulseV = Math.max(0, this.pulseV - dt * 0.8);
    const u = this.circle.material.uniforms;
    u.uT.value += dt;
    u.uPulse.value = this.pulseV;
    this.updateLights(dt);
  }

  // The nearest light sources get the real point lights; a light fades out before it moves.
  updateLights(dt) {
    const p = this.game.player.pos, t = this.game.time;
    this.playerLight.position.set(p.x, p.y + 3.4, p.z + 2.6);
    this.playerLight.intensity = 7;
    const want = this.sources
      .map((s) => [s, (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 - (s.gain && s.gain() <= 0 ? 1e9 : 0)])
      .sort((a, b) => a[1] - b[1]).slice(0, this.lightSlots.length).map((a) => a[0]);
    const lit = new Set(this.lightSlots.map((sl) => sl.src));
    const spare = want.filter((s) => !lit.has(s));
    for (const sl of this.lightSlots) {
      if (!sl.src || !want.includes(sl.src)) {
        sl.fade -= dt * 6;
        if (sl.fade <= 0) {
          sl.fade = 0;
          sl.src = spare.shift() || null;
          if (sl.src) {
            sl.light.position.copy(sl.src.pos);
            sl.light.color.setHex(sl.src.color);
            sl.light.distance = sl.src.dist;
            sl.light.decay = 1.6;
          }
        }
      } else {
        sl.fade = Math.min(1, sl.fade + dt * 4);
      }
      const s = sl.src;
      if (!s) { sl.light.intensity = 0; continue; }
      const flick = s.flicker !== undefined ? 1 + Math.sin(t * 13 + s.flicker) * 0.09 + Math.sin(t * 7.3 + s.flicker * 2) * 0.08 : 1;
      sl.light.intensity = s.power * sl.fade * flick * (s.gain ? s.gain() : 1);
    }
  }
}

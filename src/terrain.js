// The shape of the world without the drawing: ground height, zones, paths, and everything that blocks
// the way, placed from fixed seeds. Shared by the game (world.js draws it) and the game server (its
// monsters walk it), so nothing here uses three.js or the page.
import { fbm, noise2 } from './noise.js';
import { clamp, lerp, smoothstep, mulberry32 } from './util.js';

export const WORLD_RADIUS = 82;
export const WATER_Y = 0.35;
export const POND = { x: -27, z: 20, r: 8 };

export const ZONES = [
  { id: 'camp', name: 'Emberwood Camp', sub: 'Safe haven · merchant, stash & quests', x: 0, z: 0, r: 12, safe: true },
  { id: 'meadow', name: 'Slime Meadow', sub: 'Level 1 – 2', x: 0, z: -30, r: 13 },
  { id: 'glade', name: 'Sunny Glade', sub: 'Level 1', x: 26, z: 12, r: 10 },
  { id: 'pond', name: 'Mirror Pond', sub: 'Level 2', x: -27, z: 20, r: 14 },
  { id: 'bandits', name: 'Bandit Hideout', sub: 'Level 3 – 4', x: 38, z: -46, r: 13 },
  { id: 'stones', name: 'Whispering Stones', sub: 'Level 4 – 5', x: -38, z: -44, r: 13 },
  { id: 'lair', name: "Grok's Lair", sub: 'Boss · Level 6', x: 0, z: -70, r: 12 },
  { id: 'graveyard', name: 'Forgotten Graveyard', sub: 'Undead · Level 5 – 7', x: 3, z: 46, r: 15 },
];

export const GRAVEYARD = { x: 3, z: 46, r: 13.5 };
// The crypt at the east end of the graveyard; its door (facing west) leads down to the dungeon.
export const CRYPT = { x: GRAVEYARD.x + 8.5, z: GRAVEYARD.z + 1 };
export const ALTAR = { x: -38, z: -44 }; // the Whispering Stones circle and its crystal

// The north end of camp (facing south toward the fire and the camera): the merchant's stall
// counter and the stash chest on the west side, the quest notice board on the east. Built in town.js.
export const TOWN = { vendor: { x: -3.2, z: -7.4 }, stash: { x: -6.9, z: -5.9 }, board: { x: 4.6, z: -7.4 }, stashYaw: 0.35, boardYaw: -0.4 };
export const nearTown = (x, z) => Math.hypot(x - TOWN.vendor.x, z - TOWN.vendor.z - 0.8) < 3.4
  || Math.hypot(x - TOWN.stash.x, z - TOWN.stash.z) < 1.8 || Math.hypot(x - TOWN.board.x, z - TOWN.board.z - 0.4) < 2.2;

export const PATHS = [
  [[0, 0], [3, -15], [0, -30]],
  [[0, -30], [-4, -50], [0, -66]],
  [[0, -30], [18, -38], [36, -45]],
  [[0, -30], [-19, -36], [-36, -43]],
  [[0, 0], [13, 5], [25, 11]],
  [[0, 0], [-11, 8], [-18, 15]],
  [[0, 0], [-3, 14], [2, 28], [3, 40]],
];

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function pathDist(x, z) {
  let d = Infinity;
  for (const p of PATHS) {
    for (let i = 0; i < p.length - 1; i++) {
      d = Math.min(d, distToSeg(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
    }
  }
  return d;
}

// The other places in the same coordinates, far from Emberwood (the dungeons and the lands beyond the
// waystones, see maps.js), each bring their own ground, walls and zones; the functions below ask them
// first. { contains(x, z), heightAt(x, z), resolve(pos, r), clear(x, z, r), zoneAt(x, z), wallAt?(x, z) }
const regions = [];
let lastRegion = null;
export function registerRegion(r) {
  regions.push(r);
}

export function regionAt(x, z) {
  if (lastRegion && lastRegion.contains(x, z)) return lastRegion;
  for (const r of regions) if (r.contains(x, z)) return (lastRegion = r);
  return null;
}

// A dungeon wall here (bolts stop, blinks don't land)?
export function wallAt(x, z) {
  return !!regionAt(x, z)?.wallAt?.(x, z);
}

export function heightAt(x, z) {
  const region = regionAt(x, z);
  if (region) return region.heightAt(x, z);
  let h = 1.35 + fbm(x * 0.028, z * 0.028, 4) * 2.3 + noise2(x * 0.13, z * 0.13) * 0.18;
  h = 0.8 + Math.log1p(Math.exp((h - 0.8) * 3)) / 3; // soft floor → flat meadows in lowlands
  const dc = Math.hypot(x, z);
  h = lerp(1.25, h, smoothstep(7, 17, dc)); // flat camp
  const edge = dc - (WORLD_RADIUS - 6);
  if (edge > 0) h += Math.pow(edge, 1.5) * 0.16; // hills that wall in the world
  const dp = Math.hypot(x - POND.x, z - POND.z);
  h = lerp(h, -1.3, 1 - smoothstep(POND.r * 0.25, POND.r + 4, dp));
  return h;
}

export function zoneAt(x, z) {
  const region = regionAt(x, z);
  if (region) return region.zoneAt(x, z);
  for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn;
  return null;
}

// ---------------------------------------------------------------- colliders
const GRID = 5;
const grid = new Map();
const cellKey = (ix, iz) => ix * 100003 + iz;
export const colliders = [];

export function addCollider(x, z, r) {
  const c = { x, z, r };
  colliders.push(c);
  const k = cellKey(Math.floor(x / GRID), Math.floor(z / GRID));
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(c);
}

// Push a circle at pos (anything with x and z) out of whatever it overlaps. props = false: only the land's
// edges and walls hold it, not trees, rocks and the like (bosses go through them rather than get stuck).
export function resolveCollision(pos, radius, props = true) {
  const region = regionAt(pos.x, pos.z);
  if (region) {
    region.resolve(pos, radius);
  } else {
    const d = Math.hypot(pos.x, pos.z);
    const maxR = WORLD_RADIUS - 2;
    if (d > maxR) { pos.x *= maxR / d; pos.z *= maxR / d; }
    const px = pos.x - POND.x, pz = pos.z - POND.z;
    const dp = Math.hypot(px, pz), pr = POND.r - 0.4 + radius;
    if (dp < pr && dp > 1e-4) { pos.x = POND.x + (px / dp) * pr; pos.z = POND.z + (pz / dp) * pr; }
  }
  if (!props) return;
  const ix = Math.floor(pos.x / GRID), iz = Math.floor(pos.z / GRID);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const cell = grid.get(cellKey(ix + a, iz + b));
      if (!cell) continue;
      for (const c of cell) {
        const ex = pos.x - c.x, ez = pos.z - c.z, rr = c.r + radius;
        const d2 = ex * ex + ez * ez;
        if (d2 < rr * rr && d2 > 1e-8) {
          const dd = Math.sqrt(d2);
          pos.x = c.x + (ex / dd) * rr;
          pos.z = c.z + (ez / dd) * rr;
        }
      }
    }
  }
}

export function isWalkable(x, z, radius = 0.6) {
  const region = regionAt(x, z);
  if (region) {
    if (!region.clear(x, z, radius)) return false;
  } else {
    if (Math.hypot(x, z) > WORLD_RADIUS - 3) return false;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + radius) return false;
  }
  const ix = Math.floor(x / GRID), iz = Math.floor(z / GRID);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const cell = grid.get(cellKey(ix + a, iz + b));
      if (cell) for (const c of cell) if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return false;
    }
  }
  return true;
}

// A random spot within r of (cx, cz) with room to stand: { x, y, z }.
export function randomWalkablePoint(cx, cz, r, radius = 0.7) {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (isWalkable(x, z, radius)) return { x, y: heightAt(x, z), z };
  }
  return { x: cx, y: heightAt(cx, cz), z: cz };
}

// Open woodland: away from camp, paths, the pond and the middle of every zone.
export function openGround(x, z, margin = 0) {
  if (Math.hypot(x, z) < 14 + margin) return false;
  if (pathDist(x, z) < 3 + margin) return false;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 3.5 + margin) return false;
  for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r * 0.72 + margin) return false;
  return true;
}

// ---------------------------------------------------------------- what stands where
// Trees, rocks and every built thing that blocks the way, with their colliders. world.js draws them
// (plus bushes, grass and flowers, which block nothing); the server only needs the colliders.
let plan = null;

export function planWorld() {
  if (plan) return plan;
  const rng = mulberry32(20261001);
  plan = { trees: { pine: [], oak: [], ember: [] }, rocks: { rockA: [], rockB: [] }, props: [], mapDots: [] };
  planTrees(rng, plan);
  planRocks(rng, plan);
  plan.props = planProps(rng);
  planTown();
  return plan;
}

function planTrees(rng, { trees, mapDots }) {
  const STEP = 3.1, EXT = WORLD_RADIUS + 26;
  for (let gx = -EXT; gx <= EXT; gx += STEP) {
    for (let gz = -EXT; gz <= EXT; gz += STEP) {
      const x = gx + (rng() - 0.5) * STEP * 0.9, z = gz + (rng() - 0.5) * STEP * 0.9;
      const dc = Math.hypot(x, z);
      if (dc > EXT) continue;
      const wall = dc > WORLD_RADIUS - 5;
      const density = wall ? 0.92 : clamp((fbm(x * 0.045 + 100, z * 0.045 - 50, 3) - 0.02) * 2.4, 0, 0.8);
      if (!wall && !openGround(x, z)) continue;
      if (rng() > density) continue;
      const r = rng();
      const s = wall ? 1.1 + rng() * 0.8 : 0.85 + rng() * 0.6;
      const it = { x, y: heightAt(x, z) - 0.1, z, s, rotY: rng() * 6.28, tiltX: (rng() - 0.5) * 0.08, tiltZ: (rng() - 0.5) * 0.08, tint: 0.85 + rng() * 0.25 };
      (r < 0.46 ? trees.pine : r < 0.88 ? trees.oak : trees.ember).push(it);
      if (dc < WORLD_RADIUS + 2) addCollider(x, z, 0.42 * s);
      mapDots.push([x, z, r < 0.88 ? '#2f6a33' : '#b8642a']);
    }
  }
}

function planRocks(rng, { rocks, mapDots }) {
  for (let i = 0; i < 260; i++) {
    const x = (rng() - 0.5) * 2 * (WORLD_RADIUS + 10), z = (rng() - 0.5) * 2 * (WORLD_RADIUS + 10);
    const dc = Math.hypot(x, z);
    if (dc > WORLD_RADIUS + 10 || !openGround(x, z, -1.5)) continue;
    const s = rng() < 0.15 ? 1.4 + rng() * 1.2 : 0.35 + rng() * 0.8;
    const it = { x, y: heightAt(x, z) - 0.1, z, s, sy: s * (0.7 + rng() * 0.6), rotY: rng() * 6.28, tint: 0.85 + rng() * 0.3 };
    (rng() < 0.5 ? rocks.rockA : rocks.rockB).push(it);
    if (s > 0.6 && dc < WORLD_RADIUS + 2) addCollider(x, z, 0.8 * s);
    mapDots.push([x, z, '#8d8a80']);
  }
}

// Camps, ruins and the graveyard as a list of { kind, x, z, … }; world.js builds each kind.
function planProps(rng) {
  const props = [];
  const put = (kind, x, z, o = {}, r = 0) => {
    props.push({ kind, x, z, ...o });
    if (r) addCollider(x, z, r);
  };
  const campfire = (x, z) => put('campfire', x, z, {}, 1.1);
  const tent = (x, z, rotY, color, s = 1) => put('tent', x, z, { rotY, color, s }, 1.5 * s);
  const crate = (x, z, rotY, s = 0.85) => put('crate', x, z, { rotY, s }, s * 0.65);
  const barrel = (x, z) => put('barrel', x, z, {}, 0.45);

  // --- Camp
  campfire(0, 0); // (the merchants, the banker, the blacksmith and the board: camps.js)
  tent(-2.5, 6.4, 2.9, 0x6f8fa8);
  put('bench', 0, 2.3, { rotY: 0 });
  put('bench', 2.1, -1.2, { rotY: 1.05 });
  put('bench', -2.1, -1.1, { rotY: -1.05 });
  barrel(7.4, -1.2); barrel(8.0, -0.3);
  put('signpost', 2.6, -9);
  put('waystone', 5.5, 5.5, {}, 0.9); // to the other lands (maps.js WAYSTONE)
  // palisade ring with gaps for paths
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const x = Math.cos(a) * 11.5, z = Math.sin(a) * 11.5;
    if (pathDist(x, z) < 3.2) continue;
    put('stake', x, z, {}, 0.3);
  }

  // --- Bandit hideout
  campfire(38, -45);
  tent(33.5, -49.5, 0.5, 0x7a2e2a);
  tent(42.5, -42, -2.2, 0x6b2a26);
  tent(34, -41, 2.4, 0x5a3a30, 0.9);
  crate(41, -49.5, 0.2); crate(41.9, -50.4, 0.9, 0.7); crate(40.8, -50.8, 1.4, 0.6); barrel(36.5, -52); barrel(37.3, -52.6); barrel(44.5, -45);
  put('watchtower', 45, -51, {}, 1.3);

  // --- Whispering stones
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    put('standing', ALTAR.x + Math.cos(a) * 6.5, ALTAR.z + Math.sin(a) * 6.5, { a }, 0.7);
  }
  put('altar', ALTAR.x, ALTAR.z, {}, 1.3);

  // --- Grok's lair: boulders around the back, a totem, two torches
  const lx = 0, lz = -70;
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    const s = 1.6 + rng() * 1.2;
    put('boulder', lx + Math.cos(a) * 10.5, lz + Math.sin(a) * 9, { s }, s * 0.85);
  }
  put('totem', lx, lz - 5.5, {}, 0.7);
  put('bones', lx, lz);
  for (const s of [-3, 3]) put('torch', lx + s, lz - 4);

  // --- Forgotten Graveyard (home of the KayKit skeletons)
  const gv = GRAVEYARD;
  for (let row = -2; row <= 2; row++) {
    for (let col = -3; col <= 2; col++) {
      if (rng() < 0.25) continue;
      const x = gv.x + col * 2.7 + 0.6 + (rng() - 0.5) * 0.5;
      const z = gv.z + row * 3.2 + (rng() - 0.5) * 0.5;
      if (pathDist(x, z) < 1.8 || Math.hypot(x - CRYPT.x, z - CRYPT.z) < 4) continue;
      const k = rng();
      put('headstone', x, z, { rotY: (rng() - 0.5) * 0.35, variant: k < 0.6 ? 'round' : k < 0.85 ? 'cross' : 'broken' }, 0.4);
    }
  }
  // the crypt, its door facing the graves (west)
  put('crypt', CRYPT.x, CRYPT.z);
  addCollider(CRYPT.x, CRYPT.z - 1.2, 1.9);
  addCollider(CRYPT.x, CRYPT.z + 1.2, 1.9);
  // a ruined iron fence: posts with gaps (and an opening for the path); the railing joins neighbours
  const N = 88;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = gv.x + Math.cos(a) * gv.r, z = gv.z + Math.sin(a) * gv.r;
    const standing = Math.sin(a * 5 + 1.3) + Math.sin(a * 11) * 0.5 > -0.2;
    if (!standing || pathDist(x, z) < 2.6) continue;
    put('fencepost', x, z, { i }, 0.25);
  }
  for (const [ox, oz] of [[-9, -7], [-10, 5], [6, 10], [-4, 11], [10, -8]]) {
    const s = 1 + rng() * 0.4;
    put('deadtree', gv.x + ox, gv.z + oz, { s }, 0.3 * s);
  }
  // braziers with green spirit fire
  for (const [x, z] of [[gv.x - 2.6, gv.z - 12], [gv.x + 2.6, gv.z - 12], [CRYPT.x - 2.6, CRYPT.z - 2.2], [CRYPT.x - 2.6, CRYPT.z + 2.2]]) put('brazier', x, z, {}, 0.35);
  return props;
}

// The merchant's stall, the stash chest, the notice board and Wren behind the counter (town.js).
function planTown() {
  const { x, z } = TOWN.vendor;
  for (const dx of [-0.95, 0, 0.95]) addCollider(x + dx, z, 0.6);
  addCollider(x - 1.5, z - 1.55, 0.3);
  addCollider(x + 1.5, z - 1.55, 0.3);
  addCollider(x - 2.25, z - 0.9, 0.55);
  addCollider(x + 2.2, z - 1.0, 0.4);
  addCollider(x + 1.95, z + 0.35, 0.2);
  addCollider(x, z - 0.95, 0.45); // Wren
  addCollider(TOWN.stash.x, TOWN.stash.z, 0.8);
  const b = TOWN.board, cy = TOWN.boardYaw;
  for (const lx of [-1, 0, 1]) addCollider(b.x + lx * Math.cos(cy), b.z - lx * Math.sin(cy), 0.4);
}

// Procedural low-poly world: terrain, water, trees, rocks, grass, props and colliders.
// The character pack has no environment art, so everything here is generated in code
// in a flat-shaded style that matches KayKit's look.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

// The north end of camp (facing south toward the fire and the camera): the merchant's stall
// counter and the stash chest on the west side, the quest notice board on the east. Built in town.js.
export const TOWN = { vendor: { x: -3.2, z: -7.4 }, stash: { x: -6.9, z: -5.9 }, board: { x: 4.6, z: -7.4 } };
const nearTown = (x, z) => Math.hypot(x - TOWN.vendor.x, z - TOWN.vendor.z - 0.8) < 3.4
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

export const worldUniforms = { uTime: { value: 0 } };

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

// A walled-off area elsewhere in the scene (the crypt dungeon, see dungeon.js) brings its own
// floor, walls and zones; the functions below ask it first.
let region = null;
export function registerRegion(r) {
  region = r;
}

export function heightAt(x, z) {
  if (region && region.contains(x, z)) return region.floorY;
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
  if (region && region.contains(x, z)) return region.zoneAt(x, z);
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

export function resolveCollision(pos, radius) {
  if (region && region.contains(pos.x, pos.z)) {
    region.resolve(pos, radius);
  } else {
    const d = Math.hypot(pos.x, pos.z);
    const maxR = WORLD_RADIUS - 2;
    if (d > maxR) { pos.x *= maxR / d; pos.z *= maxR / d; }
    const px = pos.x - POND.x, pz = pos.z - POND.z;
    const dp = Math.hypot(px, pz), pr = POND.r - 0.4 + radius;
    if (dp < pr && dp > 1e-4) { pos.x = POND.x + (px / dp) * pr; pos.z = POND.z + (pz / dp) * pr; }
  }
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
  if (region && region.contains(x, z)) {
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

export function randomWalkablePoint(cx, cz, r, radius = 0.7) {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (isWalkable(x, z, radius)) return new THREE.Vector3(x, heightAt(x, z), z);
  }
  return new THREE.Vector3(cx, heightAt(cx, cz), cz);
}

// ---------------------------------------------------------------- geometry helpers
function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function gradient(geo, hexBottom, hexTop, y0, y1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const a = new THREE.Color(hexBottom), b = new THREE.Color(hexTop), c = new THREE.Color();
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    c.copy(a).lerp(b, clamp((p.getY(i) - y0) / (y1 - y0), 0, 1));
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Offsets vertices by position so shared corners move together (no cracks).
function jitter(geo, amt, rng) {
  const p = geo.attributes.position;
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = cache.get(key);
    if (!o) { o = [(rng() - 0.5) * amt, (rng() - 0.5) * amt, (rng() - 0.5) * amt]; cache.set(key, o); }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return geo;
}

const envMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });

// ---------------------------------------------------------------- terrain
const COL = {
  grassA: new THREE.Color(0x6aa843),
  grassB: new THREE.Color(0x96c653),
  grassDark: new THREE.Color(0x4d8a38),
  dirt: new THREE.Color(0xb88c58),
  dirtDark: new THREE.Color(0x8e6a42),
  sand: new THREE.Color(0xdcc88f),
  mud: new THREE.Color(0x6f6446),
  rock: new THREE.Color(0x8f8b7c),
};
const PATCHES = [
  { x: 38, z: -46, r: 10, c: new THREE.Color(0xa47e52), a: 0.8 },
  { x: -38, z: -44, r: 10, c: new THREE.Color(0x5f7a55), a: 0.7 },
  { x: 0, z: -70, r: 11, c: new THREE.Color(0x7d6450), a: 0.85 },
  { x: 3, z: 46, r: 15, c: new THREE.Color(0x56644a), a: 0.85 },
];

export function groundColor(out, x, z, h, slope = 0) {
  const n = fbm(x * 0.06 + 40, z * 0.06 - 12, 3);
  out.copy(COL.grassA).lerp(COL.grassB, clamp(n * 1.5 + 0.5, 0, 1));
  const n2 = noise2(x * 0.21, z * 0.21);
  if (n2 > 0.45) out.lerp(COL.grassDark, 0.45);
  const dc = Math.hypot(x, z);
  if (dc < 10) out.lerp(COL.dirt, (1 - smoothstep(5.5, 9.5, dc + n2 * 1.5)) * 0.85);
  for (const pt of PATCHES) {
    const d = Math.hypot(x - pt.x, z - pt.z);
    if (d < pt.r + 2) out.lerp(pt.c, (1 - smoothstep(pt.r * 0.45, pt.r, d + n2 * 2)) * pt.a);
  }
  const pd = pathDist(x, z) + n2 * 0.7;
  if (pd < 2.3) out.lerp(pd < 1.45 ? COL.dirt : COL.dirtDark, pd < 1.45 ? 0.95 : 0.45);
  if (h < WATER_Y + 0.5 && Math.hypot(x - POND.x, z - POND.z) < POND.r + 5) out.copy(h < WATER_Y - 0.25 ? COL.mud : COL.sand);
  if (slope > 0.5) out.lerp(COL.rock, smoothstep(0.5, 0.8, slope));
  return out;
}

function buildTerrain(rng) {
  const SIZE = 236, SEG = 158;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cell = SIZE / SEG;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    if (Math.abs(x) < SIZE / 2 - 1 && Math.abs(z) < SIZE / 2 - 1) {
      const jx = noise2(x * 0.7 + 3.1, z * 0.7) * cell * 0.3;
      const jz = noise2(x * 0.7, z * 0.7 + 9.7) * cell * 0.3;
      x += jx; z += jz;
    }
    pos.setXYZ(i, x, heightAt(x, z), z);
  }
  const g = geo.toNonIndexed();
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    e1.subVectors(b, a); e2.subVectors(c, a);
    const ny = Math.abs(e1.cross(e2).normalize().y);
    groundColor(col, (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, (a.y + b.y + c.y) / 3, 1 - ny);
    col.multiplyScalar(0.93 + rng() * 0.12);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = col.r; colors[(i + k) * 3 + 1] = col.g; colors[(i + k) * 3 + 2] = col.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

function buildWater(scene, rng) {
  const geo = new THREE.CircleGeometry(POND.r + 4.5, 56);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3f98d4, transparent: true, opacity: 0.8, roughness: 0.06, metalness: 0.15,
    emissive: 0x0c3050, emissiveIntensity: 0.5,
  });
  const water = new THREE.Mesh(geo, mat);
  water.position.set(POND.x, WATER_Y, POND.z);
  water.receiveShadow = true;
  scene.add(water);

  // lily pads + reeds
  const pads = [], reeds = [];
  for (let i = 0; i < 14; i++) {
    const ang = rng() * Math.PI * 2, d = 2 + rng() * (POND.r - 3);
    const x = POND.x + Math.cos(ang) * d, z = POND.z + Math.sin(ang) * d;
    const pad = colored(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 9, 1, false, 0.3, Math.PI * 1.8), 0x4f9a3a);
    pad.scale(0.6 + rng() * 0.6, 1, 0.6 + rng() * 0.6);
    pad.rotateY(rng() * 6.28);
    pad.translate(x, WATER_Y + 0.03, z);
    pads.push(pad);
    if (rng() < 0.3) {
      const fl = colored(new THREE.IcosahedronGeometry(0.14, 0), rng() < 0.5 ? 0xffc0d8 : 0xfff6e0);
      fl.translate(x + 0.1, WATER_Y + 0.12, z);
      pads.push(fl);
    }
  }
  for (let i = 0; i < 40; i++) {
    const ang = rng() * Math.PI * 2, d = POND.r - 0.8 + rng() * 1.8;
    const x = POND.x + Math.cos(ang) * d, z = POND.z + Math.sin(ang) * d;
    const hgt = 0.9 + rng() * 0.8;
    const reed = gradient(new THREE.ConeGeometry(0.05, hgt, 3), 0x3c6e2a, 0x9ccf5c, -hgt / 2, hgt / 2);
    reed.rotateZ((rng() - 0.5) * 0.3);
    reed.translate(x, heightAt(x, z) + hgt / 2 - 0.05, z);
    reeds.push(reed);
  }
  const deco = new THREE.Mesh(mergeGeometries([...pads, ...reeds]), envMaterial());
  deco.castShadow = true;
  scene.add(deco);
  return water;
}

// ---------------------------------------------------------------- vegetation
function makePine(rng) {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.16, 0.26, 1.3, 6).translate(0, 0.65, 0), 0x6b4a2f),
    colored(jitter(new THREE.ConeGeometry(1.55, 1.9, 7).translate(0, 1.9, 0), 0.28, rng), 0x2e7443),
    colored(jitter(new THREE.ConeGeometry(1.2, 1.6, 7).translate(0, 2.75, 0), 0.22, rng), 0x39864a),
    colored(jitter(new THREE.ConeGeometry(0.8, 1.4, 7).translate(0, 3.55, 0), 0.16, rng), 0x4b9a52),
  ]);
}

function makeOak(rng, c1, c2, c3) {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.2, 0.32, 2.0, 6).translate(0, 1.0, 0), 0x7a5536),
    colored(new THREE.CylinderGeometry(0.08, 0.12, 1.0, 5).rotateZ(-0.9).translate(0.45, 1.9, 0.1), 0x7a5536),
    colored(jitter(new THREE.IcosahedronGeometry(1.45, 1), 0.38, rng).translate(0, 3.0, 0), c1),
    colored(jitter(new THREE.IcosahedronGeometry(1.0, 0), 0.22, rng).translate(0.95, 2.55, 0.35), c2),
    colored(jitter(new THREE.IcosahedronGeometry(0.95, 0), 0.22, rng).translate(-0.85, 2.65, -0.4), c3),
  ]);
}

function makeBush(rng) {
  return mergeGeometries([
    colored(jitter(new THREE.IcosahedronGeometry(0.75, 0), 0.2, rng).scale(1, 0.75, 1).translate(0, 0.42, 0), 0x4c9439),
    colored(jitter(new THREE.IcosahedronGeometry(0.55, 0), 0.15, rng).translate(0.55, 0.33, 0.2), 0x5aa844),
    colored(jitter(new THREE.IcosahedronGeometry(0.45, 0), 0.12, rng).translate(-0.45, 0.3, -0.25), 0x62b04a),
  ]);
}

function makeRock(rng, hex) {
  return colored(jitter(new THREE.DodecahedronGeometry(1, 0), 0.35, rng).scale(1, 0.62, 1).translate(0, 0.22, 0), hex);
}

function makeTuft() {
  const blades = [];
  for (let i = 0; i < 4; i++) {
    const h = 0.48 + i * 0.07;
    const b = new THREE.ConeGeometry(0.075, h, 3).translate(0, h / 2, 0);
    b.rotateZ((i - 1.5) * 0.28);
    b.rotateY(i * 1.7);
    b.translate(Math.cos(i * 2.1) * 0.09, 0, Math.sin(i * 2.1) * 0.09);
    blades.push(gradient(b, 0x3b7a2b, 0xa9da6c, 0, 0.6));
  }
  return mergeGeometries(blades);
}

function makeFlower() {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 3).translate(0, 0.12, 0), 0x6a8f45),
    colored(new THREE.IcosahedronGeometry(0.09, 0).scale(1, 0.6, 1).translate(0, 0.25, 0), 0xffffff),
  ]);
}

function swayMaterial(base) {
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float sway = sin(uTime * 1.7 + ip.x * 0.31 + ip.y * 0.23) * 0.6 + sin(uTime * 3.3 + ip.x * 0.9) * 0.25;
      transformed.x += sway * 0.22 * position.y * position.y;
      transformed.z += sway * 0.09 * position.y;`,
    );
  };
  return base;
}

function scatterInstanced(scene, geo, material, items, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const col = new THREE.Color();
  items.forEach((it, i) => {
    e.set(it.tiltX || 0, it.rotY || 0, it.tiltZ || 0);
    q.setFromEuler(e);
    s.set(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s);
    p.set(it.x, it.y, it.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (it.color !== undefined) mesh.setColorAt(i, col.set(it.color));
    else if (it.tint !== undefined) mesh.setColorAt(i, col.setRGB(it.tint, it.tint, it.tint));
  });
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

function openGround(x, z, margin = 0) {
  if (Math.hypot(x, z) < 14 + margin) return false;
  if (pathDist(x, z) < 3 + margin) return false;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 3.5 + margin) return false;
  for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r * 0.72 + margin) return false;
  return true;
}

function buildVegetation(scene, rng, mapDots, lowSpec) {
  const pine = makePine(rng);
  const oak = makeOak(rng, 0x5ea542, 0x6cb34b, 0x559c3e);
  const ember = makeOak(rng, 0xe07a2c, 0xf0a13c, 0xc8582a);
  const bush = makeBush(rng);
  const rockA = makeRock(rng, 0x9a978b), rockB = makeRock(rng, 0x86837a);

  const lists = { pine: [], oak: [], ember: [], bush: [], rockA: [], rockB: [], tuft: [], flower: [] };
  const STEP = 3.1, EXT = WORLD_RADIUS + 26;
  for (let gx = -EXT; gx <= EXT; gx += STEP) {
    for (let gz = -EXT; gz <= EXT; gz += STEP) {
      const x = gx + (rng() - 0.5) * STEP * 0.9, z = gz + (rng() - 0.5) * STEP * 0.9;
      const dc = Math.hypot(x, z);
      if (dc > EXT) continue;
      let density;
      const wall = dc > WORLD_RADIUS - 5;
      if (wall) density = 0.92;
      else density = clamp((fbm(x * 0.045 + 100, z * 0.045 - 50, 3) - 0.02) * 2.4, 0, 0.8);
      if (!wall && !openGround(x, z)) continue;
      if (rng() > density) continue;
      const y = heightAt(x, z) - 0.1;
      const r = rng();
      const s = wall ? 1.1 + rng() * 0.8 : 0.85 + rng() * 0.6;
      const it = { x, y, z, s, rotY: rng() * 6.28, tiltX: (rng() - 0.5) * 0.08, tiltZ: (rng() - 0.5) * 0.08, tint: 0.85 + rng() * 0.25 };
      if (r < 0.46) lists.pine.push(it);
      else if (r < 0.88) lists.oak.push(it);
      else lists.ember.push(it);
      if (dc < WORLD_RADIUS + 2) addCollider(x, z, 0.42 * s);
      mapDots.push([x, z, r < 0.88 ? '#2f6a33' : '#b8642a']);
    }
  }

  for (let i = 0; i < 420; i++) {
    const x = (rng() - 0.5) * 2 * (WORLD_RADIUS + 4), z = (rng() - 0.5) * 2 * (WORLD_RADIUS + 4);
    if (Math.hypot(x, z) > WORLD_RADIUS + 4 || !openGround(x, z, -1)) continue;
    lists.bush.push({ x, y: heightAt(x, z) - 0.05, z, s: 0.7 + rng() * 0.7, rotY: rng() * 6.28, tint: 0.85 + rng() * 0.3 });
  }

  for (let i = 0; i < 260; i++) {
    const x = (rng() - 0.5) * 2 * (WORLD_RADIUS + 10), z = (rng() - 0.5) * 2 * (WORLD_RADIUS + 10);
    const dc = Math.hypot(x, z);
    if (dc > WORLD_RADIUS + 10 || !openGround(x, z, -1.5)) continue;
    const s = rng() < 0.15 ? 1.4 + rng() * 1.2 : 0.35 + rng() * 0.8;
    const it = { x, y: heightAt(x, z) - 0.1, z, s, sy: s * (0.7 + rng() * 0.6), rotY: rng() * 6.28, tint: 0.85 + rng() * 0.3 };
    (rng() < 0.5 ? lists.rockA : lists.rockB).push(it);
    if (s > 0.6 && dc < WORLD_RADIUS + 2) addCollider(x, z, 0.8 * s);
    mapDots.push([x, z, '#8d8a80']);
  }

  // grass tufts & flowers
  const TUFTS = lowSpec ? 5500 : 11000, FLOWERS = lowSpec ? 1500 : 2600;
  for (let i = 0; i < TUFTS; i++) {
    const x = (rng() - 0.5) * 2 * (WORLD_RADIUS + 6), z = (rng() - 0.5) * 2 * (WORLD_RADIUS + 6);
    if (Math.hypot(x, z) > WORLD_RADIUS + 6) continue;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.25 || pathDist(x, z) < 1.7 || Math.hypot(x, z) < 6 || nearTown(x, z)) continue;
    if (fbm(x * 0.09 - 30, z * 0.09 + 7, 2) < -0.25) continue;
    lists.tuft.push({ x, y: h - 0.05, z, s: 0.7 + rng() * 0.8, rotY: rng() * 6.28, tint: 0.8 + rng() * 0.35 });
  }
  const FLOWER_COLORS = [0xffffff, 0xffe14d, 0xff8fb8, 0xb58cff, 0xff7043, 0x8fd3ff];
  for (let i = 0; i < FLOWERS; i++) {
    const x = (rng() - 0.5) * 2 * WORLD_RADIUS, z = (rng() - 0.5) * 2 * WORLD_RADIUS;
    if (Math.hypot(x, z) > WORLD_RADIUS || pathDist(x, z) < 2 || Math.hypot(x, z) < 7 || nearTown(x, z)) continue;
    const n = fbm(x * 0.07 + 5, z * 0.07 - 5, 2);
    if (n < 0.18) continue;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.3) continue;
    const ci = Math.floor(((n * 7 + x * 0.05) % 1 + 1) % 1 * FLOWER_COLORS.length);
    lists.flower.push({ x, y: h - 0.02, z, s: 0.8 + rng() * 0.6, rotY: rng() * 6.28, color: FLOWER_COLORS[ci] });
  }

  const mat = envMaterial();
  scatterInstanced(scene, pine, mat, lists.pine);
  scatterInstanced(scene, oak, mat, lists.oak);
  scatterInstanced(scene, ember, mat, lists.ember);
  scatterInstanced(scene, bush, mat, lists.bush);
  scatterInstanced(scene, rockA, mat, lists.rockA);
  scatterInstanced(scene, rockB, mat, lists.rockB);
  const grassMat = swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  scatterInstanced(scene, makeTuft(), grassMat, lists.tuft, { castShadow: false });
  scatterInstanced(scene, makeFlower(), swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })), lists.flower, { castShadow: false });
}

// ---------------------------------------------------------------- props
function buildProps(scene, rng) {
  const parts = [];
  const fires = [];
  const add = (geo, x, z, { y = 0, rotY = 0, ground = true } = {}) => {
    geo.rotateY(rotY);
    geo.translate(x, (ground ? heightAt(x, z) : 0) + y, z);
    parts.push(geo);
  };

  const campfire = (x, z) => {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      add(colored(jitter(new THREE.DodecahedronGeometry(0.27, 0), 0.12, rng), 0x807c72), x + Math.cos(a) * 0.95, z + Math.sin(a) * 0.95, { y: 0.1 });
    }
    for (let i = 0; i < 3; i++) {
      const log = colored(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6), 0x5a3c22);
      log.rotateZ(Math.PI / 2 - 0.35);
      log.translate(0.3, 0.3, 0);
      add(log, x, z, { rotY: (i / 3) * Math.PI * 2 });
    }
    fires.push(new THREE.Vector3(x, heightAt(x, z) + 0.35, z));
    addCollider(x, z, 1.1);
  };

  const tent = (x, z, rotY, hex, s = 1) => {
    const t = colored(jitter(new THREE.ConeGeometry(1.9 * s, 2.5 * s, 4, 1), 0.08, rng), hex);
    t.rotateY(Math.PI / 4);
    t.translate(0, 1.2 * s, 0);
    add(t, x, z, { rotY });
    const door = colored(new THREE.ConeGeometry(0.55 * s, 1.5 * s, 3, 1, true, 0, Math.PI * 0.66), 0x2c1c12);
    door.translate(0, 0.72 * s, 1.18 * s);
    add(door, x, z, { rotY });
    const pole = colored(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 4).translate(0, 2.6 * s, 0), 0x5a3c22);
    add(pole, x, z, { rotY });
    addCollider(x, z, 1.5 * s);
  };

  const crate = (x, z, rotY, s = 0.85) => {
    add(colored(new THREE.BoxGeometry(s, s, s).translate(0, s / 2, 0), 0xa3773f), x, z, { rotY });
    add(colored(new THREE.BoxGeometry(s * 1.02, s * 0.12, s * 1.02).translate(0, s * 0.8, 0), 0x7d5a2e), x, z, { rotY });
    addCollider(x, z, s * 0.65);
  };
  const barrel = (x, z) => {
    add(colored(new THREE.CylinderGeometry(0.38, 0.34, 0.95, 9).translate(0, 0.48, 0), 0x8b5a2b), x, z);
    add(colored(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 9).translate(0, 0.72, 0), 0x55504a), x, z);
    add(colored(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 9).translate(0, 0.22, 0), 0x55504a), x, z);
    addCollider(x, z, 0.45);
  };
  const bench = (x, z, rotY) => {
    const l = colored(new THREE.CylinderGeometry(0.26, 0.26, 1.9, 7), 0x6e4a2a);
    l.rotateZ(Math.PI / 2);
    l.translate(0, 0.26, 0);
    add(l, x, z, { rotY });
  };

  // --- Camp
  campfire(0, 0);
  tent(-5.8, -2.8, 0.9, 0xc9a06a);
  tent(5.4, -3.6, -0.8, 0x9c5a3c);
  tent(-2.5, 6.4, 2.9, 0x6f8fa8);
  bench(0, 2.3, 0);
  bench(2.1, -1.2, 1.05);
  bench(-2.1, -1.1, -1.05);
  crate(-7.2, 1.2, 0.3); crate(-7.9, 2.2, 0.8, 0.7); barrel(7.4, -1.2); barrel(8.0, -0.3);
  // signpost
  add(colored(new THREE.CylinderGeometry(0.08, 0.1, 2.3, 5).translate(0, 1.15, 0), 0x6b4a2f), 2.6, -9);
  add(colored(new THREE.BoxGeometry(1.4, 0.34, 0.08).translate(0.45, 1.85, 0), 0xa27a4b), 2.6, -9, { rotY: -0.2 });
  add(colored(new THREE.BoxGeometry(1.2, 0.3, 0.08).translate(-0.4, 1.4, 0), 0xa27a4b), 2.6, -9, { rotY: 0.5 });
  // palisade ring with gaps for paths
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const x = Math.cos(a) * 11.5, z = Math.sin(a) * 11.5;
    if (pathDist(x, z) < 3.2) continue;
    const h = 1.3 + rng() * 0.35;
    add(colored(new THREE.CylinderGeometry(0.15, 0.17, h, 5).translate(0, h / 2, 0), 0x7a5536), x, z);
    add(colored(new THREE.ConeGeometry(0.15, 0.35, 5).translate(0, h + 0.17, 0), 0x8c6440), x, z);
    addCollider(x, z, 0.3);
  }

  // --- Bandit hideout
  campfire(38, -45);
  tent(33.5, -49.5, 0.5, 0x7a2e2a);
  tent(42.5, -42, -2.2, 0x6b2a26);
  tent(34, -41, 2.4, 0x5a3a30, 0.9);
  crate(41, -49.5, 0.2); crate(41.9, -50.4, 0.9, 0.7); crate(40.8, -50.8, 1.4, 0.6); barrel(36.5, -52); barrel(37.3, -52.6); barrel(44.5, -45);
  // watchtower
  {
    const tx = 45, tz = -51;
    for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      add(colored(new THREE.CylinderGeometry(0.12, 0.14, 3.6, 5).translate(0, 1.8, 0), 0x6b4a2f), tx + ox, tz + oz);
    }
    add(colored(new THREE.BoxGeometry(2.3, 0.2, 2.3).translate(0, 3.5, 0), 0x8c6440), tx, tz);
    for (const [ox, oz, w, d] of [[0, -1.1, 2.3, 0.1], [0, 1.1, 2.3, 0.1], [-1.1, 0, 0.1, 2.3], [1.1, 0, 0.1, 2.3]]) {
      add(colored(new THREE.BoxGeometry(w, 0.5, d).translate(ox, 3.85, oz), 0x7a5536), tx, tz);
    }
    add(colored(new THREE.ConeGeometry(1.8, 1.2, 4).rotateY(Math.PI / 4).translate(0, 4.9, 0), 0x6b2a26), tx, tz);
    addCollider(tx, tz, 1.3);
  }

  // --- Whispering stones
  const sx = -38, sz = -44;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const x = sx + Math.cos(a) * 6.5, z = sz + Math.sin(a) * 6.5;
    const h = 2.6 + rng() * 1.1;
    const st = colored(jitter(new THREE.BoxGeometry(1.0, h, 0.75, 1, 2, 1), 0.18, rng).translate(0, h / 2 - 0.2, 0), 0x7d7f88);
    st.rotateZ((rng() - 0.5) * 0.15);
    add(st, x, z, { rotY: -a });
    addCollider(x, z, 0.7);
  }
  add(colored(new THREE.CylinderGeometry(1.1, 1.35, 0.55, 6).translate(0, 0.2, 0), 0x6a6c75), sx, sz);
  addCollider(sx, sz, 1.3);

  // --- Grok's lair
  const lx = 0, lz = -70;
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    const x = lx + Math.cos(a) * 10.5, z = lz + Math.sin(a) * 9;
    const s = 1.6 + rng() * 1.2;
    add(colored(jitter(new THREE.DodecahedronGeometry(s, 0), 0.5, rng).scale(1, 0.8, 1), 0x77736a), x, z, { y: s * 0.35 });
    addCollider(x, z, s * 0.85);
  }
  // totem
  {
    const tx = lx, tz = lz - 5.5;
    add(colored(new THREE.BoxGeometry(0.8, 0.8, 0.8).translate(0, 0.4, 0), 0x8b5a2b), tx, tz);
    add(colored(new THREE.BoxGeometry(0.75, 0.75, 0.75).translate(0, 1.18, 0), 0xa0522d), tx, tz);
    add(colored(new THREE.BoxGeometry(0.85, 0.85, 0.85).translate(0, 2.0, 0), 0x7a4a24), tx, tz);
    add(colored(new THREE.ConeGeometry(0.16, 0.8, 5).rotateZ(1.2).translate(0.75, 2.3, 0), 0xefe6d0), tx, tz);
    add(colored(new THREE.ConeGeometry(0.16, 0.8, 5).rotateZ(-1.2).translate(-0.75, 2.3, 0), 0xefe6d0), tx, tz);
    add(colored(new THREE.BoxGeometry(0.5, 0.12, 0.05).translate(0, 2.05, 0.44), 0xd8372f), tx, tz);
    add(colored(new THREE.BoxGeometry(0.12, 0.12, 0.05).translate(-0.2, 2.25, 0.44), 0xffe14d), tx, tz);
    add(colored(new THREE.BoxGeometry(0.12, 0.12, 0.05).translate(0.2, 2.25, 0.44), 0xffe14d), tx, tz);
    addCollider(tx, tz, 0.7);
  }
  // bone piles
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, d = 3 + rng() * 5;
    const x = lx + Math.cos(a) * d, z = lz + Math.sin(a) * d;
    for (let k = 0; k < 3; k++) {
      const b = colored(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4), 0xece3cc);
      b.rotateZ(Math.PI / 2);
      add(b, x + (rng() - 0.5) * 0.4, z + (rng() - 0.5) * 0.4, { y: 0.06, rotY: rng() * 6.28 });
    }
    if (rng() < 0.6) add(colored(new THREE.IcosahedronGeometry(0.18, 0), 0xf2ead6), x, z, { y: 0.15 });
  }
  fires.push(new THREE.Vector3(lx - 3, heightAt(lx - 3, lz - 4) + 1.7, lz - 4));
  fires.push(new THREE.Vector3(lx + 3, heightAt(lx + 3, lz - 4) + 1.7, lz - 4));
  for (const s of [-3, 3]) add(colored(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 5).translate(0, 0.8, 0), 0x5a3c22), lx + s, lz - 4);

  // --- Forgotten Graveyard (home of the KayKit skeletons)
  const gv = GRAVEYARD;
  const crypt = CRYPT;
  const spiritFires = [];
  const STONE = 0x979ba0;
  const headstone = (x, z, rotY, kind) => {
    let g;
    if (kind === 'cross') {
      g = mergeGeometries([
        colored(new THREE.BoxGeometry(0.22, 1.35, 0.2).translate(0, 0.62, 0), 0x8c9095),
        colored(new THREE.BoxGeometry(0.8, 0.2, 0.2).translate(0, 0.95, 0), 0x8c9095),
      ]);
    } else if (kind === 'broken') {
      g = colored(jitter(new THREE.BoxGeometry(0.8, 0.55, 0.24, 1, 2, 1), 0.12, rng).translate(0, 0.22, 0), 0x7e8388);
    } else {
      g = mergeGeometries([
        colored(new THREE.BoxGeometry(0.8, 0.85, 0.22).translate(0, 0.38, 0), STONE),
        colored(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12).rotateX(Math.PI / 2).translate(0, 0.8, 0), STONE),
      ]);
    }
    g.rotateZ((rng() - 0.5) * 0.25);
    g.rotateX((rng() - 0.5) * 0.2);
    add(g, x, z, { rotY, y: -0.05 });
    const mound = colored(jitter(new THREE.DodecahedronGeometry(0.55, 0), 0.12, rng).scale(0.85, 0.28, 1.45).translate(0, 0.02, 0.95), 0x5e4a36);
    add(mound, x, z, { rotY });
    addCollider(x, z, 0.4);
  };
  for (let row = -2; row <= 2; row++) {
    for (let col = -3; col <= 2; col++) {
      if (rng() < 0.25) continue;
      const x = gv.x + col * 2.7 + 0.6 + (rng() - 0.5) * 0.5;
      const z = gv.z + row * 3.2 + (rng() - 0.5) * 0.5;
      if (pathDist(x, z) < 1.8 || Math.hypot(x - crypt.x, z - crypt.z) < 4) continue;
      const k = rng();
      headstone(x, z, (rng() - 0.5) * 0.35, k < 0.6 ? 'round' : k < 0.85 ? 'cross' : 'broken');
    }
  }
  // crypt, door facing the graves (west)
  {
    const { x: cx, z: cz } = crypt;
    add(colored(new THREE.BoxGeometry(4.4, 0.35, 5.2).translate(0, 0.1, 0), 0x6a6d74), cx, cz);
    add(colored(new THREE.BoxGeometry(3.6, 2.9, 4.4).translate(0, 1.6, 0), 0x7b7f87), cx, cz);
    add(colored(new THREE.ConeGeometry(3.3, 1.7, 4).rotateY(Math.PI / 4).scale(1, 1, 1.25).translate(0, 3.9, 0), 0x55585f), cx, cz);
    add(colored(new THREE.BoxGeometry(0.12, 2.0, 1.4).translate(-1.81, 1.25, 0), 0x16161a), cx, cz);
    for (const s of [-1, 1]) add(colored(new THREE.CylinderGeometry(0.2, 0.24, 3.0, 6).translate(-2.0, 1.6, s * 1.1), 0x9a9ea5), cx, cz);
    add(colored(new THREE.BoxGeometry(0.5, 0.35, 3.0).translate(-2.0, 3.2, 0), 0x8a8e95), cx, cz);
    add(colored(new THREE.BoxGeometry(0.14, 0.9, 0.14).translate(0, 5.1, 0), 0x7b7f87), cx, cz);
    add(colored(new THREE.BoxGeometry(0.14, 0.14, 0.55).translate(0, 5.25, 0), 0x7b7f87), cx, cz);
    addCollider(cx, cz - 1.2, 1.9);
    addCollider(cx, cz + 1.2, 1.9);
  }
  // ruined iron fence: chunks of railing with gaps, plus an opening for the path
  const FENCE = 0x2e2f33;
  const posts = [];
  const N = 88;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = gv.x + Math.cos(a) * gv.r, z = gv.z + Math.sin(a) * gv.r;
    const standing = Math.sin(a * 5 + 1.3) + Math.sin(a * 11) * 0.5 > -0.2;
    if (!standing || pathDist(x, z) < 2.6) { posts.push(null); continue; }
    posts.push([x, z]);
    add(colored(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 4).translate(0, 0.7, 0), FENCE), x, z);
    add(colored(new THREE.ConeGeometry(0.09, 0.22, 4).translate(0, 1.5, 0), FENCE), x, z);
    addCollider(x, z, 0.25);
  }
  for (let i = 0; i < N; i++) {
    const p = posts[i], q = posts[(i + 1) % N];
    if (!p || !q) continue;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const rot = Math.atan2(q[0] - p[0], q[1] - p[1]);
    for (const y of [0.35, 1.15]) add(colored(new THREE.BoxGeometry(0.04, 0.05, len).translate(0, y, 0), FENCE), (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, { rotY: rot });
  }
  // dead trees
  const deadTree = (x, z, s) => {
    const bits = [colored(new THREE.CylinderGeometry(0.1 * s, 0.22 * s, 2.6 * s, 5).translate(0, 1.3 * s, 0), 0x4b3f37)];
    for (let k = 0; k < 4; k++) {
      const br = new THREE.CylinderGeometry(0.03 * s, 0.07 * s, 1.1 * s, 4).translate(0, 0.55 * s, 0);
      br.rotateZ(0.7 + rng() * 0.5);
      br.rotateY(k * 1.6 + rng());
      br.translate(0, (1.3 + k * 0.35) * s, 0);
      bits.push(colored(br, 0x4b3f37));
    }
    add(mergeGeometries(bits), x, z, { rotY: rng() * 6.28 });
    addCollider(x, z, 0.3 * s);
  };
  for (const [ox, oz] of [[-9, -7], [-10, 5], [6, 10], [-4, 11], [10, -8]]) deadTree(gv.x + ox, gv.z + oz, 1 + rng() * 0.4);
  // braziers with green spirit fire
  const brazier = (x, z) => {
    add(colored(new THREE.CylinderGeometry(0.1, 0.14, 1.1, 6).translate(0, 0.55, 0), 0x3a3b40), x, z);
    add(colored(new THREE.CylinderGeometry(0.38, 0.2, 0.3, 8).translate(0, 1.2, 0), 0x3a3b40), x, z);
    spiritFires.push(new THREE.Vector3(x, heightAt(x, z) + 1.35, z));
    addCollider(x, z, 0.35);
  };
  brazier(gv.x - 2.6, gv.z - 12);
  brazier(gv.x + 2.6, gv.z - 12);
  brazier(crypt.x - 2.6, crypt.z - 2.2);
  brazier(crypt.x - 2.6, crypt.z + 2.2);
  const spiritLight = new THREE.Vector3(crypt.x - 3.2, heightAt(crypt.x - 3.2, crypt.z) + 2, crypt.z);

  const mesh = new THREE.Mesh(mergeGeometries(parts), envMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // embers under the campfires (glow picked up by bloom)
  const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(2.2) });
  for (const f of fires.slice(0, 2)) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.12, 8), emberMat);
    e.position.set(f.x, f.y - 0.25, f.z);
    scene.add(e);
  }

  // floating crystal over the altar
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0xb58cff, emissive: 0x9a5cff, emissiveIntensity: 2.2, flatShading: true, roughness: 0.2 }),
  );
  crystal.scale.set(1, 1.6, 1);
  crystal.position.set(sx, heightAt(sx, sz) + 2.3, sz);
  crystal.castShadow = true;
  scene.add(crystal);

  return { fires, crystal, spiritFires, spiritLight };
}

function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f8fe0) },
      mid: { value: new THREE.Color(0xa6d2f2) },
      bottom: { value: new THREE.Color(0xd4e6ec) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = mix(mid, top, smoothstep(0.05, 0.55, h)); c = mix(bottom, c, smoothstep(-0.05, 0.12, h));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 16), mat);
  scene.add(sky);
  return sky;
}

// Pre-rendered minimap background: terrain colours + tree dots.
function buildMinimapBase(mapDots) {
  const S = 360, R = WORLD_RADIUS + 6;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const col = new THREE.Color();
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = (px / S) * 2 * R - R, z = (py / S) * 2 * R - R;
      const h = heightAt(x, z);
      groundColor(col, x, z, h);
      if (h < WATER_Y) col.set(0x3f98d4);
      const shade = clamp(0.85 + (h - 1.2) * 0.06, 0.6, 1.2);
      const o = (py * S + px) * 4;
      col.convertLinearToSRGB();
      img.data[o] = clamp(col.r * 255 * shade, 0, 255);
      img.data[o + 1] = clamp(col.g * 255 * shade, 0, 255);
      img.data[o + 2] = clamp(col.b * 255 * shade, 0, 255);
      img.data[o + 3] = Math.hypot(x, z) > WORLD_RADIUS + 3 ? 90 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const [x, z, color] of mapDots) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(((x + R) / (2 * R)) * S, ((z + R) / (2 * R)) * S, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas: c, range: R };
}

export function buildWorld(scene, { lowSpec = false } = {}) {
  const rng = mulberry32(20260930);
  scene.add(buildTerrain(rng));
  const water = buildWater(scene, rng);
  const mapDots = [];
  const props = buildProps(scene, rng);
  buildVegetation(scene, rng, mapDots, lowSpec);
  const sky = buildSky(scene);
  const minimap = buildMinimapBase(mapDots);
  return { water, sky, fires: props.fires, crystal: props.crystal, spiritFires: props.spiritFires, spiritLight: props.spiritLight, minimap };
}

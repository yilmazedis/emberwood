// A dungeon, drawn and run: its plan (dungeon-map.js, shared with the game server) built from the KayKit
// Dungeon pack, with its torches, chests, the rune circle in the boss's room and the boss's hoard, which
// opens when the boss falls. Each party gets its own copy on the server; here there's just the one we're in.
// Walls on the camera side of a room are cut down to knee height so they never hide the fight.
// The pieces of every dungeon come packed in one file (tools/pack-dungeon.mjs), fetched on the way there.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL, CUT_Y, FLOOR_Y } from './dungeon-map.js';
import { randomItem } from './items.js';
import { hdr } from './fx.js';
import { randInt, chance } from './util.js';

const PACK = 'assets/dungeon/dungeon.glb';
const CHEST_REFILL = 5 * 60 * 1000;

// ---------------------------------------------------------------- the pack (shared by every dungeon)
let packData = null; // the download
let packModels = null; // parsed: model name -> root
export function fetchPack() {
  if (!packData) {
    packData = fetch(PACK)
      .then((r) => { if (!r.ok) throw new Error(`${PACK}: ${r.status}`); return r.arrayBuffer(); })
      .catch((err) => { packData = null; throw err; });
  }
  return packData;
}

async function loadModels() {
  if (!packModels) {
    packModels = (async () => {
      const gltf = await new GLTFLoader().parseAsync(await fetchPack(), '');
      const models = {};
      for (const root of gltf.scene.children) models[root.userData.model] = root;
      return models;
    })().catch((err) => { packModels = null; throw err; });
  }
  return packModels;
}

// ---------------------------------------------------------------- minimap
function buildMinimap(d) {
  const SIZE = 360, R = Math.max(d.COLS, d.ROWS) * CELL * 0.55;
  const mid = { x: d.OX + (d.COLS * CELL) / 2, z: d.OZ + (d.ROWS * CELL) / 2 };
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');
  const k = SIZE / (2 * R), px = (x) => (x - mid.x + R) * k, pz = (z) => (z - mid.z + R) * k;
  ctx.fillStyle = '#0d0b10';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#4d4640';
  for (let r = 0; r < d.ROWS; r++) {
    for (let c = 0; c < d.COLS; c++) {
      if (d.open(r, c)) ctx.fillRect(px(d.cellX(c) - 0.9), pz(d.cellZ(r) - 0.9), (CELL + 1.8) * k, (CELL + 1.8) * k);
    }
  }
  for (let r = 0; r < d.ROWS; r++) {
    for (let c = 0; c < d.COLS; c++) {
      if (!d.open(r, c)) continue;
      const l = d.open(r, c - 1) ? 0 : WALL, rt = d.open(r, c + 1) ? 0 : WALL, t = d.open(r - 1, c) ? 0 : WALL, b = d.open(r + 1, c) ? 0 : WALL;
      ctx.fillStyle = d.tile(r, c) === 'B' ? '#8f7f8f' : '#9a8f7c';
      ctx.fillRect(px(d.cellX(c) + l), pz(d.cellZ(r) + t), (CELL - l - rt) * k, (CELL - t - b) * k);
    }
  }
  ctx.fillStyle = '#d8d0bc'; // the stairs up
  for (let i = 0; i < 4; i++) ctx.fillRect(px(d.midX(d.stairs.c) - 1.8), pz(d.cellZ(d.stairs.r) + 0.6 + i * 0.9), 3.6 * k, 0.45 * k);
  return { canvas: cv, range: R, cx: mid.x, cz: mid.z };
}

// ---------------------------------------------------------------- the rune circle in the boss's room
function runeCircle(room, color) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uPulse: { value: 0 }, uCol: { value: hdr(color, 1.5) } },
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
  m.position.set(room.cx, FLOOR_Y + 0.02, room.cz);
  m.renderOrder = 3;
  return m;
}

// ---------------------------------------------------------------- a dungeon at runtime
export class DungeonView {
  constructor(game, map) {
    this.game = game;
    this.map = map;
    this.d = map.dungeon;
    this.look = map.look;
    this.group = new THREE.Group();
    this.group.visible = false;
    game.scene.add(this.group);
    this.circle = null;
    this.pulseV = 0;
    this.minimap = buildMinimap(this.d);
    const flame = this.look.flame;
    this.fires = this.d.flames.map((f) => ({ pos: new THREE.Vector3(f.x, f.y, f.z), scale: 0.28, color: flame }));
    this.followLight = true; // a light follows the hero down here (Diablo-style light radius)
    // light sources: torches, the rune circle, and the hoard once it's unguarded
    this.lights = this.d.flames.map((f, i) => ({ pos: new THREE.Vector3(f.x + this.d.flameDirs[i].x * 0.55, f.y, f.z + this.d.flameDirs[i].z * 0.55), color: flame, power: 13, dist: 12, flicker: i }));
    const B = this.d.rooms.B;
    this.lights.push({ pos: new THREE.Vector3(B.cx, 1.6, B.cz), color: 0x9a5cff, power: 9, dist: 15, gain: () => 0.7 + this.pulseV * 0.8 });
    const ui = game.ui;
    this.chests = this.d.chests.map((def) => {
      const c = { ...def, group: null, lid: null, lidT: 0, opened: false, readyAt: 0, unlocked: false };
      const top = new THREE.Vector3(c.x, FLOOR_Y + 2.3, c.z);
      c.label = ui.createNpcLabel(c.name, c.title, 'Open', () => this.use(c.id), (o) => o.copy(top));
      c.spot = { id: c.id, x: c.x + Math.sin(c.rot) * 1.5, z: c.z + Math.cos(c.rot) * 1.5, label: c.label, can: () => !!c.group && !c.opened && (!c.hoard || c.unlocked), use: () => this.openChest(c) };
      return c;
    });
    this.spots = this.chests.map((c) => c.spot); // (the stairs out are a portal: places.js)
    this.hoard = this.chests.find((c) => c.hoard);
    if (this.hoard) this.lights.push({ pos: new THREE.Vector3(this.hoard.x, 1.8, this.hoard.z + 1.2), color: 0xffc860, power: 7, dist: 8, gain: () => (this.hoard.unlocked ? 1 : 0) });
  }

  // Builds it the first time someone goes down (behind the fade).
  load() {
    if (!this.loading) this.loading = this.build().catch((err) => { this.loading = null; throw err; });
    return this.loading;
  }

  async build() {
    const models = await loadModels();
    let map = null;
    const parts = {};
    const partsOf = (n) => {
      if (parts[n]) return parts[n];
      const root = models[n];
      parts[n] = [];
      if (!root) return parts[n];
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        map = map || o.material.map;
        parts[n].push({ geo: o.geometry, matrix: o.matrixWorld.clone() });
      });
      return parts[n];
    };
    for (const p of this.d.pieces) partsOf(p.m);
    // one material for the whole pack (it shares a single texture), so everything merges
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0, color: this.look.tint ?? 0xffffff });
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
    for (const p of this.d.pieces) {
      if (!parts[p.m].length) { console.warn(`${this.map.id}: ${p.m} is missing from ${PACK} (run tools/pack-dungeon.mjs)`); continue; }
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
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    for (const c of this.chests) {
      if (!models[c.model]) continue;
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
    this.circle = runeCircle(this.d.rooms.B, this.look.circle ?? 0x8a4dff);
    this.group.add(this.circle);
  }

  show(on) {
    this.group.visible = on;
    for (const c of this.chests) c.label.el.classList.toggle('hidden', !on);
  }

  use(id) {
    const s = this.spots.find((x) => x.id === id);
    if (s && this.game.places.near === s) s.use();
  }

  pulse(amount) {
    this.pulseV = Math.max(this.pulseV, amount);
  }

  // ---------------------------------------------------------------- chests (their loot is ours alone)
  openChest(c) {
    const g = this.game, p = g.player;
    c.opened = true;
    c.readyAt = Date.now() + (c.hoard ? 12000 : CHEST_REFILL);
    c.label.el.style.display = 'none';
    g.sfx.play('chest');
    const at = new THREE.Vector3(c.x + Math.sin(c.rot) * 0.7, FLOOR_Y, c.z + Math.cos(c.rot) * 0.7);
    const lvl = Math.max(p.level, this.map.levels[0] + 1);
    if (c.hoard) {
      c.unlocked = false; // sealed again until its boss falls again
      g.loot.dropGold(Math.round(randInt(150, 240) * (1 + 0.12 * (lvl - 9))), at);
      g.loot.dropGold(Math.round(randInt(60, 110) * (1 + 0.12 * (lvl - 9))), at);
      g.loot.dropItem(randomItem(lvl + 1, { minRarity: 'rare', boost: 2 }), at);
      g.loot.dropItem(randomItem(lvl, { minRarity: 'magic', boost: 1.5 }), at);
      g.loot.dropPotion(at);
      g.fx.burst(new THREE.Vector3(c.x, FLOOR_Y + 1.2, c.z), 0xffc860, 40, 4);
      g.ui.log(`You loot <b>${c.name}</b>.`, 'gold');
    } else {
      g.loot.dropGold(Math.round(randInt(30, 60) * (1 + 0.2 * (lvl - 1))), at);
      g.loot.dropItem(randomItem(lvl, { minRarity: 'magic' }), at);
      if (chance(0.5)) g.loot.dropPotion(at);
    }
  }

  // The boss has fallen (the world says so; it also makes whatever it called crumble): its hoard opens.
  bossDown() {
    const h = this.hoard;
    if (!h) return;
    h.unlocked = true;
    h.opened = false;
    h.label.el.style.display = '';
    h.label.el.querySelector('.npc-title').textContent = 'Unguarded';
    this.game.ui.log(`${h.name} lies open at the back of the room.`, 'gold');
    this.pulse(2.5);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.circle) return;
    const now = Date.now();
    for (const c of this.chests) {
      if (c.opened && now >= c.readyAt) { // refilled (or, for the hoard, sealed again)
        c.opened = false;
        c.label.el.style.display = '';
        if (c.hoard) c.label.el.querySelector('.npc-title').textContent = c.title;
      }
      c.lidT += ((c.opened ? 1 : 0) - c.lidT) * (1 - Math.exp(-6 * dt));
      if (c.lid) c.lid.rotation.x = -1.9 * c.lidT;
    }
    const g = this.game;
    if (this.hoard?.unlocked && Math.random() < dt * 10) {
      g.fx.add.emit({ pos: { x: this.hoard.x, y: FLOOR_Y + 1.1, z: this.hoard.z }, count: 1, spread: 0.6, velSpread: 0.3, vel: { x: 0, y: 1.2, z: 0 }, color: hdr(0xffd070, 2.4), size: 0.12, sizeEnd: 0.02, life: 1.2, drag: 1 });
    }
    this.pulseV = Math.max(0, this.pulseV - dt * 0.8);
    const u = this.circle.material.uniforms;
    u.uT.value += dt;
    u.uPulse.value = this.pulseV;
  }
}

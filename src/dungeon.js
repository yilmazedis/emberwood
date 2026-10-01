// The Forgotten Crypt, drawn and run: a hand-made dungeon beneath the graveyard, built from the KayKit
// Dungeon pack on a 4 m grid (its plan, walls, paths and monsters are in crypt-map.js, which the game
// server shares). It sits far north of the overworld in the same scene, so combat, loot and particles
// work unchanged; going down swaps the lighting, fog and minimap (setInside).
// Walls on the camera side of a room are cut down to knee height so they never hide the fight.
// The pieces come packed in one file (tools/pack-dungeon.mjs), fetched when you near the graveyard.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, CRYPT } from './world.js';
import { ROWS, COLS, CELL, WALL, CUT_Y, FLOOR_Y, OX, OZ, ROOMS, PIECES, FLAMES, FLAME_DIRS, CHESTS, open, tile, cellX, cellZ, midX } from './crypt-map.js';
import { randomItem } from './items.js';
import { hdr } from './fx.js';
import { randInt, chance } from './util.js';

export { inDungeon, wallAt, lineClear, steer, ROOMS, CRYPT_SPAWNS, LICH_HOME, FLOOR_Y, CELL } from './crypt-map.js';

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
    this.flames = FLAMES.map((f) => new THREE.Vector3(f.x, f.y, f.z));
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
    this.sources = FLAMES.map((f, i) => ({ pos: new THREE.Vector3(f.x + FLAME_DIRS[i].x * 0.55, f.y, f.z + FLAME_DIRS[i].z * 0.55), color: 0xff8a3a, power: 13, dist: 12, flicker: i }));
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

  // Morvain has fallen (the world says so; it also makes his minions crumble): his hoard opens.
  onLichDefeated() {
    const g = this.game, h = this.hoard;
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

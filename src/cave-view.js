// The hidden caves, drawn (caves.js has the rules, maps/caves.js the plans): rough rock walls along every
// edge of the plan, earth underfoot, crystals for light, rubble gates that crumble as each chamber falls
// silent, the keeper's treasure and the daylight out. All of it built in code (no download), in each cave's
// own colours. Walls on the camera side stay low so they never hide the fight.
// And their mouths in the lands (CaveMouth): rocks and bushes like any others, until a hero with the key
// comes by: then a glow pulses in the dark between the bushes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, FLOOR_Y } from './dungeon-map.js';
import { buildMinimap } from './dungeon.js';
import { colored, jitter, makeBush, heightAt } from './world.js';
import { rollDrop, rollPotion, makeItem, tierAt } from './items.js';
import { STAGES, CAVE_XP } from './caves.js';
import { xpForLevel } from './player.js';
import { hdr } from './fx.js';
import { mulberry32, randInt, chance, clamp } from './util.js';

const SOUTH_H = 1.15; // camera-side walls stay below this
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, a] of [[0, 1], [0.25, 0.65], [0.6, 0.18], [1, 0]]) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
// a shaft of light: bright where it comes in, fading out toward the floor (v: 0 at the bottom)
let shaftTex = null;
function shaftTexture() {
  if (shaftTex) return shaftTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d'), v = g.createLinearGradient(0, 0, 0, 128), h = g.createLinearGradient(0, 0, 64, 0);
  v.addColorStop(0, 'rgba(255,255,255,0.9)');
  v.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 128);
  g.globalCompositeOperation = 'destination-in';
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.3, 'rgba(0,0,0,1)');
  h.addColorStop(0.7, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 128);
  shaftTex = new THREE.CanvasTexture(c);
  shaftTex.colorSpace = THREE.SRGBColorSpace;
  return shaftTex;
}
const shaftMaterial = (opacity) => new THREE.MeshBasicMaterial({ map: shaftTexture(), color: new THREE.Color(0xfff2d0).multiplyScalar(1.5), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

const glowSprite = (hex, opacity = 0.7) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(hex), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));

// a lump of rock: a jittered dodecahedron, w × h × d, coloured
function rock(rng, hex, w, h, d) {
  return colored(jitter(new THREE.DodecahedronGeometry(0.5, 0), 0.12, rng).scale(w, h, d), hex);
}

// a cluster of crystals, tall and leaning, glowing
function crystalCluster(rng, hex) {
  const parts = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const h = 0.6 + rng() * 1.1, w = 0.14 + rng() * 0.12;
    const g = new THREE.OctahedronGeometry(1, 0).scale(w, h, w);
    g.rotateZ((rng() - 0.5) * 0.9);
    g.rotateX((rng() - 0.5) * 0.9);
    g.translate((rng() - 0.5) * 0.6, h * 0.55, (rng() - 0.5) * 0.6);
    parts.push(colored(g, hex));
  }
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------- a cave at runtime
export class CaveView {
  constructor(game, map) {
    this.game = game;
    this.map = map;
    this.d = map.dungeon;
    this.c = map.cave;
    this.look = map.look;
    this.group = new THREE.Group();
    this.group.visible = false;
    game.scene.add(this.group);
    this.minimap = buildMinimap(this.d);
    this.followLight = true;
    this.fires = [];
    this.lights = [];
    this.gates = this.d.gates.map((g) => ({ ...g, open: false, t: 1, mesh: null }));
    this.state = { cleared: 0, left: 0, done: false, known: false, sawRunning: false };
    const B = this.d.rooms.B, ui = game.ui;
    const def = this.d.chests[0];
    this.chest = { ...def, group: null, lid: null, lidT: 0, opened: false, unlocked: false };
    const top = new THREE.Vector3(def.x, FLOOR_Y + 2.2, def.z);
    this.chest.label = ui.createNpcLabel(def.name, def.title, 'Open', () => this.use('treasure'), (o) => o.copy(top));
    this.spots = [{ id: 'treasure', x: def.x, z: def.z + 1.5, label: this.chest.label, can: () => this.chest.unlocked && !this.chest.opened, use: () => this.openChest() }];
    this.out = map.portals.find((p) => p.id === 'out');
    this.hall = B;
  }

  load() {
    if (!this.built) { this.build(); this.built = true; }
    return Promise.resolve();
  }

  build() {
    const d = this.d, L = this.c.look, rng = mulberry32(0x5eed + Math.round(d.OX));
    const open = (r, c) => d.open(r, c);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    // ---- the floor: a tile of rough earth per cell, each its own shade
    const floor = [];
    for (let r = 0; r < d.ROWS; r++) {
      for (let c = 0; c < d.COLS; c++) {
        if (!open(r, c) && d.tile(r, c) !== 'U') continue;
        const g = new THREE.PlaneGeometry(CELL + 0.3, CELL + 0.3, 3, 3).rotateX(-Math.PI / 2);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, (rng() - 0.5) * 0.08);
        g.translate(d.midX(c), FLOOR_Y - 0.02, d.midZ(r));
        floor.push(colored(g.toNonIndexed(), pick(L.floor)));
      }
    }
    const floorGeo = mergeGeometries(floor);
    // per face, a little lighter or darker
    const col = floorGeo.attributes.color;
    for (let i = 0; i < col.count; i += 3) {
      const k = 0.85 + rng() * 0.3;
      for (let j = 0; j < 3; j++) col.setXYZ(i + j, col.getX(i + j) * k, col.getY(i + j) * k, col.getZ(i + j) * k);
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    const floorMesh = new THREE.Mesh(floorGeo, mat);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // ---- the walls: rocks along every edge between floor and rock; low on the camera's side
    const rocks = [];
    const wallAt = (x, z, along, h, cut) => { // two or three rocks along a 4 m edge, centred on (x, z)
      const n = cut ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5, w = cut ? 1.8 + rng() * 0.7 : 2.4 + rng() * 0.9;
        const g = rock(rng, pick(L.rock), w, cut ? SOUTH_H * (0.75 + rng() * 0.25) : h * (0.8 + rng() * 0.4), 1.4 + rng() * 0.8);
        g.rotateY(rng() * Math.PI * 2);
        const ox = along === 'x' ? t * CELL : 0, oz = along === 'z' ? t * CELL : 0;
        g.translate(x + ox + (rng() - 0.5) * 0.4, (cut ? SOUTH_H : h) * 0.38, z + oz + (rng() - 0.5) * 0.4);
        rocks.push(g);
      }
    };
    for (let r = 0; r < d.ROWS; r++) {
      for (let c = 0; c < d.COLS; c++) {
        if (!open(r, c)) continue;
        const x0 = d.cellX(c), z0 = d.cellZ(r);
        if (!open(r - 1, c) && d.tile(r - 1, c) !== 'U') wallAt(x0 + CELL / 2, z0 - 0.35, 'x', 4.4, false);
        if (!open(r + 1, c)) wallAt(x0 + CELL / 2, z0 + CELL + 0.35, 'x', 4.4, true);
        if (!open(r, c - 1)) wallAt(x0 - 0.35, z0 + CELL / 2, 'z', 4.4, false);
        if (!open(r, c + 1)) wallAt(x0 + CELL + 0.35, z0 + CELL / 2, 'z', 4.4, false);
      }
    }
    // a boulder at every corner where walls meet (no gaps); low where the floor is to its north
    for (let r = 0; r <= d.ROWS; r++) {
      for (let c = 0; c <= d.COLS; c++) {
        const cells = [open(r - 1, c - 1), open(r - 1, c), open(r, c - 1), open(r, c)];
        const n = cells.filter(Boolean).length;
        if (n === 0 || n === 4) continue;
        const low = cells[0] || cells[1]; // (floor to its north: it's on the camera's side of that floor)
        const g = rock(rng, pick(L.rock), 1.9 + rng() * 0.6, low ? SOUTH_H : 4.6 + rng() * 1.2, 1.9 + rng() * 0.6);
        g.rotateY(rng() * Math.PI * 2);
        g.translate(d.cellX(c), (low ? SOUTH_H : 4.6) * 0.38, d.cellZ(r));
        rocks.push(g);
      }
    }
    // the dressing: stalagmites (they block the way: maps/caves.js), crystals, bones, mushrooms
    const glow = [];
    for (const p of d.pieces) {
      const s = p.scale || [1, 1, 1];
      if (p.m === 'stalagmite') {
        const h = 1.6 + rng() * 1.4;
        const g = colored(jitter(new THREE.ConeGeometry(0.6, h, 6, 2), 0.08, rng), pick(L.rock)).scale(s[0], s[1], s[2]);
        g.rotateY(p.rot);
        g.translate(p.x, (h * s[1]) / 2, p.z);
        rocks.push(g);
        const base = rock(rng, pick(L.rock), 1.5 * s[0], 0.6, 1.5 * s[2]);
        base.translate(p.x, 0.15, p.z);
        rocks.push(base);
      } else if (p.m === 'crystal') {
        const g = crystalCluster(rng, L.crystal).scale(s[0], s[1], s[2]);
        g.rotateY(p.rot);
        g.translate(p.x, 0, p.z);
        glow.push(g);
        const sp = glowSprite(L.crystal, 0.45);
        sp.scale.setScalar(3.2 * s[1]);
        sp.position.set(p.x, 1.0 * s[1], p.z);
        this.group.add(sp);
        this.lights.push({ pos: new THREE.Vector3(p.x, 1.6, p.z), color: L.crystal, power: 9, dist: 12, flicker: p.x * 0.3 });
      } else if (p.m === 'bones') {
        for (let i = 0; i < 3; i++) {
          const b = colored(new THREE.CapsuleGeometry(0.05, 0.45, 2, 5), 0xe8dfc8).rotateZ(Math.PI / 2).rotateY(rng() * 6.3);
          b.translate(p.x + (rng() - 0.5) * 0.6, 0.08, p.z + (rng() - 0.5) * 0.6);
          rocks.push(b);
        }
        const skull = colored(new THREE.IcosahedronGeometry(0.16, 1), 0xefe6d0).scale(1, 0.85, 1.1);
        skull.translate(p.x, 0.14, p.z);
        rocks.push(skull);
      } else if (p.m === 'mushrooms') {
        for (let i = 0; i < 4; i++) {
          const h = 0.15 + rng() * 0.25, x = p.x + (rng() - 0.5) * 0.8, z = p.z + (rng() - 0.5) * 0.8;
          rocks.push(colored(new THREE.CylinderGeometry(0.03, 0.04, h, 5).translate(x, h / 2, z), 0xd8d0c0));
          glow.push(colored(new THREE.SphereGeometry(0.11 + rng() * 0.06, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, h, z), L.crystal));
        }
      }
    }
    const rockGeo = mergeGeometries(rocks.map((g) => (g.index ? g.toNonIndexed() : g)));
    rockGeo.computeVertexNormals();
    const rockMesh = new THREE.Mesh(rockGeo, mat);
    rockMesh.castShadow = rockMesh.receiveShadow = true;
    this.group.add(rockMesh);
    if (glow.length) {
      const gm = new THREE.Mesh(mergeGeometries(glow.map((g) => (g.index ? g.toNonIndexed() : g))), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, emissive: new THREE.Color(L.crystal), emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 }));
      this.group.add(gm);
    }

    // ---- the way in: daylight falling through the mouth, above the first chamber
    const st = d.stairs, mx = d.midX(st.c), mz = d.cellZ(st.r) + CELL - 0.2;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6), shaftMaterial(0.45));
    beam.position.set(mx, 2.6, mz + 0.4);
    beam.rotation.x = 0.55; // (slanting in from above the mouth)
    this.group.add(beam);
    const sky = glowSprite(0xfff0c8, 0.55);
    sky.scale.set(4.2, 3.4, 1);
    sky.position.set(mx, 2.6, mz - 1.2);
    this.group.add(sky);
    const spot = glowSprite(0xfff0c8, 0.35);
    spot.scale.set(4, 4, 1);
    spot.position.set(mx, 0.2, mz + 1.6);
    this.group.add(spot);
    this.lights.push({ pos: new THREE.Vector3(mx, 3, mz + 0.5), color: 0xfff0d0, power: 10, dist: 13 });
    for (const sx of [-1, 1]) {
      const g = rock(rng, pick(L.rock), 2.2, 5.2, 2.4);
      g.translate(mx + sx * 2.1, 2.0, mz - 1.2);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      this.group.add(m);
    }

    // ---- the gates: fallen rock across the passage, a rune glowing in it
    for (const gt of this.gates) {
      const grp = new THREE.Group(), parts = [];
      const across = gt.vertical ? 'x' : 'z'; // (a north–south passage is closed across x)
      for (let i = 0; i < 7; i++) {
        const t = (i % 4) / 3 - 0.5, layer = i < 4 ? 0 : 1;
        const g = rock(rng, pick(L.rock), 1.3 + rng() * 0.5, 1.1 + rng() * 0.5, 1.3 + rng() * 0.5);
        g.rotateY(rng() * 6.3);
        g.translate(across === 'x' ? t * 3 : (rng() - 0.5) * 0.6, 0.45 + layer * 0.95, across === 'z' ? t * 3 : (rng() - 0.5) * 0.6);
        parts.push(g);
      }
      const m = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
      m.castShadow = true;
      grp.add(m);
      const rune = glowSprite(L.crystal, 0.55);
      rune.scale.setScalar(2.4);
      rune.position.y = 1.3;
      grp.add(rune);
      grp.position.set(gt.x, 0, gt.z);
      gt.mesh = grp;
      gt.rune = rune;
      this.group.add(grp);
    }

    // ---- the keeper's treasure: a chest of dark wood and gold
    const ch = this.chest, cg = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8, flatShading: true });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8c060, metalness: 0.7, roughness: 0.35, emissive: 0x3a2a08 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.95), wood);
    body.position.y = 0.38;
    const lid = new THREE.Group();
    lid.position.set(0, 0.75, -0.47);
    const lidBox = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 1.5, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), wood);
    lidBox.position.z = 0.47;
    lid.add(lidBox);
    for (const sx of [-0.55, 0, 0.55]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.98), gold);
      band.position.set(sx, 0.38, 0);
      cg.add(band);
    }
    cg.add(body, lid);
    cg.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    cg.position.set(ch.x, FLOOR_Y, ch.z);
    cg.rotation.y = ch.rot;
    ch.group = cg;
    ch.lid = lid;
    this.group.add(cg);
    this.lights.push({ pos: new THREE.Vector3(ch.x, 1.8, ch.z + 1.2), color: 0xffc860, power: 7, dist: 8, gain: () => (ch.unlocked ? 1 : 0) });

    // ---- the daylight out of the keeper's hall: a crack of sky, shining once the keeper falls
    const out = this.out;
    this.dawn = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.9, 7, 14, 1, true), shaftMaterial(0.5));
    shaft.position.y = 3.5;
    const pool = glowSprite(0xfff0c8, 0.9);
    pool.scale.set(4, 4, 1);
    pool.position.y = 0.6;
    this.dawn.add(shaft, pool);
    this.dawn.position.set(out.x, 0, out.z);
    this.dawn.visible = false;
    this.group.add(this.dawn);
    this.lights.push({ pos: new THREE.Vector3(out.x, 3, out.z), color: 0xfff0d0, power: 12, dist: 14, gain: () => (this.state.done ? 1 : 0) });
    this.applyGates(true);
  }

  // ---------------------------------------------------------------- coming and going
  show(on) {
    this.group.visible = on;
    this.shown = on;
    if (on) this.reset();
    this.chestLabel();
    this.game.ui.caveHud(on ? this : null);
  }

  // The treasure's label: only while it's here to open.
  chestLabel() {
    const c = this.chest;
    c.label.el.classList.toggle('hidden', !this.shown || !c.unlocked || c.opened);
  }

  // A new stay (or the first): how the cave stands comes with the world's next update.
  reset() {
    this.state = { cleared: 0, left: 0, done: false, known: false, sawRunning: false };
    for (const g of this.gates) { g.open = false; g.t = 1; }
    this.chest.unlocked = false;
    this.chest.opened = false;
    this.applyGates(true);
    if (this.dawn) this.dawn.visible = false;
  }

  use(id) {
    const s = this.spots.find((x) => x.id === id);
    if (s && this.game.places.near === s) s.use();
  }

  get cleared() {
    return this.state.done;
  }

  // ---------------------------------------------------------------- the world says how the cave stands
  // [chambers cleared, monsters left in the one being fought, done]
  setState([cleared, left, done]) {
    const s = this.state, g = this.game, first = !s.known;
    const was = s.cleared;
    s.known = true;
    s.cleared = cleared;
    s.left = left;
    if (!done) s.sawRunning = true;
    for (const gt of this.gates) {
      if (gt.open || gt.stage > cleared) continue;
      gt.open = true;
      gt.t = first ? 1 : 0; // (on arriving: already open; as it happens: it crumbles)
      if (!first) this.crumble(gt);
    }
    this.applyGates(first);
    if (!first && cleared > was && cleared < STAGES) {
      g.ui.centerMsg(`Chamber ${cleared} of ${STAGES} falls silent. The way opens…`);
      g.sfx.play('portal', 0.6);
    }
    if (done && !s.done) {
      s.done = true;
      this.dawn.visible = true;
      this.chest.unlocked = true;
      this.chest.label.el.querySelector('.npc-title').textContent = 'Unguarded';
      this.chestLabel();
      if (s.sawRunning) this.reward();
    }
    g.ui.caveHud(this);
  }

  // The cave is cleared while we're in it: a good share of a level, for everyone here.
  reward() {
    const g = this.game, p = g.player;
    const xp = Math.round(xpForLevel(p.level) * CAVE_XP);
    g.ui.centerMsg(`${this.c.name} is cleared!`);
    g.ui.log(`<b>${this.c.name}</b> is cleared: <b>+${xp} XP</b>. The keeper's treasure and the daylight wait in its hall.`, 'lvl');
    g.ui.floater(p.headPos(), `+${xp} XP`, 'xp');
    g.fx.levelUp(p.pos);
    g.sfx.play('quest');
    p.gainXp(xp);
    g.save();
  }

  // A gate's rocks sink into the floor in a cloud of dust.
  crumble(gt) {
    const g = this.game, at = new THREE.Vector3(gt.x, 0.4, gt.z);
    g.fx.dust(at, 26);
    g.fx.burst(new THREE.Vector3(gt.x, 1.2, gt.z), this.c.look.crystal, 30, 3);
    if (g.volAt(at)) g.sfx.play('slam', 0.7 * g.volAt(at));
    g.shake(0.25 * g.volAt(at));
  }

  applyGates(instant = false) {
    for (const gt of this.gates) {
      if (!gt.mesh) continue;
      if (instant) gt.t = 1;
      const k = gt.open ? gt.t : 0;
      gt.mesh.visible = !(gt.open && gt.t >= 1);
      gt.mesh.position.y = -2.4 * k * k;
      gt.rune.material.opacity = 0.55 * (1 - k);
    }
  }

  // Our hero can't walk through a gate that's still closed (the world spawns the next chamber's monsters only
  // when it opens, so nothing else needs stopping).
  blockGates(pos, radius) {
    for (const gt of this.gates) {
      if (gt.open) continue;
      const qx = clamp(pos.x, gt.x0, gt.x1), qz = clamp(pos.z, gt.z0, gt.z1);
      const dx = pos.x - qx, dz = pos.z - qz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) { const dd = Math.sqrt(d2); pos.x = qx + (dx / dd) * radius; pos.z = qz + (dz / dd) * radius; continue; }
      // inside it: out the way we came (the side of the chamber before it)
      const room = this.d.rooms[this.d.tile(gt.r, gt.c - 1)] || this.d.rooms[this.d.tile(gt.r, gt.c + 1)] || this.d.rooms[this.d.tile(gt.r - 1, gt.c)] || this.d.rooms[this.d.tile(gt.r + 1, gt.c)];
      if (gt.vertical) pos.z = room && room.cz > gt.z ? gt.z1 + radius : gt.z0 - radius;
      else pos.x = room && room.cx > gt.x ? gt.x1 + radius : gt.x0 - radius;
    }
  }

  // ---------------------------------------------------------------- the treasure (its loot is ours alone)
  openChest() {
    const g = this.game, p = g.player, c = this.chest;
    c.opened = true;
    this.chestLabel();
    g.sfx.play('chest');
    const at = new THREE.Vector3(c.x, FLOOR_Y, c.z + 1.0);
    const lvl = Math.max(p.level, this.c.levels[0]);
    g.loot.dropGold(Math.round(randInt(220, 340) * (1 + 0.14 * (lvl - 1))), at);
    g.loot.dropGold(Math.round(randInt(80, 140) * (1 + 0.14 * (lvl - 1))), at);
    g.loot.dropItem(rollPotion(lvl), at);
    g.loot.dropItem(rollPotion(lvl), at);
    if (chance(0.6)) { const it = rollDrop(Math.min(60, lvl + 1), p.cls); if (it) g.loot.dropItem(it, at); }
    if (chance(0.5)) g.loot.dropItem(makeItem(`recipe_${tierAt(Math.min(60, lvl))}`), at);
    g.fx.burst(new THREE.Vector3(c.x, FLOOR_Y + 1.2, c.z), 0xffc860, 50, 4);
    g.ui.log(`You loot <b>${c.name}</b>.`, 'gold');
  }

  bossDown() {
    this.pulse(2);
  }

  pulse() {}

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.built) return;
    let moving = false;
    for (const gt of this.gates) if (gt.open && gt.t < 1) { gt.t = Math.min(1, gt.t + dt / 1.3); moving = true; }
    if (moving) this.applyGates();
    const c = this.chest;
    c.lidT += ((c.opened ? 1 : 0) - c.lidT) * (1 - Math.exp(-6 * dt));
    if (c.lid) c.lid.rotation.x = -1.9 * c.lidT;
    const g = this.game, t = g.time;
    for (const gt of this.gates) if (!gt.open && gt.rune) gt.rune.material.opacity = 0.42 + Math.sin(t * 2.4 + gt.stage) * 0.14;
    if (this.state.done && Math.random() < dt * 14) { // motes in the daylight
      const o = this.out;
      g.fx.add.emit({ pos: { x: o.x + (Math.random() - 0.5) * 2, y: 0.3, z: o.z + (Math.random() - 0.5) * 2 }, count: 1, spread: 0.2, velSpread: 0.2, vel: { x: 0, y: 1.4, z: 0 }, color: hdr(0xfff0c0, 2), size: 0.1, sizeEnd: 0.02, life: 1.6, drag: 0.5 });
    }
    if (c.unlocked && !c.opened && Math.random() < dt * 8) {
      g.fx.add.emit({ pos: { x: c.x, y: FLOOR_Y + 1.0, z: c.z }, count: 1, spread: 0.6, velSpread: 0.3, vel: { x: 0, y: 1.2, z: 0 }, color: hdr(0xffd070, 2.4), size: 0.12, sizeEnd: 0.02, life: 1.2, drag: 1 });
    }
  }

  // The closed gates on the minimap (m: world to map), as small bars of rock.
  minimapOverlay(ctx, m) {
    ctx.fillStyle = '#e86a4a';
    for (const gt of this.gates) {
      if (gt.open) continue;
      const [x0, y0] = m(gt.x0 + 0.5, gt.z0 + 0.5), [x1, y1] = m(gt.x1 - 0.5, gt.z1 - 0.5);
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(2, Math.abs(x1 - x0)), Math.max(2, Math.abs(y1 - y0)));
    }
    if (this.state.done) {
      const [x, y] = m(this.out.x, this.out.z);
      ctx.fillStyle = '#fff0c0';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- a cave's mouth in its land
// Rocks and bushes like any others; for a hero who may go in (a key, or its party's cave open), the bushes
// in front part, and a glow pulses in the dark. at: { x, z, yaw } (the way the mouth faces).
export class CaveMouth {
  constructor(game, land, cave) {
    this.game = game;
    this.land = land;
    this.cave = cave;
    const at = cave.mouth, rng = mulberry32(0x6d07 + Math.round(at.x * 13 + at.z));
    this.at = at;
    const g = new THREE.Group();
    g.position.set(at.x, heightAt(at.x, at.z), at.z);
    g.rotation.y = at.yaw;
    this.group = g;
    const rockHex = cave.look.mouth;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    // the outcrop: a mound of rock, an arch in front of it around a dark hole (colliders: maps.js)
    const parts = [];
    for (const [x, y, z, w, h, dd] of [[0, 1.7, -2.1, 4.6, 3.8, 3.0], [-1.75, 1.2, -0.75, 1.7, 2.9, 1.9], [1.75, 1.2, -0.75, 1.7, 2.9, 1.9], [0, 2.75, -0.8, 3.9, 1.3, 1.8],
      [-2.9, 0.6, -1.7, 1.8, 1.6, 1.8], [2.8, 0.55, -1.8, 1.7, 1.4, 1.8], [-1.2, 3.2, -2.0, 2.0, 1.4, 2.0], [1.3, 3.0, -2.3, 2.2, 1.3, 2.0]]) {
      const r = rock(rng, rockHex, w, h, dd);
      r.rotateY((rng() - 0.5) * 0.6);
      r.translate(x, y, z);
      parts.push(r);
    }
    const outcrop = new THREE.Mesh(mergeGeometries(parts), mat);
    outcrop.castShadow = outcrop.receiveShadow = true;
    g.add(outcrop);
    const holeShape = new THREE.Shape();
    holeShape.moveTo(-0.95, 0);
    holeShape.lineTo(-0.95, 1.3);
    holeShape.absarc(0, 1.3, 0.95, Math.PI, 0, true);
    holeShape.lineTo(0.95, 0);
    holeShape.closePath();
    const hole = new THREE.Mesh(new THREE.ShapeGeometry(holeShape, 10), new THREE.MeshBasicMaterial({ color: 0x050407 }));
    hole.position.set(0, 0.02, -0.55);
    g.add(hole);
    // bushes: around it, and three in front that hide the hole until it's found
    const bushGeo = makeBush(rng), bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, color: new THREE.Color(cave.bushes).multiplyScalar(2.1) });
    for (const [x, z, s] of [[-2.8, 0.4, 1.0], [2.9, 0.2, 1.1], [-3.4, -1.2, 0.9], [3.3, -1.3, 0.85]]) {
      const b = new THREE.Mesh(bushGeo, bushMat);
      b.position.set(x, 0, z);
      b.scale.setScalar(s);
      b.rotation.y = rng() * 6;
      b.castShadow = true;
      g.add(b);
    }
    this.cover = [[-0.8, 0.5, 1.15], [0.85, 0.45, 1.1], [0, 0.95, 1.0]].map(([x, z, s]) => {
      const b = new THREE.Mesh(bushGeo, bushMat);
      b.position.set(x, 0, z);
      b.scale.setScalar(s);
      b.rotation.y = rng() * 6;
      b.castShadow = true;
      g.add(b);
      return { mesh: b, x, z, s };
    });
    // the glow, when found
    this.glow = glowSprite(cave.look.crystal, 0);
    this.glow.position.set(0, 1.1, -0.2);
    this.glow.scale.setScalar(3.4);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(cave.look.crystal).multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(0, 0.08, 0.8);
    g.add(this.glow, this.ring);
    this.reveal = 0; // 0 hidden … 1 found
    // the way in: a label and a spot, only while it's found
    const top = new THREE.Vector3(), ui = game.ui;
    this.label = ui.createNpcLabel(cave.name, 'Hidden cave', 'Enter', () => this.use(), (o) => o.copy(top));
    this.top = top.set(at.x + Math.sin(at.yaw) * 0.4, g.position.y + 3.6, at.z + Math.cos(at.yaw) * 0.4);
    this.spot = { id: `mouth_${land}`, x: at.x + Math.sin(at.yaw) * 1.2, z: at.z + Math.cos(at.yaw) * 1.2, label: this.label, can: () => this.found, use: () => game.enterCave(land) };
  }

  use() {
    if (this.game.places.near === this.spot) this.spot.use();
  }

  // Found: our hero carries its key, or its party's copy is open to it (game.js decides).
  get found() {
    return this.game.caveFound(this.land);
  }

  show(on) {
    this.shown = on;
    this.label.el.classList.toggle('hidden', !on || this.reveal < 0.5);
  }

  update(dt) {
    const want = this.found ? 1 : 0;
    this.reveal += (want - this.reveal) * (1 - Math.exp(-3 * dt));
    const k = this.reveal, t = this.game.time;
    for (const b of this.cover) { // the bushes in front step aside
      b.mesh.position.x = b.x * (1 + k * 1.6);
      b.mesh.position.z = b.z + k * 0.6;
      b.mesh.scale.setScalar(b.s * (1 - k * 0.25));
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
    this.glow.material.opacity = k * (0.65 + 0.35 * pulse);
    this.glow.scale.setScalar(3 + pulse * 1.2);
    this.ring.material.opacity = k * (0.25 + 0.5 * (1 - ((t * 0.7) % 1)));
    this.ring.scale.setScalar(1 + ((t * 0.7) % 1) * 0.8);
    this.label.el.classList.toggle('hidden', !this.shown || k < 0.5);
    if (k > 0.5 && Math.random() < dt * 10) {
      const g = this.game, a = this.at, y = this.group.position.y;
      g.fx.add.emit({ pos: { x: a.x + (Math.random() - 0.5) * 2.2, y: y + 0.2, z: a.z + (Math.random() - 0.5) * 2.2 }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: 1.3, z: 0 }, color: hdr(this.cave.look.crystal, 2.2), colorEnd: hdr(this.cave.look.crystal, 0.2), size: 0.13, sizeEnd: 0.02, life: 1.4, drag: 0.6 });
    }
  }

  // A pulsing mark on the minimap while it's found.
  minimapMark(ctx, m, t) {
    if (this.reveal < 0.5) return;
    const [x, y] = m(this.at.x, this.at.z), r = 4 + Math.sin(t * 4) * 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = `#${new THREE.Color(this.cave.look.crystal).getHexString()}`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
}

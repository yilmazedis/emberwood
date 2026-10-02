// The Arena, drawn: a ring of stone around a pit of sand, tiers of stands with banners, braziers, and the
// yard in front of the gate with its waystone and the champions' board (who has won the most fights).
// Its shape and rules are in maps/arena.js (shared with the server, which checks every blow).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored, jitter, envMaterial, buildWaystone } from './world.js';
import { ARENA, YARD, FLOOR, PILLARS } from './maps/arena.js';
import { CLASSES } from './classes.js';
import { mulberry32, has } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const BANNERS = [0xb8322a, 0x3a6aa8, 0xe0b040, 0x4a8a4a, 0x7a4aa8];

export class ArenaView {
  constructor(game, map) {
    this.game = game;
    this.map = map;
    this.look = map.look;
    this.group = new THREE.Group();
    this.group.visible = false;
    game.scene.add(this.group);
    this.fires = [];
    this.lights = [];
    this.waystones = [];
    this.built = false;
    const b = map.board, top = new THREE.Vector3(b.x, FLOOR + 3.3, b.z);
    const label = game.ui.createNpcLabel('Champions', 'Who rules the pit', 'Read', () => this.use('board'), (o) => o.copy(top));
    this.spots = [{ id: 'board', x: b.x, z: b.z + 1.3, label, can: () => true, use: () => this.openBoard() }];
    this.minimap = this.buildMinimap();
    $('arena-board').querySelector('.close').addEventListener('click', () => this.closeBoard());
  }

  load() {
    if (this.built) return Promise.resolve();
    this.built = true;
    const rng = mulberry32(777), cx = ARENA.cx, cz = ARENA.cz, parts = [];
    const add = (geo, x, z, y = 0, rotY = 0) => { geo.rotateY(rotY); geo.translate(cx + x, FLOOR + y, cz + z); parts.push(geo); };
    // the ground around, the sand of the pit (with a darker ring) and the yard's flagstones
    const ground = new THREE.Mesh(new THREE.CircleGeometry(95, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 }));
    ground.position.set(cx, FLOOR - 0.02, cz + 10);
    ground.receiveShadow = true;
    this.group.add(ground);
    const sand = new THREE.Mesh(new THREE.CircleGeometry(ARENA.wall, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8b97e, roughness: 1 }));
    sand.position.set(cx, FLOOR + 0.01, cz);
    sand.receiveShadow = true;
    this.group.add(sand);
    const ring = new THREE.Mesh(new THREE.RingGeometry(ARENA.r * 0.32, ARENA.r * 0.35, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa8834e, roughness: 1 }));
    ring.position.set(cx, FLOOR + 0.02, cz);
    this.group.add(ring);
    for (let x = YARD.x0; x < YARD.x1; x += 2) {
      for (let z = YARD.z0 - 1; z < YARD.z1; z += 2) add(colored(new THREE.BoxGeometry(1.9, 0.08, 1.9), 0x9a968c + Math.floor(rng() * 3) * 0x050505), x + 1, z + 1, 0.0);
    }
    // the ring wall: stone blocks with merlons, open at the gate, and its gate towers
    const N = 48;
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N) * Math.PI * 2, x = Math.cos(a) * (ARENA.wall + 0.4), z = Math.sin(a) * (ARENA.wall + 0.4);
      if (z > 0 && Math.abs(x) < ARENA.gate + 0.8) continue;
      const seg = (2 * Math.PI * (ARENA.wall + 0.4)) / N + 0.1;
      add(colored(jitter(new THREE.BoxGeometry(seg, 2.6, 1.2, 2, 1, 1), 0.05, rng).translate(0, 1.3, 0), 0x8f8578), x, z, 0, -a + Math.PI / 2);
      if (i % 2) add(colored(new THREE.BoxGeometry(seg * 0.45, 0.6, 1.2).translate(0, 2.9, 0), 0x857b6e), x, z, 0, -a + Math.PI / 2);
    }
    for (const s of [-1, 1]) {
      add(colored(new THREE.BoxGeometry(2.2, 5.2, 2.2).translate(0, 2.6, 0), 0x7d7468), s * (ARENA.gate + 1.4), ARENA.wall + 0.4);
      add(colored(new THREE.ConeGeometry(1.8, 1.6, 4).rotateY(Math.PI / 4).translate(0, 6.0, 0), 0x6b2a26), s * (ARENA.gate + 1.4), ARENA.wall + 0.4);
    }
    add(colored(new THREE.BoxGeometry(ARENA.gate * 2 + 4.6, 0.9, 1.4).translate(0, 4.5, 0), 0x7d7468), 0, ARENA.wall + 0.4);
    // the stands: three tiers behind the wall, all the way round but the yard's side
    for (let t = 0; t < 3; t++) {
      const r = ARENA.wall + 2.4 + t * 2.2, h = 1.6 + t * 1.3, n = 40 + t * 6;
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (z > 8) continue;
        add(colored(new THREE.BoxGeometry((2 * Math.PI * r) / n + 0.1, h, 2.2).translate(0, h / 2, 0), t % 2 ? 0x9a8f80 : 0xa89c8a), x, z, 0, -a + Math.PI / 2);
      }
    }
    // banners on poles round the top of the stands
    for (let i = 0; i < 14; i++) {
      const a = Math.PI + 0.25 + (i / 13) * (Math.PI - 0.5), r = ARENA.wall + 8.4, x = Math.cos(a) * r, z = Math.sin(a) * r;
      add(colored(new THREE.CylinderGeometry(0.08, 0.1, 6, 5).translate(0, 3, 0), 0x4a3a2a), x, z, 4.0);
      add(colored(new THREE.BoxGeometry(1.1, 2.0, 0.05).translate(0.55, 4.9, 0), BANNERS[i % BANNERS.length]), x, z, 4.0, -a);
    }
    // broken pillars in the pit, and a few weapons left in the sand
    for (const [x, z] of PILLARS) {
      const h = 2.2 + rng() * 2.4;
      add(colored(new THREE.CylinderGeometry(1.15, 1.25, 0.4, 8).translate(0, 0.2, 0), 0x8a8072), x, z);
      add(colored(jitter(new THREE.CylinderGeometry(0.8, 0.85, h, 8, 2), 0.06, rng).translate(0, 0.4 + h / 2, 0), 0xa89c8a), x, z);
      const chunk = colored(jitter(new THREE.CylinderGeometry(0.75, 0.8, 1.4, 8), 0.1, rng), 0xa09484);
      chunk.rotateZ(Math.PI / 2);
      chunk.translate(1.6, 0.7, 0.8);
      add(chunk, x, z, 0, rng() * 6.3);
    }
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2, r = 4 + rng() * 15, blade = colored(new THREE.BoxGeometry(0.1, 1.1, 0.03).translate(0, 0.5, 0), 0xc8ced6);
      blade.rotateZ(0.5);
      add(blade, Math.cos(a) * r, Math.sin(a) * r, 0, rng() * 6.3);
    }
    // braziers round the pit and at the yard; the champions' board
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2, r = ARENA.wall - 1.6, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > 0 && Math.abs(x) < 6) continue;
      this.brazier(add, x, z);
    }
    for (const x of [-8.5, 8.5]) this.brazier(add, x, YARD.z0 + 1.5);
    const b = this.map.board;
    add(colored(new THREE.BoxGeometry(2.6, 1.7, 0.18).translate(0, 1.9, 0), 0x8a5a33), b.x - cx, b.z - cz);
    for (const s of [-1.1, 1.1]) add(colored(new THREE.CylinderGeometry(0.09, 0.11, 2.8, 5).translate(s, 1.4, -0.1), 0x5a3a20), b.x - cx, b.z - cz);
    add(colored(new THREE.BoxGeometry(2.0, 1.2, 0.04).translate(0, 1.95, 0.1), 0xf1e1bf), b.x - cx, b.z - cz);
    // crossed swords over the gate
    for (const s of [-1, 1]) add(colored(new THREE.BoxGeometry(0.16, 3.2, 0.06).rotateZ(s * 0.7).translate(0, 5.6, 0.8), 0xd8dee6), 0, ARENA.wall + 0.4);
    const mesh = new THREE.Mesh(mergeGeometries(parts), envMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const w = buildWaystone(this.map.waystone.x, this.map.waystone.z, rng);
    this.group.add(w.group);
    this.waystones.push(w);
    this.lights.push({ pos: w.glow, color: 0x5ad0ff, power: 6, dist: 9 });
    return Promise.resolve();
  }

  brazier(add, x, z) {
    add(colored(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6).translate(0, 0.6, 0), 0x3a3a40), x, z);
    add(colored(new THREE.CylinderGeometry(0.42, 0.22, 0.32, 8).translate(0, 1.3, 0), 0x3a3a40), x, z);
    const pos = new THREE.Vector3(ARENA.cx + x, FLOOR + 1.45, ARENA.cz + z);
    this.fires.push({ pos, scale: 0.6 });
    this.lights.push({ pos: pos.clone().setY(pos.y + 0.6), color: 0xff8a3a, power: 10, dist: 13, flicker: x + z });
  }

  buildMinimap() {
    const S = 360, R = 48, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d'), k = S / (2 * R), mx = (x) => (x + R) * k, mz = (z) => (z - 10 + R) * k;
    ctx.fillStyle = '#6e6250';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#8f8578';
    ctx.beginPath(); ctx.arc(mx(0), mz(0), (ARENA.wall + 9) * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8b97e';
    ctx.beginPath(); ctx.arc(mx(0), mz(0), ARENA.wall * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a49e94';
    ctx.fillRect(mx(YARD.x0), mz(YARD.z0 - 1.5), (YARD.x1 - YARD.x0) * k, (YARD.z1 - YARD.z0 + 1.5) * k);
    ctx.strokeStyle = '#4a4238';
    ctx.lineWidth = 1.2 * k;
    const gapA = Math.asin(ARENA.gate / ARENA.wall);
    ctx.beginPath(); ctx.arc(mx(0), mz(0), ARENA.wall * k, Math.PI / 2 + gapA, Math.PI / 2 - gapA + Math.PI * 2); ctx.stroke();
    return { canvas: cv, range: R, cx: ARENA.cx, cz: ARENA.cz + 10 };
  }

  show(on) {
    this.group.visible = on;
    for (const s of this.spots) s.label.el.classList.toggle('hidden', !on);
    if (!on) this.closeBoard();
  }

  use(id) {
    const s = this.spots.find((x) => x.id === id);
    if (s && this.game.places.near === s) s.use();
  }

  update(dt) {
    const t = this.game.time;
    for (const w of this.waystones) {
      w.crystal.rotation.y += dt * 0.9;
      w.crystal.position.y = 3.8 + Math.sin(t * 1.6) * 0.15;
    }
    if (this.boardOpen && this.game.places.near?.id !== 'board') this.closeBoard(); // walked away
  }

  // ---------------------------------------------------------------- the champions' board
  async openBoard() {
    const el = $('arena-board'), g = this.game;
    this.boardOpen = true;
    el.classList.remove('hidden');
    $('arena-rows').innerHTML = '<div class="ab-note">Reading the board…</div>';
    try {
      const r = await g.net.request('arenaBoard');
      const rows = (r.top || []).map((e, i) => `<div class="ab-row c-${has(CLASSES, e.c) ? e.c : ''}"><span>${i + 1}</span><b>${esc(e.n)}</b><i>Lv ${Number(e.l) || 1}</i><em>${Number(e.k) || 0} won · ${Number(e.d) || 0} lost</em></div>`);
      $('arena-rows').innerHTML = rows.length ? rows.join('') : '<div class="ab-note">No fights yet. Be the first champion!</div>';
      $('arena-me').textContent = r.me ? `You: ${r.me.k} won · ${r.me.d} lost` : '';
    } catch (err) {
      $('arena-rows').innerHTML = `<div class="ab-note">${esc(err.message)}</div>`;
    }
  }

  closeBoard() {
    this.boardOpen = false;
    $('arena-board').classList.add('hidden');
  }
}

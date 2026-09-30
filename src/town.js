// The camp market: Wren the merchant (KayKit Ranger) behind a stall, and the player's stash chest.
// Also the economy that goes with it: rotating stock, ale, buyback, selling commons, stash transfers.
// Stock and stash live on the player (so they are saved); the buyback list lasts for the session.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { cloneItem } from './assets.js';
import { heightAt, addCollider, TOWN } from './world.js';
import { vendorItem, buyPrice, RARITY } from './items.js';
import { angleDiff, clamp, dampAngle, pick, yawTo } from './util.js';

export const ALE_PRICE = 25;
const STOCK_SIZE = 9;
const RESTOCK_MS = 5 * 60 * 1000;
const BUYBACK_SIZE = 5;
const REACH = 2.6; // how close you must stand to the counter / chest
const LEAVE = 4.5; // walking this far away closes the panel

const GREETINGS = [
  'Fine wares for brave souls!',
  "Back from the woods? Let's trade.",
  "Ale's fresh, blades are sharp.",
  'Mind the slimes on your way out.',
  'Everything has a price, friend.',
];

const mat = (color, rough = 0.85, metal = 0, side = THREE.FrontSide) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, side });

function mesh(geo, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, material, x, y, z, rx, ry, rz) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, rx, ry, rz);

// Market stall facing +Z (toward the fire). The canopy stays behind the merchant's head so the
// high camera always sees their face.
function buildStall(scene) {
  const { x, z } = TOWN.vendor;
  const g = new THREE.Group();
  g.position.set(x, heightAt(x, z), z);
  const wood = mat(0x8a5a33), plank = mat(0xb07a45), dark = mat(0x5a3a20);
  const red = mat(0xb8322a), cream = mat(0xf1e1bf), gold = mat(0xe8b640, 0.35, 0.4);

  g.add(box(3.0, 0.95, 0.8, wood, 0, 0.475, 0));
  g.add(box(3.2, 0.1, 1.0, plank, 0, 1.0, 0.02));
  for (let i = -2; i <= 2; i++) g.add(box(0.07, 0.8, 0.02, dark, i * 0.62, 0.46, 0.41));
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.3, 6), dark, s * 1.5, 1.65, -1.55));
  for (let i = 0; i < 6; i++) g.add(box(0.5, 2.0, 0.04, i % 2 ? cream : red, -1.25 + i * 0.5, 1.9, -1.58));
  const canopy = new THREE.Group();
  canopy.position.set(0, 3.2, -1.6);
  canopy.rotation.x = 0.32;
  for (let i = 0; i < 6; i++) canopy.add(box(0.5, 0.05, 1.05, i % 2 ? cream : red, -1.25 + i * 0.5, 0, 0.5));
  g.add(canopy);

  // shop sign on a post at the side: a board with a gold coin
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 5), dark, 1.95, 1.15, 0.35));
  g.add(box(0.75, 0.5, 0.06, plank, 1.95, 2.05, 0.4));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12), gold, 1.95, 2.05, 0.45, Math.PI / 2));

  // wares on the counter, using the pack's own models
  const wares = [
    ['mug_full', -1.15, 1.05, 0.1, 0.5, [0, 0.4, 0]],
    ['mug_full', -0.82, 1.05, 0.28, 0.5, [0, -0.3, 0]],
    ['spellbook_open', -0.15, 1.08, 0.08, 0.45, [0, 0, 0]],
    ['sword_1handed', 0.8, 1.1, 0.15, 0.55, [0, 0, Math.PI / 2]],
    ['shield_round', 1.2, 0.58, 0.55, 0.6, [-0.25, 0, 0]],
  ];
  for (const [name, wx, wy, wz, s, r] of wares) {
    const o = cloneItem(name);
    o.position.set(wx, wy, wz);
    o.scale.setScalar(s);
    o.rotation.set(...r);
    g.add(o);
  }
  // crates and a barrel behind the stall
  g.add(box(0.7, 0.7, 0.7, wood, -2.25, 0.35, -0.9, 0, 0.3, 0));
  g.add(box(0.55, 0.55, 0.55, plank, -2.3, 0.97, -0.95, 0, -0.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.85, 9), dark, 2.2, 0.43, -1.0));
  scene.add(g);

  for (const dx of [-0.95, 0, 0.95]) addCollider(x + dx, z, 0.6);
  addCollider(x - 1.5, z - 1.55, 0.3);
  addCollider(x + 1.5, z - 1.55, 0.3);
  addCollider(x - 2.25, z - 0.9, 0.55);
  addCollider(x + 2.2, z - 1.0, 0.4);
  addCollider(x + 1.95, z + 0.35, 0.2);
  return g;
}

// Iron-banded chest with a hinged lid; a golden glow inside shows when it opens.
function buildChest(scene) {
  const { x, z } = TOWN.stash;
  const g = new THREE.Group();
  g.position.set(x, heightAt(x, z), z);
  g.rotation.y = 0.35; // turned toward the camp
  const wood = mat(0x7a4a26), lidWood = mat(0x7a4a26, 0.85, 0, THREE.DoubleSide);
  const band = mat(0x3a3a42, 0.5, 0.3, THREE.DoubleSide), gold = mat(0xe8b640, 0.3, 0.45);
  g.add(box(1.3, 0.62, 0.85, wood, 0, 0.31, 0));
  for (const s of [-1, 1]) g.add(box(0.09, 0.64, 0.88, band, s * 0.48, 0.32, 0));
  g.add(box(0.2, 0.24, 0.05, gold, 0, 0.46, 0.44));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc040).multiplyScalar(1.8) }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.63; // just above the box top; the closed lid's dome hides it
  g.add(glow);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.62, -0.425);
  g.add(hinge);
  const half = (r, len) => new THREE.CylinderGeometry(r, r, len, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
  hinge.add(mesh(half(0.425, 1.3), lidWood, 0, 0, 0.425));
  for (const s of [-1, 1]) hinge.add(mesh(half(0.435, 0.09), band, s * 0.48, 0, 0.425));
  scene.add(g);
  addCollider(x, z, 0.8);
  return { group: g, hinge };
}

// Quest notice board: posts, a small gable roof, pinned notes, and a golden "!" that floats
// above it when there is a new story quest or a reward to claim.
function buildBoard(scene) {
  const { x, z } = TOWN.board;
  const g = new THREE.Group();
  g.position.set(x, heightAt(x, z), z);
  g.rotation.y = -0.4; // turned toward the fire
  const wood = mat(0x8a5a33), dark = mat(0x5a3a20), roof = mat(0x6b3a2a);
  const papers = [mat(0xf1e1bf, 0.95), mat(0xe6d3a8, 0.95)], pin = mat(0xc0392b, 0.5);
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.5, 6), dark, s * 1.0, 1.25, 0));
  g.add(box(2.2, 1.3, 0.1, wood, 0, 1.55, 0));
  g.add(box(2.3, 0.08, 0.14, dark, 0, 2.22, 0));
  g.add(box(2.3, 0.08, 0.14, dark, 0, 0.88, 0));
  g.add(box(2.6, 0.06, 0.46, roof, 0, 2.43, 0.15, 0.6));
  g.add(box(2.6, 0.06, 0.46, roof, 0, 2.43, -0.15, -0.6));
  [[-0.62, 1.8, -0.08], [-0.05, 1.6, 0.06], [0.58, 1.82, 0.1], [0.4, 1.25, -0.05], [-0.55, 1.24, 0.07]].forEach(([nx, ny, rz], i) => {
    g.add(mesh(new THREE.PlaneGeometry(0.42, 0.5), papers[i % 2], nx, ny, 0.056, 0, 0, rz));
    g.add(mesh(new THREE.SphereGeometry(0.035, 6, 4), pin, nx, ny + 0.2, 0.07));
  });
  // the golden "!" (a gap wide enough that the bloom doesn't merge the dot into the bar)
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 1.5, flatShading: true });
  const marker = new THREE.Group();
  marker.position.set(0, 3.0, 0);
  marker.add(mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), glowMat, 0, 0.41, 0));
  marker.add(mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), glowMat, 0, -0.07, 0));
  g.add(marker);
  scene.add(g);
  // colliders along the board, between the posts
  const cy = g.rotation.y;
  for (const lx of [-1, 0, 1]) addCollider(x + lx * Math.cos(cy), z - lx * Math.sin(cy), 0.4);
  return { group: g, marker };
}

export class Town {
  constructor(game) {
    this.game = game;
    this.buyback = [];
    this.near = null;
    this.lid = 0;
    this.pendingRestock = false;
    const { scene, ui } = game;
    const v = TOWN.vendor, s = TOWN.stash;

    buildStall(scene);
    this.chest = buildChest(scene);
    this.board = buildBoard(scene);

    // Wren: the Ranger model, quiver hidden, standing behind the counter
    this.npc = new Humanoid('Ranger');
    this.npc.setMeshVisible('Ranger_Quiver', false);
    this.npc.group.position.set(v.x, heightAt(v.x, v.z - 0.95), v.z - 0.95);
    this.npcYaw = 0;
    scene.add(this.npc.group);
    addCollider(v.x, v.z - 0.95, 0.45);

    // where the player stands to use them
    this.vendorSpot = new THREE.Vector2(v.x, v.z + 1.25);
    const cy = this.chest.group.rotation.y;
    this.stashSpot = new THREE.Vector2(s.x + Math.sin(cy) * 1.05, s.z + Math.cos(cy) * 1.05);
    const by = this.board.group.rotation.y, b = TOWN.board;
    this.boardSpot = new THREE.Vector2(b.x + Math.sin(by) * 1.3, b.z + Math.cos(by) * 1.3);

    const npcPos = this.npc.group.position;
    this.vendorLabel = ui.createNpcLabel('Wren', 'Merchant', 'Trade', () => this.open('vendor'), (out) => out.set(npcPos.x, npcPos.y + 2.75, npcPos.z));
    const chestPos = this.chest.group.position;
    this.stashLabel = ui.createNpcLabel('Stash', 'Your storage', 'Open', () => this.open('stash'), (out) => out.set(chestPos.x, chestPos.y + 1.25, chestPos.z));
    const boardPos = this.board.group.position;
    this.boardLabel = ui.createNpcLabel('Notice Board', 'Quests', 'Read', () => this.open('board'), (out) => out.set(boardPos.x, boardPos.y + 3.95, boardPos.z));
    this.labels = { vendor: this.vendorLabel, stash: this.stashLabel, board: this.boardLabel };
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, p = g.player, ui = g.ui;
    const open = ui.invOpen ? ui.invMode : null;
    // the closest of the stall, the chest and the board within reach
    const dist = {
      vendor: Math.hypot(p.pos.x - this.vendorSpot.x, p.pos.z - this.vendorSpot.y),
      stash: Math.hypot(p.pos.x - this.stashSpot.x, p.pos.z - this.stashSpot.y),
      board: Math.hypot(p.pos.x - this.boardSpot.x, p.pos.z - this.boardSpot.y),
    };
    this.near = null;
    let best = REACH;
    if (p.alive) for (const k in dist) if (dist[k] < best) { best = dist[k]; this.near = k; }
    for (const k in this.labels) this.labels[k].el.classList.toggle('near', this.near === k && open !== k);
    if (open in dist && dist[open] > LEAVE) ui.closeInventory();

    // the merchant watches you when you're close (but never turns their back to the camp)
    const n = this.npc.group.position;
    const dx = p.pos.x - n.x, dz = p.pos.z - n.z;
    const want = Math.hypot(dx, dz) < 8 ? clamp(angleDiff(0, yawTo(dx, dz)), -1.1, 1.1) : 0;
    this.npcYaw = dampAngle(this.npcYaw, want, 4, dt);
    this.npc.group.rotation.y = this.npcYaw;
    this.npc.update(dt);

    this.lid += ((open === 'stash' ? 1 : 0) - this.lid) * (1 - Math.exp(-8 * dt));
    this.chest.hinge.rotation.x = -1.85 * this.lid;

    const marker = this.board.marker;
    marker.visible = g.quests.markerVisible();
    if (marker.visible) {
      this.markerT = (this.markerT || 0) + dt;
      marker.rotation.y = this.markerT * 1.6;
      marker.position.y = 3.0 + Math.sin(this.markerT * 2.4) * 0.12;
    }

    if (open !== 'vendor' && (this.pendingRestock || Date.now() >= p.shop.restockAt)) this.restock();
  }

  interact() {
    if (this.near) this.open(this.near);
  }

  open(kind) {
    const g = this.game;
    if (this.near !== kind) return;
    g.ui.openInventory(kind);
    if (kind === 'vendor') {
      this.npc.anim.play('Interact', { timeScale: 1.2 });
      if (performance.now() - (this.lastGreet ?? -1e9) > 5000) { // don't stack greetings
        this.lastGreet = performance.now();
        const n = this.npc.group.position;
        g.ui.floater(new THREE.Vector3(n.x, n.y + 3.1, n.z), pick(GREETINGS), 'say');
      }
    } else if (kind === 'board') {
      g.sfx.play('page');
    } else {
      g.sfx.play('chest');
    }
  }

  // ---------------------------------------------------------------- shop
  restock() {
    const p = this.game.player;
    p.shop.stock = Array.from({ length: STOCK_SIZE }, () => {
      const item = vendorItem(Math.max(1, p.level + (Math.random() < 0.25 ? 1 : 0)));
      return { item, price: buyPrice(item) };
    });
    p.shop.restockAt = Date.now() + RESTOCK_MS;
    this.pendingRestock = false;
    this.game.save();
  }

  onLevelUp() {
    this.pendingRestock = true; // better gear for the new level, next time the shop is closed
  }

  secondsToRestock() {
    return Math.max(0, Math.ceil((this.game.player.shop.restockAt - Date.now()) / 1000));
  }

  pay(price) {
    const g = this.game;
    if (g.player.gold < price) {
      g.ui.centerMsg('Not enough gold');
      return false;
    }
    g.player.gold -= price;
    return true;
  }

  done(msg) {
    const g = this.game;
    g.sfx.play('gold');
    if (msg) g.ui.log(msg, 'gold');
    g.ui.refreshInventory();
    g.save();
  }

  buyAle() {
    if (!this.pay(ALE_PRICE)) return;
    this.game.player.potions++;
    this.done();
  }

  buy(i) {
    const p = this.game.player, entry = p.shop.stock[i];
    if (!entry) return;
    if (p.freeSlot() < 0) { this.game.ui.centerMsg('Your bag is full'); return; }
    if (!this.pay(entry.price)) return;
    p.bag[p.freeSlot()] = entry.item;
    p.shop.stock[i] = null;
    this.done(`Bought <b style="color:${RARITY[entry.item.rarity].color}">${entry.item.name}</b> for ${entry.price}g`);
  }

  buyBack(i) {
    const p = this.game.player, entry = this.buyback[i];
    if (!entry) return;
    if (p.freeSlot() < 0) { this.game.ui.centerMsg('Your bag is full'); return; }
    if (!this.pay(entry.price)) return;
    p.bag[p.freeSlot()] = entry.item;
    this.buyback.splice(i, 1);
    this.done(`Bought back ${entry.item.name}`);
  }

  // Everything sold (here or out in the woods) can be bought back for what it sold for.
  addBuyback(item) {
    this.buyback.unshift({ item, price: item.value });
    this.buyback.length = Math.min(this.buyback.length, BUYBACK_SIZE);
  }

  commonsValue() {
    return this.game.player.bag.reduce((sum, it) => sum + (it && it.rarity === 'common' ? it.value : 0), 0);
  }

  sellCommons() {
    const p = this.game.player;
    let total = 0, count = 0;
    p.bag.forEach((it, i) => {
      if (!it || it.rarity !== 'common') return;
      total += it.value;
      count++;
      this.addBuyback(it);
      p.bag[i] = null;
    });
    if (!count) { this.game.ui.centerMsg('No common items to sell'); return; }
    p.gold += total;
    this.done(`Sold ${count} common item${count > 1 ? 's' : ''} for <b>${total}g</b>`);
  }

  // ---------------------------------------------------------------- stash
  store(bagIndex) {
    const g = this.game, p = g.player, it = p.bag[bagIndex];
    if (!it) return;
    const j = p.stash.findIndex((x) => !x);
    if (j < 0) { g.ui.centerMsg('Your stash is full'); return; }
    p.stash[j] = it;
    p.bag[bagIndex] = null;
    g.sfx.play('equip');
    g.ui.refreshInventory();
    g.save();
  }

  take(stashIndex) {
    const g = this.game, p = g.player, it = p.stash[stashIndex];
    if (!it) return;
    const j = p.freeSlot();
    if (j < 0) { g.ui.centerMsg('Your bag is full'); return; }
    p.bag[j] = it;
    p.stash[stashIndex] = null;
    g.sfx.play('equip');
    g.ui.refreshInventory();
    g.save();
  }
}

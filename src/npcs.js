// The people (and the board) in every land's camp (camps.js): drawn with their stalls, a name tag with a
// button when in reach (E), and what they do: merchants sell (weapons and armor for the hero's class up to
// the camp's level, potions, elixirs and scrolls; the blacksmith sells upgrade recipes and works the anvil)
// and buy anything; the banker keeps the account's shared bank (bank.js); the board has the land's quests.
// Sold items can be bought back for what they fetched, this session.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { cloneItem } from './assets.js';
import { heightAt, TOWN } from './world.js';
import { CAMPS, SHOP_CAP, spotOf } from './camps.js';
import { ITEMS, itemDef, itemName, itemColor, makeItem } from './items.js';
import { angleDiff, clamp, dampAngle, pick, yawTo } from './util.js';

const REACH = 2.6; // how close you must stand
const LEAVE = 4.5; // walking this far away closes the panel
const BUYBACK = 6;
const GREET = {
  weapons: ['Sharp steel for brave souls!', 'A good blade is half the fight.', 'Looking for something with more bite?'],
  armor: ['Better to be hit in good plate.', 'Mind the straps, they pinch.', 'Armor never goes out of fashion.'],
  goods: ['Potions, elixirs, scrolls home!', 'Something for the road?', 'Drink up, hero.'],
  bank: ['Your valuables are safe with me.', 'Everything you and yours left here, as you left it.', 'Deposits, withdrawals…'],
  anvil: ['Bring me a recipe and I make it stronger. Never fails.', 'Hear that ring? That is quality.', 'Upgrades, recipes, honest work.'],
};
const ROLE_ACTION = { weapons: 'Trade', armor: 'Trade', goods: 'Trade', bank: 'Bank', board: 'Read', anvil: 'Upgrade' };

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
const item = (name, x, y, z, s, r) => { const o = cloneItem(name); o.position.set(x, y, z); o.scale.setScalar(s); o.rotation.set(...r); return o; };

// ---------------------------------------------------------------- stalls (each faces +Z, the merchant behind)
// Emberwood's market stall: a counter, a striped canopy, a coin sign and wares (the old merchant's).
function stall() {
  const g = new THREE.Group();
  const wood = mat(0x8a5a33), plank = mat(0xb07a45), dark = mat(0x5a3a20), red = mat(0xb8322a), cream = mat(0xf1e1bf), gold = mat(0xe8b640, 0.35, 0.4);
  g.add(box(3.0, 0.95, 0.8, wood, 0, 0.475, 0), box(3.2, 0.1, 1.0, plank, 0, 1.0, 0.02));
  for (let i = -2; i <= 2; i++) g.add(box(0.07, 0.8, 0.02, dark, i * 0.62, 0.46, 0.41));
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.3, 6), dark, s * 1.5, 1.65, -1.55));
  for (let i = 0; i < 6; i++) g.add(box(0.5, 2.0, 0.04, i % 2 ? cream : red, -1.25 + i * 0.5, 1.9, -1.58));
  const canopy = new THREE.Group();
  canopy.position.set(0, 3.2, -1.6);
  canopy.rotation.x = 0.32;
  for (let i = 0; i < 6; i++) canopy.add(box(0.5, 0.05, 1.05, i % 2 ? cream : red, -1.25 + i * 0.5, 0, 0.5));
  g.add(canopy);
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 5), dark, 1.95, 1.15, 0.35), box(0.75, 0.5, 0.06, plank, 1.95, 2.05, 0.4), mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12), gold, 1.95, 2.05, 0.45, Math.PI / 2));
  g.add(item('sword_1handed', -0.9, 1.1, 0.15, 0.55, [0, 0, Math.PI / 2]), item('axe_1handed', -0.1, 1.1, 0.1, 0.5, [0, 0.3, Math.PI / 2]), item('dagger', 0.6, 1.08, 0.2, 0.55, [0, -0.4, Math.PI / 2]));
  g.add(item('shield_round', 1.2, 0.58, 0.55, 0.6, [-0.25, 0, 0]));
  g.add(box(0.7, 0.7, 0.7, wood, -2.25, 0.35, -0.9, 0, 0.3, 0), box(0.55, 0.55, 0.55, plank, -2.3, 0.97, -0.95, 0, -0.2, 0), mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.85, 9), dark, 2.2, 0.43, -1.0));
  return g;
}

// A weapon rack with a few weapons on it, in front of the merchant.
function rack() {
  const g = new THREE.Group(), wood = mat(0x7a4e2a), dark = mat(0x4a3020);
  g.add(box(1.6, 0.1, 0.5, wood, 0, 0.12, 0.85), box(1.6, 0.08, 0.1, wood, 0, 1.25, 0.7));
  for (const s of [-1, 1]) g.add(box(0.1, 1.3, 0.1, dark, s * 0.75, 0.65, 0.7));
  g.add(item('sword_2handed', -0.45, 0.2, 0.78, 0.6, [0.15, 0, 0]), item('axe_2handed', 0.05, 0.2, 0.78, 0.55, [0.15, 0.4, 0]), item('staff', 0.5, 0.45, 0.78, 0.55, [0.15, 0, 0]));
  return g;
}

// An armor stand: a post and a breastplate, a helmet on top.
function stand() {
  const g = new THREE.Group(), wood = mat(0x6a4428), steel = mat(0xc8d0da, 0.35, 0.35), trim = mat(0x8a6a3a, 0.5, 0.3);
  g.add(box(0.7, 0.08, 0.7, wood, 0, 0.04, 0.85), mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 6), wood, 0, 0.7, 0.85));
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.62, 8), steel, 0, 1.12, 0.85), mesh(new THREE.SphereGeometry(0.21, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), steel, 0, 1.52, 0.85));
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.15, 6, 5), trim, s * 0.36, 1.36, 0.85));
  g.add(item('shield_square', 0.55, 0.45, 1.1, 0.5, [-0.35, -0.5, 0]));
  return g;
}

// A table of potions and scrolls.
function table() {
  const g = new THREE.Group(), wood = mat(0x8a5a33), cloth = mat(0x3a6a4a);
  g.add(box(1.4, 0.08, 0.7, wood, 0, 0.82, 0.8), box(1.42, 0.02, 0.72, cloth, 0, 0.87, 0.8));
  for (const [x, z] of [[-0.62, 0.5], [0.62, 0.5], [-0.62, 1.1], [0.62, 1.1]]) g.add(box(0.08, 0.82, 0.08, wood, x, 0.41, z));
  const glass = (hex) => mat(hex, 0.15, 0.1);
  [[-0.45, 0xe8322a], [-0.2, 0x3a78e0], [0.05, 0xe8322a], [0.25, 0x4ad46a]].forEach(([x, c]) => {
    g.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), glass(c), x, 0.97, 0.8), mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 6), mat(0xc8b898), x, 1.08, 0.8));
  });
  g.add(item('spellbook_closed', 0.5, 0.95, 0.85, 0.4, [0, 0.6, 0]));
  return g;
}

// The banker's iron-banded strongbox (its lid opens while the bank is open).
function chest() {
  const g = new THREE.Group(), wood = mat(0x7a4a26), lidWood = mat(0x7a4a26, 0.85, 0, THREE.DoubleSide);
  const band = mat(0x3a3a42, 0.5, 0.3, THREE.DoubleSide), gold = mat(0xe8b640, 0.3, 0.45);
  const c = new THREE.Group();
  c.position.set(0, 0, 0.9);
  c.add(box(1.3, 0.62, 0.85, wood, 0, 0.31, 0));
  for (const s of [-1, 1]) c.add(box(0.09, 0.64, 0.88, band, s * 0.48, 0.32, 0));
  c.add(box(0.2, 0.24, 0.05, gold, 0, 0.46, 0.44));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc040).multiplyScalar(1.8) }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.63;
  c.add(glow);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.62, -0.425);
  c.add(hinge);
  const half = (r, len) => new THREE.CylinderGeometry(r, r, len, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
  hinge.add(mesh(half(0.425, 1.3), lidWood, 0, 0, 0.425));
  for (const s of [-1, 1]) hinge.add(mesh(half(0.435, 0.09), band, s * 0.48, 0, 0.425));
  g.add(c);
  g.userData.hinge = hinge;
  return g;
}

// The quest board: posts, a little roof, pinned notes, and a golden "!" when something waits.
function board() {
  const g = new THREE.Group();
  const wood = mat(0x8a5a33), dark = mat(0x5a3a20), roof = mat(0x6b3a2a);
  const papers = [mat(0xf1e1bf, 0.95), mat(0xe6d3a8, 0.95)], pin = mat(0xc0392b, 0.5);
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.5, 6), dark, s * 1.0, 1.25, 0));
  g.add(box(2.2, 1.3, 0.1, wood, 0, 1.55, 0), box(2.3, 0.08, 0.14, dark, 0, 2.22, 0), box(2.3, 0.08, 0.14, dark, 0, 0.88, 0));
  g.add(box(2.6, 0.06, 0.46, roof, 0, 2.43, 0.15, 0.6), box(2.6, 0.06, 0.46, roof, 0, 2.43, -0.15, -0.6));
  [[-0.62, 1.8, -0.08], [-0.05, 1.6, 0.06], [0.58, 1.82, 0.1], [0.4, 1.25, -0.05], [-0.55, 1.24, 0.07]].forEach(([nx, ny, rz], i) => {
    g.add(mesh(new THREE.PlaneGeometry(0.42, 0.5), papers[i % 2], nx, ny, 0.056, 0, 0, rz), mesh(new THREE.SphereGeometry(0.035, 6, 4), pin, nx, ny + 0.2, 0.07));
  });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 1.5, flatShading: true });
  const marker = new THREE.Group();
  marker.position.set(0, 3.0, 0);
  marker.add(mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), glowMat, 0, 0.41, 0), mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), glowMat, 0, -0.07, 0));
  g.add(marker);
  g.userData.marker = marker;
  return g;
}

// The blacksmith's anvil, with a small glowing forge beside it.
function anvil() {
  const g = new THREE.Group(), iron = mat(0x3a3a42, 0.4, 0.5), stone = mat(0x6a625a), wood = mat(0x5a3a20);
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 8), wood, 0, 0.25, 0.9));
  g.add(box(0.7, 0.18, 0.32, iron, 0, 0.62, 0.9), box(0.4, 0.14, 0.24, iron, 0, 0.47, 0.9), mesh(new THREE.ConeGeometry(0.12, 0.34, 4), iron, 0.48, 0.62, 0.9, 0, 0, -Math.PI / 2));
  g.add(item('axe_1handed', 0.1, 0.74, 0.95, 0.45, [Math.PI / 2, 0, 0.4]));
  g.add(box(1.0, 0.9, 0.9, stone, -1.25, 0.45, 0.4), box(1.1, 0.12, 1.0, mat(0x4a423a), -1.25, 0.94, 0.4));
  const coals = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a20).multiplyScalar(2.2) }));
  coals.rotation.x = -Math.PI / 2;
  coals.position.set(-1.25, 1.01, 0.4);
  g.add(coals);
  return g;
}

const PROPS = { weapons: rack, armor: stand, goods: table, bank: chest, anvil, board };

export class Npcs {
  constructor(game) {
    this.game = game;
    this.camps = {}; // land -> [{ n (camps.js), group, h (the merchant), label, spot, yaw }]
    this.near = null;
    this.open = null; // the one whose panel is open
    this.buyback = [];
    this.lastGreet = 0;
    for (const [land, list] of Object.entries(CAMPS)) this.camps[land] = list.map((n) => this.build(land, n));
    this.land = null;
  }

  build(land, n) {
    const g = this.game, root = new THREE.Group(), y = heightAt(n.x, n.z);
    root.position.set(n.x, y, n.z);
    root.rotation.y = n.yaw;
    root.visible = false;
    g.scene.add(root);
    const prop = n.stall ? stall() : n.role === 'board' ? board() : PROPS[n.role]();
    if (n.stall) prop.position.set(0, heightAt(TOWN.vendor.x, TOWN.vendor.z) - y, TOWN.vendor.z - n.z);
    root.add(prop);
    const e = { land, n, root, prop, yaw: 0, spot: spotOf(n) };
    if (n.role !== 'board') {
      e.h = new Humanoid(n.model, { tint: n.tint ?? null, palette: n.palette ?? null });
      if (n.model === 'Ranger') e.h.setMeshVisible('Ranger_Quiver', false);
      if (n.role === 'anvil') e.h.equip('r', 'axe_1handed');
      root.add(e.h.group);
    }
    const top = n.role === 'board' ? 3.95 : 2.75;
    e.label = g.ui.createNpcLabel(n.name, n.title, ROLE_ACTION[n.role], () => this.use(e), (out) => out.set(n.x, y + top, n.z));
    e.label.el.classList.add('hidden');
    return e;
  }

  // The camp of the land we're in (none in dungeons and the arena).
  get here() {
    return this.camps[this.game.places.id] || null;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, p = g.player, ui = g.ui, land = g.places.id;
    if (land !== this.land) { // show this land's camp only
      for (const [l, list] of Object.entries(this.camps)) for (const e of list) { e.root.visible = l === land; e.label.el.classList.toggle('hidden', l !== land); }
      this.land = land;
      this.near = null;
    }
    const here = this.here;
    if (!here) return;
    let best = null, bd = REACH;
    if (p.alive) {
      for (const e of here) {
        const d = Math.hypot(p.pos.x - e.spot.x, p.pos.z - e.spot.z);
        if (d < bd) { bd = d; best = e; }
      }
    }
    this.near = best;
    for (const e of here) e.label.el.classList.toggle('near', e === best && this.open !== e);
    if (this.open) {
      const d = Math.hypot(p.pos.x - this.open.spot.x, p.pos.z - this.open.spot.z);
      if (d > LEAVE || !ui.invOpen) this.close();
    }
    for (const e of here) {
      if (e.h) { // they watch you when you're close (never turning their back on the camp)
        const dx = p.pos.x - e.n.x, dz = p.pos.z - e.n.z;
        const want = Math.hypot(dx, dz) < 8 ? clamp(angleDiff(e.n.yaw, yawTo(dx, dz)), -1.1, 1.1) : 0;
        e.yaw = dampAngle(e.yaw, want, 4, dt);
        e.h.group.rotation.y = e.yaw;
        e.h.update(dt);
      }
      const hinge = e.prop.userData.hinge;
      if (hinge) {
        e.lid = (e.lid || 0) + ((this.open === e ? 1 : 0) - (e.lid || 0)) * (1 - Math.exp(-8 * dt));
        hinge.rotation.x = -1.85 * e.lid;
      }
      const marker = e.prop.userData.marker;
      if (marker) {
        marker.visible = g.quests.markerVisible(e.land);
        if (marker.visible) {
          this.markerT = (this.markerT || 0) + dt;
          marker.rotation.y = this.markerT * 1.6;
          marker.position.y = 3.0 + Math.sin(this.markerT * 2.4) * 0.12;
        }
      }
    }
  }

  interact() {
    if (this.near) this.use(this.near);
  }

  use(e) {
    if (this.near !== e) return;
    const g = this.game, n = e.n;
    this.open = e;
    g.ui.openInventory(n.role === 'board' ? 'board' : n.role === 'bank' ? 'bank' : n.role === 'anvil' ? 'anvil' : 'shop', e);
    if (n.role === 'board') { g.sfx.play('page'); return; }
    if (n.role === 'bank') g.sfx.play('chest');
    e.h?.anim.play('Interact', { timeScale: 1.2 });
    if (performance.now() - this.lastGreet > 5000) { // (don't stack greetings)
      this.lastGreet = performance.now();
      g.ui.floater(new THREE.Vector3(n.x, heightAt(n.x, n.z) + 3.1, n.z), pick(GREET[n.role]), 'say');
    }
  }

  close() {
    this.open = null;
  }

  // ---------------------------------------------------------------- shops
  capOf(e) {
    return SHOP_CAP[e.land] ?? 10;
  }

  // What a merchant sells to this hero: { item (a sample), price }.
  stock(e) {
    const p = this.game.player, role = e.n.role, cap = this.capOf(e);
    let defs;
    if (role === 'weapons') defs = Object.values(ITEMS).filter((d) => (d.kind === 'weapon' || d.kind === 'offhand') && !d.unique && d.classes?.includes(p.cls) && d.level <= cap);
    else if (role === 'armor') defs = Object.values(ITEMS).filter((d) => d.kind === 'armor' && d.classes?.includes(p.cls) && d.level <= cap);
    else if (role === 'goods') defs = Object.values(ITEMS).filter((d) => d.kind === 'potion' || d.kind === 'elixir' || d.kind === 'scroll');
    else if (role === 'anvil') defs = Object.values(ITEMS).filter((d) => d.kind === 'recipe');
    else defs = [];
    const order = { weapon: 0, offhand: 1, head: 2, body: 3, hands: 4, feet: 5 };
    defs.sort((a, b) => a.level - b.level || (order[a.kind] ?? order[a.slot] ?? 0) - (order[b.kind] ?? order[b.slot] ?? 0) || a.price - b.price || a.name.localeCompare(b.name));
    return defs.map((d) => ({ item: makeItem(d.key), price: d.price }));
  }

  buy(key, n = 1) {
    const g = this.game, p = g.player, d = ITEMS[key];
    if (!d) return false;
    n = d.stack ? clamp(n, 1, d.stack) : 1;
    const price = d.price * n;
    if (p.gold < price) { g.ui.centerMsg('Not enough gold'); return false; }
    const it = makeItem(key, d.stack ? { n } : {});
    if (!p.addItem(it, true)) { g.ui.centerMsg('Your bag is full'); g.ui.refreshInventory(); return false; }
    p.gold -= price;
    this.done(`Bought <b style="color:${itemColor(it)}">${d.stack ? `${n} × ${d.name}` : itemName(it)}</b> for ${price}g`);
    return true;
  }

  // Everything sold (here or out in the woods) can be bought back for what it sold for.
  addBuyback(item, price) {
    this.buyback.unshift({ item, price });
    this.buyback.length = Math.min(this.buyback.length, BUYBACK);
  }

  buyBack(i) {
    const g = this.game, p = g.player, entry = this.buyback[i];
    if (!entry) return;
    if (p.gold < entry.price) { g.ui.centerMsg('Not enough gold'); return; }
    if (!p.addItem(entry.item, true)) { g.ui.centerMsg('Your bag is full'); return; }
    p.gold -= entry.price;
    this.buyback.splice(i, 1);
    this.done(`Bought back ${itemName(entry.item)}`);
  }

  done(msg) {
    const g = this.game;
    g.sfx.play('gold');
    if (msg) g.ui.log(msg, 'gold');
    g.ui.refreshInventory();
    g.save();
  }

  // ---------------------------------------------------------------- the anvil
  upgrade(where, index) {
    const g = this.game, p = g.player;
    const it = where === 'eq' ? p.equipment[index] : p.bag[index];
    if (!it || itemDef(it)?.stack) return;
    if (p.upgrade(it)) {
      g.sfx.play('bash');
      g.sfx.play('quest');
      const e = this.open;
      if (e) {
        const at = new THREE.Vector3(e.n.x + Math.sin(e.n.yaw) * 0.9, heightAt(e.n.x, e.n.z) + 0.8, e.n.z + Math.cos(e.n.yaw) * 0.9);
        g.fx.sparks(at, 0xffc060, 40, 6);
        g.fx.burst(at, 0xff8a2a, 30, 3);
        e.h?.startSwing(0.5, 'chop');
      }
      g.ui.log(`Upgraded to <b style="color:${itemColor(it)}">${itemName(it)}</b>`, 'lvl');
      g.quests.onEvent('upgrade', { plus: it.p });
      g.ui.refreshInventory();
      g.save();
    }
  }
}

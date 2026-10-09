// The player's hero: its class and look, stats (from its level, items, skill points and buffs), its bag and
// what it wears, leveling, skills, potions, combos, and moving about (control.js decides where it goes and
// what it attacks).
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { heightAt, resolveCollision } from './world.js';
import {
  ITEMS, WEAPON_TYPES, SLOTS, emptyEquipment, itemDef, itemStats, makeItem, slotsFor, cannotUse, sellPrice, newId,
  itemName, itemColor, maxPlus, upgradeCost,
} from './items.js';
import { dampAngle, yawTo, rand, has, clamp } from './util.js';
import { CLASSES, lookOf as classLook } from './classes.js';
import { SKILLS, TREES, BUFFS, power, manaCost, auraTick } from './skills.js';
import { ATTRS, K as AK, ATTR_PER_LEVEL, attrPoints } from './attributes.js';
import { aimedAt, handPos } from './skills/common.js';
import { Control } from './control.js';
import { hdr } from './fx.js';

export const MAX_LEVEL = 80;
// XP to the next level. Quick up to level 10; after that each level asks for more kills of your own level:
// about 16 at level 10, 50 at 20, 80 at 30, 130 at 40, 190 at 50 and 240 at 59. Past 58 there are no
// monsters of your level outside the caves (sim/caves.js): a cave a day is the way up.
export const xpForLevel = (lvl) => Math.round(55 * Math.pow(lvl, 1.55) * (1 + 0.1 * Math.max(0, lvl - 9)));
export const BAG_SIZE = 30;
export const BAR_SIZE = 8; // skill slots on the action bar (keys 1–8)
export const POTION_CD = 1.5;
const LUNGE = 1.4, LUNGE_SPEED = 5.5; // m a melee blow may carry the hero toward its foe, and how fast
const _axis = new THREE.Vector2();
const r2 = (v) => Math.round(v * 100) / 100;
const _ember = new THREE.Vector3();

const freshQuests = () => ({ done: [], active: [] }); // see quests.js
const freshSkills = () => ({ pts: {}, bar: new Array(BAR_SIZE).fill(null) });
const freshAttrs = () => Object.fromEntries(ATTRS.map((k) => [k, 0])); // points spent on each

// The basic attack's combo: a press that lands in the window after a blow (from COMBO_OPEN of the swing to a
// moment after it ends) chains into the next, stronger blow and cuts the rest of the swing short. Too early
// (mashing) breaks the chain. A press right as the window opens is perfect.
export const COMBO = { open: 0.8, grace: 0.32, perfect: 0.12, mults: [1, 1.04, 1.08, 1.2], perfectBonus: 0.05, tooEarly: 0.12 };

// ---------------------------------------------------------------- how a hero looks
// Clothes and weapons on the model: weapons in the hands, a helmet shows the look's hat, armor colours the
// body (and from middle class shows the cape), gloves and boots tint hands and feet. eq: slot -> item.
export function applyEquipmentVisuals(h, eq, cls, look = 0) {
  // (upgrades show from +8: enchant.js; a unique item has its own glow at any level)
  const L = classLook(cls, look), glowOf = (it) => { const d = itemDef(it); return d?.unique || d?.tier === 'rare' ? d.glow ?? null : null; };
  const wd = itemDef(eq.weapon), od = itemDef(eq.offhand), middle = (d) => d?.type === 'shield' || d?.type === 'book' || d?.type === 'bow';
  const leftBow = wd && WEAPON_TYPES[wd.type]?.left;
  h.equip(leftBow ? 'l' : 'r', wd ? wd.model : null, glowOf(eq.weapon), wd?.tint ?? null, eq.weapon?.p ?? 0, middle(wd));
  if (leftBow) h.equip('r', null);
  else h.equip('l', od ? od.model : null, glowOf(eq.offhand), od?.tint ?? null, eq.offhand?.p ?? 0, middle(od));
  const head = itemDef(eq.head), body = itemDef(eq.body);
  const shown = new Set();
  if (head?.look?.helm !== 0 && head) {
    for (const part of L.hats) if (part.endsWith('Visor') ? head.tier !== 'low' : true) shown.add(part);
  }
  for (const part of L.hats) h.setMeshVisible(part, shown.has(part));
  for (const part of L.capes) h.setMeshVisible(part, !!body && body.tier !== 'low');
  h.setBodyTint(body?.look?.body ?? null);
  h.enableGearTint();
  const gearOf = (d, cover) => (d ? { color: d.look?.body ?? 0x8a6a4a, metal: d.look?.metal ?? 0.1, rough: d.look?.metal > 0.2 ? 0.4 : 0.8, cover, glow: 0 } : null);
  h.setGear('hands', gearOf(itemDef(eq.hands), { hand: 1, lowerarm: 0.8 }));
  h.setGear('feet', gearOf(itemDef(eq.feet), { foot: 1, toes: 1, lowerleg: 0.9 }));
}

// What the other players' games need to draw this hero: its level, look and what it wears that shows
// (items by name; their games know them all).
export function lookOf(p) {
  const eq = p.equipment, k = { lv: p.level, m: p.look };
  const put = (key, it) => { if (it) k[key] = it.p ? [it.k, it.p] : it.k; };
  put('w', eq.weapon); put('o', eq.offhand); put('h', eq.head); put('b', eq.body); put('g', eq.hands); put('f', eq.feet);
  return k;
}

// …and back, for a hero someone else plays. Looks come from other games, so anything unknown is left off.
export function equipmentFromLook(k) {
  const eq = emptyEquipment();
  if (!k || typeof k !== 'object') return eq;
  const item = (v, slots) => {
    const [key, plus] = Array.isArray(v) ? v : [v, 1];
    if (typeof key !== 'string' || !has(ITEMS, key) || !slots.includes(ITEMS[key].slot) || ITEMS[key].stack) return null;
    return { k: key, p: clamp(Number(plus) || 0, 0, maxPlus(ITEMS[key])) };
  };
  eq.weapon = item(k.w, ['weapon']);
  eq.offhand = item(k.o, ['offhand', 'weapon']);
  eq.head = item(k.h, ['head']);
  eq.body = item(k.b, ['body']);
  eq.hands = item(k.g, ['hands']);
  eq.feet = item(k.f, ['feet']);
  return eq;
}

// A magic bolt from a staff, for our hero (real: it deals damage) or for show. target: the foe it homes on.
export function boltAction(a, point, real, target = null) {
  const g = a.game;
  a.h.anim.play('Throw', { timeScale: 2.6, startAt: 0.25 });
  if (a.vol() > 0.01) g.sfx.play('bolt', 0.8 * a.vol());
  return {
    fired: false,
    tick: (dt, s) => {
      if (s.fired || s.t < 0.15) return;
      s.fired = true;
      const from = handPos(a);
      g.projectiles.spawn({ from, to: aimedAt(a, from, point), homing: target, owner: real ? 'player' : 'remote', mult: s.mult ?? 1, spell: true, speed: 22, color: 0x9a7dff, trail: 0x5a3aff, radius: 0.35, range: 16, size: 0.2, small: true, glide: 0.9, combo: s.combo });
    },
    end: () => a.h.anim.stopOne(),
  };
}

// An arrow from a bow (the basic attack of archers), for our hero or for show: the bow comes up and the string
// is drawn (character.js SWINGS.bow), loosed a moment later (at most a third of a second), with a twang.
export function arrowAction(a, point, real, target = null, dur = 0.6) {
  const g = a.game, release = Math.min(0.32, dur * 0.5);
  a.h.startSwing(release * 2, 'bow');
  return {
    fired: false,
    tick: (dt, s) => {
      if (s.fired || s.t < release) return;
      s.fired = true;
      const from = handPos(a, true);
      g.projectiles.spawn({ from, to: aimedAt(a, from, point), homing: target, owner: real ? 'player' : 'remote', mult: s.mult ?? 1, spell: false, speed: 34, color: 0xfff0d0, trail: 0xc8a070, feather: 0xd84a3a, radius: 0.32, range: 18, size: 0.14, small: true, noLight: true, glide: 1.0, arrow: true, combo: s.combo });
      if (a.vol() > 0.01) g.sfx.play('bow', a.vol());
    },
  };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.look = 0;
    this.setClass('warrior', 0);
    this.radius = 0.5;
    this.yaw = Math.PI;
    this.targetYaw = this.yaw;
    this.control = new Control(game, this);
    this.reset();
  }

  // Wear the class's model in its look (swapping it in the scene if one is already there).
  setClass(cls, look = 0) {
    this.cls = CLASSES[cls] ? cls : 'warrior';
    this.look = look;
    const L = classLook(this.cls, look), key = `${L.model}:${L.palette || ''}`;
    if (this.h && this.modelKey === key) return;
    const old = this.h;
    this.modelKey = key;
    this.h = new Humanoid(L.model, { palette: L.palette || null });
    this.group = this.h.group;
    this.pos = this.group.position;
    if (old) {
      this.group.position.copy(old.group.position);
      this.group.rotation.y = old.group.rotation.y;
      this.game.scene.remove(old.group);
      this.game.scene.add(this.group);
    }
  }

  // A brand-new character: level 1, nothing in the bag (see starterKit).
  reset() {
    this.level = 1;
    this.xp = 0;
    this.gold = 0;
    this.bag = new Array(BAG_SIZE).fill(null);
    this.equipment = emptyEquipment();
    this.quests = freshQuests();
    this.sk = freshSkills();
    this.attr = freshAttrs();
    this.cave = { day: 0 }; // the day (caves.js dayNumber) of the last cave run
    this.cd = { attack: 0, potion: 0 };
    this.buffs = {}; // id -> { t: seconds left, v: strength } (skills.js BUFFS)
    this.stunT = 0; // another hero's skill in the arena, or a monster's: stunned (can't act) / slowed
    this.slowT = 0;
    this.slowBy = 1;
    this.auras = {}; // their looks, the same for every hero (skills.js auraTick)
    this.action = null;
    this.queued = null;
    this.combo = { step: 0, until: 0, open: 0, perfectUntil: 0, swings: 0 };
    this.alive = true;
    this.stepT = 0;
    this.channel = null; // reading a camp scroll
    this.sureCrit = false;
    this.hp = undefined;
    this.control?.reset();
    this.recompute();
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  // A new hero's things: its class's first weapon and clothes, some potions and a scroll home.
  starterKit() {
    const c = CLASSES[this.cls];
    for (const key of c.start) {
      const it = makeItem(key), d = itemDef(it);
      const slot = d.slot === 'weapon' && this.equipment.weapon ? 'offhand' : d.slot;
      this.equipment[slot] = it;
    }
    this.addItem(makeItem('hp_potion_1', { n: 5 }), true);
    this.addItem(makeItem('mp_potion_1', { n: 3 }), true);
    this.addItem(makeItem('camp_scroll', { n: 1 }), true);
    this.gold = 30;
    this.onGearChanged(false);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  serialize() {
    const buffs = {};
    for (const [id, b] of Object.entries(this.buffs)) if (BUFFS[id]?.long && b.t > 5) buffs[id] = [Math.round(b.t), r2(b.v)];
    return {
      v: 2, level: this.level, xp: this.xp, gold: this.gold, bag: this.bag, equipment: this.equipment,
      quests: this.quests, sk: this.sk, attr: this.attr, cave: this.cave, buffs,
    };
  }

  load(s) {
    if (!s || (s.v || 1) < 2) return this.loadOld(s || {});
    this.level = clamp(Math.round(s.level || 1), 1, MAX_LEVEL);
    this.xp = Math.max(0, s.xp || 0);
    this.gold = Math.max(0, Math.round(s.gold || 0));
    const valid = (it) => (it && typeof it === 'object' && has(ITEMS, it.k) ? it : null);
    this.bag = Array.from({ length: BAG_SIZE }, (_, i) => valid(s.bag?.[i]));
    this.compactStacks();
    this.equipment = emptyEquipment();
    for (const slot of SLOTS) this.equipment[slot] = valid(s.equipment?.[slot]);
    this.quests = Array.isArray(s.quests?.done) ? s.quests : freshQuests();
    this.sk = { pts: {}, bar: new Array(BAR_SIZE).fill(null) };
    const trees = TREES[this.cls];
    for (const t of trees) this.sk.pts[t.id] = clamp(Math.round(s.sk?.pts?.[t.id] || 0), 0, MAX_LEVEL);
    if (this.spentPoints() > this.level) this.sk.pts = {}; // (shouldn't happen: start over)
    for (let i = 0; i < BAR_SIZE; i++) { const id = s.sk?.bar?.[i]; this.sk.bar[i] = has(SKILLS, id) && SKILLS[id].cls === this.cls ? id : null; }
    this.attr = freshAttrs();
    for (const k of ATTRS) this.attr[k] = clamp(Math.round(Number(s.attr?.[k]) || 0), 0, attrPoints(MAX_LEVEL));
    if (this.spentAttr() > attrPoints(this.level)) this.attr = freshAttrs(); // (shouldn't happen: start over)
    // a hero from before attributes, or from the four of the first days: every point free again (game.js explains)
    if ((!s.attr || 'vit' in s.attr || 'dex' in s.attr) && this.level > 1) { this.attr = freshAttrs(); this.newAttrs = s.attr ? 'changed' : 'new'; }
    this.cave = { day: Math.max(0, Math.round(Number(s.cave?.day) || 0)) };
    this.buffs = {};
    for (const [id, b] of Object.entries(s.buffs || {})) if (BUFFS[id]?.long && Array.isArray(b)) this.buffs[id] = { t: clamp(Number(b[0]) || 0, 0, BUFFS[id].dur), v: Number(b[1]) || 0 };
    this.onGearChanged(false);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  // A hero from before the four classes and fixed items: its level, XP and gold stay; its old random items are
  // sold for it (their value, three times over, goes into its purse), and it gets its class's things for its
  // level, as if bought, so it can play on at once. Skill points are all free to spend.
  loadOld(s) {
    this.level = clamp(Math.round(s.level || 1), 1, MAX_LEVEL);
    this.xp = Math.max(0, s.xp || 0);
    const old = [...(s.bag || []), ...Object.values(s.equipment || {}), ...(s.stash || [])].filter((x) => x && typeof x === 'object');
    this.gold = Math.max(0, Math.round(s.gold || 0)) + old.reduce((sum, it) => sum + Math.max(0, Number(it.value) || 0) * 3, 0);
    this.bag = new Array(BAG_SIZE).fill(null);
    this.equipment = emptyEquipment();
    this.quests = freshQuests();
    this.sk = freshSkills();
    this.attr = freshAttrs();
    this.buffs = {};
    this.kitForLevel();
    this.addItem(makeItem(this.level >= 35 ? 'hp_potion_3' : this.level >= 15 ? 'hp_potion_2' : 'hp_potion_1', { n: Math.max(5, Math.min(30, (s.potions || 0) + 5)) }), true);
    this.addItem(makeItem(this.level >= 35 ? 'mp_potion_3' : this.level >= 15 ? 'mp_potion_2' : 'mp_potion_1', { n: 8 }), true);
    this.addItem(makeItem('camp_scroll', { n: 3 }), true);
    this.migrated = old.length;
    this.onGearChanged(false);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  // The best weapon and clothes of its class a merchant would sell a hero of this level (old heroes get them).
  kitForLevel() {
    const c = CLASSES[this.cls], best = (pred) => Object.values(ITEMS).filter((d) => !d.unique && !d.stack && d.level <= this.level && d.classes?.includes(this.cls) && pred(d)).sort((a, b) => b.level - a.level)[0];
    for (const key of c.start) {
      const first = ITEMS[key];
      const d = best((x) => x.kind === first.kind && (x.kind === 'armor' ? true : x.type === first.type)) || first;
      if (d.kind === 'armor') for (const slot of ['head', 'body', 'hands', 'feet']) this.equipment[slot] = makeItem(`${d.set}_${slot}`);
      else this.equipment[d.slot === 'weapon' && this.equipment.weapon ? 'offhand' : d.slot] = makeItem(d.key);
    }
  }

  // ---------------------------------------------------------------- stats
  // The class's attributes, the points spent and what the gear gives (attributes.js says what they do), plus
  // the weapon's damage and speed, the clothes' armor, the trees' bonuses and timed boosts.
  recompute() {
    const L = this.level, c = CLASSES[this.cls], eq = this.equipment;
    const s = {
      armor: L * 1.5, levelDmg: L * 0.9, dmgMin: 2, dmgMax: 4, speed: 1.3,
      dmgPct: 0, dmgMult: c.dmg, atkSpd: c.atkSpd, moveSpd: c.moveSpd, crit: 0.05 + c.crit,
      regen: 1 + L * 0.15, mpRegen: 0.75 * (1 + L * 0.12) * Math.sqrt(c.mp), evade: 0, reach: 0, ranged: null, weapon: null,
      hpPct: 0, armorPct: 0, mpRegenPct: 0, spellPct: 0, dotPct: 0, healPct: 0, typePct: 0, taken: 1,
    };
    const A = {};
    for (const k of ATTRS) A[k] = (c.attrs?.[k] || 0) + (this.attr?.[k] || 0);
    // weapons: the main hand's damage and speed; a second one-handed weapon adds an eighth of its damage
    const w = itemDef(eq.weapon);
    if (w) {
      const ws = itemStats(eq.weapon), t = WEAPON_TYPES[w.type];
      s.dmgMin = ws.dmgMin; s.dmgMax = ws.dmgMax; s.speed = ws.speed;
      s.reach = t.reach || 0; s.ranged = t.ranged || null; s.weapon = w.type; s.hands = t.hands; s.swing = t.swing;
    }
    const off = itemDef(eq.offhand);
    this.dualWield = !!(off && off.kind === 'weapon');
    if (this.dualWield) {
      const os = itemStats(eq.offhand);
      s.dmgMin += Math.round(os.dmgMin * 0.12);
      s.dmgMax += Math.round(os.dmgMax * 0.12);
    }
    // everything worn: armor and attributes (the weapons' damage is counted above)
    for (const slot of SLOTS) {
      const it = eq[slot];
      if (!it) continue;
      const st = itemStats(it);
      s.armor += st.armor || 0;
      for (const k of ATTRS) A[k] += st[k] || 0;
    }
    // what the points in each tree add
    for (const tree of TREES[this.cls]) {
      const n = this.sk.pts[tree.id] || 0;
      if (!n) continue;
      for (const [k, v] of Object.entries(tree.passive)) {
        if (k === 'daggerPct') { if (s.weapon === 'dagger') s.typePct += v * n; }
        else if (k === 'bowPct') { if (s.weapon === 'bow') s.typePct += v * n; }
        else if (k === 'bowSpd') { if (s.weapon === 'bow') s.atkSpd += v * n; }
        else s[k] = (s[k] || 0) + v * n;
      }
    }
    // timed boosts (skills, tonics, elixirs)
    for (const [id, b] of Object.entries(this.buffs || {})) {
      const def = BUFFS[id];
      if (!def) continue;
      for (const k of ['armorPct', 'hpPct', 'dmgPct', 'atkSpd', 'moveSpd', 'crit']) if (def[k]) s[k] += def[k](b.v);
      if (def.evade) s.evade = Math.max(s.evade, def.evade(b.v));
      if (def.taken) s.taken *= def.taken(b.v);
    }
    // the attributes (the class's primary one powers its weapon blows)
    s.attrs = A;
    const auto = AK.auto * (L - 1), phys = A[c.primary] || 0;
    s.maxHp = Math.round((40 + 16 * L + A.str * AK.strHp) * c.hp * (1 + s.hpPct));
    s.maxMp = Math.round((40 + 6 * L + A.int * AK.intMp) * c.mp);
    s.armor = Math.round((s.armor + A.agi * AK.agiArmor) * c.armor * (1 + s.armorPct));
    s.regen += A.str * AK.strRegen;
    s.mpRegen *= 1 + s.mpRegenPct;
    s.atkSpd += A.agi * AK.agiSpd;
    s.evade = Math.min(0.6, s.evade);
    s.atkSpeed = s.speed * (1 + s.atkSpd);
    s.moveSpeed = 5.6 * (1 + Math.min(0.6, s.moveSpd));
    // a blow: the weapon's damage and the level's share, times weapon damage (Strength) or spell damage (Intelligence)
    s.baseLo = s.dmgMin + s.levelDmg;
    s.baseHi = s.dmgMax + s.levelDmg;
    s.physMul = (1 + auto + phys * AK.prim + s.dmgPct + s.typePct) * s.dmgMult;
    s.spellMul = (1 + auto + A.int * AK.int + s.dmgPct) * s.dmgMult * (1 + s.spellPct);
    s.dmgLo = Math.max(1, Math.round(s.baseLo * s.physMul));
    s.dmgHi = Math.max(s.dmgLo + 1, Math.round(s.baseHi * s.physMul));
    s.spellLo = Math.max(1, Math.round(s.baseLo * s.spellMul));
    s.spellHi = Math.max(s.spellLo + 1, Math.round(s.baseHi * s.spellMul));
    s.heal = (1 + s.healPct) * (1 + A.int * AK.intHeal); // heals and tonics
    s.dr = Math.min(0.85, s.armor / (s.armor + 60 + 8 * Math.max(0, L - 10))); // (armor grows with level: so does what it takes)
    s.style = this.styleName();
    this.stats = s;
    if (this.hp !== undefined) {
      this.hp = Math.min(this.hp, s.maxHp);
      this.mp = Math.min(this.mp, s.maxMp);
    }
  }

  // How this hero fights now, by what it holds ("Sword and shield", "Bow"…).
  styleName() {
    const w = itemDef(this.equipment.weapon), o = itemDef(this.equipment.offhand), st = CLASSES[this.cls].styles;
    if (!w) return 'Bare hands';
    switch (this.cls) {
      case 'warrior': return o?.type === 'shield' ? st.guard : o?.kind === 'weapon' ? st.dual : w.hands === 2 ? st.heavy : 'One weapon';
      case 'healer': return w.hands === 2 ? st.heavy : o?.type === 'shield' ? st.guard : 'Mace';
      case 'rogue': return w.type === 'bow' ? st.archer : st.assassin;
      case 'scientist': return w.type === 'staff' ? st.elements : o?.type === 'book' ? st.alchemy : 'Short staff';
      default: return '';
    }
  }

  // One blow (or spell): weapon damage plus the hero's level's share, times weapon damage (Strength) or, for
  // spells, spell damage (Intelligence), times mult. Critical hits do 80% more.
  rollDamage(mult, spell = false, critBonus = 0) {
    const s = this.stats;
    let amount = rand(s.baseLo, s.baseHi) * mult * (spell ? s.spellMul : s.physMul);
    const crit = this.sureCrit || Math.random() < s.crit + critBonus;
    this.sureCrit = false;
    if (crit) amount *= 1.8;
    return { amount: Math.max(1, Math.round(amount)), crit };
  }

  // Damage a second for poisons and burns: mult of an average blow (no crits).
  dotDps(mult, spell = true) {
    const s = this.stats;
    return Math.max(1, Math.round(((s.baseLo + s.baseHi) / 2) * mult * (spell ? s.spellMul : s.physMul) * (1 + s.dotPct)));
  }

  // ---------------------------------------------------------------- the bag
  freeSlot() {
    return this.bag.findIndex((x) => !x);
  }

  // Stacks of a kind join up as far as they can (potions used to stop at 50 a slot).
  compactStacks() {
    for (let i = 0; i < this.bag.length; i++) {
      const it = this.bag[i], d = it && itemDef(it);
      if (!d?.stack) continue;
      for (let j = 0; j < i && this.bag[i]; j++) {
        const into = this.bag[j];
        if (!into || into.k !== it.k || into.n >= d.stack) continue;
        const take = Math.min(it.n, d.stack - into.n);
        into.n += take;
        it.n -= take;
        if (it.n <= 0) this.bag[i] = null;
      }
    }
  }

  // Can this go in the bag (a free slot, or a stack of its kind with room)?
  hasRoomFor(item) {
    const d = itemDef(item);
    if (!d) return false;
    if (this.freeSlot() >= 0) return true;
    return !!d.stack && this.bag.some((it) => it && it.k === item.k && it.n + (item.n || 1) <= d.stack);
  }

  // Put an item in the bag (stackables join a stack of the same kind first). False if there's no room.
  addItem(item, quiet = false) {
    const d = itemDef(item);
    if (!d) return false;
    if (d.stack) {
      let left = item.n || 1;
      for (const it of this.bag) {
        if (!it || it.k !== item.k || it.n >= d.stack) continue;
        const take = Math.min(left, d.stack - it.n);
        it.n += take;
        left -= take;
        if (!left) break;
      }
      while (left > 0) {
        const i = this.freeSlot();
        if (i < 0) { item.n = left; if (!quiet) this.game.ui?.refreshInventory(); return false; }
        const take = Math.min(left, d.stack);
        this.bag[i] = { id: newId(), k: item.k, n: take };
        left -= take;
      }
      if (!quiet) this.game.ui?.refreshInventory();
      return true;
    }
    const i = this.freeSlot();
    if (i < 0) return false;
    this.bag[i] = item;
    if (!quiet) this.game.ui?.refreshInventory();
    return true;
  }

  // How many of a stackable the bag holds; and taking n of them out (false if there aren't that many).
  count(key) {
    return this.bag.reduce((n, it) => n + (it && it.k === key ? it.n || 1 : 0), 0);
  }

  takeOut(key, n = 1) {
    if (this.count(key) < n) return false;
    for (let i = this.bag.length - 1; i >= 0 && n > 0; i--) {
      const it = this.bag[i];
      if (!it || it.k !== key) continue;
      const take = Math.min(n, it.n || 1);
      it.n = (it.n || 1) - take;
      n -= take;
      if (it.n <= 0) this.bag[i] = null;
    }
    return true;
  }

  // Where an item goes when equipped: an empty slot of its kind first (earrings, rings, a second weapon).
  slotFor(item) {
    const slots = slotsFor(item, this.cls), eq = this.equipment, d = itemDef(item);
    if (!slots.length) return null;
    if (d.kind === 'weapon' && slots.includes('offhand')) { // a second weapon only beside another one-hander
      const main = itemDef(eq.weapon);
      if (eq.weapon && main?.hands === 1 && slotsFor(eq.weapon, this.cls).includes('offhand') && !eq.offhand) return 'offhand';
      return 'weapon';
    }
    return slots.find((s) => !eq[s]) || slots[0];
  }

  equipFromBag(i, target = null) {
    const it = this.bag[i], g = this.game;
    if (!it) return;
    const d = itemDef(it);
    if (d.stack) return this.useItem(i);
    const why = cannotUse(it, this.cls, this.level);
    if (why) { g.ui.centerMsg(why); return; }
    const slots = slotsFor(it, this.cls);
    const slot = target && slots.includes(target) ? target : this.slotFor(it);
    if (!slot) return;
    const eq = this.equipment;
    // what else has to come off: the off hand for a two-handed weapon (or a main weapon a second one can't go
    // beside), the two-handed weapon for something in the off hand
    const extra = [];
    if (slot === 'weapon') {
      const off = itemDef(eq.offhand);
      if (d.hands === 2 && eq.offhand) extra.push('offhand');
      else if (off?.kind === 'weapon' && !slotsFor(it, this.cls).includes('offhand')) extra.push('offhand');
    }
    if (slot === 'offhand') {
      const main = itemDef(eq.weapon);
      if (main?.hands === 2) extra.push('weapon');
      if (d.kind === 'weapon' && (!main || main.hands !== 1)) { g.ui.centerMsg('A second weapon goes beside a one-handed one'); return; }
    }
    const prev = eq[slot];
    const freeAfter = this.bag.filter((x) => !x).length + (prev ? 0 : 1);
    if (extra.length > freeAfter) { g.ui.centerMsg('Not enough room in your bag'); return; }
    this.bag[i] = prev || null;
    eq[slot] = it;
    for (const s of extra) {
      this.bag[this.freeSlot()] = eq[s];
      eq[s] = null;
    }
    g.sfx.play('equip');
    this.onGearChanged();
  }

  unequip(slot) {
    const it = this.equipment[slot];
    if (!it) return;
    const i = this.freeSlot();
    if (i < 0) { this.game.ui.centerMsg('Your bag is full'); return; }
    this.bag[i] = it;
    this.equipment[slot] = null;
    // without a main weapon, a second one moves over to the main hand
    if (slot === 'weapon' && itemDef(this.equipment.offhand)?.kind === 'weapon') {
      this.equipment.weapon = this.equipment.offhand;
      this.equipment.offhand = null;
    }
    this.game.sfx.play('equip');
    this.onGearChanged();
  }

  // Use a potion, elixir or scroll from the bag.
  useItem(i) {
    const it = this.bag[i], d = itemDef(it), g = this.game;
    if (!d?.stack || !this.alive) return;
    if (this.level < d.level) { g.ui.centerMsg(`Needs level ${d.level}`); return; }
    if (d.kind === 'potion') this.drink(d.key);
    else if (d.kind === 'elixir') {
      if (!this.takeOut(d.key)) return;
      this.addBuff(d.buff, 1);
      g.fx.heal(this.pos);
      g.sfx.play('drink');
      g.ui.log(`${d.name}: ${d.desc}`, 'xp');
      g.link.act({ k: 'dr' });
      g.ui.refreshInventory();
      g.save();
    } else if (d.kind === 'scroll') this.readCampScroll();
    else if (d.kind === 'recipe') g.ui.centerMsg('Take it to the anvil in Emberwood camp');
    else if (d.kind === 'key') g.keyHint(d);
  }

  // Drink a potion: the given one, or the strongest of its kind (hp | mp) the hero can use.
  drink(keyOrUse) {
    const g = this.game;
    if (!this.alive || this.cd.potion > 0 || this.stunT > 0) return;
    let key = keyOrUse;
    if (keyOrUse === 'hp' || keyOrUse === 'mp') {
      key = [3, 2, 1].map((n) => `${keyOrUse}_potion_${n}`).find((k) => this.count(k) && ITEMS[k].level <= this.level);
      if (!key) { g.ui.centerMsg(`No ${keyOrUse === 'hp' ? 'healing' : 'mana'} potions: the provisioner in camp sells them`); return; }
    }
    const d = ITEMS[key];
    if (d.use === 'hp' && this.hp >= this.stats.maxHp) { g.ui.centerMsg('Already at full Life'); return; }
    if (d.use === 'mp' && this.mp >= this.stats.maxMp) { g.ui.centerMsg('Already at full Mana'); return; }
    if (!this.takeOut(key)) return;
    this.cd.potion = POTION_CD;
    if (d.use === 'hp') this.heal(Math.round(this.stats.maxHp * d.amount));
    else {
      this.mp = Math.min(this.stats.maxMp, this.mp + this.stats.maxMp * d.amount);
      g.fx.add.emit({ pos: this.pos, count: 30, spread: 0.6, velSpread: 0.6, vel: { x: 0, y: 2.4, z: 0 }, color: hdr(0x6aa0ff, 2), colorEnd: hdr(0x2a50ff, 0.3), size: 0.2, sizeEnd: 0.04, life: 1, drag: 1.2, flat: true });
    }
    g.sfx.play('drink');
    g.link.act({ k: 'dr' });
    g.ui.refreshInventory();
    g.save();
  }

  // A camp scroll: three seconds of reading (a blow breaks it), then off to this land's camp.
  readCampScroll() {
    const g = this.game, map = g.places.map;
    if (map.kind === 'arena') { g.ui.centerMsg('The scroll will not work in the arena'); return; }
    if (this.channel) return;
    if (!this.count('camp_scroll')) return;
    this.channel = { t: 0, dur: 3, kind: 'scroll' };
    this.action = null;
    this.h.anim.play('Interact', { timeScale: 0.5 });
    g.ui.channel('Reading the camp scroll…', 3);
    g.sfx.play('page');
  }

  breakChannel() {
    if (!this.channel) return;
    this.channel = null;
    this.h.anim.stopOne();
    this.game.ui.channel(null);
    this.game.ui.centerMsg('Interrupted');
  }

  // Sold (the bag's sell mode: ui.sellPicked); quiet: the caller says it and saves, for several at once.
  sell(i, quiet = false) {
    const it = this.bag[i], g = this.game;
    if (!it) return 0;
    const value = sellPrice(it);
    this.bag[i] = null;
    this.gold += value;
    g.npcs?.addBuyback(it, value);
    if (quiet) return value;
    g.sfx.play('gold');
    g.ui.log(`Sold <b style="color:${itemColor(it)}">${itemName(it)}${it.n > 1 ? ` ×${it.n}` : ''}</b> for <b>${value}g</b>`, 'gold');
    g.ui.refreshInventory();
    g.save();
    return value;
  }

  // Bag slot `from` to `to` (dragged): into an empty slot, onto a stack of its kind (as much as fits), or
  // the two swap places.
  moveItem(from, to) {
    const a = this.bag[from], b = this.bag[to];
    if (!a || from === to) return false;
    const d = itemDef(a);
    if (b && d.stack && b.k === a.k && b.n < d.stack) {
      const take = Math.min(a.n, d.stack - b.n);
      b.n += take;
      a.n -= take;
      if (a.n <= 0) this.bag[from] = null;
    } else {
      this.bag[from] = b;
      this.bag[to] = a;
    }
    this.game.ui.refreshInventory();
    this.game.save();
    return true;
  }

  onGearChanged(save = true) {
    const hpFrac = this.hp !== undefined ? this.hp / this.stats.maxHp : 1;
    this.recompute();
    if (this.hp !== undefined) this.hp = Math.min(this.stats.maxHp, Math.max(this.hp, hpFrac * this.stats.maxHp));
    applyEquipmentVisuals(this.h, this.equipment, this.cls, this.look);
    this.game.ui?.refreshInventory();
    this.game.ui?.refreshSkills?.();
    this.game.doll?.setEquipment(this.equipment, this.cls, this.look);
    this.game.link?.lookChanged();
    if (save) this.game.save();
  }

  // The anvil: one step up for a worn or carried item, if the hero has the recipes and the fee.
  upgrade(item) {
    const g = this.game, cost = upgradeCost(item);
    if (!cost) return false;
    if (this.count(cost.recipe) < cost.recipes) { g.ui.centerMsg(`Needs ${cost.recipes} ${ITEMS[cost.recipe].name}${cost.recipes > 1 ? 's' : ''}`); return false; }
    if (this.gold < cost.gold) { g.ui.centerMsg('Not enough gold'); return false; }
    this.takeOut(cost.recipe, cost.recipes);
    this.gold -= cost.gold;
    item.p = (item.p ?? 0) + 1;
    this.onGearChanged();
    return true;
  }

  // ---------------------------------------------------------------- levels and skill points
  gainXp(n) {
    if (this.level >= MAX_LEVEL) { this.xp = 0; return; } // (the top, for now)
    this.xp += n;
    let leveled = false;
    while (this.level < MAX_LEVEL && this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      leveled = true;
      if (this.level >= MAX_LEVEL) this.xp = 0;
      this.game.ui.log(`<b>Level ${this.level}!</b> ${ATTR_PER_LEVEL} attribute points (<b>I</b>: character) and a skill point (<b>K</b>: skills).`, 'lvl');
    }
    if (leveled) {
      this.recompute();
      this.hp = this.stats.maxHp;
      this.mp = this.stats.maxMp;
      this.game.fx.levelUp(this.pos);
      this.game.sfx.play('levelup');
      this.game.ui.floater(this.headPos(), `Level ${this.level}`, 'info');
      this.game.ui.refreshSkills?.();
      this.game.quests?.onLevel();
      this.game.checkKeys?.(); // (a cave key for a land outgrown crumbles)
      this.game.link?.act({ k: 'lv' });
      this.game.link?.lookChanged();
      this.game.save();
    }
  }

  spentPoints() {
    return Object.values(this.sk.pts).reduce((a, b) => a + b, 0);
  }

  get freePoints() {
    return Math.max(0, this.level - this.spentPoints());
  }

  treePoints(treeId) {
    return this.sk.pts[treeId] || 0;
  }

  skillOpen(id) {
    const sk = SKILLS[id];
    return !!sk && sk.cls === this.cls && this.treePoints(sk.tree) >= sk.unlock;
  }

  skillPower(id) {
    return power(this.treePoints(SKILLS[id].tree));
  }

  // Why a skill can't be used with what the hero holds now (null if it can).
  skillBlocked(id) {
    const need = SKILLS[id].needs, s = this.stats, off = itemDef(this.equipment.offhand);
    if (!need) return null;
    if (need === 'shield' && off?.type !== 'shield') return 'Needs a shield';
    if (need === 'book' && off?.type !== 'book') return 'Needs a book in the off hand';
    if (need === 'staff' && s.weapon !== 'staff') return 'Needs a long staff';
    if (need === 'bow' && s.weapon !== 'bow') return 'Needs a bow';
    if (need === 'dagger' && s.weapon !== 'dagger') return 'Needs a dagger';
    if (need === 'twohand' && (s.hands !== 2 || s.ranged)) return 'Needs a two-handed weapon';
    if (need === 'melee' && (!s.weapon || s.ranged)) return 'Needs a melee weapon';
    return null;
  }

  // One point into a tree; skills it opens go on the bar's free slots.
  learn(treeId) {
    if (!this.freePoints || !TREES[this.cls].some((t) => t.id === treeId)) return false;
    const before = new Set(TREES[this.cls].flatMap((t) => t.skills).filter((id) => this.skillOpen(id)));
    this.sk.pts[treeId] = this.treePoints(treeId) + 1;
    for (const id of TREES[this.cls].find((t) => t.id === treeId).skills) {
      if (!this.skillOpen(id) || before.has(id) || this.sk.bar.includes(id)) continue;
      const free = this.sk.bar.indexOf(null);
      if (free >= 0) this.sk.bar[free] = id;
      this.game.ui?.log(`New skill: <b>${SKILLS[id].name}</b>`, 'lvl');
    }
    this.recompute();
    this.game.ui?.buildActionBar();
    this.game.save();
    return true;
  }

  // Take every point back (for a fee: the skill window says how much).
  resetSkills() {
    const g = this.game, fee = this.respecFee();
    if (this.gold < fee) { g.ui.centerMsg('Not enough gold'); return false; }
    this.gold -= fee;
    this.sk = freshSkills();
    this.recompute();
    g.ui.buildActionBar();
    g.ui.refreshInventory();
    g.save();
    return true;
  }

  respecFee() {
    return this.level < 10 ? 0 : Math.round(this.level * this.level * 4 / 10) * 10;
  }

  // ---------------------------------------------------------------- attribute points (attributes.js)
  spentAttr() {
    return ATTRS.reduce((n, k) => n + (this.attr[k] || 0), 0);
  }

  get freeAttr() {
    return Math.max(0, attrPoints(this.level) - this.spentAttr());
  }

  // n points into attribute k (as many as are free).
  addAttr(k, n = 1) {
    n = Math.min(n, this.freeAttr);
    if (!ATTRS.includes(k) || n <= 0) return false;
    this.attr[k] += n;
    this.onAttrsChanged();
    return true;
  }

  // The free points the way the class usually spends them (CLASSES[cls].suggest), whole levels at a time.
  suggestAttrs() {
    const mix = CLASSES[this.cls].suggest, total = Object.values(mix).reduce((a, b) => a + b, 0);
    let free = this.freeAttr;
    if (!free) return false;
    const keys = Object.keys(mix);
    for (let i = 0; free > 0; i = (i + 1) % keys.length) { // round and round, by the mix's shares
      const k = keys[i], take = Math.min(free, Math.max(1, Math.round((mix[k] * ATTR_PER_LEVEL) / total)));
      this.attr[k] += take;
      free -= take;
    }
    this.onAttrsChanged();
    return true;
  }

  // Every attribute point back (for the same fee as skill points).
  resetAttrs() {
    const g = this.game, fee = this.respecFee();
    if (this.gold < fee) { g.ui.centerMsg('Not enough gold'); return false; }
    this.gold -= fee;
    this.attr = freshAttrs();
    this.onAttrsChanged();
    return true;
  }

  onAttrsChanged() {
    const hpFrac = this.hp / this.stats.maxHp, mpFrac = this.mp / this.stats.maxMp;
    this.recompute();
    this.hp = Math.min(this.stats.maxHp, Math.max(1, hpFrac * this.stats.maxHp));
    this.mp = Math.min(this.stats.maxMp, mpFrac * this.stats.maxMp);
    this.game.ui?.refreshInventory();
    this.game.save();
  }

  setBar(i, id) {
    if (i < 0 || i >= BAR_SIZE) return;
    const was = this.sk.bar.indexOf(id);
    if (was >= 0) this.sk.bar[was] = this.sk.bar[i]; // (swap places)
    this.sk.bar[i] = id;
    this.game.ui.buildActionBar();
    this.game.save();
  }

  headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 2.7, this.pos.z);
  }

  // ---------------------------------------------------------------- combat actions
  faceToward(p) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    this.yaw = this.targetYaw = yawTo(dx, dz);
    this.group.rotation.y = this.yaw;
  }

  // How far the basic attack reaches (to the foe's centre: its radius counts too).
  attackRange(target = null) {
    const s = this.stats;
    if (s.ranged) return s.ranged === 'arrow' ? 15 : 13;
    return (s.hands === 2 ? 2.7 : 2.3) + s.reach + (target ? target.radius : 0);
  }

  // The basic attack at a foe (or toward a point). manual: a press (it can combo), not a held button: a press
  // in the window after a blow lands chains into the next, stronger one at once; a moment too early is held
  // for the window (and is perfect); earlier than that breaks the chain. Held attacks never combo.
  basicAttack(target = null, manual = false) {
    const g = this.game, s = this.stats, c = this.combo, now = g.time;
    if (!this.alive || this.stunT > 0 || this.channel) return false;
    if (this.action && !this.action.swing) return false; // (a skill is playing)
    const swinging = !!this.action?.swing;
    let step = 0, perfect = false;
    if (manual) {
      if (swinging && now < c.open) {
        if (now >= c.open - COMBO.tooEarly) { this.queued = { t: c.open - now + 0.001, fn: () => this.basicAttack(target, true) }; return true; }
        c.step = 0;
        g.ui.combo(0, 'early');
        return false;
      }
      if (now >= c.open && now <= c.until) {
        step = c.step + 1 >= COMBO.mults.length ? 1 : c.step + 1; // (after the finisher the chain starts over)
        perfect = now <= c.perfectUntil;
      }
    } else if (swinging || this.cd.attack > 0) return false;
    c.step = step;
    const dur = 0.62 / s.atkSpeed;
    const mult = COMBO.mults[step] * (perfect ? 1 + COMBO.perfectBonus : 1);
    const point = target ? target.pos.clone() : g.aim(3.2).point;
    this.faceToward(point);
    this.action = null;
    this.h.swing = null;
    this.queued = null;
    c.open = now + dur * COMBO.open;
    c.perfectUntil = c.open + COMBO.perfect;
    c.until = now + dur + COMBO.grace;
    if (manual && step > 0) g.ui.combo(step, perfect ? 'perfect' : 'good');
    this.cd.attack = dur;
    if (s.ranged) {
      const act = s.ranged === 'arrow' ? arrowAction(this, point, true, target, dur) : boltAction(this, point, true, target);
      this.action = { t: 0, dur, canMove: false, swing: true, mult, combo: step, ...act };
      g.link.act({ k: s.ranged === 'arrow' ? 'ar' : 'bo', x: r2(point.x), z: r2(point.z) });
      return true;
    }
    const twoH = s.hands === 2, style = step === COMBO.mults.length - 1 ? 'chop' : twoH ? (step % 2 ? 'cleave' : 'chop') : s.swing === 'stab' ? (step % 2 ? 'stab' : 'slash') : (step + c.swings) % 2 ? 'slash' : 'backslash';
    c.swings = (c.swings || 0) + 1;
    this.h.startSwing(dur, style);
    g.sfx.play('swing', 0.7);
    const range = this.attackRange() - 0.1, finisher = step === COMBO.mults.length - 1;
    this.action = {
      t: 0, dur, canMove: false, hit: false, swing: true,
      tick: (dt, a) => {
        // the foe steps back as the blow comes: the hero steps in with it (a long stride at most), so one that
        // backs away (a caster keeping its distance) is still hit, not chased for ever
        if (!a.hit && target?.alive && target.pos) {
          const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z, d = Math.hypot(dx, dz);
          const reach = range + (target.radius || 0) - 0.25;
          if (d > reach && (a.lunge || 0) < LUNGE) {
            const step = Math.min(d - reach, LUNGE_SPEED * dt, LUNGE - (a.lunge || 0));
            this.pos.x += (dx / d) * step;
            this.pos.z += (dz / d) * step;
            a.lunge = (a.lunge || 0) + step;
            this.yaw = this.targetYaw = yawTo(dx, dz);
            resolveCollision(this.pos, this.radius);
          }
        }
        if (!a.hit && a.t >= dur * 0.45) {
          a.hit = true;
          a.canMove = true;
          a.moveMult = 0.6;
          const eff = this.buffs.poison_blade && s.weapon === 'dagger' ? { dot: [this.dotDps(this.buffs.poison_blade.v, false), 4, 'poison'] } : null;
          const n = g.meleeHit({ range, arc: twoH ? 1.8 : 2.1, mult, knock: finisher ? 1.0 : 0.35, eff, target });
          const color = finisher ? 0xffc060 : perfect ? 0xfff6a0 : 0xfff0d0;
          if (style === 'chop' || style === 'cleave') g.fx.arc(this.pos, this.yaw, { span: 1.4, rIn: 0.5, rOut: range + 0.4, color, dur: 0.2 });
          else g.fx.arc(this.pos, this.yaw, { span: 2.1, rIn: 0.6, rOut: range + 0.2, color, dur: 0.22, reverse: style === 'backslash' });
          if (finisher && n) g.shake(0.18);
          if (!n) g.sfx.play('whiff', 0.5);
        }
      },
    };
    g.link.act({ k: 'sw', s: style, d: r2(dur) });
    return true;
  }

  // Use the skill in bar slot i (keys 1–8).
  useSkill(i) {
    const id = this.sk.bar[i];
    if (id) this.castSkill(id);
  }

  // Cast a skill: its target (the selected foe, or the nearest; a friend; a spot), in range or not (control.js
  // walks there first), mana and cooldown.
  castSkill(id, opts = {}) {
    const g = this.game, sk = SKILLS[id];
    if (!this.alive || !sk || this.stunT > 0) return false;
    if (!this.skillOpen(id)) { g.ui.centerMsg(`${sk.name}: put more points in its tree`); return false; }
    const blocked = this.skillBlocked(id);
    if (blocked) { g.ui.centerMsg(`${sk.name}: ${blocked.toLowerCase()}`); return false; }
    if ((this.cd[id] || 0) > 0) return false;
    const cost = manaCost(sk, this.level);
    if (this.mp < cost) { g.ui.noMana(); return false; }
    const ctx = this.control.skillTarget(sk, opts);
    if (!ctx) return false; // (no target: control said why, or is walking into range)
    if (this.channel) this.breakChannel();
    const swinging = this.action?.swing;
    if (this.action && !swinging) { this.queued = { t: 0.4, fn: () => this.castSkill(id, opts) }; return false; }
    // a skill right after a basic blow, in its combo window, cuts the swing short and is stronger for the chain
    let bonus = 1;
    if (swinging) {
      if (g.time < this.combo.open) { this.queued = { t: this.combo.open - g.time + 0.02, fn: () => this.castSkill(id, opts) }; return false; }
      if (g.time <= this.combo.until && this.combo.step > 0) { bonus = 1 + 0.05 * this.combo.step; g.ui.combo(this.combo.step, 'skill'); }
      this.combo.step = 0;
    }
    this.action = null;
    this.h.swing = null;
    this.mp -= cost;
    this.cd[id] = sk.cd;
    ctx.pw = this.skillPower(id) * bonus;
    this.action = sk.cast(this, ctx, true);
    const to = this.action.dest || ctx.at || (ctx.target ? ctx.target.pos : null);
    const a = { k: 'sk', id, pw: r2(ctx.pw) };
    if (to) { a.x = r2(to.x); a.z = r2(to.z); }
    if (ctx.target) a.t = ctx.target === this ? 0 : ctx.target.isHero ? `h${ctx.target.id}` : ctx.target.id;
    g.link.act(a);
    return true;
  }

  // Timed boosts (skills.js BUFFS); v: their strength.
  addBuff(id, v = 1, dur = null) {
    const def = BUFFS[id];
    if (!def) return;
    this.buffs[id] = { t: dur ?? def.dur, v };
    if (id === 'divine_shield') this.shield = Math.round(this.stats.maxHp * v);
    if (def.look) this.aura(def.look, dur ?? def.dur);
    this.recompute();
    this.game.ui?.refreshBuffs?.();
  }

  aura(id, dur) {
    this.auras[id] = dur;
  }

  vol() {
    return 1; // (our own sounds are never far away)
  }

  heal(n, quiet = false) {
    const g = this.game;
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    if (quiet) { if (this.hp - before >= 1) g.ui.floater(this.headPos(), `+${Math.round(this.hp - before)}`, 'heal small'); return; }
    g.fx.heal(this.pos);
    g.ui.floater(this.headPos(), `+${Math.round(this.hp - before)}`, 'heal');
    g.sfx.play('heal');
  }

  // Stunned or slowed (another hero in the arena, or a monster's blow): { s: stun s, w: slow s, f: slow factor }.
  applyStatus(looks) {
    if (this.buffs.sanctuary) return; // (holy ground: no stuns or slows)
    const s = Number(looks.s ?? looks.stun) || 0, w = Number(looks.w) || 0;
    if (s > 0) {
      this.stunT = Math.max(this.stunT, Math.min(1.5, s));
      this.action = null;
      this.queued = null;
      this.h.swing = null;
      this.breakChannel();
    }
    if (w > 0) {
      this.slowT = Math.max(this.slowT, Math.min(6, w));
      this.slowBy = Math.max(0.3, Math.min(1, Number(looks.f) || 0.6));
    }
  }

  die() {
    const g = this.game;
    this.alive = false;
    this.stunT = 0;
    this.slowT = 0;
    this.action = null;
    this.queued = null;
    this.channel = null;
    g.ui.channel(null);
    this.h.swing = null;
    this.h.armsOut = 0;
    this.h.model.rotation.y = 0;
    this.h.anim.play('Death_A', { hold: true });
    this.control.onDeath();
    for (const id of Object.keys(this.buffs)) if (!BUFFS[id].long) delete this.buffs[id]; // (blessings outlast death)
    this.recompute();
    const arena = g.places.map.kind === 'arena';
    const lost = arena ? 0 : Math.floor(this.gold * 0.1); // (the arena takes no gold)
    this.gold -= lost;
    g.sfx.play('death');
    g.link.act({ k: 'de' });
    g.ui.closeInventory();
    setTimeout(() => { if (!this.alive) g.ui.showDeath(true); }, 1400);
    g.save();
  }

  // "Wake up" on the faint screen: the game takes us where heroes who faint here wake (game.rise),
  // then revive() stands us up.
  respawn() {
    this.game.rise();
  }

  // Back on our feet with this share of our Life (all of it at camp; less when a doctor brings us round).
  revive(share = 1) {
    this.alive = true;
    this.hp = Math.max(1, this.stats.maxHp * share);
    this.mp = share >= 1 ? this.stats.maxMp : Math.max(this.mp, this.stats.maxMp * share);
    this.h.anim.play('Spawn_Ground', { timeScale: 1.2 });
    this.game.ui.showDeath(false);
    this.game.link.act({ k: 're' });
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, s = this.stats;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    let lapsed = false;
    for (const [id, b] of Object.entries(this.buffs)) {
      b.t -= dt;
      if (id === 'renew' && this.alive) this.heal(this.stats.maxHp * b.v * dt, true);
      if (b.t <= 0) { delete this.buffs[id]; lapsed = true; if (id === 'divine_shield') this.shield = 0; }
    }
    if (lapsed) { this.recompute(); g.ui.refreshBuffs?.(); }
    auraTick(this, dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.h.frost = this.slowT > 0 ? Math.min(1, this.slowT * 2) : 0;
    if (this.stunT > 0 && Math.random() < dt * 16) { // dizzy stars
      const ang = g.time * 6, y = this.pos.y + 2.55;
      g.fx.add.emit({ pos: { x: this.pos.x + Math.cos(ang) * 0.45, y, z: this.pos.z + Math.sin(ang) * 0.45 }, count: 1, spread: 0.05, velSpread: 0.1, vel: { x: -Math.sin(ang) * 1.2, y: 0.1, z: Math.cos(ang) * 1.2 }, color: new THREE.Color(0xffe066).multiplyScalar(2.4), size: 0.16, sizeEnd: 0.04, life: 0.45, drag: 0.5 });
    }
    if (!this.alive) {
      this.h.update(dt);
      return;
    }
    const safe = g.currentZone?.safe;
    this.hp = Math.min(s.maxHp, this.hp + s.regen * (safe ? 8 : 1) * dt);
    this.mp = Math.min(s.maxMp, this.mp + s.mpRegen * (safe ? 4 : 1) * dt);

    // reading a camp scroll
    if (this.channel) {
      this.channel.t += dt;
      if (this.channel.t >= this.channel.dur) {
        this.channel = null;
        g.ui.channel(null);
        this.h.anim.stopOne();
        if (this.takeOut('camp_scroll')) { g.ui.refreshInventory(); g.toCamp(); }
      }
    }

    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.tick) a.tick(dt, a);
      if (a.t >= a.dur) {
        this.action = null;
        if (a.end) a.end();
      }
    }

    // where to go: the keys or the joystick, else where control.js is taking us (a click, a foe to reach)
    const ax = g.inputBlocked ? _axis.set(0, 0) : g.input.axis(_axis);
    let len = Math.min(1, ax.length());
    if (len > 0.01) this.control.manualMove();
    else {
      const want = this.control.steer(dt);
      if (want) { ax.set(want.x, want.z); len = want.len; }
    }
    let speed = 0;
    const spawning = this.h.anim.oneName === 'Spawn_Ground';
    if (len > 0.01 && (!this.action || this.action.canMove) && !spawning && this.stunT <= 0) {
      if (this.channel) this.breakChannel();
      const mx = ax.x / (ax.length() || 1), mz = ax.y / (ax.length() || 1);
      speed = s.moveSpeed * (this.action?.moveMult ?? 1) * Math.max(0.35, len) * (this.slowT > 0 ? this.slowBy : 1);
      this.pos.x += mx * speed * dt;
      this.pos.z += mz * speed * dt;
      if (!this.action?.lockFacing) this.targetYaw = yawTo(mx, mz);
    }
    resolveCollision(this.pos, this.radius);
    g.places.view.blockGates?.(this.pos, this.radius); // (a cave's closed gates)
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.yaw = dampAngle(this.yaw, this.targetYaw, 16, dt);
    this.group.rotation.y = this.yaw;

    this.moveSpeed = speed;
    this.moveMode = speed > s.moveSpeed * 0.55 ? 2 : speed > 0 ? 1 : 0; // (what the others see)
    if (!this.channel) {
      if (speed > s.moveSpeed * 0.55) this.h.anim.setBase('Running_A', speed / 5.4);
      else if (speed > 0) this.h.anim.setBase('Walking_A', Math.max(0.7, speed / 2.2));
      else this.h.anim.setBase('Idle_A');
    }
    if (speed > 0 && this.h.anim.oneName === 'Hit_A') this.h.anim.stopOne();

    if (this.queued) {
      this.queued.t -= dt;
      if (this.queued.t <= 0) {
        const q = this.queued;
        this.queued = null;
        if (!this.action || this.action.swing) q.fn();
      }
    }
    if (!spawning && !this.channel) this.control.act(dt); // attacks it holds or is walking toward

    if (speed > 0) {
      this.stepT += dt;
      if (this.stepT > 0.28) { this.stepT = 0; g.fx.dust(this.pos, 2); }
    }
    this.h.update(dt);
    this.glowEmbers(dt);
  }

  // Unique and +7 weapons shed a few embers.
  glowEmbers(dt) {
    const it = this.equipment.weapon, d = itemDef(it);
    if (!d || !(d.unique || (it.p ?? 0) >= 7)) return;
    this.emberT = (this.emberT || 0) + dt;
    if (this.emberT < 0.12) return;
    this.emberT = 0;
    const bone = this.h.bones[WEAPON_TYPES[d.type]?.left ? 'handslotl' : 'handslotr'];
    if (!bone) return;
    bone.getWorldPosition(_ember);
    _ember.y += rand(0, 0.8);
    const c = d.glow ?? 0xff6a10;
    this.game.fx.add.emit({
      pos: _ember, count: 1, spread: 0.15, velSpread: 0.25, vel: { x: 0, y: 0.9, z: 0 },
      color: hdr(c, 2.2), colorEnd: hdr(c, 0.3), size: 0.11, sizeEnd: 0.02, life: 0.7, drag: 1.2,
    });
  }
}


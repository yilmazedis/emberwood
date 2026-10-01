// The player's hero (any of the classes in classes.js): stats, gear, leveling, movement and skills.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { heightAt, resolveCollision } from './world.js';
import { makeItem, BASES } from './items.js';
import { Assets } from './assets.js';
import { dampAngle, yawTo, rand } from './util.js';
import { CLASSES } from './classes.js';
import { SKILLS, CLASS_SKILLS, BUFFS, auraTick } from './skills.js';
import { hdr } from './fx.js';

export const xpForLevel = (lvl) => Math.round(60 * Math.pow(lvl, 1.55));
const _axis = new THREE.Vector2();
const r2 = (v) => Math.round(v * 100) / 100;
const _ember = new THREE.Vector3();

export const STASH_SIZE = 30;
const freshQuests = () => ({ mainIndex: 0, main: null, bounties: [null, null, null] }); // see quests.js
export const emptyEquipment = () => ({ weapon: null, offhand: null, head: null, back: null, hands: null, feet: null, ring1: null, ring2: null });

// Gloves/boots: colour + material from the base, glowing when legendary.
function gearLook(item) {
  if (!item) return null;
  const b = BASES[item.base];
  return { ...b.gear, cover: b.cover, glow: item.rarity === 'legendary' ? 1 : 0 };
}

// Weapons in the hands; a head item shows the class's own hat (helmet, bear hat, wizard hat), a back
// item its cape (classes.js lists the model parts); gloves and boots tint the hands and feet.
export function applyEquipmentVisuals(h, eq, cls = 'knight') {
  const c = CLASSES[cls];
  const glow = (it) => (it && it.rarity === 'legendary' ? 0xff6a10 : null);
  h.equip('r', eq.weapon?.model || null, glow(eq.weapon));
  h.equip('l', eq.offhand?.model || null, glow(eq.offhand));
  const shown = new Set(eq.head ? c.hats[eq.head.base] || [] : []);
  for (const part of new Set(Object.values(c.hats).flat())) h.setMeshVisible(part, shown.has(part));
  for (const part of c.capes) h.setMeshVisible(part, !!eq.back);
  h.enableGearTint();
  h.setGear('hands', gearLook(eq.hands));
  h.setGear('feet', gearLook(eq.feet));
}

// What the other players' games need to draw this hero: its level and the gear that shows.
export function lookOf(p) {
  const eq = p.equipment, leg = (it) => (it.rarity === 'legendary' ? 1 : 0);
  const k = { lv: p.level };
  if (eq.weapon?.model) k.w = [eq.weapon.model, leg(eq.weapon)];
  if (eq.offhand?.model) k.o = [eq.offhand.model, leg(eq.offhand)];
  if (eq.head) k.h = eq.head.base;
  if (eq.back) k.b = 1;
  if (eq.hands) k.g = [eq.hands.base, leg(eq.hands)];
  if (eq.feet) k.f = [eq.feet.base, leg(eq.feet)];
  return k;
}

// …and back, for a hero someone else plays. Looks come from other games, so anything unknown is left off.
export function equipmentFromLook(k) {
  const eq = emptyEquipment();
  if (!k || typeof k !== 'object') return eq;
  const rarity = (v) => (v ? 'legendary' : 'common');
  const held = (v) => (Array.isArray(v) && typeof v[0] === 'string' && Object.hasOwn(Assets.items, v[0]) ? { model: v[0], rarity: rarity(v[1]) } : null);
  const base = (key, slot) => typeof key === 'string' && Object.hasOwn(BASES, key) && BASES[key].slot === slot;
  const worn = (v, slot) => (Array.isArray(v) && base(v[0], slot) && BASES[v[0]].gear ? { base: v[0], rarity: rarity(v[1]) } : null);
  eq.weapon = held(k.w);
  eq.offhand = held(k.o);
  eq.head = base(k.h, 'head') ? { base: k.h } : null;
  eq.back = k.b ? { base: 'cape' } : null;
  eq.hands = worn(k.g, 'hands');
  eq.feet = worn(k.f, 'feet');
  return eq;
}

// The mage's arcane bolt as an action, for our hero (real: it deals damage) or for show.
export function boltAction(a, point, real) {
  const g = a.game;
  a.h.anim.play('Throw', { timeScale: 2.6, startAt: 0.25 });
  if (a.vol() > 0.01) g.sfx.play('bolt', 0.8 * a.vol());
  return {
    fired: false,
    tick: (dt, s) => {
      if (s.fired || s.t < 0.15) return;
      s.fired = true;
      const from = new THREE.Vector3();
      a.h.bones.handslotr.getWorldPosition(from);
      from.y = Math.max(from.y, a.pos.y + 1.2);
      const to = new THREE.Vector3(point.x, from.y, point.z);
      if (to.distanceTo(from) < 1) to.set(from.x + Math.sin(a.yaw), from.y, from.z + Math.cos(a.yaw));
      g.projectiles.spawn({ from, to, owner: real ? 'player' : 'remote', mult: 1, speed: 22, color: 0x9a7dff, trail: 0x5a3aff, radius: 0.35, range: 13, size: 0.2, small: true });
    },
    end: () => a.h.anim.stopOne(),
  };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.setClass('knight');
    this.radius = 0.5;
    this.yaw = Math.PI;
    this.targetYaw = this.yaw;
    this.reset();
  }

  // Wear the class's model (swapping it in the scene if one is already there).
  setClass(cls) {
    this.cls = cls;
    // its four skills, in key order: { id, key, name, level, mp, cd, … } (skills.js)
    this.skills = CLASS_SKILLS[cls].map((id, i) => ({ id, key: String(i + 1), ...SKILLS[id] }));
    const model = CLASSES[cls].model;
    if (this.h && this.model === model) return;
    const old = this.h;
    this.model = model;
    this.h = new Humanoid(model);
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
    this.potions = 3;
    this.bag = new Array(20).fill(null);
    this.equipment = emptyEquipment();
    this.stash = new Array(STASH_SIZE).fill(null);
    this.shop = { stock: [], restockAt: 0 }; // the merchant's stock (see town.js)
    this.quests = freshQuests();
    this.cd = { attack: 0, potion: 0 };
    for (const sk of this.skills) this.cd[sk.id] = 0;
    this.buffs = {}; // id -> seconds left (skills.js BUFFS)
    this.auras = {}; // their looks, the same for every hero (skills.js auraTick)
    this.action = null;
    this.queued = null;
    this.combo = 0;
    this.alive = true;
    this.stepT = 0;
    this.hp = undefined;
    this.recompute();
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  starterKit() {
    for (const [slot, base, name] of CLASSES[this.cls].start) this.equipment[slot] = makeItem(base, 1, 'common', name);
    this.onGearChanged(false);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  serialize() {
    return {
      v: 1, level: this.level, xp: this.xp, gold: this.gold, potions: this.potions,
      bag: this.bag, equipment: this.equipment, stash: this.stash, shop: this.shop, quests: this.quests,
    };
  }

  load(s) {
    this.level = s.level || 1;
    this.xp = s.xp || 0;
    this.gold = s.gold || 0;
    this.potions = s.potions ?? 3;
    this.bag = Array.from({ length: 20 }, (_, i) => s.bag?.[i] || null);
    this.equipment = { ...emptyEquipment(), ...s.equipment };
    this.stash = Array.from({ length: STASH_SIZE }, (_, i) => s.stash?.[i] || null);
    this.shop = Array.isArray(s.shop?.stock) ? s.shop : { stock: [], restockAt: 0 };
    this.quests = Array.isArray(s.quests?.bounties) ? s.quests : freshQuests();
    this.onGearChanged(false);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  recompute() {
    const L = this.level, c = CLASSES[this.cls];
    const s = {
      maxHp: (90 + L * 14) * c.hp, maxMp: (40 + L * 6) * c.mp, armor: L * 1.5 * c.armor, dmgMin: 2, dmgMax: 4, speed: 1.3,
      dmgPct: 0.06 * (L - 1) + (c.dmg - 1), atkSpd: c.atkSpd, moveSpd: c.moveSpd, crit: 0.05 + c.crit, spell: 1 + c.spell,
      regen: 1 + L * 0.25, mpRegen: (3 + L * 0.3) * Math.sqrt(c.mp), evade: 0,
    };
    for (const it of Object.values(this.equipment)) {
      if (!it) continue;
      const st = it.stats;
      if (st.dmgMin) { s.dmgMin = st.dmgMin; s.dmgMax = st.dmgMax; s.speed = st.speed; }
      s.armor += st.armor || 0;
      s.maxHp += st.hp || 0;
      s.maxMp += st.mp || 0;
      s.dmgPct += st.dmgPct || 0;
      s.atkSpd += st.atkSpd || 0;
      s.moveSpd += st.moveSpd || 0;
      s.crit += st.crit || 0;
      s.spell += st.spell || 0;
      s.regen += st.regen || 0;
    }
    for (const id of Object.keys(this.buffs || {})) { // skills' timed boosts
      const b = BUFFS[id];
      if (b.armorMul) s.armor *= b.armorMul;
      s.atkSpd += b.atkSpd || 0;
      s.dmgPct += b.dmgPct || 0;
      s.evade = Math.max(s.evade, b.evade || 0);
    }
    s.armor = Math.round(s.armor);
    s.maxHp = Math.round(s.maxHp);
    s.maxMp = Math.round(s.maxMp);
    s.atkSpeed = s.speed * (1 + s.atkSpd);
    s.moveSpeed = 5.6 * (1 + s.moveSpd);
    s.dmgLo = Math.max(1, Math.round(s.dmgMin * (1 + s.dmgPct)));
    s.dmgHi = Math.max(s.dmgLo + 1, Math.round(s.dmgMax * (1 + s.dmgPct)));
    s.dr = s.armor / (s.armor + 60);
    this.stats = s;
    if (this.hp !== undefined) {
      this.hp = Math.min(this.hp, s.maxHp);
      this.mp = Math.min(this.mp, s.maxMp);
    }
  }

  rollDamage(mult, spell = false, critBonus = 0) {
    const s = this.stats;
    let amount = rand(s.dmgLo, s.dmgHi) * mult * (spell ? s.spell : 1);
    const crit = Math.random() < s.crit + critBonus;
    if (crit) amount *= 2;
    return { amount: Math.max(1, Math.round(amount)), crit };
  }

  // ---------------------------------------------------------------- inventory
  freeSlot() {
    return this.bag.findIndex((x) => !x);
  }

  addItem(item) {
    const i = this.freeSlot();
    if (i < 0) return false;
    this.bag[i] = item;
    this.game.ui.refreshInventory();
    return true;
  }

  // Equipment slot an item goes into. Rings fill the empty ring slot first; with both taken,
  // they replace the weaker ring (lower value) unless a slot is given explicitly.
  slotFor(item) {
    if (item.slot !== 'ring') return item.slot;
    const eq = this.equipment;
    if (!eq.ring1) return 'ring1';
    if (!eq.ring2) return 'ring2';
    return eq.ring2.value < eq.ring1.value ? 'ring2' : 'ring1';
  }

  equipFromBag(i, target = null) {
    const it = this.bag[i];
    if (!it) return;
    const eq = this.equipment;
    const slot = target || this.slotFor(it);
    // what else has to come off?
    const extra = [];
    if (it.twoHanded && eq.offhand) extra.push('offhand');
    if (it.slot === 'offhand' && eq.weapon?.twoHanded) extra.push('weapon');
    const prev = eq[slot];
    const freeAfter = this.bag.filter((x) => !x).length + (prev ? 0 : 1);
    if (extra.length > freeAfter) {
      this.game.ui.centerMsg('Not enough room in your bag');
      return;
    }
    this.bag[i] = prev || null;
    eq[slot] = it;
    for (const s of extra) {
      this.bag[this.freeSlot()] = eq[s];
      eq[s] = null;
    }
    this.game.sfx.play('equip');
    this.onGearChanged();
  }

  unequip(slot) {
    const it = this.equipment[slot];
    if (!it) return;
    const i = this.freeSlot();
    if (i < 0) {
      this.game.ui.centerMsg('Your bag is full');
      return;
    }
    this.bag[i] = it;
    this.equipment[slot] = null;
    this.game.sfx.play('equip');
    this.onGearChanged();
  }

  sell(i) {
    const it = this.bag[i];
    if (!it) return;
    this.bag[i] = null;
    this.gold += it.value;
    this.game.town?.addBuyback(it);
    this.game.sfx.play('gold');
    this.game.ui.log(`Sold ${it.name} for <b>${it.value}g</b>`, 'gold');
    this.game.ui.refreshInventory();
    this.game.save();
  }


  onGearChanged(save = true) {
    const hpFrac = this.hp !== undefined ? this.hp / this.stats.maxHp : 1;
    this.recompute();
    if (this.hp !== undefined) this.hp = Math.min(this.stats.maxHp, Math.max(this.hp, hpFrac * this.stats.maxHp));
    applyEquipmentVisuals(this.h, this.equipment, this.cls);
    this.game.ui?.refreshInventory();
    this.game.doll?.setEquipment(this.equipment, this.cls);
    this.game.link?.lookChanged();
    if (save) this.game.save();
  }

  gainXp(n) {
    this.xp += n;
    let leveled = false;
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      leveled = true;
      const skill = this.skills.find((s) => s.level === this.level);
      this.game.ui.log(`<b>Level ${this.level}!</b>${skill ? ` New skill: <b>${skill.name}</b> [${skill.key}]` : ''}`, 'lvl');
    }
    if (leveled) {
      this.recompute();
      this.hp = this.stats.maxHp;
      this.mp = this.stats.maxMp;
      this.game.fx.levelUp(this.pos);
      this.game.sfx.play('levelup');
      this.game.ui.floater(this.headPos(), `Level ${this.level}`, 'info');
      this.game.ui.buildActionBar();
      this.game.town?.onLevelUp();
      this.game.link?.act({ k: 'lv' });
      this.game.link?.lookChanged();
      this.game.save();
    }
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

  basicAttack() {
    const g = this.game, s = this.stats;
    if (this.cls === 'mage') return this.arcaneBolt();
    const { point } = g.aim(3.2);
    const dur = 0.62 / s.atkSpeed;
    const twoH = !!this.equipment.weapon?.twoHanded;
    this.faceToward(point);
    this.combo = (this.combo + 1) % 2;
    const style = twoH ? 'chop' : this.combo ? 'slash' : 'backslash';
    this.h.startSwing(dur, style);
    this.cd.attack = dur;
    g.sfx.play('swing', 0.7);
    this.action = {
      t: 0, dur, canMove: false, hit: false,
      tick: (dt, a) => {
        if (!a.hit && a.t >= dur * 0.45) {
          a.hit = true;
          a.canMove = true;
          a.moveMult = 0.6;
          const n = g.meleeHit({ range: twoH ? 2.7 : 2.3, arc: twoH ? 1.6 : 2.1, mult: 1, knock: 0.35 });
          if (style === 'chop') g.fx.arc(this.pos, this.yaw, { span: 1.3, rIn: 0.5, rOut: 2.8, color: 0xfff2d0, dur: 0.2 });
          else g.fx.arc(this.pos, this.yaw, { span: 2.1, rIn: 0.6, rOut: 2.4, color: 0xfff2d0, dur: 0.22, reverse: style === 'backslash' });
          if (!n) g.sfx.play('whiff', 0.5);
        }
      },
    };
    g.link.act({ k: 'sw', s: style, d: r2(dur) });
  }

  // The mage's attack: a bolt of arcane force from the staff (weapon damage, scaled by Spell Power).
  arcaneBolt() {
    const g = this.game, s = this.stats;
    const { point } = g.aim(12);
    const dur = 0.62 / s.atkSpeed;
    this.faceToward(point);
    this.cd.attack = dur;
    this.action = { t: 0, dur, canMove: false, ...boltAction(this, point, true) };
    g.link.act({ k: 'bo', x: r2(point.x), z: r2(point.z) });
  }

  useSkill(i) {
    const g = this.game, sk = this.skills[i];
    if (!this.alive || !sk) return;
    if (this.level < sk.level) { g.ui.centerMsg(`${sk.name} unlocks at level ${sk.level}`); return; }
    if (this.cd[sk.id] > 0) return;
    if (this.mp < sk.mp) { g.ui.noMana(); return; }
    if (this.action) { this.queued = { t: 0.4, fn: () => this.useSkill(i) }; return; }
    this.mp -= sk.mp;
    this.cd[sk.id] = sk.cd;
    const at = sk.range ? g.aim(sk.range).point : null;
    this.action = sk.cast(this, at, true);
    const to = this.action.dest || at; // where the others should see it go (a leap's landing, a teleport's end)
    g.link.act(to ? { k: 'sk', id: sk.id, x: r2(to.x), z: r2(to.z) } : { k: 'sk', id: sk.id });
  }

  // Timed boosts from skills (skills.js BUFFS); their looks are an aura every hero shows.
  addBuff(id) {
    this.buffs[id] = BUFFS[id].dur;
    this.recompute();
  }

  aura(id, dur) {
    this.auras[id] = dur;
  }

  vol() {
    return 1; // (our own sounds are never far away)
  }

  drinkAle() {
    const g = this.game;
    if (!this.alive || this.cd.potion > 0) return;
    if (this.potions <= 0) { g.ui.centerMsg('No ale left — the merchant in camp sells more'); return; }
    if (this.hp >= this.stats.maxHp) { g.ui.centerMsg('Already at full life'); return; }
    this.potions--;
    this.cd.potion = 1.5;
    this.heal(Math.round(this.stats.maxHp * 0.4));
    g.sfx.play('drink');
    g.link.act({ k: 'dr' });
    g.save();
  }

  heal(n) {
    const g = this.game;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    g.fx.heal(this.pos);
    g.ui.floater(this.headPos(), `+${Math.round(this.hp - before)}`, 'heal');
    g.sfx.play('heal');
  }

  die() {
    const g = this.game;
    this.alive = false;
    this.action = null;
    this.queued = null;
    this.h.swing = null;
    this.h.armsOut = 0;
    this.h.model.rotation.y = 0;
    this.h.anim.play('Death_A', { hold: true });
    const lost = Math.floor(this.gold * 0.1);
    this.gold -= lost;
    g.sfx.play('death');
    g.link.act({ k: 'de' });
    g.ui.closeInventory();
    setTimeout(() => g.ui.showDeath(true), 1400);
    g.save();
  }

  respawn() {
    this.alive = true;
    if (this.game.dungeon.inside) this.game.dungeon.setInside(false); // back to camp from the crypt
    this.pos.set(0, heightAt(0, 3.5), 3.5);
    this.game.camFocus.copy(this.pos);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
    this.yaw = this.targetYaw = Math.PI;
    this.h.anim.play('Spawn_Ground', { timeScale: 1.2 });
    this.game.ui.showDeath(false);
    this.game.link.act({ k: 're' });
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, s = this.stats;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    let lapsed = false;
    for (const id of Object.keys(this.buffs)) {
      this.buffs[id] -= dt;
      if (this.buffs[id] <= 0) { delete this.buffs[id]; lapsed = true; }
    }
    if (lapsed) this.recompute();
    auraTick(this, dt);
    if (!this.alive) {
      this.h.update(dt);
      return;
    }
    const safe = g.currentZone?.safe;
    this.hp = Math.min(s.maxHp, this.hp + s.regen * (safe ? 8 : 1) * dt);
    this.mp = Math.min(s.maxMp, this.mp + s.mpRegen * (safe ? 4 : 1) * dt);

    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.tick) a.tick(dt, a);
      if (a.t >= a.dur) {
        this.action = null;
        if (a.end) a.end();
      }
    }

    const ax = g.inputBlocked ? _axis.set(0, 0) : g.input.axis(_axis); // keyboard (0 or 1) or joystick (analog 0..1)
    const len = Math.min(1, ax.length());
    let speed = 0;
    const spawning = this.h.anim.oneName === 'Spawn_Ground';
    if (len > 0.01 && (!this.action || this.action.canMove) && !spawning) {
      const mx = ax.x / len, mz = ax.y / len;
      speed = s.moveSpeed * (this.action?.moveMult ?? 1) * Math.max(0.35, len);
      this.pos.x += mx * speed * dt;
      this.pos.z += mz * speed * dt;
      if (!this.action?.lockFacing) this.targetYaw = yawTo(mx, mz);
    }
    resolveCollision(this.pos, this.radius);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.yaw = dampAngle(this.yaw, this.targetYaw, 16, dt);
    this.group.rotation.y = this.yaw;

    this.moveSpeed = speed;
    this.moveMode = speed > s.moveSpeed * 0.55 ? 2 : speed > 0 ? 1 : 0; // (what the others see)
    if (speed > s.moveSpeed * 0.55) this.h.anim.setBase('Running_A', speed / 5.4);
    else if (speed > 0) this.h.anim.setBase('Walking_A', Math.max(0.7, speed / 2.2));
    else this.h.anim.setBase('Idle_A');
    if (speed > 0 && this.h.anim.oneName === 'Hit_A') this.h.anim.stopOne();

    if (this.queued) {
      this.queued.t -= dt;
      if (this.queued.t <= 0) this.queued = null;
    }
    if (!this.action && !spawning) {
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        q.fn();
      } else if (g.input.attacking && !g.inputBlocked && this.cd.attack <= 0) {
        this.basicAttack();
      }
    }

    if (speed > 0) {
      this.stepT += dt;
      if (this.stepT > 0.28) { this.stepT = 0; g.fx.dust(this.pos, 2); }
    }
    this.h.update(dt);
    this.legendaryEmbers(dt);
  }

  // Legendary gloves/boots shed a few embers from the hands/feet.
  legendaryEmbers(dt) {
    const eq = this.equipment;
    const spots = [];
    if (eq.hands?.rarity === 'legendary') spots.push('handl', 'handr');
    if (eq.feet?.rarity === 'legendary') spots.push('footl', 'footr');
    if (!spots.length) return;
    this.emberT = (this.emberT || 0) + dt;
    if (this.emberT < 0.09) return;
    this.emberT = 0;
    const bone = this.h.bones[spots[Math.floor(Math.random() * spots.length)]];
    if (!bone) return;
    bone.getWorldPosition(_ember);
    this.game.fx.add.emit({
      pos: _ember, count: 1, spread: 0.07, velSpread: 0.25, vel: { x: 0, y: 0.9, z: 0 },
      color: hdr(0xffa040, 2.2), colorEnd: hdr(0xff3a10, 0.3), size: 0.12, sizeEnd: 0.02, life: 0.7, drag: 1.2,
    });
  }
}

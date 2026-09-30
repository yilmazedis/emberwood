// Item database + random loot generation (Diablo-style bases, rarities and affixes).
import { rand, randInt, pick, weightedPick } from './util.js';

export const RARITY = {
  common: { label: 'Common', color: '#e8e4da', affixes: [0, 0], mult: 1, beam: null, w: 60 },
  magic: { label: 'Magic', color: '#6aa9ff', affixes: [1, 2], mult: 1.06, beam: 0x4d8dff, w: 28 },
  rare: { label: 'Rare', color: '#ffd84a', affixes: [2, 3], mult: 1.14, beam: 0xffd23f, w: 10 },
  legendary: { label: 'Legendary', color: '#ff8a2b', affixes: [3, 4], mult: 1.32, beam: 0xff7a1a, w: 2 },
};
const RARITY_ORDER = ['common', 'magic', 'rare', 'legendary'];

export const BASES = {
  dagger: { name: 'Dagger', type: 'Dagger', slot: 'weapon', model: 'dagger', dmg: [5, 8], speed: 1.45, w: 9 },
  sword: { name: 'Arming Sword', type: 'One-Handed Sword', slot: 'weapon', model: 'sword_1handed', dmg: [8, 12], speed: 1.15, w: 10 },
  axe: { name: 'Hand Axe', type: 'One-Handed Axe', slot: 'weapon', model: 'axe_1handed', dmg: [9, 14], speed: 1.05, w: 8 },
  greatsword: { name: 'Greatsword', type: 'Two-Handed Sword', slot: 'weapon', model: 'sword_2handed', legendaryModel: 'sword_2handed_color', dmg: [16, 24], speed: 0.86, twoHanded: true, w: 6 },
  greataxe: { name: 'Great Axe', type: 'Two-Handed Axe', slot: 'weapon', model: 'axe_2handed', dmg: [19, 28], speed: 0.78, twoHanded: true, w: 5 },
  staff: { name: 'Oak Staff', type: 'Staff', slot: 'weapon', model: 'staff', dmg: [6, 10], speed: 1.0, spell: 0.5, mp: 20, twoHanded: true, w: 5 },
  wand: { name: 'Wand', type: 'Wand', slot: 'weapon', model: 'wand', dmg: [4, 7], speed: 1.25, spell: 0.3, w: 5 },
  round: { name: 'Round Shield', type: 'Shield', slot: 'offhand', model: 'shield_round', legendaryModel: 'shield_round_color', armor: 5, w: 8 },
  kite: { name: 'Kite Shield', type: 'Shield', slot: 'offhand', model: 'shield_square', legendaryModel: 'shield_square_color', armor: 8, w: 6 },
  spiked: { name: 'Spiked Shield', type: 'Shield', slot: 'offhand', model: 'shield_spikes', legendaryModel: 'shield_spikes_color', armor: 7, dmgPct: 0.05, w: 5 },
  crest: { name: 'Crest Shield', type: 'Shield', slot: 'offhand', model: 'shield_badge', legendaryModel: 'shield_badge_color', armor: 10, w: 4 },
  tome: { name: 'Spellbook', type: 'Tome', slot: 'offhand', model: 'spellbook_open', spell: 0.2, mp: 25, w: 4 },
  helm: { name: 'Iron Helm', type: 'Helmet', slot: 'head', icon: 'helm', meshes: ['Knight_Helmet'], armor: 4, hp: 10, w: 7 },
  visor: { name: 'Visored Helm', type: 'Helmet', slot: 'head', icon: 'visor', meshes: ['Knight_Helmet', 'Knight_HelmetVisor'], armor: 7, w: 4 },
  cape: { name: "Traveler's Cape", type: 'Cape', slot: 'back', icon: 'cape', meshes: ['Knight_Cape'], armor: 2, moveSpd: 0.04, w: 6 },
  // Bone gear (KayKit Skeletons pack): only drops from skeletons (the `bone` loot table)
  bone_blade: { name: 'Bone Blade', type: 'One-Handed Sword', slot: 'weapon', model: 'Skeleton_Blade', dmg: [10, 15], speed: 1.15, w: 0, boneW: 7 },
  bone_axe: { name: 'Bone Cleaver', type: 'One-Handed Axe', slot: 'weapon', model: 'Skeleton_Axe', dmg: [12, 18], speed: 1.0, w: 0, boneW: 6 },
  necro_staff: { name: 'Necromancer Staff', type: 'Staff', slot: 'weapon', model: 'Skeleton_Staff', dmg: [8, 12], speed: 1.0, spell: 0.7, mp: 30, twoHanded: true, w: 0, boneW: 4 },
  bone_buckler: { name: 'Bone Buckler', type: 'Shield', slot: 'offhand', model: 'Skeleton_Shield_Small_A', armor: 7, w: 0, boneW: 5 },
  grave_ward: { name: 'Grave Ward', type: 'Shield', slot: 'offhand', model: 'Skeleton_Shield_Large_A', armor: 12, w: 0, boneW: 3 },
};

export const AFFIXES = {
  dmgPct: { fmt: (v) => `+${Math.round(v * 100)}% Damage`, roll: (il) => rand(0.05, 0.1) * (1 + il * 0.12), pre: 'Keen' },
  hp: { fmt: (v) => `+${v} Max Life`, roll: (il) => randInt(8, 14) + il * 4, suf: 'of the Bear' },
  mp: { fmt: (v) => `+${v} Max Mana`, roll: (il) => randInt(6, 10) + il * 3, suf: 'of Wisdom' },
  armor: { fmt: (v) => `+${v} Armor`, roll: (il) => randInt(2, 4) + il * 2, pre: 'Sturdy' },
  atkSpd: { fmt: (v) => `+${Math.round(v * 100)}% Attack Speed`, roll: () => rand(0.05, 0.12), suf: 'of Haste' },
  moveSpd: { fmt: (v) => `+${Math.round(v * 100)}% Move Speed`, roll: () => rand(0.04, 0.08), suf: 'of the Fox' },
  crit: { fmt: (v) => `+${Math.round(v * 100)}% Critical Chance`, roll: () => rand(0.03, 0.07), pre: 'Deadly' },
  spell: { fmt: (v) => `+${Math.round(v * 100)}% Spell Power`, roll: (il) => rand(0.08, 0.16) * (1 + il * 0.1), pre: 'Arcane' },
  regen: { fmt: (v) => `+${v.toFixed(1)} Life per Second`, roll: (il) => rand(0.8, 1.6) + il * 0.35, suf: 'of Mending' },
};

const RARE_A = ['Grim', 'Storm', 'Dread', 'Blood', 'Soul', 'Rune', 'Wolf', 'Iron', 'Shadow', 'Ember', 'Frost', 'Doom'];
const RARE_B = ['bite', 'song', 'fang', 'ward', 'call', 'edge', 'guard', 'brand', 'reaver', 'veil', 'mark', 'hide'];
const LEGENDARY = {
  weapon: ["Kingsbane", "Sunforged Oath", "The Last Ember", "Widowmaker", "Heartseeker", "Gravecaller"],
  offhand: ["Aegis of Dawn", "Bulwark of Ages", "The Unbroken", "Ossuary Wall"],
  head: ["Crown of the Fallen", "Helm of the Ember Lord"],
  back: ["Mantle of Ash", "Wings of the Phoenix"],
};

let uid = 1;
export function newId() {
  return `${Date.now().toString(36)}-${uid++}`;
}

function rollRarity(boost = 0, min = 'common') {
  const minIdx = RARITY_ORDER.indexOf(min);
  const entries = RARITY_ORDER.slice(minIdx).map((k) => ({ k, w: RARITY[k].w * (k === 'common' ? 1 : 1 + boost) }));
  return weightedPick(entries).k;
}

export function makeItem(baseKey, ilvl = 1, rarity = 'common', nameOverride = null) {
  const base = BASES[baseKey];
  const r = RARITY[rarity];
  const scale = (1 + 0.14 * (ilvl - 1)) * r.mult;
  const stats = {};
  if (base.dmg) {
    stats.dmgMin = Math.max(1, Math.round(base.dmg[0] * scale));
    stats.dmgMax = Math.max(stats.dmgMin + 1, Math.round(base.dmg[1] * scale));
    stats.speed = base.speed;
  }
  if (base.armor) stats.armor = Math.round(base.armor * (1 + 0.2 * (ilvl - 1)) * r.mult);
  for (const k of ['hp', 'mp', 'spell', 'dmgPct', 'moveSpd']) if (base[k]) stats[k] = base[k];

  const affixes = [];
  const n = randInt(r.affixes[0], r.affixes[1]);
  const pool = Object.keys(AFFIXES).filter((k) => !(k === 'spell' && base.slot === 'head'));
  for (let i = 0; i < n && pool.length; i++) {
    const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    let v = AFFIXES[k].roll(ilvl);
    if (k === 'hp' || k === 'mp' || k === 'armor') v = Math.round(v);
    affixes.push({ k, v });
    stats[k] = (stats[k] || 0) + v;
  }

  let name = nameOverride || base.name;
  if (!nameOverride) {
    if (rarity === 'magic' && affixes.length) {
      const a = AFFIXES[affixes[0].k];
      name = a.pre ? `${a.pre} ${base.name}` : `${base.name} ${a.suf}`;
    } else if (rarity === 'rare') {
      name = `${pick(RARE_A)}${pick(RARE_B)}`;
    } else if (rarity === 'legendary') {
      name = pick(LEGENDARY[base.slot]);
    }
  }
  const model = rarity === 'legendary' && base.legendaryModel ? base.legendaryModel : base.model;
  const value = Math.round((6 + ilvl * 3) * (1 + RARITY_ORDER.indexOf(rarity) * 1.5));
  return {
    id: newId(), base: baseKey, name, rarity, ilvl, slot: base.slot, type: base.type,
    model: model || null, icon: base.icon || model, meshes: base.meshes || null,
    twoHanded: !!base.twoHanded, stats, affixes, value,
  };
}

// table 'bone' (skeletons) favours bone gear but can still drop regular items.
export function randomItem(ilvl, { boost = 0, minRarity = 'common', table = null } = {}) {
  const entries = Object.entries(BASES).map(([k, b]) => ({ k, w: table === 'bone' ? b.boneW ?? b.w * 0.4 : b.w }));
  const baseKey = weightedPick(entries).k;
  return makeItem(baseKey, ilvl, rollRarity(boost, minRarity));
}

// Human-readable lines for tooltips.
export function itemLines(item) {
  const s = item.stats;
  const main = [];
  if (s.dmgMin) main.push(`${s.dmgMin}–${s.dmgMax} Damage`, `${s.speed.toFixed(2)} Attacks per Second`);
  const baseArmor = BASES[item.base].armor;
  if (baseArmor) main.push(`${s.armor - (item.affixes.find((a) => a.k === 'armor')?.v || 0)} Armor`);
  const aff = item.affixes.map((a) => AFFIXES[a.k].fmt(a.v));
  const b = BASES[item.base];
  const implicit = [];
  if (b.hp) implicit.push(`+${b.hp} Max Life`);
  if (b.mp) implicit.push(`+${b.mp} Max Mana`);
  if (b.spell) implicit.push(`+${Math.round(b.spell * 100)}% Spell Power`);
  if (b.dmgPct) implicit.push(`+${Math.round(b.dmgPct * 100)}% Damage`);
  if (b.moveSpd) implicit.push(`+${Math.round(b.moveSpd * 100)}% Move Speed`);
  if (b.twoHanded) implicit.push('Two-Handed');
  return { main, implicit, aff };
}

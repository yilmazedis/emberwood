// Every item in the game, by name: the same name is always the same item (no random rolls), so a +3
// Giant Sword is a Giant Sword, three times upgraded at the anvil. Plain data and numbers (the game server
// shares it), no three.js.
//
// Items come in three classes, low (levels 1–19), middle (20–39) and high (40–60), and each hero class has
// its own weapons and clothes in each: a hero can't wear another class's (healers may also wield warriors'
// two-handed swords, spears and maces, and their shields). Accessories (rings, earrings, necklaces, belts)
// are for everyone and only drop from monsters. Unique items only drop from the roaming world bosses: weapons,
// shields, books and accessories, never clothes.
//
// An item a hero carries is { id, k: key, p: plus } (stackables { id, k, n: count }); everything else comes
// from its definition here (itemDef), so a change of balance reaches every item already found.
import { clamp, weightedPick, pick } from './util.js';

export const MAX_PLUS = 7; // upgrades: normal items start at +1, unique ones at +0
export const UPGRADE_GAIN = 0.1; // each + adds a tenth of the item's main stats
export const UNIQUE_POWER = 1.25; // a unique item is this much stronger than a normal one of its level

export const TIERS = {
  low: { id: 'low', name: 'Low class', short: 'Low', from: 1, to: 19, color: '#e8e4da', recipe: 'recipe_low' },
  mid: { id: 'mid', name: 'Middle class', short: 'Middle', from: 20, to: 39, color: '#6aa9ff', recipe: 'recipe_mid' },
  high: { id: 'high', name: 'High class', short: 'High', from: 40, to: 60, color: '#ffd84a', recipe: 'recipe_high' },
};
export const UNIQUE_COLOR = '#ff8a2b';
export const tierAt = (level) => (level >= 40 ? 'high' : level >= 20 ? 'mid' : 'low');

// Equipment slots. Two earrings and two rings: an item of either kind goes in whichever is free.
export const SLOTS = ['weapon', 'offhand', 'head', 'body', 'hands', 'feet', 'neck', 'belt', 'ear1', 'ear2', 'ring1', 'ring2'];
export const SLOT_LABEL = { weapon: 'Weapon', offhand: 'Off-hand', head: 'Helmet', body: 'Armor', hands: 'Gloves', feet: 'Boots', neck: 'Necklace', belt: 'Belt', ear1: 'Earring', ear2: 'Earring', ring1: 'Ring', ring2: 'Ring' };
export const emptyEquipment = () => Object.fromEntries(SLOTS.map((s) => [s, null]));

// ---------------------------------------------------------------- weapons
// speed: attacks a second; dps: damage per second next to a one-handed sword of the same level; reach: extra
// melee reach (m); ranged: shoots instead of swinging. Stats it always gives (spell power, attack speed…).
export const WEAPON_TYPES = {
  sword1h: { label: 'One-handed sword', hands: 1, speed: 1.25, dps: 1.0, swing: 'slash', model: 'sword_1handed' },
  axe1h: { label: 'One-handed axe', hands: 1, speed: 1.1, dps: 1.04, swing: 'slash', model: 'axe_1handed' },
  mace1h: { label: 'Mace', hands: 1, speed: 1.15, dps: 0.95, swing: 'chop', model: 'proc_mace', spell: 0.05 },
  sword2h: { label: 'Two-handed sword', hands: 2, speed: 0.95, dps: 1.26, swing: 'chop', model: 'sword_2handed' },
  axe2h: { label: 'Two-handed axe', hands: 2, speed: 0.85, dps: 1.3, swing: 'chop', model: 'axe_2handed' },
  spear: { label: 'Spear', hands: 2, speed: 1.0, dps: 1.22, reach: 0.8, swing: 'stab', model: 'proc_glaive' },
  maul: { label: 'Two-handed mace', hands: 2, speed: 0.9, dps: 1.24, swing: 'chop', model: 'proc_maul' },
  dagger: { label: 'Dagger', hands: 1, speed: 1.55, dps: 0.85, swing: 'stab', model: 'dagger', crit: 0.03 },
  bow: { label: 'Bow', hands: 2, speed: 1.05, dps: 1.0, ranged: 'arrow', model: 'bow_withString', left: true },
  staff: { label: 'Long staff', hands: 2, speed: 1.0, dps: 0.9, ranged: 'bolt', model: 'staff', spell: 0.12, atkSpd: 0.15 },
  rod: { label: 'Short staff', hands: 1, speed: 1.15, dps: 0.78, ranged: 'bolt', model: 'wand', spell: 0.06 },
};
// who may wield each kind (warriors' two-handed swords, spears and maces suit healers too)
const WIELD = {
  sword1h: ['warrior'], axe1h: ['warrior'], axe2h: ['warrior'],
  sword2h: ['warrior', 'healer'], spear: ['warrior', 'healer'], maul: ['warrior', 'healer'],
  mace1h: ['healer'], dagger: ['rogue'], bow: ['rogue'], staff: ['scientist'], rod: ['scientist'],
  shield: ['warrior', 'healer'], book: ['scientist'],
};
// one-handed weapons that also go in the off hand (two weapons at once)
export const DUAL = { warrior: ['sword1h', 'axe1h'], rogue: ['dagger'] };

// A one-handed sword's average blow at +1 for each item level (other levels in between are interpolated).
// The hero's level adds its own share on top (see Player.recompute), so items needn't do it all.
const SWORD = [[1, 7], [10, 12], [20, 20], [30, 28], [40, 37], [50, 46], [60, 56]];
const lerpTable = (t, x) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 0; i < t.length - 1; i++) if (x <= t[i + 1][0]) return t[i][1] + ((t[i + 1][1] - t[i][1]) * (x - t[i][0])) / (t[i + 1][0] - t[i][0]);
  return t[t.length - 1][1];
};
// Armor of a whole set of clothes (helmet, armor, gloves, boots) at +1, by item level; a shield adds 45% more.
const SET_ARMOR = [[1, 22], [20, 70], [40, 130], [60, 190]];
const PIECE = { head: 0.22, body: 0.4, hands: 0.18, feet: 0.2 };

// ---------------------------------------------------------------- the catalog
export const ITEMS = {};
const add = (key, def) => { ITEMS[key] = { key, ...def }; };

// weapon(key, name, type, level, extra): its damage from the table, its kind's speed and stats
function weapon(key, name, type, level, extra = {}) {
  const t = WEAPON_TYPES[type], unique = !!extra.unique;
  const avg = (lerpTable(SWORD, level) * 1.25 * t.dps) / t.speed * (unique ? UNIQUE_POWER : 1);
  const spread = type === 'axe2h' || type === 'maul' ? 0.25 : type === 'dagger' ? 0.15 : 0.2;
  const stats = { dmgMin: Math.max(1, Math.round(avg * (1 - spread))), dmgMax: Math.round(avg * (1 + spread)), speed: t.speed };
  for (const s of ['spell', 'atkSpd', 'crit']) if (t[s]) stats[s] = t[s] * (unique ? 1.2 : 1);
  Object.assign(stats, extra.stats);
  add(key, { name, kind: 'weapon', type, slot: 'weapon', classes: WIELD[type], level, tier: tierAt(level), hands: t.hands, model: t.model, ...extra, stats });
}

function shield(key, name, level, extra = {}) {
  const unique = !!extra.unique;
  const armor = Math.round(lerpTable(SET_ARMOR, level) * 0.45 * (unique ? UNIQUE_POWER : 1));
  add(key, { name, kind: 'offhand', type: 'shield', slot: 'offhand', classes: WIELD.shield, level, tier: tierAt(level), model: 'shield_round', ...extra, stats: { armor, hp: Math.round(level * 1.2 + 4), ...extra.stats } });
}

function book(key, name, level, extra = {}) {
  const unique = !!extra.unique;
  add(key, { name, kind: 'offhand', type: 'book', slot: 'offhand', classes: WIELD.book, level, tier: tierAt(level), model: 'spellbook_open', ...extra, stats: { spell: (0.1 + level * 0.0025) * (unique ? 1.25 : 1), mp: Math.round(10 + level * 2.2), ...extra.stats } });
}

// A set of clothes: four pieces for one class. look: what it does to the hero's model (helmet shown, the
// body's colour, gloves and boots); share: how much of a warrior's armor it gives, and what else it adds.
function set(prefix, name, cls, level, { share, extra, look, pieces }) {
  const total = lerpTable(SET_ARMOR, level) * share;
  for (const [slot, piece] of Object.entries(pieces)) {
    const stats = { armor: Math.max(1, Math.round(total * PIECE[slot])) };
    for (const [k, v] of Object.entries(extra)) stats[k] = (typeof v === 'function' ? v(level) : v) * PIECE[slot] * 4; // (per piece, on average)
    for (const k of ['hp', 'mp']) if (stats[k]) stats[k] = Math.round(stats[k]);
    add(`${prefix}_${slot}`, { name: `${name} ${piece}`, kind: 'armor', type: slot, slot, classes: [cls], level, tier: tierAt(level), set: prefix, look, stats });
  }
}

// ---- Warrior: blades, axes and great weapons; Plate, Chitin and Shell
weapon('short_sword', 'Short Sword', 'sword1h', 1);
weapon('large_axe', 'Large Axe', 'axe2h', 1);
weapon('blade_axe', 'Blade Axe', 'axe1h', 10, { tint: 0xd8e2ee });
weapon('giant_sword', 'Giant Sword', 'sword2h', 10);
weapon('mirage_sword', 'Mirage Sword', 'sword1h', 20, { tint: 0xbfe4ff, glow: 0x2a6aa8 });
weapon('glaive', 'Glaive', 'spear', 20);
weapon('sword_of_the_dead', 'Sword of the Dead', 'sword1h', 30, { model: 'Skeleton_Blade', tint: 0xd8d0e8, glow: 0x4a2a7a });
weapon('gigantic_axe', 'Gigantic Axe', 'axe2h', 30, { tint: 0xb8b0a8 });
weapon('raptor', 'Raptor', 'sword1h', 40, { tint: 0xffe6a0, glow: 0x8a5a10, stats: { crit: 0.03 } });
weapon('iron_impact', 'Iron Impact', 'maul', 40, { tint: 0x9aa4b0 });
weapon('wyrmfang', 'Wyrmfang', 'axe1h', 50, { tint: 0xff9a6a, glow: 0x8a2a10 });
weapon('titan_greatsword', 'Titan Greatsword', 'sword2h', 50, { model: 'sword_2handed_color', tint: 0xfff0d0, glow: 0x6a4a10 });
shield('round_shield', 'Round Shield', 1);
shield('kite_shield', 'Kite Shield', 20, { model: 'shield_square' });
shield('tower_shield', 'Tower Shield', 40, { model: 'shield_badge', tint: 0xe8e4ff });
for (const [p, n, lv] of [['plate', 'Plate', 1], ['chitin', 'Chitin', 20], ['shell', 'Shell', 40]]) {
  set(p, n, 'warrior', lv, {
    share: 1, extra: { hp: (l) => 6 + l * 0.9 },
    look: { body: { plate: 0xd9dee6, chitin: 0x7a8a5a, shell: 0xc8a050 }[p], helm: 1, metal: 0.35 },
    pieces: { head: 'Helmet', body: 'Armor', hands: 'Gauntlets', feet: 'Boots' },
  });
}

// ---- Healer: maces of their own (and warriors' great weapons and shields); Chain, Blessed and Seraph
weapon('iron_mace', 'Iron Mace', 'mace1h', 1);
weapon('morning_star', 'Morning Star', 'mace1h', 10, { tint: 0xd0d6de });
weapon('holy_mace', 'Holy Mace', 'mace1h', 20, { tint: 0xffefc0, glow: 0x6a5a10 });
weapon('flanged_mace', 'Flanged Mace', 'mace1h', 30, { tint: 0xc0c8d8 });
weapon('lightbringer', 'Lightbringer', 'mace1h', 40, { tint: 0xfff6d0, glow: 0xa88a20 });
weapon('seraph_scepter', "Seraph's Scepter", 'mace1h', 50, { model: 'proc_scepter', tint: 0xffffff, glow: 0xa8a0ff });
for (const [p, n, lv] of [['chain', 'Chain', 1], ['blessed', 'Blessed', 20], ['seraph', 'Seraph', 40]]) {
  set(p, n, 'healer', lv, {
    share: 0.85, extra: { hp: (l) => 4 + l * 0.6, mp: (l) => 4 + l * 0.6 },
    look: { body: { chain: 0xb8c0cc, blessed: 0xfff4d8, seraph: 0xf0e0ff }[p], helm: 1, metal: 0.25 },
    pieces: { head: 'Coif', body: 'Vestment', hands: 'Gloves', feet: 'Sandals' },
  });
}

// ---- Rogue: daggers (two at once) or bows; Leather, Stalker and Nightshade
weapon('dagger', 'Dagger', 'dagger', 1);
weapon('short_bow', 'Short Bow', 'bow', 1);
weapon('kris', 'Kris', 'dagger', 10, { tint: 0xd8e0e8 });
weapon('hunters_bow', "Hunter's Bow", 'bow', 10, { tint: 0xc8a070 });
weapon('stiletto', 'Stiletto', 'dagger', 20, { tint: 0xbfe0ff, glow: 0x2a5a8a });
weapon('composite_bow', 'Composite Bow', 'bow', 20, { tint: 0xa0b8d0 });
weapon('viper_fang', 'Viper Fang', 'dagger', 30, { tint: 0xa0ffb0, glow: 0x1a6a2a });
weapon('longbow', 'Longbow', 'bow', 30, { tint: 0x8a6a4a });
weapon('nightfang', 'Nightfang', 'dagger', 40, { tint: 0x9a8aff, glow: 0x3a1a8a });
weapon('elven_bow', 'Elven Bow', 'bow', 40, { tint: 0xe0ffd0, glow: 0x2a6a2a });
weapon('soul_reaper', 'Soul Reaper', 'dagger', 50, { tint: 0xff8aa0, glow: 0x7a1a3a });
weapon('dragonbone_bow', 'Dragonbone Bow', 'bow', 50, { tint: 0xfff0d8, glow: 0x7a4a1a });
for (const [p, n, lv] of [['leather', 'Leather', 1], ['stalker', 'Stalker', 20], ['nightshade', 'Nightshade', 40]]) {
  set(p, n, 'rogue', lv, {
    share: 0.7, extra: { crit: 0.006, moveSpd: 0.006 },
    look: { body: { leather: 0x9a7048, stalker: 0x4a5a48, nightshade: 0x4a3a6a }[p], helm: 0, metal: 0.05 },
    pieces: { head: 'Hood', body: 'Jerkin', hands: 'Gloves', feet: 'Boots' },
  });
}

// ---- Scientist: long staves (faster), or a short staff with a book (stronger spells); Linen, Alchemist and Aether
weapon('oak_staff', 'Oak Staff', 'staff', 1);
weapon('copper_rod', 'Copper Rod', 'rod', 1, { tint: 0xe8a070 });
weapon('ember_staff', 'Ember Staff', 'staff', 10, { tint: 0xffb080, glow: 0x6a2a08 });
weapon('galvanic_rod', 'Galvanic Rod', 'rod', 10, { tint: 0xa0d8ff, glow: 0x1a4a7a });
weapon('frostwood_staff', 'Frostwood Staff', 'staff', 20, { tint: 0xc8ecff, glow: 0x2a5a8a });
weapon('alchemist_rod', "Alchemist's Rod", 'rod', 20, { tint: 0xb0ffb0, glow: 0x1a6a1a });
weapon('stormcaller', 'Stormcaller', 'staff', 30, { model: 'Skeleton_Staff', tint: 0xd8d0ff, glow: 0x3a2a9a });
weapon('catalyst_rod', 'Catalyst Rod', 'rod', 30, { tint: 0xffe08a, glow: 0x7a5a10 });
weapon('arcanum_staff', 'Arcanum Staff', 'staff', 40, { tint: 0xe0c0ff, glow: 0x5a1a9a });
weapon('aether_rod', 'Aether Rod', 'rod', 40, { tint: 0xc0fff8, glow: 0x1a7a7a });
weapon('archmage_spire', "Archmage's Spire", 'staff', 50, { tint: 0xfff0ff, glow: 0x8a3aaa });
weapon('philosophers_rod', "Philosopher's Rod", 'rod', 50, { tint: 0xffd0e0, glow: 0x8a2a4a });
book('field_notes', 'Field Notes', 1, { model: 'spellbook_closed' });
book('codex_elements', 'Codex of Elements', 20, { tint: 0xc0e0ff });
book('tome_ascension', 'Tome of Ascension', 40, { tint: 0xffe8b0, glow: 0x6a4a10 });
for (const [p, n, lv] of [['linen', 'Linen', 1], ['alchemist', 'Alchemist', 20], ['aether', 'Aether', 40]]) {
  set(p, n, 'scientist', lv, {
    share: 0.55, extra: { mp: (l) => 6 + l * 1.1, spell: 0.006 },
    look: { body: { linen: 0xd8c8a8, alchemist: 0x6a8a5a, aether: 0x7ad0e0 }[p], helm: 1, metal: 0 },
    pieces: { head: 'Cap', body: 'Coat', hands: 'Gloves', feet: 'Shoes' },
  });
}

// ---------------------------------------------------------------- accessories (everyone; dropped only)
// Two of each kind per class of items; their stats by item level.
const ACC_LEVEL = { low: 6, mid: 22, high: 42 };
const ACC_METAL = { low: 'Copper', mid: 'Silver', high: 'Gold' };
const ACC_COLOR = { low: 0xd08a50, mid: 0xd8dde4, high: 0xf0c040 };
const ACCESSORIES = [
  ['ring', 'Ring of Strength', { dmgPct: (l) => 0.03 + l * 0.0009 }, 0xe0304a],
  ['ring', 'Ring of Vitality', { hp: (l) => 12 + l * 3 }, 0x2fd07a],
  ['ear', 'Earring of Precision', { crit: (l) => 0.02 + l * 0.0006 }, 0xffd84a],
  ['ear', 'Earring of Wisdom', { mp: (l) => 10 + l * 2.4, spell: (l) => 0.02 + l * 0.0004 }, 0x5a9bff],
  ['neck', 'Amulet of Fury', { atkSpd: (l) => 0.03 + l * 0.0008 }, 0xff6a2a],
  ['neck', 'Amulet of Warding', { armor: (l) => 4 + l * 1.4 }, 0x9ad0ff],
  ['belt', 'Belt of the Ox', { hp: (l) => 8 + l * 2, armor: (l) => 2 + l * 0.6 }, 0x8a5a34],
  ['belt', 'Belt of Swiftness', { moveSpd: (l) => 0.03 + l * 0.0005, regen: (l) => 0.6 + l * 0.08 }, 0x4a7a4a],
];
const ACC_SLOT = { ring: 'ring', ear: 'ear', neck: 'neck', belt: 'belt' };
const ACC_LABEL = { ring: 'Ring', ear: 'Earring', neck: 'Necklace', belt: 'Belt' };
function accStats(spec, level, power = 1) {
  const s = {};
  for (const [k, f] of Object.entries(spec)) {
    const v = f(level) * power;
    s[k] = k === 'hp' || k === 'mp' || k === 'armor' ? Math.round(v) : Math.round(v * 1000) / 1000;
  }
  return s;
}
for (const [tier, level] of Object.entries(ACC_LEVEL)) {
  ACCESSORIES.forEach(([kind, name, spec, gem], i) => {
    const key = `${tier}_${kind}_${i % 2}`;
    add(key, {
      name: `${ACC_METAL[tier]} ${name}`, kind: 'acc', type: kind, slot: ACC_SLOT[kind], classes: null, level, tier,
      gear: { kind, color: ACC_COLOR[tier], gem }, stats: accStats(spec, level), drop: true,
    });
  });
}

// ---------------------------------------------------------------- unique items (world bosses only)
const UNIQUE_LEVEL = { low: 12, mid: 28, high: 46 };
function uniqueAcc(key, name, tier, kind, spec, gem, extra = {}) {
  const level = UNIQUE_LEVEL[tier];
  add(key, { name, kind: 'acc', type: kind, slot: ACC_SLOT[kind], classes: null, level, tier, unique: true, gear: { kind, color: 0xff9a3a, gem, glow: 1 }, stats: accStats(spec, level, UNIQUE_POWER), ...extra });
}
{
  const U = { unique: true };
  // low: Gorehorn and the Frost Giant (Emberwood, Frostfang)
  weapon('wanderers_edge', "Wanderer's Edge", 'sword1h', 12, { ...U, tint: 0xffd8a0, glow: 0xff6a10, stats: { atkSpd: 0.06 } });
  weapon('ogre_splitter', 'Ogre Splitter', 'axe2h', 12, { ...U, tint: 0xd8c0a0, glow: 0xff6a10, stats: { crit: 0.04 } });
  weapon('mace_of_dawn', 'Mace of Dawn', 'mace1h', 12, { ...U, tint: 0xffe8b0, glow: 0xffb030, stats: { regen: 3 } });
  weapon('whisper', 'Whisper', 'dagger', 12, { ...U, tint: 0xd0f0ff, glow: 0x4ab0ff, stats: { moveSpd: 0.05 } });
  weapon('windstring', 'Windstring', 'bow', 12, { ...U, tint: 0xe8ffe0, glow: 0x6aff8a, stats: { atkSpd: 0.08 } });
  weapon('cinderwood_staff', 'Cinderwood Staff', 'staff', 12, { ...U, tint: 0xffa070, glow: 0xff4a10, stats: { mp: 40 } });
  weapon('spark_coil', 'Spark Coil', 'rod', 12, { ...U, tint: 0xa0e8ff, glow: 0x30a0ff, stats: { crit: 0.05 } });
  shield('meadow_aegis', 'Aegis of the Meadow', 12, { ...U, model: 'shield_round_color', glow: 0xff8a2a, stats: { regen: 2 } });
  book('grimoire_sparks', 'Grimoire of Sparks', 12, { ...U, model: 'spellbook_open', tint: 0xffd0a0, glow: 0xff6a10 });
  uniqueAcc('band_wanderer', 'Band of the Wanderer', 'low', 'ring', { hp: (l) => 12 + l * 3, dmgPct: (l) => 0.02 + l * 0.0006 }, 0xff8a2a);
  uniqueAcc('moonstone_earring', 'Moonstone Earring', 'low', 'ear', { crit: (l) => 0.02 + l * 0.0006, mp: (l) => 8 + l * 2 }, 0xd0e8ff);
  uniqueAcc('pendant_wild', 'Pendant of the Wild', 'low', 'neck', { atkSpd: (l) => 0.03 + l * 0.0008, moveSpd: () => 0.03 }, 0x6aff6a);
  uniqueAcc('girdle_giants', 'Girdle of Giants', 'low', 'belt', { hp: (l) => 14 + l * 2.6, armor: (l) => 3 + l * 0.8 }, 0xc8a050);
  // middle: Ignis the Living Pyre (Cinderfall)
  weapon('emberbrand', 'Emberbrand', 'sword1h', 28, { ...U, tint: 0xffb070, glow: 0xff3a00, stats: { crit: 0.04 } });
  weapon('ashbringer', 'Ashbringer', 'sword2h', 28, { ...U, model: 'sword_2handed_color', tint: 0xffc890, glow: 0xff4a10, stats: { atkSpd: 0.06 } });
  weapon('pyre_mace', 'Pyre Mace', 'mace1h', 28, { ...U, tint: 0xffa060, glow: 0xff4a00, stats: { spell: 0.08 } });
  weapon('cinderkiss', 'Cinderkiss', 'dagger', 28, { ...U, tint: 0xffc0a0, glow: 0xff5a20, stats: { crit: 0.05 } });
  weapon('phoenix_bow', 'Phoenix Bow', 'bow', 28, { ...U, tint: 0xffd090, glow: 0xff6a10, stats: { dmgPct: 0.06 } });
  weapon('burning_sun', 'Staff of the Burning Sun', 'staff', 28, { ...U, model: 'Skeleton_Staff', tint: 0xffd0a0, glow: 0xff5a10, stats: { spell: 0.1 } });
  weapon('volatile_rod', 'Volatile Rod', 'rod', 28, { ...U, tint: 0xffe070, glow: 0xff8a10, stats: { atkSpd: 0.08 } });
  shield('obsidian_bulwark', 'Obsidian Bulwark', 28, { ...U, model: 'shield_spikes_color', tint: 0x8a8090, glow: 0xff4a10 });
  book('codex_ignis', 'Codex Ignis', 28, { ...U, tint: 0xffb080, glow: 0xff4a10 });
  uniqueAcc('salamander_ring', 'Ring of the Salamander', 'mid', 'ring', { dmgPct: (l) => 0.03 + l * 0.0009, crit: () => 0.02 }, 0xff4a10);
  uniqueAcc('ember_earring', 'Earring of Embers', 'mid', 'ear', { crit: (l) => 0.02 + l * 0.0006, spell: (l) => 0.02 + l * 0.0008 }, 0xff8a2a);
  uniqueAcc('heart_forge', 'Heart of the Forge', 'mid', 'neck', { armor: (l) => 4 + l * 1.4, hp: (l) => 10 + l * 2 }, 0xff6a10);
  uniqueAcc('belt_ashen', 'Belt of the Ashen King', 'mid', 'belt', { hp: (l) => 10 + l * 2, regen: (l) => 0.6 + l * 0.08, moveSpd: () => 0.03 }, 0x8a2a10);
  // high: Umbra the Devourer (Shadowmere)
  weapon('nightbane', 'Nightbane', 'sword1h', 46, { ...U, tint: 0xc0a8ff, glow: 0x6a2aff, stats: { crit: 0.05 } });
  weapon('abyssal_reaver', 'Abyssal Reaver', 'axe2h', 46, { ...U, tint: 0xa898d0, glow: 0x8a2aff, stats: { atkSpd: 0.06 } });
  weapon('halo_mercy', 'Halo of Mercy', 'mace1h', 46, { ...U, model: 'proc_scepter', tint: 0xffffff, glow: 0xd0b0ff, stats: { spell: 0.1, regen: 6 } });
  weapon('voidstep', 'Voidstep', 'dagger', 46, { ...U, tint: 0xd0b8ff, glow: 0x7a3aff, stats: { moveSpd: 0.06 } });
  weapon('starfall_bow', 'Starfall Bow', 'bow', 46, { ...U, tint: 0xe8e0ff, glow: 0x9a6aff, stats: { crit: 0.05 } });
  weapon('staff_eternity', 'Staff of Eternity', 'staff', 46, { ...U, tint: 0xf0e0ff, glow: 0xb06aff, stats: { mp: 90 } });
  weapon('singularity_rod', 'Singularity Rod', 'rod', 46, { ...U, tint: 0xd8c8ff, glow: 0x8a4aff, stats: { spell: 0.08 } });
  shield('wall_shadows', 'Wall of Shadows', 46, { ...U, model: 'shield_badge_color', tint: 0xb0a0d0, glow: 0x6a2aff });
  book('tome_void', 'Tome of the Void', 46, { ...U, tint: 0xd0c0ff, glow: 0x7a3aff });
  uniqueAcc('ring_nyxara', 'Ring of Nyxara', 'high', 'ring', { dmgPct: (l) => 0.03 + l * 0.0009, hp: (l) => 10 + l * 2 }, 0xff4ad8);
  uniqueAcc('tear_abyss', 'Tear of the Abyss', 'high', 'ear', { mp: (l) => 10 + l * 2.4, spell: (l) => 0.03 + l * 0.0009 }, 0xb07aff);
  uniqueAcc('amulet_eternity', 'Amulet of Eternity', 'high', 'neck', { atkSpd: (l) => 0.03 + l * 0.0008, crit: () => 0.03 }, 0xd0b0ff);
  uniqueAcc('belt_hollow', 'Belt of the Hollow King', 'high', 'belt', { hp: (l) => 14 + l * 2.6, armor: (l) => 3 + l * 0.8 }, 0x9a6aff);
}
export const UNIQUES = { low: [], mid: [], high: [] };
for (const d of Object.values(ITEMS)) if (d.unique) UNIQUES[d.tier].push(d.key);

// ---------------------------------------------------------------- things you use up
// potions heal (or fill mana) by a share of the maximum; elixirs boost for ten minutes; the camp scroll takes
// you to the camp of the land you're in; recipes are what the anvil needs to upgrade an item.
const stack = (key, def) => add(key, { stack: def.stack || 50, ...def });
stack('hp_potion_1', { name: 'Minor Healing Potion', kind: 'potion', use: 'hp', amount: 0.3, level: 1, price: 15, icon: 'potion_red', desc: 'Restores 30% of your maximum Life.' });
stack('hp_potion_2', { name: 'Healing Potion', kind: 'potion', use: 'hp', amount: 0.45, level: 15, price: 70, icon: 'potion_red2', desc: 'Restores 45% of your maximum Life.' });
stack('hp_potion_3', { name: 'Greater Healing Potion', kind: 'potion', use: 'hp', amount: 0.6, level: 35, price: 240, icon: 'potion_red3', desc: 'Restores 60% of your maximum Life.' });
stack('mp_potion_1', { name: 'Minor Mana Potion', kind: 'potion', use: 'mp', amount: 0.3, level: 1, price: 15, icon: 'potion_blue', desc: 'Restores 30% of your maximum Mana.' });
stack('mp_potion_2', { name: 'Mana Potion', kind: 'potion', use: 'mp', amount: 0.45, level: 15, price: 70, icon: 'potion_blue2', desc: 'Restores 45% of your maximum Mana.' });
stack('mp_potion_3', { name: 'Greater Mana Potion', kind: 'potion', use: 'mp', amount: 0.6, level: 35, price: 240, icon: 'potion_blue3', desc: 'Restores 60% of your maximum Mana.' });
stack('elixir_might', { name: 'Elixir of Might', kind: 'elixir', buff: 'elixir_might', level: 5, price: 250, stack: 20, icon: 'elixir_red', desc: '+10% damage for 10 minutes.' });
stack('elixir_iron', { name: 'Elixir of Iron', kind: 'elixir', buff: 'elixir_iron', level: 5, price: 250, stack: 20, icon: 'elixir_grey', desc: '+20% armor for 10 minutes.' });
stack('elixir_vigor', { name: 'Elixir of Vigor', kind: 'elixir', buff: 'elixir_vigor', level: 5, price: 250, stack: 20, icon: 'elixir_green', desc: '+10% maximum Life for 10 minutes.' });
stack('camp_scroll', { name: 'Camp Scroll', kind: 'scroll', level: 1, price: 40, stack: 20, icon: 'scroll', desc: 'Read it to return to the camp of the land you are in (it takes a few seconds; being hit breaks it).' });
stack('recipe_low', { name: 'Low Class Upgrade Recipe', kind: 'recipe', tier: 'low', level: 1, price: 900, stack: 20, icon: 'recipe_low', desc: 'The anvil in Emberwood camp upgrades a low class item one step with it. It never fails.' });
stack('recipe_mid', { name: 'Middle Class Upgrade Recipe', kind: 'recipe', tier: 'mid', level: 1, price: 6500, stack: 20, icon: 'recipe_mid', desc: 'The anvil in Emberwood camp upgrades a middle class item one step with it. It never fails.' });
stack('recipe_high', { name: 'High Class Upgrade Recipe', kind: 'recipe', tier: 'high', level: 1, price: 32000, stack: 20, icon: 'recipe_high', desc: 'The anvil in Emberwood camp upgrades a high class item one step with it. It never fails.' });

// Elixirs' boosts (Player.recompute applies them; they last through travel and saves).
export const ELIXIRS = {
  elixir_might: { dur: 600, dmgPct: 0.1, name: 'Might' },
  elixir_iron: { dur: 600, armorPct: 0.2, name: 'Iron' },
  elixir_vigor: { dur: 600, hpPct: 0.1, name: 'Vigor' },
};

// ---------------------------------------------------------------- prices
// What merchants ask for an item (selling one brings a quarter, more for upgrades).
const PRICE = [[1, 40], [10, 450], [20, 1800], [30, 4500], [40, 9500], [50, 18000], [60, 30000]];
for (const d of Object.values(ITEMS)) {
  if (d.price) continue;
  const base = lerpTable(PRICE, d.level);
  d.price = Math.round((d.kind === 'weapon' ? base : d.kind === 'offhand' ? base * 0.7 : d.kind === 'armor' ? base * 0.45 : base * 0.8) * (d.unique ? 4 : 1) / 5) * 5;
}

// ---------------------------------------------------------------- items in a hero's hands
let uid = 1;
export const newId = () => `${Date.now().toString(36)}-${(uid++).toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;
export const itemDef = (it) => (it && ITEMS[it.k]) || null;
export const isStack = (it) => !!itemDef(it)?.stack;

// A fresh item: normal items +1, unique ones +0; stackables n of them.
export function makeItem(key, opts = {}) {
  const d = ITEMS[key];
  if (!d) throw new Error(`no such item ${key}`);
  if (d.stack) return { id: newId(), k: key, n: clamp(opts.n ?? 1, 1, d.stack) };
  return { id: newId(), k: key, p: clamp(opts.p ?? (d.unique ? 0 : 1), d.unique ? 0 : 1, MAX_PLUS) };
}

// How strong an item is at its plus: 1 at +1 (normal) or +0 (unique), a tenth more for each step.
export const plusMult = (it) => { const d = itemDef(it); return 1 + UPGRADE_GAIN * ((it.p ?? 0) - (d?.unique ? 0 : 1)); };

// The item's stats at its plus: damage, armor, life and mana grow; percentages grow half as fast.
export function itemStats(it) {
  const d = itemDef(it);
  if (!d?.stats) return {};
  const m = plusMult(it), half = 1 + (m - 1) * 0.5, out = {};
  for (const [k, v] of Object.entries(d.stats)) {
    if (k === 'speed') out[k] = v;
    else if (k === 'dmgMin' || k === 'dmgMax' || k === 'armor' || k === 'hp' || k === 'mp') out[k] = Math.round(v * m);
    else out[k] = v * half;
  }
  return out;
}

export const itemName = (it) => { const d = itemDef(it); return d ? (d.stack ? d.name : `+${it.p ?? 0} ${d.name}`) : 'Unknown item'; };
export const itemColor = (it) => { const d = itemDef(it); return !d ? '#888' : d.unique ? UNIQUE_COLOR : d.tier && !d.stack ? TIERS[d.tier].color : '#e8e4da'; };

// Can a hero of this class and level wear it? Returns null if so, else why not.
export function cannotUse(it, cls, level) {
  const d = itemDef(it);
  if (!d) return 'Unknown item';
  if (d.classes && !d.classes.includes(cls)) return `For ${d.classes.map((c) => CLASS_NAME[c]).join(' and ')}s only`;
  if (level < d.level) return `Needs level ${d.level}`;
  return null;
}
const CLASS_NAME = { warrior: 'Warrior', healer: 'Healer', rogue: 'Rogue', scientist: 'Scientist' };

// The slots an item can go in (two for earrings and rings; the off hand too for weapons held two at once).
export function slotsFor(it, cls) {
  const d = itemDef(it);
  if (!d || d.stack) return [];
  if (d.slot === 'ring') return ['ring1', 'ring2'];
  if (d.slot === 'ear') return ['ear1', 'ear2'];
  if (d.kind === 'weapon' && d.hands === 1 && DUAL[cls]?.includes(d.type)) return ['weapon', 'offhand'];
  return [d.slot];
}

// What it sells for at a merchant, and what upgrading it costs at the anvil.
export function sellPrice(it) {
  const d = itemDef(it);
  if (!d) return 0;
  if (d.stack) return Math.max(1, Math.floor((d.price * (it.n || 1)) / 4));
  return Math.round((d.price / 4) * (1 + 0.5 * Math.max(0, (it.p ?? 0) - (d.unique ? 0 : 1))));
}

// Upgrading from +p to +(p+1): recipes of the item's class (more for the last steps) and a smith's fee.
export function upgradeCost(it) {
  const d = itemDef(it);
  if (!d || d.stack || (it.p ?? 0) >= MAX_PLUS) return null;
  const next = (it.p ?? 0) + 1;
  const recipes = next >= 7 ? 3 : next >= 5 ? 2 : 1;
  return { recipe: TIERS[d.tier].recipe, recipes, gold: Math.round(d.price * 0.05 * next / 5) * 5 + 10 };
}

// ---------------------------------------------------------------- loot
// A monster's drop at its level: a weapon, offhand or clothes of any class (more often the finder's), or an
// accessory; never better than a step above the monster.
export function rollDrop(level, cls) {
  const tier = tierAt(level);
  const roll = Math.random();
  if (roll < 0.28) { // an accessory of this class of items
    const keys = Object.values(ITEMS).filter((d) => d.kind === 'acc' && !d.unique && d.tier === tier && d.level <= level + 4).map((d) => d.key);
    if (keys.length) return makeItem(pick(keys));
  }
  // weapons and clothes no more than a few levels above the monster, and not far below it
  const fits = (d) => !d.unique && !d.stack && d.kind !== 'acc' && d.level <= level + 2 && d.level >= Math.max(1, level - 14);
  const pool = Object.values(ITEMS).filter(fits);
  if (!pool.length) return null;
  const d = weightedPick(pool.map((x) => ({ x, w: (x.classes?.includes(cls) ? 3 : 1) * (x.kind === 'armor' ? 0.6 : 1) }))).x;
  return makeItem(d.key);
}

// A potion now and then, of the right strength.
export function rollPotion(level) {
  const g = level >= 35 ? 3 : level >= 15 ? 2 : 1;
  return makeItem(`${Math.random() < 0.65 ? 'hp' : 'mp'}_potion_${g}`);
}

// A world boss's unique: one of its class of items, each as likely as the next.
export const rollUnique = (tier) => makeItem(pick(UNIQUES[tier]));

// ---------------------------------------------------------------- tooltips
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
export const STAT_LINES = [
  ['armor', (v) => `+${v} Armor`], ['hp', (v) => `+${v} Max Life`], ['mp', (v) => `+${v} Max Mana`],
  ['dmgPct', (v) => `+${pct(v)} Damage`], ['spell', (v) => `+${pct(v)} Spell Power`], ['atkSpd', (v) => `+${pct(v)} Attack Speed`],
  ['crit', (v) => `+${pct(v)} Critical Chance`], ['moveSpd', (v) => `+${pct(v)} Move Speed`], ['regen', (v) => `+${v.toFixed(1)} Life per Second`],
];

// Lines for an item's tooltip: { main: damage and armor lines, stats: the rest }.
export function itemLines(it) {
  const d = itemDef(it), s = itemStats(it), main = [], stats = [];
  if (!d) return { main, stats };
  if (s.dmgMin) main.push(`${s.dmgMin}–${s.dmgMax} Damage`, `${s.speed.toFixed(2)} Attacks per Second`);
  for (const [k, fmt] of STAT_LINES) {
    if (!s[k]) continue;
    if (k === 'armor' && (d.kind === 'armor' || d.type === 'shield')) main.push(`${s[k]} Armor`);
    else stats.push(fmt(s[k]));
  }
  return { main, stats };
}

// The item's type line: "Middle class · Two-handed sword", "Unique · Ring"…
export function typeLine(it) {
  const d = itemDef(it);
  if (!d) return '';
  const what = d.kind === 'weapon' ? WEAPON_TYPES[d.type].label : d.kind === 'offhand' ? (d.type === 'shield' ? 'Shield' : 'Book') : d.kind === 'armor' ? SLOT_LABEL[d.slot] : d.kind === 'acc' ? ACC_LABEL[d.type] : { potion: 'Potion', elixir: 'Elixir', scroll: 'Scroll', recipe: 'Upgrade recipe' }[d.kind];
  if (d.stack) return what;
  return `${d.unique ? 'Unique' : TIERS[d.tier].name} · ${what}`;
}

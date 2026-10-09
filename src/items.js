// Every item in the game, by name: the same name is always the same item (no random rolls), so a +3
// Giant Sword is a Giant Sword, three times upgraded at the anvil. Plain data and numbers (the game server
// shares it), no three.js.
//
// Items come in three classes, low (levels 1–19), middle (20–39) and high (40–80), and each hero class has
// its own weapons and clothes in each: a hero can't wear another class's (healers may also wield warriors'
// two-handed swords, spears and maces, and their shields). Accessories (rings, earrings, necklaces, belts)
// are for everyone and only drop from monsters. Unique items only drop from the roaming world bosses: weapons,
// shields, books and accessories, never clothes.
//
// What an item is stays its own: a weapon's damage and speed, the armor of clothes and shields. Everything
// else it gives is attributes (Strength, Agility, Intelligence: attributes.js says what they do), so the same
// points a hero spends at each level come from gear too.
//
// An item a hero carries is { id, k: key, p: plus } (stackables { id, k, n: count }); everything else comes
// from its definition here (itemDef), so a change of balance reaches every item already found.
import { clamp, weightedPick, pick } from './util.js';

export const MAX_PLUS = 10; // upgrades: normal items start at +1, unique ones at +0; weapons, shields and books
// go up to +10 (and glow from +8: enchant.js), clothes and accessories to +7
export const maxPlus = (d) => (d && (d.slot === 'weapon' || d.slot === 'offhand') ? MAX_PLUS : 7);
export const UPGRADE_GAIN = 0.1; // each + adds a tenth of the item's main stats
export const UNIQUE_POWER = 1.25; // a unique item is this much stronger than a normal one of its level
export const RARE_POWER = 1.1; // and a rare one (the Death Canyon's) this much

export const TIERS = {
  low: { id: 'low', name: 'Low class', short: 'Low', from: 1, to: 19, color: '#e8e4da', recipe: 'recipe_low' },
  mid: { id: 'mid', name: 'Middle class', short: 'Middle', from: 20, to: 39, color: '#6aa9ff', recipe: 'recipe_mid' },
  high: { id: 'high', name: 'High class', short: 'High', from: 40, to: 80, color: '#ffd84a', recipe: 'recipe_high' },
  // only the Death Canyon's monsters carry these (rollRare), and only its monsters the recipes to upgrade them
  rare: { id: 'rare', name: 'Rare', short: 'Rare', from: 70, to: 80, color: '#e05cff', recipe: 'recipe_rare' },
};
export const UNIQUE_COLOR = '#ff8a2b';
export const tierAt = (level) => (level >= 40 ? 'high' : level >= 20 ? 'mid' : 'low');

// Equipment slots. Two earrings and two rings: an item of either kind goes in whichever is free.
export const SLOTS = ['weapon', 'offhand', 'head', 'body', 'hands', 'feet', 'neck', 'belt', 'ear1', 'ear2', 'ring1', 'ring2'];
export const SLOT_LABEL = { weapon: 'Weapon', offhand: 'Off-hand', head: 'Helmet', body: 'Armor', hands: 'Gloves', feet: 'Boots', neck: 'Necklace', belt: 'Belt', ear1: 'Earring', ear2: 'Earring', ring1: 'Ring', ring2: 'Ring' };
export const emptyEquipment = () => Object.fromEntries(SLOTS.map((s) => [s, null]));

// ---------------------------------------------------------------- attributes
export const ATTRS = ['str', 'agi', 'int'];
export const ATTR_NAME = { str: 'Strength', agi: 'Agility', int: 'Intelligence' };
export const ATTR_SHORT = { str: 'STR', agi: 'AGI', int: 'INT' };
// The attribute points an item gives at +1: a budget by its level, times its slot's weight (a two-handed
// weapon or a book more than gloves), shared out by its mix ({ str: 3, agi: 1 }: three quarters Strength).
const budget = (level) => 3 + 0.3 * level;
export const WEIGHT = { head: 0.7, body: 1.1, hands: 0.5, feet: 0.6, shield: 1.0, book: 1.5, ring: 0.8, ear: 0.8, neck: 0.9, belt: 0.8 };
function attrs(level, weight, mix, power = 1) {
  const total = budget(level) * weight * power, sum = Object.values(mix).reduce((a, b) => a + b, 0), out = {};
  for (const [k, share] of Object.entries(mix)) if (share > 0) out[k] = Math.max(1, Math.round((total * share) / sum));
  return out;
}
// a unique's mix: its kind's, with a fair share more of its own flavour
const flavour = (mix, extra) => (extra ? { ...mix, [extra]: (mix[extra] || 0) + Object.values(mix).reduce((a, b) => a + b, 0) * 0.4 } : mix);

// ---------------------------------------------------------------- weapons
// speed: attacks a second; dps: damage per second next to a one-handed sword of the same level; reach: extra
// melee reach (m); ranged: shoots instead of swinging. weight and mix: the attributes it gives (see attrs).
export const WEAPON_TYPES = {
  sword1h: { label: 'One-handed sword', hands: 1, speed: 1.25, dps: 1.0, swing: 'slash', model: 'sword_1handed', weight: 1.2, mix: { str: 1 } },
  axe1h: { label: 'One-handed axe', hands: 1, speed: 1.1, dps: 1.04, swing: 'slash', model: 'axe_1handed', weight: 1.2, mix: { str: 4, agi: 1 } },
  mace1h: { label: 'Mace', hands: 1, speed: 1.15, dps: 0.95, swing: 'chop', model: 'proc_mace', weight: 1.2, mix: { int: 1, str: 1 } },
  sword2h: { label: 'Two-handed sword', hands: 2, speed: 0.95, dps: 1.26, swing: 'chop', model: 'sword_2handed', weight: 1.7, mix: { str: 1 } },
  axe2h: { label: 'Two-handed axe', hands: 2, speed: 0.85, dps: 1.3, swing: 'chop', model: 'axe_2handed', weight: 1.7, mix: { str: 4, agi: 1 } },
  spear: { label: 'Spear', hands: 2, speed: 1.0, dps: 1.22, reach: 0.8, swing: 'stab', model: 'proc_glaive', weight: 1.7, mix: { str: 3, agi: 2 } },
  maul: { label: 'Two-handed mace', hands: 2, speed: 0.9, dps: 1.24, swing: 'chop', model: 'proc_maul', weight: 1.7, mix: { str: 1 } },
  dagger: { label: 'Dagger', hands: 1, speed: 1.55, dps: 0.85, swing: 'stab', model: 'dagger', weight: 1.0, mix: { agi: 3, str: 2 } },
  bow: { label: 'Bow', hands: 2, speed: 1.05, dps: 1.0, ranged: 'arrow', model: 'bow_withString', left: true, weight: 1.7, mix: { agi: 3, str: 2 } },
  staff: { label: 'Long staff', hands: 2, speed: 1.15, dps: 1.035, ranged: 'bolt', model: 'staff', weight: 1.8, mix: { int: 4, agi: 1 } },
  rod: { label: 'Short staff', hands: 1, speed: 1.15, dps: 0.78, ranged: 'bolt', model: 'wand', weight: 1.0, mix: { int: 3, agi: 1 } },
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
const SWORD = [[1, 7], [10, 12], [20, 20], [30, 28], [40, 37], [50, 46], [60, 56], [70, 66], [80, 76]];
const lerpTable = (t, x) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 0; i < t.length - 1; i++) if (x <= t[i + 1][0]) return t[i][1] + ((t[i + 1][1] - t[i][1]) * (x - t[i][0])) / (t[i + 1][0] - t[i][0]);
  return t[t.length - 1][1];
};
// Armor of a whole set of clothes (helmet, armor, gloves, boots) at +1, by item level; a shield adds 45% more.
const SET_ARMOR = [[1, 22], [20, 70], [40, 130], [60, 190], [80, 250]];
const PIECE = { head: 0.22, body: 0.4, hands: 0.18, feet: 0.2 };

// ---------------------------------------------------------------- the catalog
export const ITEMS = {};
const add = (key, def) => { ITEMS[key] = { key, ...def }; };

// weapon(key, name, type, level, extra): its damage from the table, its kind's speed and attributes (a
// unique: more of everything, and more of its own attribute, extra.flavour)
function weapon(key, name, type, level, extra = {}) {
  const t = WEAPON_TYPES[type], unique = !!extra.unique, power = unique ? UNIQUE_POWER : extra.tier === 'rare' ? RARE_POWER : 1;
  const avg = (lerpTable(SWORD, level) * 1.25 * t.dps) / t.speed * power;
  const spread = type === 'axe2h' || type === 'maul' ? 0.25 : type === 'dagger' ? 0.15 : 0.2;
  const stats = { dmgMin: Math.max(1, Math.round(avg * (1 - spread))), dmgMax: Math.round(avg * (1 + spread)), speed: t.speed, ...attrs(level, t.weight, flavour(t.mix, extra.flavour), power) };
  add(key, { name, kind: 'weapon', type, slot: 'weapon', classes: WIELD[type], level, tier: tierAt(level), hands: t.hands, model: t.model, ...extra, stats });
}

function shield(key, name, level, extra = {}) {
  const power = extra.unique ? UNIQUE_POWER : extra.tier === 'rare' ? RARE_POWER : 1;
  const armor = Math.round(lerpTable(SET_ARMOR, level) * 0.45 * power);
  add(key, { name, kind: 'offhand', type: 'shield', slot: 'offhand', classes: WIELD.shield, level, tier: tierAt(level), model: 'shield_round', ...extra, stats: { armor, ...attrs(level, WEIGHT.shield, flavour({ str: 3, agi: 1 }, extra.flavour), power) } });
}

function book(key, name, level, extra = {}) {
  const power = extra.unique ? UNIQUE_POWER : extra.tier === 'rare' ? RARE_POWER : 1;
  add(key, { name, kind: 'offhand', type: 'book', slot: 'offhand', classes: WIELD.book, level, tier: tierAt(level), model: 'spellbook_open', ...extra, stats: attrs(level, WEIGHT.book, flavour({ int: 3, str: 1 }, extra.flavour), power) });
}

// A set of clothes: four pieces for one class. look: what it does to the hero's model (helmet shown, the
// body's colour, gloves and boots); share: how much of a warrior's armor it gives; mix: its attributes.
function set(prefix, name, cls, level, { share, mix, look, pieces, tier = tierAt(level) }) {
  const power = tier === 'rare' ? RARE_POWER : 1, total = lerpTable(SET_ARMOR, level) * share * power;
  for (const [slot, piece] of Object.entries(pieces)) {
    const stats = { armor: Math.max(1, Math.round(total * PIECE[slot])), ...attrs(level, WEIGHT[slot], mix, power) };
    add(`${prefix}_${slot}`, { name: `${name} ${piece}`, kind: 'armor', type: slot, slot, classes: [cls], level, tier, set: prefix, look, stats });
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
weapon('raptor', 'Raptor', 'sword1h', 40, { tint: 0xffe6a0, glow: 0x8a5a10 });
weapon('iron_impact', 'Iron Impact', 'maul', 40, { tint: 0x9aa4b0 });
weapon('wyrmfang', 'Wyrmfang', 'axe1h', 50, { tint: 0xff9a6a, glow: 0x8a2a10 });
weapon('titan_greatsword', 'Titan Greatsword', 'sword2h', 50, { model: 'sword_2handed_color', tint: 0xfff0d0, glow: 0x6a4a10 });
shield('round_shield', 'Round Shield', 1);
shield('kite_shield', 'Kite Shield', 20, { model: 'shield_square' });
shield('tower_shield', 'Tower Shield', 40, { model: 'shield_badge', tint: 0xe8e4ff });
for (const [p, n, lv] of [['plate', 'Plate', 1], ['chitin', 'Chitin', 20], ['shell', 'Shell', 40]]) {
  set(p, n, 'warrior', lv, {
    share: 1, mix: { str: 4, agi: 1 },
    look: { body: { plate: 0xd9dee6, chitin: 0x7a8a5a, shell: 0xc8a050 }[p], helm: 1, metal: 0.35 },
    pieces: { head: 'Helmet', body: 'Armor', hands: 'Gauntlets', feet: 'Boots' },
  });
}

// ---- Healer (Emberwood's doctor): maces of their own (and warriors' great weapons and shields); Chain, Apothecary
// and Physician
weapon('iron_mace', 'Iron Mace', 'mace1h', 1);
weapon('morning_star', 'Morning Star', 'mace1h', 10, { tint: 0xd0d6de });
weapon('holy_mace', 'Bonesetter', 'mace1h', 20, { tint: 0xe0f0e8, glow: 0x2a6a4a });
weapon('flanged_mace', 'Flanged Mace', 'mace1h', 30, { tint: 0xc0c8d8 });
weapon('lightbringer', 'Lifewarden', 'mace1h', 40, { tint: 0xe8fff0, glow: 0x2aa86a });
weapon('seraph_scepter', "Physician's Scepter", 'mace1h', 50, { model: 'proc_scepter', tint: 0xffffff, glow: 0x6affb0 });
for (const [p, n, lv] of [['chain', 'Chain', 1], ['blessed', 'Apothecary', 20], ['seraph', 'Physician', 40]]) { // (keys kept for saves)
  set(p, n, 'healer', lv, {
    share: 0.85, mix: { int: 1, str: 1 },
    look: { body: { chain: 0xb8c0cc, blessed: 0xd8ecdc, seraph: 0xf4f8fa }[p], helm: 1, metal: 0.25 },
    pieces: { head: 'Coif', body: 'Coat', hands: 'Gloves', feet: 'Boots' },
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
    share: 0.7, mix: { agi: 3, str: 1 },
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
    share: 0.55, mix: { int: 3, str: 2 },
    look: { body: { linen: 0xd8c8a8, alchemist: 0x6a8a5a, aether: 0x7ad0e0 }[p], helm: 1, metal: 0 },
    pieces: { head: 'Cap', body: 'Coat', hands: 'Gloves', feet: 'Shoes' },
  });
}

// ---------------------------------------------------------------- accessories (everyone; dropped only)
// Two of each kind per class of items; their attributes by item level.
const ACC_LEVEL = { low: 6, mid: 22, high: 42, rare: 72 };
const ACC_METAL = { low: 'Copper', mid: 'Silver', high: 'Gold', rare: 'Obsidian' };
const ACC_COLOR = { low: 0xd08a50, mid: 0xd8dde4, high: 0xf0c040, rare: 0x4a3a4a };
const ACCESSORIES = [
  ['ring', 'Ring of Strength', { str: 1 }, 0xe0304a],
  ['ring', 'Ring of Agility', { agi: 1 }, 0x2fd07a],
  ['ear', 'Earring of Precision', { agi: 1 }, 0xffd84a],
  ['ear', 'Earring of Wisdom', { int: 1 }, 0x5a9bff],
  ['neck', 'Amulet of Fury', { str: 1, agi: 1 }, 0xff6a2a],
  ['neck', 'Amulet of Warding', { str: 1, int: 1 }, 0x9ad0ff],
  ['belt', 'Belt of the Ox', { str: 1 }, 0x8a5a34],
  ['belt', 'Belt of Swiftness', { agi: 1, int: 1 }, 0x4a7a4a],
];
const ACC_SLOT = { ring: 'ring', ear: 'ear', neck: 'neck', belt: 'belt' };
const ACC_LABEL = { ring: 'Ring', ear: 'Earring', neck: 'Necklace', belt: 'Belt' };
for (const [tier, level] of Object.entries(ACC_LEVEL)) {
  ACCESSORIES.forEach(([kind, name, mix, gem], i) => {
    const key = `${tier}_${kind}_${i % 2}`;
    add(key, {
      name: `${ACC_METAL[tier]} ${name}`, kind: 'acc', type: kind, slot: ACC_SLOT[kind], classes: null, level, tier,
      gear: { kind, color: ACC_COLOR[tier], gem, glow: tier === 'rare' ? 1 : 0 }, stats: attrs(level, WEIGHT[kind], mix, tier === 'rare' ? RARE_POWER : 1), drop: true,
    });
  });
}

// ---------------------------------------------------------------- rare items (the Death Canyon's monsters only)
// Level 70, a tenth stronger than a normal item of their level, upgraded with rare recipes (also only there).
{
  const R = { tier: 'rare' }, L = 70;
  weapon('dragonspine', 'Dragonspine Blade', 'sword1h', L, { ...R, tint: 0xffb0a0, glow: 0xff3a2a });
  weapon('canyon_cleaver', 'Canyon Cleaver', 'axe1h', L, { ...R, tint: 0xd8a080, glow: 0xff6a1a });
  weapon('titans_wrath', "Titan's Wrath", 'sword2h', L, { ...R, model: 'sword_2handed_color', tint: 0xffd0b0, glow: 0xff4a1a });
  weapon('earthsplitter', 'Earthsplitter', 'axe2h', L, { ...R, tint: 0xc89070, glow: 0xffa040 });
  weapon('dawnbreaker', 'Dawnbreaker', 'mace1h', L, { ...R, model: 'proc_scepter', tint: 0xfff4d0, glow: 0xffd060 });
  weapon('judgement_maul', 'Maul of Reckoning', 'maul', L, { ...R, tint: 0xf0e0c0, glow: 0xffc040 });
  weapon('viper_queen', 'Viper Queen', 'dagger', L, { ...R, tint: 0xc0ffb0, glow: 0x3aff6a });
  weapon('stormstring', 'Stormstring', 'bow', L, { ...R, tint: 0xd0e8ff, glow: 0x4ab0ff });
  weapon('cataclysm_staff', 'Staff of Cataclysm', 'staff', L, { ...R, model: 'Skeleton_Staff', tint: 0xffc0a0, glow: 0xff3a10 });
  weapon('quake_rod', 'Quake Rod', 'rod', L, { ...R, tint: 0xe0c090, glow: 0xffa020 });
  shield('ruin_bulwark', 'Bulwark of Ruin', L, { ...R, model: 'shield_spikes_color', tint: 0x8a6a5a, glow: 0xff5a1a });
  book('tome_calamity', 'Tome of Calamity', L, { ...R, tint: 0xffb090, glow: 0xff4a10 });
  const sets = [
    ['warlord', 'Warlord', 'warrior', 1, { str: 4, agi: 1 }, 0x8a3a2a, 1, 0.35, ['Helm', 'Plate', 'Gauntlets', 'Greaves']],
    ['sanctified', 'Plaguewarden', 'healer', 0.85, { int: 1, str: 1 }, 0x4a3e36, 1, 0.25, ['Mask', 'Coat', 'Gloves', 'Boots']], // (key kept for saves)
    ['phantom', 'Phantom', 'rogue', 0.7, { agi: 3, str: 1 }, 0x2a2a3a, 0, 0.05, ['Hood', 'Jerkin', 'Gloves', 'Boots']],
    ['stormweave', 'Stormweave', 'scientist', 0.55, { int: 3, str: 2 }, 0x3a5aa8, 1, 0, ['Cap', 'Coat', 'Gloves', 'Shoes']],
  ];
  for (const [p, n, cls, share, mix, body, helm, metal, [h, b, g, f]] of sets) {
    set(p, n, cls, L, { share, mix, tier: 'rare', look: { body, helm, metal }, pieces: { head: h, body: b, hands: g, feet: f } });
  }
}

// ---------------------------------------------------------------- unique items (world bosses only)
const UNIQUE_LEVEL = { low: 12, mid: 28, high: 46 };
function uniqueAcc(key, name, tier, kind, mix, gem, extra = {}) {
  const level = UNIQUE_LEVEL[tier];
  add(key, { name, kind: 'acc', type: kind, slot: ACC_SLOT[kind], classes: null, level, tier, unique: true, gear: { kind, color: 0xff9a3a, gem, glow: 1 }, stats: attrs(level, WEIGHT[kind], mix, UNIQUE_POWER), ...extra });
}
{
  const U = { unique: true };
  // low: Gorehorn and the Frost Giant (Emberwood, Frostfang)
  weapon('wanderers_edge', "Wanderer's Edge", 'sword1h', 12, { ...U, tint: 0xffd8a0, glow: 0xff6a10, flavour: 'agi' });
  weapon('ogre_splitter', 'Ogre Splitter', 'axe2h', 12, { ...U, tint: 0xd8c0a0, glow: 0xff6a10, flavour: 'agi' });
  weapon('mace_of_dawn', 'Mace of Dawn', 'mace1h', 12, { ...U, tint: 0xffe8b0, glow: 0xffb030, flavour: 'str' });
  weapon('whisper', 'Whisper', 'dagger', 12, { ...U, tint: 0xd0f0ff, glow: 0x4ab0ff, flavour: 'agi' });
  weapon('windstring', 'Windstring', 'bow', 12, { ...U, tint: 0xe8ffe0, glow: 0x6aff8a, flavour: 'agi' });
  weapon('cinderwood_staff', 'Cinderwood Staff', 'staff', 12, { ...U, tint: 0xffa070, glow: 0xff4a10, flavour: 'int' });
  weapon('spark_coil', 'Spark Coil', 'rod', 12, { ...U, tint: 0xa0e8ff, glow: 0x30a0ff, flavour: 'agi' });
  shield('meadow_aegis', 'Aegis of the Meadow', 12, { ...U, model: 'shield_round_color', glow: 0xff8a2a, flavour: 'str' });
  book('grimoire_sparks', 'Grimoire of Sparks', 12, { ...U, model: 'spellbook_open', tint: 0xffd0a0, glow: 0xff6a10 });
  uniqueAcc('band_wanderer', 'Band of the Wanderer', 'low', 'ring', { str: 2 }, 0xff8a2a);
  uniqueAcc('moonstone_earring', 'Moonstone Earring', 'low', 'ear', { agi: 1, int: 1 }, 0xd0e8ff);
  uniqueAcc('pendant_wild', 'Pendant of the Wild', 'low', 'neck', { agi: 2, str: 1 }, 0x6aff6a);
  uniqueAcc('girdle_giants', 'Girdle of Giants', 'low', 'belt', { str: 3 }, 0xc8a050);
  // middle: Ignis the Living Pyre (Cinderfall)
  weapon('emberbrand', 'Emberbrand', 'sword1h', 28, { ...U, tint: 0xffb070, glow: 0xff3a00, flavour: 'agi' });
  weapon('ashbringer', 'Ashbringer', 'sword2h', 28, { ...U, model: 'sword_2handed_color', tint: 0xffc890, glow: 0xff4a10, flavour: 'agi' });
  weapon('pyre_mace', 'Pyre Mace', 'mace1h', 28, { ...U, tint: 0xffa060, glow: 0xff4a00, flavour: 'int' });
  weapon('cinderkiss', 'Cinderkiss', 'dagger', 28, { ...U, tint: 0xffc0a0, glow: 0xff5a20, flavour: 'agi' });
  weapon('phoenix_bow', 'Phoenix Bow', 'bow', 28, { ...U, tint: 0xffd090, glow: 0xff6a10, flavour: 'str' });
  weapon('burning_sun', 'Staff of the Burning Sun', 'staff', 28, { ...U, model: 'Skeleton_Staff', tint: 0xffd0a0, glow: 0xff5a10, flavour: 'int' });
  weapon('volatile_rod', 'Volatile Rod', 'rod', 28, { ...U, tint: 0xffe070, glow: 0xff8a10, flavour: 'agi' });
  shield('obsidian_bulwark', 'Obsidian Bulwark', 28, { ...U, model: 'shield_spikes_color', tint: 0x8a8090, glow: 0xff4a10 });
  book('codex_ignis', 'Codex Ignis', 28, { ...U, tint: 0xffb080, glow: 0xff4a10 });
  uniqueAcc('salamander_ring', 'Ring of the Salamander', 'mid', 'ring', { str: 1, agi: 1 }, 0xff4a10);
  uniqueAcc('ember_earring', 'Earring of Embers', 'mid', 'ear', { agi: 1, int: 1 }, 0xff8a2a);
  uniqueAcc('heart_forge', 'Heart of the Forge', 'mid', 'neck', { str: 3 }, 0xff6a10);
  uniqueAcc('belt_ashen', 'Belt of the Ashen King', 'mid', 'belt', { str: 2, agi: 1 }, 0x8a2a10);
  // high: Umbra the Devourer (Shadowmere)
  weapon('nightbane', 'Nightbane', 'sword1h', 46, { ...U, tint: 0xc0a8ff, glow: 0x6a2aff, flavour: 'agi' });
  weapon('abyssal_reaver', 'Abyssal Reaver', 'axe2h', 46, { ...U, tint: 0xa898d0, glow: 0x8a2aff, flavour: 'agi' });
  weapon('halo_mercy', 'Scepter of Mercy', 'mace1h', 46, { ...U, model: 'proc_scepter', tint: 0xffffff, glow: 0xd0b0ff, flavour: 'int' });
  weapon('voidstep', 'Voidstep', 'dagger', 46, { ...U, tint: 0xd0b8ff, glow: 0x7a3aff, flavour: 'agi' });
  weapon('starfall_bow', 'Starfall Bow', 'bow', 46, { ...U, tint: 0xe8e0ff, glow: 0x9a6aff, flavour: 'agi' });
  weapon('staff_eternity', 'Staff of Eternity', 'staff', 46, { ...U, tint: 0xf0e0ff, glow: 0xb06aff, flavour: 'int' });
  weapon('singularity_rod', 'Singularity Rod', 'rod', 46, { ...U, tint: 0xd8c8ff, glow: 0x8a4aff, flavour: 'int' });
  shield('wall_shadows', 'Wall of Shadows', 46, { ...U, model: 'shield_badge_color', tint: 0xb0a0d0, glow: 0x6a2aff });
  book('tome_void', 'Tome of the Void', 46, { ...U, tint: 0xd0c0ff, glow: 0x7a3aff });
  uniqueAcc('ring_nyxara', 'Ring of Nyxara', 'high', 'ring', { str: 2 }, 0xff4ad8);
  uniqueAcc('tear_abyss', 'Tear of the Abyss', 'high', 'ear', { int: 1 }, 0xb07aff);
  uniqueAcc('amulet_eternity', 'Amulet of Eternity', 'high', 'neck', { agi: 2, str: 1 }, 0xd0b0ff);
  uniqueAcc('belt_hollow', 'Belt of the Hollow King', 'high', 'belt', { str: 3 }, 0x9a6aff);
}
export const UNIQUES = { low: [], mid: [], high: [] };
const TOP_ITEM_LEVEL = Math.max(...Object.values(ITEMS).filter((d) => d.tier !== 'rare').map((d) => d.level)); // (the best items monsters drop: past it, those)
export const RARES = Object.values(ITEMS).filter((d) => d.tier === 'rare' && !d.stack).map((d) => d.key);
for (const d of Object.values(ITEMS)) if (d.unique) UNIQUES[d.tier].push(d.key);

// ---------------------------------------------------------------- things you use up
// potions heal (or fill mana) by a share of the maximum; elixirs boost for ten minutes; the camp scroll takes
// you to the camp of the land you're in; recipes are what the anvil needs to upgrade an item. Potions of a
// kind all go in one slot, however many.
const stack = (key, def) => add(key, { stack: def.stack || (def.kind === 'potion' ? 9999 : 50), ...def });
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
stack('recipe_low', { name: 'Low Class Upgrade Recipe', kind: 'recipe', tier: 'low', level: 1, price: 50, stack: 20, icon: 'recipe_low', desc: 'The anvil in Emberwood camp upgrades a low class item one step with it. It never fails.' });
stack('recipe_mid', { name: 'Middle Class Upgrade Recipe', kind: 'recipe', tier: 'mid', level: 1, price: 200, stack: 20, icon: 'recipe_mid', desc: 'The anvil in Emberwood camp upgrades a middle class item one step with it. It never fails.' });
stack('recipe_high', { name: 'High Class Upgrade Recipe', kind: 'recipe', tier: 'high', level: 1, price: 600, stack: 20, icon: 'recipe_high', desc: 'The anvil in Emberwood camp upgrades a high class item one step with it. It never fails.' });
stack('recipe_rare', { name: 'Rare Upgrade Recipe', kind: 'recipe', tier: 'rare', level: 1, price: 2000, stack: 20, icon: 'recipe_rare', dropOnly: true, desc: 'Found only on the Death Canyon\'s monsters, and seldom. The anvil in Emberwood camp upgrades a rare item one step with it. It never fails.' });

// The hidden caves' keys (caves.js): one at a time, bound to the hero who found it (no bank, trade or sale).
for (const [land, name, near] of [['emberwood', 'Bramble Hollow', 'the Bandit Hideout'], ['frostfang', 'the Rimewell', 'the Snowdrift Fields'], ['cinderfall', 'the Ember Vein', 'the Ashen Flats'], ['shadowmere', 'the Gloamdeep', 'the Gloom Marsh']]) {
  stack(`cave_key_${land}`, {
    name: `Key to ${name}`, kind: 'key', land, level: 1, price: 0, stack: 1, bound: true, icon: `key_${land}`,
    desc: `Opens the hidden cave near ${near} for you and your party. While you carry it, its mouth glows among the bushes. One cave a day.`,
  });
}

// Elixirs' boosts (Player.recompute applies them; they last through travel and saves).
export const ELIXIRS = {
  elixir_might: { dur: 600, dmgPct: 0.1, name: 'Might' },
  elixir_iron: { dur: 600, armorPct: 0.2, name: 'Iron' },
  elixir_vigor: { dur: 600, hpPct: 0.1, name: 'Vigor' },
};

// ---------------------------------------------------------------- prices
// What merchants ask for an item (selling one brings a quarter, more for upgrades).
const PRICE = [[1, 40], [10, 450], [20, 1800], [30, 4500], [40, 9500], [50, 18000], [60, 30000], [70, 45000], [80, 60000]];
for (const d of Object.values(ITEMS)) {
  if (d.price !== undefined) continue;
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
  return { id: newId(), k: key, p: clamp(opts.p ?? (d.unique ? 0 : 1), d.unique ? 0 : 1, maxPlus(d)) };
}

// How strong an item is at its plus: 1 at +1 (normal) or +0 (unique), a tenth more for each step.
export const plusMult = (it) => { const d = itemDef(it); return 1 + UPGRADE_GAIN * ((it.p ?? 0) - (d?.unique ? 0 : 1)); };

// The item's stats at its plus: damage, armor and attributes all grow (its speed doesn't).
export function itemStats(it) {
  const d = itemDef(it);
  if (!d?.stats) return {};
  const m = plusMult(it), out = {};
  for (const [k, v] of Object.entries(d.stats)) out[k] = k === 'speed' ? v : Math.round(v * m);
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

// Upgrading from +p to +(p+1): recipes of the item's class (more for the last steps: 1 up to +4, 2 for +5 and +6,
// 3 for +7 and +8, 4 for +9, 5 for +10) and a smith's fee. (Cheap for now, while upgrading is being tried out.)
export function upgradeCost(it) {
  const d = itemDef(it);
  if (!d || d.stack || (it.p ?? 0) >= maxPlus(d)) return null;
  const next = (it.p ?? 0) + 1;
  const recipes = next >= 10 ? 5 : next >= 9 ? 4 : next >= 7 ? 3 : next >= 5 ? 2 : 1;
  return { recipe: TIERS[d.tier].recipe, recipes, gold: Math.round(d.price * 0.02 * next / 5) * 5 + 10 };
}

// ---------------------------------------------------------------- loot
// A monster's drop at its level: a weapon, offhand or clothes of any class (more often the finder's), or an
// accessory; never better than a step above the monster. High class items are rare: merchants don't sell them,
// and most of the times one would drop, nothing does (HIGH_KEEP), so they are worth hunting for.
export const HIGH_KEEP = 0.3;
export function rollDrop(level, cls) {
  const rare = (it) => (it && itemDef(it).tier === 'high' && Math.random() > HIGH_KEEP ? null : it);
  const tier = tierAt(level);
  if (Math.random() < 0.15) { // an accessory of this class of items (nobody sells them)
    const keys = Object.values(ITEMS).filter((d) => d.kind === 'acc' && !d.unique && d.tier === tier && d.level <= level + 4).map((d) => d.key);
    if (keys.length) return rare(makeItem(pick(keys)));
  }
  // weapons and clothes no more than a few levels above the monster, and not far below it (past the best
  // items' level, the best ones still); the newest of them (the best for a hero hunting here) come less often
  const lo = Math.min(Math.max(1, level - 14), TOP_ITEM_LEVEL - 10);
  const fits = (d) => !d.unique && !d.stack && d.kind !== 'acc' && d.tier !== 'rare' && d.level <= level + 2 && d.level >= lo;
  const pool = Object.values(ITEMS).filter(fits);
  if (!pool.length) return null;
  const weight = (x) => (x.classes?.includes(cls) ? 3 : 1) * (x.kind === 'armor' ? 0.6 : 1) * (x.level >= level - 4 ? 0.35 : 1);
  const d = weightedPick(pool.map((x) => ({ x, w: weight(x) }))).x;
  return rare(makeItem(d.key));
}

// A potion now and then, of the right strength.
export function rollPotion(level) {
  const g = level >= 35 ? 3 : level >= 15 ? 2 : 1;
  return makeItem(`${Math.random() < 0.65 ? 'hp' : 'mp'}_potion_${g}`);
}

// A world boss's unique: one of its class of items, each as likely as the next.
export const rollUnique = (tier) => makeItem(pick(UNIQUES[tier]));

// A rare item (the Death Canyon's monsters: game.js says how seldom): any class's, the finder's more often.
export function rollRare(cls) {
  const d = weightedPick(RARES.map((k) => ITEMS[k]).map((x) => ({ x, w: x.classes?.includes(cls) ? 3 : 1 }))).x;
  return makeItem(d.key);
}

// ---------------------------------------------------------------- tooltips
export const STAT_LINES = [
  ['armor', (v) => `+${v} Armor`], ...ATTRS.map((k) => [k, (v) => `+${v} ${ATTR_NAME[k]}`]),
];

// Lines for an item's tooltip: { main: its damage and speed, or its armor; stats: the attributes it gives }.
export function itemLines(it) {
  const d = itemDef(it), s = itemStats(it), main = [], stats = [];
  if (!d) return { main, stats };
  if (s.dmgMin) main.push(`${s.dmgMin}–${s.dmgMax} Damage`, `${s.speed.toFixed(2)} Attacks per Second`);
  if (s.armor) main.push(`${s.armor} Armor`);
  for (const k of ATTRS) if (s[k]) stats.push(`+${s[k]} ${ATTR_NAME[k]}`);
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

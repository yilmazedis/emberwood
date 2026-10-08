// Attributes: Strength, Dexterity, Intelligence and Vitality. A hero starts with its class's, gets five points
// to spend at every level (any class may put them anywhere), and its gear gives more (items.js). What a
// point does is the same for everyone; a class only decides what it needs most:
//   Strength: weapon damage (swords, axes, maces, great weapons; half of it with daggers and bows) and a
//     little armor
//   Dexterity: attack speed, critical hits and dodging blows; with daggers and bows also damage (they
//     count the average of Strength and Dexterity)
//   Intelligence: spell damage (staves' bolts too), healing and mana
//   Vitality: Life and Life regeneration
// Besides points, every level makes a hero a little stronger by itself (AUTO). Plain data and numbers.
import { ATTRS, ATTR_NAME, ATTR_SHORT } from './items.js';

export { ATTRS, ATTR_NAME, ATTR_SHORT };
export const ATTR_PER_LEVEL = 5;
export const K = {
  auto: 0.014, // weapon and spell damage per level, for everyone
  str: 0.0075, strArmor: 0.15,
  dexSpd: 0.0008, dexCrit: 0.0005, dexDodge: 0.0002, dodgeCap: 0.15,
  int: 0.01, intHeal: 0.001, intMp: 2,
  vitHp: 5, vitRegen: 0.06,
};
// weapons that count Dexterity for their damage as much as Strength
export const FINESSE = ['dagger', 'bow'];

// The points a hero of this level has had to spend.
export const attrPoints = (level) => ATTR_PER_LEVEL * (Math.max(1, level) - 1);

// What a total of each attribute gives (cls: its Life and Mana multipliers), for the character window.
// weapon: what it holds (daggers and bows also count Dexterity for damage).
export function attrEffects(k, total, cls, weapon) {
  const pct = (v, d = 1) => `${(v * 100).toFixed(d).replace(/\.0+$/, '')}%`;
  const finesse = FINESSE.includes(weapon);
  switch (k) {
    case 'str': return [`+${pct(total * K.str * (finesse ? 0.5 : 1))} weapon damage`, `+${Math.round(total * K.strArmor * cls.armor)} armor`];
    case 'dex': return [...(finesse ? [`+${pct(total * K.str * 0.5)} weapon damage`] : []), `+${pct(total * K.dexSpd)} attack speed`, `+${pct(total * K.dexCrit)} critical chance`, `+${pct(Math.min(K.dodgeCap, total * K.dexDodge))} dodge`];
    case 'int': return [`+${pct(total * K.int)} spell damage`, `+${pct(total * K.intHeal)} healing`, `+${Math.round(total * K.intMp * cls.mp)} Mana`];
    case 'vit': return [`+${Math.round(total * K.vitHp * cls.hp)} Life`, `+${(total * K.vitRegen).toFixed(1)} Life a second`];
    default: return [];
  }
}

// One line on what an attribute is for, and who wants it.
export const ATTR_ABOUT = {
  str: 'Weapon damage and some armor. Warriors, and healers who fight with a mace. Daggers and bows count it half.',
  dex: 'Attack speed, critical hits and dodging. Daggers and bows count it for damage too, as much as Strength.',
  int: 'Spell damage, healing and Mana. Scientists and healers.',
  vit: 'Life and Life regeneration. Everyone who wants to stay standing.',
};

// Attributes, as in Dota 2: Strength, Agility and Intelligence. A hero starts with its class's, gets five points
// to spend at every level (any class may put them anywhere), and its gear gives more (items.js). Every class has
// a primary attribute that powers its weapon blows (Warrior: Strength, Rogue: Agility, Scientist and Doctor:
// Intelligence); besides, each does the same for everyone:
//   Strength: Life and Life regeneration
//   Agility: attack speed and armor
//   Intelligence: spell damage (staves' bolts too), healing and Mana
// Every level also makes a hero a little stronger by itself (AUTO). Plain data and numbers.
import { ATTRS, ATTR_NAME, ATTR_SHORT } from './items.js';

export { ATTRS, ATTR_NAME, ATTR_SHORT };
export const ATTR_PER_LEVEL = 5;
export const K = {
  auto: 0.014, // weapon and spell damage per level, for everyone
  prim: 0.006, // weapon damage per point of the class's primary attribute
  strHp: 2, strRegen: 0.03,
  agiSpd: 0.0008, agiArmor: 0.3,
  int: 0.01, intHeal: 0.001, intMp: 2,
};

// The points a hero of this level has had to spend.
export const attrPoints = (level) => ATTR_PER_LEVEL * (Math.max(1, level) - 1);

// What a total of each attribute gives a hero of class `cls` (its definition: primary, Life, Mana and armor
// multipliers), for the character window.
export function attrEffects(k, total, cls) {
  const pct = (v, d = 1) => `${(v * 100).toFixed(d).replace(/\.0+$/, '')}%`;
  const prim = cls.primary === k ? [`+${pct(total * K.prim)} weapon damage`] : [];
  switch (k) {
    case 'str': return [...prim, `+${Math.round(total * K.strHp * cls.hp)} Life`, `+${(total * K.strRegen).toFixed(1)} Life a second`];
    case 'agi': return [...prim, `+${pct(total * K.agiSpd)} attack speed`, `+${Math.round(total * K.agiArmor * cls.armor)} armor`];
    case 'int': return [...prim, `+${pct(total * K.int)} spell damage`, `+${pct(total * K.intHeal)} healing`, `+${Math.round(total * K.intMp * cls.mp)} Mana`];
    default: return [];
  }
}

// One line on what an attribute is for (the primary one: the class's weapon damage too).
export const ATTR_ABOUT = {
  str: 'Life and Life regeneration, for everyone. A Warrior\'s primary attribute: its weapon damage too.',
  agi: 'Attack speed and armor, for everyone. A Rogue\'s primary attribute: its weapon damage too.',
  int: 'Spell damage, healing and Mana, for everyone. A Scientist\'s and a Doctor\'s primary attribute: their weapon damage too.',
};

// The four playable classes: model, starting gear, base stats and which model parts show gear.
// Shared by the game and the game server (server/), so this file is plain data.
//   hp, mp, armor, dmg: multipliers on the base values; crit, atkSpd, moveSpd, spell: added
//   hats: model parts a head item shows (by item base); capes: parts a back item shows
export const CLASSES = {
  knight: {
    name: 'Knight', model: 'Knight', role: 'Sword and shield',
    desc: 'Heavy armor and a shield. Hard to bring down, steady damage.',
    hp: 1.1, mp: 1, armor: 1.4, dmg: 1, crit: 0, atkSpd: 0, moveSpd: 0, spell: 0,
    start: [['weapon', 'sword', 'Rusty Sword'], ['offhand', 'round', 'Dented Shield']],
    hats: { helm: ['Knight_Helmet'], visor: ['Knight_Helmet', 'Knight_HelmetVisor'] },
    capes: ['Knight_Cape'],
    portrait: ['Knight_Head', 'Knight_Helmet'],
  },
  barbarian: {
    name: 'Barbarian', model: 'Barbarian', role: 'Two-handed axe',
    desc: 'A huge axe and a thick hide. Hits hardest of all, fights up close.',
    hp: 1.25, mp: 0.8, armor: 1, dmg: 1.18, crit: 0.02, atkSpd: 0, moveSpd: 0.02, spell: 0,
    start: [['weapon', 'greataxe', 'Notched Great Axe']],
    hats: { helm: ['Barbarian_BearHat'], visor: ['Barbarian_BearHat'] },
    capes: [],
    portrait: ['Barbarian_Head', 'Barbarian_BearHat'],
  },
  mage: {
    name: 'Mage', model: 'Mage', role: 'Staff and spells',
    desc: 'Fragile, but commands fire and frost from a distance with a deep well of mana.',
    hp: 0.85, mp: 1.6, armor: 0.8, dmg: 0.9, crit: 0.03, atkSpd: 0, moveSpd: 0, spell: 0.35,
    start: [['weapon', 'staff', 'Apprentice Staff']],
    hats: { helm: ['Mage_Hat'], visor: ['Mage_Hat'] },
    capes: ['Mage_Cape'],
    portrait: ['Mage_Head', 'Mage_Hat'],
  },
  rogue: {
    name: 'Rogue', model: 'Rogue', role: 'Fast daggers',
    desc: 'Quick strikes, more critical hits, and the fastest runner in the woods.',
    hp: 0.95, mp: 1.1, armor: 0.9, dmg: 1, crit: 0.08, atkSpd: 0.12, moveSpd: 0.07, spell: 0,
    start: [['weapon', 'dagger', 'Chipped Dagger']],
    hats: {},
    capes: ['Rogue_Cape'],
    portrait: ['Rogue_Head'],
  },
};

export const CLASS_IDS = Object.keys(CLASSES);
export const MAX_CHARACTERS = 4;
// Character names: 3–14 letters (any alphabet, e.g. Turkish letters), no spaces or digits.
export const NAME_RULE = /^\p{L}{3,14}$/u;
// Account names: 3–16 of a–z, 0–9 and _.
export const USER_RULE = /^[A-Za-z0-9_]{3,16}$/;

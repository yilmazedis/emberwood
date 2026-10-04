// The four classes heroes can be: Warrior, Scientist, Rogue and Healer. Each picks its way of fighting by the
// weapons it holds (a warrior with sword and shield, two weapons, or one great one; a scientist with a long
// staff, or a short one and a book; a rogue with daggers or a bow; a healer with mace and shield or a great
// weapon) and by where it spends its skill points (skills.js). Shared by the game and the game server, so
// plain data only.
//   hp, mp, armor, dmg: multipliers; crit, atkSpd, moveSpd, spell: added
//   looks: the models a hero of the class can wear (chosen when it's made): a KayKit character and a
//   palette (assets.js repaints its colours), which parts show a helmet (hats) and the cape
export const CLASSES = {
  warrior: {
    name: 'Warrior', role: 'Blades, axes and shields',
    desc: 'The front line. Sword and shield to hold it, two weapons for speed, or one great weapon to break it. Most Life and armor of all.',
    hp: 1.22, mp: 0.8, armor: 1.3, dmg: 1.0, crit: 0, atkSpd: 0, moveSpd: 0, spell: 0,
    styles: { guard: 'Sword and shield', dual: 'Two weapons', heavy: 'Great weapon' },
    looks: [
      { model: 'Knight', name: 'Knight', hats: ['Knight_Helmet', 'Knight_HelmetVisor'], capes: ['Knight_Cape'], portrait: ['Knight_Head', 'Knight_Helmet'] },
      { model: 'Barbarian', name: 'Barbarian', hats: ['Barbarian_BearHat'], capes: [], portrait: ['Barbarian_Head', 'Barbarian_BearHat'] },
    ],
    start: ['short_sword', 'round_shield', 'plate_body'],
  },
  scientist: {
    name: 'Scientist', role: 'Fire, frost and alchemy',
    desc: 'Studies the elements and what is poison. A long staff casts fast fire and frost; a short staff and a book brew poisons, curses and doors through space. Fragile.',
    hp: 0.85, mp: 1.6, armor: 0.75, dmg: 1.0, crit: 0.03, atkSpd: 0, moveSpd: 0, spell: 0,
    styles: { elements: 'Long staff', alchemy: 'Short staff and book' },
    looks: [
      { model: 'Mage', name: 'Arcanist', hats: ['Mage_Hat'], capes: ['Mage_Cape'], portrait: ['Mage_Head', 'Mage_Hat'] },
      { model: 'Mage', name: 'Alchemist', palette: 'alchemist', hats: ['Mage_Hat'], capes: ['Mage_Cape'], portrait: ['Mage_Head', 'Mage_Hat'] },
    ],
    start: ['oak_staff', 'linen_body'],
  },
  rogue: {
    name: 'Rogue', role: 'Daggers or a bow',
    desc: 'Quick and hard to pin down: twin daggers and killing blows up close, or arrows from afar. More critical hits, the fastest feet.',
    hp: 0.95, mp: 1.0, armor: 0.9, dmg: 1.0, crit: 0.05, atkSpd: 0.05, moveSpd: 0.06, spell: 0,
    styles: { assassin: 'Daggers', archer: 'Bow' },
    looks: [
      { model: 'Rogue', name: 'Rogue', hats: [], capes: ['Rogue_Cape'], portrait: ['Rogue_Head'] },
      { model: 'Rogue_Hooded', name: 'Hooded', hats: [], capes: ['RogueHooded_Cape'], portrait: ['RogueHooded_Head', 'RogueHooded_Mask'] },
    ],
    start: ['dagger', 'dagger', 'leather_body'],
  },
  healer: {
    name: 'Healer', role: 'Heals, blessings and holy wrath',
    desc: 'Keeps a party standing: heals, blessings that last, and raises the fallen. Fights alone with mace and holy fire, slower than the others.',
    hp: 1.05, mp: 1.4, armor: 1.1, dmg: 0.8, crit: 0, atkSpd: 0, moveSpd: 0, spell: 0,
    styles: { guard: 'Mace and shield', heavy: 'Great weapon' },
    looks: [
      { model: 'Mage', name: 'Cleric', palette: 'cleric', hats: ['Mage_Hat'], capes: ['Mage_Cape'], portrait: ['Mage_Head', 'Mage_Hat'] },
      { model: 'Knight', name: 'Paladin', palette: 'paladin', hats: ['Knight_Helmet', 'Knight_HelmetVisor'], capes: ['Knight_Cape'], portrait: ['Knight_Head', 'Knight_Helmet'] },
    ],
    start: ['iron_mace', 'round_shield', 'chain_body'],
  },
};

export const CLASS_IDS = Object.keys(CLASSES);
export const MAX_CHARACTERS = 4;
// Character names: 3–14 letters (any alphabet, e.g. Turkish letters), no spaces or digits.
export const NAME_RULE = /^\p{L}{3,14}$/u;
// Account names: 3–16 of a–z, 0–9 and _.
export const USER_RULE = /^[A-Za-z0-9_]{3,16}$/;

// Heroes made before the four classes: what they are now (and which look they keep).
export const OLD_CLASSES = { knight: ['warrior', 0], barbarian: ['warrior', 1], mage: ['scientist', 0], rogue: ['rogue', 0] };

// A hero's look: its class's, by number (anything unknown is the first).
export const lookOf = (cls, look) => {
  const c = CLASSES[cls] || CLASSES.warrior;
  return c.looks[Number.isInteger(look) && look >= 0 && look < c.looks.length ? look : 0];
};

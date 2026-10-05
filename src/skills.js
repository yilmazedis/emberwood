// Skills. Each class has three trees of four skills (skills/warrior.js, scientist.js, rogue.js, healer.js).
// A hero gets a skill point every level and puts it in a tree: a tree's skills open as it fills (at 1, 6, 15
// and 30 points), every point makes them stronger (power: +1.2% each) and adds the tree's own small bonus.
// Sixty points can't fill everything: a hero goes all in on one tree, or spreads out and is good at more
// but best at nothing.
//
// One definition serves our own hero and the heroes we see: cast(actor, ctx, real) plays the show (animation,
// effects, sound) for any hero, and only when `real` (our hero) does it move the hero, deal damage and tell
// the world. Other heroes' games send what they cast ({ k: 'sk', id, x, z, t }) and we cast it with real =
// false.
//   actor: our Player or a RemotePlayer: game, h (the model), pos, yaw, faceToward(p), vol(), aura(id, s)
//   ctx: { at: where it was aimed (or where the hero went, for leaps and teleports), target: the foe or
//        friend it was cast at, pw: its power (1 + 1.2% a point in its tree) }
// cast() returns the action that runs while the skill plays: { t, dur, canMove, moveMult, lockFacing,
// tick(dt, action), end() } (see Player.update), plus dest: a place to tell the others instead of `at`.
//   target: 'enemy' (a foe: the one selected, else the nearest), 'ground' (a spot), 'self', 'ally' (a friendly
//   hero, ourselves if none is picked), 'dead' (a fallen friendly hero)
//   needs: the weapon it takes: 'shield', 'twohand', 'dagger', 'bow', 'staff' (a long one), 'book', 'melee'
//   mp: mana, as a share of the hero's level's base pool (so it costs the same at any level)
import * as THREE from 'three';
import { hdr } from './fx.js';
import { rand } from './util.js';
import { WARRIOR } from './skills/warrior.js';
import { SCIENTIST } from './skills/scientist.js';
import { ROGUE } from './skills/rogue.js';
import { HEALER } from './skills/healer.js';

export const UNLOCK = [1, 6, 15, 30]; // points in a tree that open its skills
export const POWER_PER_POINT = 0.012;
export const power = (points) => 1 + POWER_PER_POINT * points;

// The trees, in order. passive: what each point adds (Player.recompute).
export const TREES = {
  warrior: [
    { id: 'arms', name: 'Arms', color: '#ff9a5a', about: 'Heavy blows and finishing strikes.', passive: { dmgPct: 0.005 }, skills: ['power_strike', 'cleave', 'charge', 'execute'] },
    { id: 'guard', name: 'Guard', color: '#8fc0ff', about: 'Shields, taunts and standing firm.', passive: { armorPct: 0.006, hpPct: 0.003 }, skills: ['war_cry', 'shield_bash', 'shield_wall', 'last_stand'] },
    { id: 'fury', name: 'Fury', color: '#ff5a4a', about: 'Rage, whirling blades and great weapons.', passive: { atkSpd: 0.004, crit: 0.002 }, skills: ['battle_rage', 'whirlwind', 'leap', 'earthshatter'] },
  ],
  scientist: [
    { id: 'fire', name: 'Pyrology', color: '#ff7a2a', about: 'Fire: blasts, burning ground and meteors.', passive: { spellPct: 0.003 }, skills: ['fireball', 'flame_wave', 'inferno', 'meteor'] },
    { id: 'frost', name: 'Cryology', color: '#8fdcff', about: 'Frost: slows, freezes and storms of ice.', passive: { spellPct: 0.002, armorPct: 0.005 }, skills: ['ice_bolt', 'frost_nova', 'blizzard', 'glacial_prison'] },
    { id: 'alchemy', name: 'Alchemy', color: '#8aff6a', about: 'Poisons, curses, and doors through space.', passive: { dotPct: 0.006, mpRegenPct: 0.004 }, skills: ['toxic_flask', 'blink', 'recall', 'plague'] },
  ],
  rogue: [
    { id: 'assassin', name: 'Assassination', color: '#c9a8ff', about: 'Daggers: from behind, with poison.', passive: { crit: 0.0012, daggerPct: 0.002 }, skills: ['backstab', 'poison_blade', 'shadow_step', 'eviscerate'] },
    { id: 'marksman', name: 'Marksmanship', color: '#9be06a', about: 'Bows: power, volleys and rains of arrows.', passive: { bowPct: 0.003, bowSpd: 0.0015 }, skills: ['power_shot', 'multi_shot', 'crippling_arrow', 'arrow_rain'] },
    { id: 'shadow', name: 'Shadow', color: '#8fa0b8', about: 'Speed, smoke and vanishing (for the party too).', passive: { moveSpd: 0.003, evade: 0.002 }, skills: ['swiftness', 'smoke_bomb', 'vanish', 'shadow_mantle'] },
  ],
  healer: [
    { id: 'restore', name: 'Restoration', color: '#7dff9a', about: 'Heals, and raising the fallen.', passive: { healPct: 0.008 }, skills: ['heal', 'renew', 'resurrection', 'circle_healing'] },
    { id: 'blessing', name: 'Blessing', color: '#ffe08a', about: 'Lasting blessings, shields and sanctuary.', passive: { armorPct: 0.004, hpPct: 0.004 }, skills: ['blessing', 'holy_armor', 'divine_shield', 'sanctuary'] },
    { id: 'wrath', name: 'Retribution', color: '#ffb85a', about: 'Holy fire to fight alone.', passive: { dmgPct: 0.005 }, skills: ['smite', 'holy_strike', 'judgement', 'consecration'] },
  ],
};

export const SKILLS = { ...WARRIOR, ...SCIENTIST, ...ROGUE, ...HEALER };
// where each skill sits: { cls, tree, slot }
for (const [cls, trees] of Object.entries(TREES)) {
  trees.forEach((tree, ti) => tree.skills.forEach((id, slot) => Object.assign(SKILLS[id], { id, cls, tree: tree.id, treeIndex: ti, slot, unlock: UNLOCK[slot] })));
}
export const treeOf = (cls, treeId) => TREES[cls]?.find((t) => t.id === treeId) || null;

// What a tree's points add, in words (the skill window).
const PASSIVE_TEXT = {
  dmgPct: (v) => `+${(v * 100).toFixed(1)}% damage`, armorPct: (v) => `+${(v * 100).toFixed(1)}% armor`, hpPct: (v) => `+${(v * 100).toFixed(1)}% Life`,
  atkSpd: (v) => `+${(v * 100).toFixed(1)}% attack speed`, crit: (v) => `+${(v * 100).toFixed(2)}% critical chance`, spellPct: (v) => `+${(v * 100).toFixed(1)}% spell damage`,
  dotPct: (v) => `+${(v * 100).toFixed(1)}% poison damage`, mpRegenPct: (v) => `+${(v * 100).toFixed(1)}% mana regeneration`, daggerPct: (v) => `+${(v * 100).toFixed(1)}% dagger damage`,
  bowPct: (v) => `+${(v * 100).toFixed(1)}% bow damage`, bowSpd: (v) => `+${(v * 100).toFixed(1)}% bow speed`, moveSpd: (v) => `+${(v * 100).toFixed(1)}% move speed`,
  evade: (v) => `+${(v * 100).toFixed(1)}% chance to dodge`, healPct: (v) => `+${(v * 100).toFixed(1)}% healing`,
};
export const passiveText = (tree, points = 1) => Object.entries(tree.passive).map(([k, v]) => PASSIVE_TEXT[k](v * points)).join(', ');

// Mana a skill costs at a level (its share of that level's base pool).
export const MANA_COST = 1.6; // (skills cost this many times their share, so mana runs low in a long fight)
export const manaCost = (sk, level) => Math.round(sk.mp * MANA_COST * (40 + 6 * level));

// Timed effects on a hero (Player.recompute applies them): { dur (s), and what they change }. A buff's
// value (v) is its strength when cast (some grow with the caster's points). Long ones (blessings, elixirs)
// last through travel and saving.
//   armorPct, hpPct, dmgPct, atkSpd, moveSpd, crit, evade: added; taken: damage taken × this; absorb: a shield
export const BUFFS = {
  war_cry: { dur: 12, name: 'War Cry', armorPct: (v) => v, look: 'warcry' },
  shield_wall: { dur: 6, name: 'Shield Wall', taken: (v) => v, look: 'guard' },
  last_stand: { dur: 15, name: 'Last Stand', hpPct: () => 0.25, look: 'rage' },
  battle_rage: { dur: 10, name: 'Battle Rage', atkSpd: () => 0.25, dmgPct: (v) => v, look: 'rage' },
  poison_blade: { dur: 15, name: 'Poison Blade', look: 'poison' },
  smoke: { dur: 4, name: 'Smoke', evade: () => 0.5, look: 'smoke' },
  vanish: { dur: 4, name: 'Vanished', look: 'smoke' },
  swiftness: { dur: 600, name: 'Swiftness', moveSpd: (v) => v, look: 'swift', long: true, ally: true },
  shadow_mantle: { dur: 60, name: 'Shadow Mantle', crit: (v) => v, atkSpd: () => 0.1, look: 'mantle', ally: true },
  blessing: { dur: 600, name: 'Blessing of Vitality', hpPct: (v) => v, long: true, ally: true },
  holy_armor: { dur: 600, name: 'Holy Armor', armorPct: (v) => v, long: true, ally: true },
  divine_shield: { dur: 10, name: 'Divine Shield', look: 'shield', ally: true }, // v: Life it soaks up
  sanctuary: { dur: 10, name: 'Sanctuary', taken: () => 0.75, look: 'shield', ally: true },
  renew: { dur: 10, name: 'Renew', look: 'renew', ally: true }, // v: share of max Life healed a second
  frost_armor: { dur: 6, name: 'Frozen', look: 'frost' },
  elixir_might: { dur: 600, name: 'Elixir of Might', dmgPct: () => 0.1, long: true },
  elixir_iron: { dur: 600, name: 'Elixir of Iron', armorPct: () => 0.2, long: true },
  elixir_vigor: { dur: 600, name: 'Elixir of Vigor', hpPct: () => 0.1, long: true },
};

// The most another hero's buff may give (they come from other games): { id: [min, max] }
export const ALLY_BUFF_RANGE = { swiftness: [0.1, 0.3], shadow_mantle: [0.05, 0.2], blessing: [0.08, 0.2], holy_armor: [0.15, 0.4], divine_shield: [0, 4000], sanctuary: [0, 1], renew: [0.02, 0.08] };

// Lingering looks while a buff lasts (for any hero): auras = { look: seconds left }.
export function auraTick(a, dt) {
  const g = a.game, p = a.pos;
  for (const id of Object.keys(a.auras)) {
    a.auras[id] -= dt;
    if (a.auras[id] <= 0) { delete a.auras[id]; continue; }
    const r = Math.random();
    if (id === 'warcry' && r < dt * 14) {
      g.fx.add.emit({ pos: { x: p.x + rand(-0.5, 0.5), y: p.y + rand(0.3, 1.6), z: p.z + rand(-0.5, 0.5) }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: 1.2, z: 0 }, color: hdr(0xffd060, 2.2), colorEnd: hdr(0xff9a20, 0.3), size: 0.14, sizeEnd: 0.02, life: 0.8, drag: 1 });
    } else if (id === 'rage' && r < dt * 22) {
      g.fx.add.emit({ pos: { x: p.x + rand(-0.45, 0.45), y: p.y + rand(0.4, 1.8), z: p.z + rand(-0.45, 0.45) }, count: 1, spread: 0.1, velSpread: 0.3, vel: { x: 0, y: 1.5, z: 0 }, color: hdr(0xff4a2a, 2.4), colorEnd: hdr(0x8a0a00, 0.3), size: 0.16, sizeEnd: 0.02, life: 0.7, drag: 1 });
    } else if (id === 'smoke' && r < dt * 9) {
      g.fx.soft.emit({ pos: { x: p.x + rand(-0.5, 0.5), y: p.y + rand(0.2, 1.2), z: p.z + rand(-0.5, 0.5) }, count: 1, spread: 0.2, velSpread: 0.3, vel: { x: 0, y: 0.5, z: 0 }, color: new THREE.Color(0x4a4650), alpha: 0.35, size: 0.6, sizeEnd: 1.4, life: 1.2, drag: 1.5 });
    } else if (id === 'guard' && r < dt * 16) {
      const ang = rand(0, Math.PI * 2);
      g.fx.add.emit({ pos: { x: p.x + Math.sin(ang) * 0.8, y: p.y + rand(0.3, 1.9), z: p.z + Math.cos(ang) * 0.8 }, count: 1, spread: 0.05, velSpread: 0.1, vel: { x: 0, y: 0.4, z: 0 }, color: hdr(0x8fc0ff, 2), colorEnd: hdr(0x3a6aff, 0.2), size: 0.16, sizeEnd: 0.03, life: 0.6, drag: 1 });
    } else if (id === 'shield' && r < dt * 18) {
      const ang = rand(0, Math.PI * 2), up = rand(0.2, 2.1);
      g.fx.add.emit({ pos: { x: p.x + Math.sin(ang) * 0.85, y: p.y + up, z: p.z + Math.cos(ang) * 0.85 }, count: 1, spread: 0.03, velSpread: 0.05, color: hdr(0xffe7a0, 2.2), colorEnd: hdr(0xffc040, 0.2), size: 0.15, sizeEnd: 0.03, life: 0.5, drag: 1 });
    } else if (id === 'poison' && r < dt * 8) {
      const hand = new THREE.Vector3();
      a.h.bones.handslotr.getWorldPosition(hand);
      g.fx.add.emit({ pos: hand, count: 1, spread: 0.1, velSpread: 0.1, vel: { x: 0, y: -0.6, z: 0 }, color: hdr(0x7dff4a, 2), colorEnd: hdr(0x2a8a10, 0.2), size: 0.1, sizeEnd: 0.02, life: 0.6, drag: 0.5 });
    } else if (id === 'swift' && r < dt * 6 && a.moveMode) {
      g.fx.add.emit({ pos: { x: p.x, y: p.y + 0.15, z: p.z }, count: 1, spread: 0.25, velSpread: 0.2, vel: { x: 0, y: 0.3, z: 0 }, color: hdr(0xbfe8ff, 1.8), colorEnd: hdr(0x6ab0ff, 0.1), size: 0.14, sizeEnd: 0.02, life: 0.5, drag: 1 });
    } else if (id === 'mantle' && r < dt * 10) {
      g.fx.add.emit({ pos: { x: p.x + rand(-0.4, 0.4), y: p.y + rand(0.2, 1.6), z: p.z + rand(-0.4, 0.4) }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: 0.8, z: 0 }, color: hdr(0xa08aff, 2), colorEnd: hdr(0x3a2a8a, 0.2), size: 0.14, sizeEnd: 0.02, life: 0.7, drag: 1 });
    } else if (id === 'renew' && r < dt * 7) {
      g.fx.add.emit({ pos: { x: p.x + rand(-0.4, 0.4), y: p.y + 0.3, z: p.z + rand(-0.4, 0.4) }, count: 1, spread: 0.1, velSpread: 0.15, vel: { x: 0, y: 1.6, z: 0 }, color: hdr(0x7dff9a, 2), colorEnd: hdr(0x2aff80, 0.2), size: 0.16, sizeEnd: 0.03, life: 0.9, drag: 1 });
    } else if (id === 'frost' && r < dt * 10) {
      g.fx.add.emit({ pos: { x: p.x + rand(-0.5, 0.5), y: p.y + rand(0.2, 1.8), z: p.z + rand(-0.5, 0.5) }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: -0.3, z: 0 }, color: hdr(0xcff4ff, 2), colorEnd: hdr(0x5ab8ff, 0.2), size: 0.14, sizeEnd: 0.03, life: 0.7, drag: 1 });
    }
  }
}

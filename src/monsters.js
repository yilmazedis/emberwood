// The monsters: what each kind is like, and where they live. Plain data, shared by the game (enemies.js
// draws them) and the game server (sim/world.js runs them).
//   hp, dmg: at level 1 (they grow with level: monsterHp, monsterDmg); speed m/s; range: attack reach (casters:
//   how far they shoot, keeping `keep` metres away); atkCd/atkDur: seconds; aggro: notice distance
import { CRYPT_SPAWNS } from './crypt-map.js';

// How a monster grows with its level: +32% life and +22% damage a level, and faster past level 10, where
// heroes' gear grows faster too. XP: +25% a level.
export const monsterHp = (d, lvl) => Math.round(d.hp * (1 + 0.32 * (lvl - 1)) * (1 + 0.04 * Math.max(0, lvl - 10)));
export const monsterDmg = (d, lvl) => d.dmg * (1 + 0.22 * (lvl - 1)) * (1 + 0.02 * Math.max(0, lvl - 10));
export const monsterXp = (d, lvl) => d.xp * (1 + 0.25 * (lvl - 1));

export const ENEMY_TYPES = {
  slime: { name: 'Slime', kind: 'slime', color: 0x7ed957, size: 0.9, hp: 26, dmg: 5, speed: 3.0, range: 1.35, atkCd: 1.4, aggro: 8.5, xp: 12, radius: 0.55, gold: [1, 4], drop: 0.12 },
  slime_blue: { name: 'Bog Slime', kind: 'slime', color: 0x57c7ff, size: 1.0, hp: 36, dmg: 7, speed: 3.1, range: 1.45, atkCd: 1.3, aggro: 9, xp: 18, radius: 0.6, gold: [2, 6], drop: 0.16 },
  slime_red: { name: 'Magma Slime', kind: 'slime', color: 0xff5a24, glow: 0.55, size: 1.2, hp: 60, dmg: 11, speed: 3.3, range: 1.6, atkCd: 1.3, aggro: 10, xp: 30, radius: 0.72, gold: [4, 9], drop: 0.22 },
  bandit: { name: 'Bandit', kind: 'humanoid', model: 'Rogue_Hooded', weapon: 'dagger', hp: 70, dmg: 10, speed: 4.3, range: 1.9, atkCd: 1.35, atkDur: 0.6, aggro: 11, xp: 34, radius: 0.5, gold: [4, 12], drop: 0.3 },
  cultist: { name: 'Cultist', kind: 'caster', model: 'Mage', weapon: 'wand', tint: 0xc9a8ff, hp: 52, dmg: 12, speed: 3.6, range: 11, keep: 7, atkCd: 2.3, aggro: 14, xp: 40, radius: 0.5, gold: [5, 12], drop: 0.3 },
  // KayKit Skeletons pack — same rig, so they share every animation with the adventurers
  skeleton_minion: { name: 'Skeleton Minion', kind: 'humanoid', model: 'Skeleton_Minion', weapon: 'Skeleton_Blade', undead: true, eyes: 0x6dffd8, hp: 55, dmg: 10, speed: 4.1, range: 1.9, atkCd: 1.3, atkDur: 0.6, aggro: 11, xp: 30, radius: 0.5, gold: [3, 9], drop: 0.25, loot: 'bone' },
  skeleton_warrior: { name: 'Skeleton Warrior', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', offhand: 'Skeleton_Shield_Large_A', style: 'chop', scale: 1.1, undead: true, eyes: 0xff8a3a, hp: 120, dmg: 16, speed: 3.4, range: 2.2, atkCd: 1.8, atkDur: 0.85, aggro: 11, xp: 55, radius: 0.6, gold: [6, 14], drop: 0.35, loot: 'bone' },
  skeleton_rogue: { name: 'Skeleton Rogue', kind: 'humanoid', model: 'Skeleton_Rogue', weapon: 'Skeleton_Blade', offhand: 'Skeleton_Shield_Small_A', undead: true, eyes: 0xff4a6a, hp: 62, dmg: 11, speed: 5.4, range: 1.8, atkCd: 0.95, atkDur: 0.45, aggro: 12, xp: 38, radius: 0.5, gold: [4, 10], drop: 0.3, loot: 'bone' },
  skeleton_mage: { name: 'Skeleton Mage', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', undead: true, eyes: 0x7dff6a, bolt: 0x5dff8a, hp: 58, dmg: 14, speed: 3.4, range: 12, keep: 8, atkCd: 2.2, aggro: 15, xp: 50, radius: 0.5, gold: [5, 12], drop: 0.35, loot: 'bone' },
  brute: { name: 'Grok the Brute', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', scale: 1.5, boss: true, hp: 270, dmg: 24, speed: 4.0, range: 2.9, atkCd: 1.7, atkDur: 1.0, aggro: 13, xp: 320, radius: 0.95, gold: [60, 110], drop: 1, respawn: 75 },
  // the crypt's boss: bolt volleys, erupting grave circles, raises the dead, blinks away when crowded
  lich: { name: 'Morvain the Lich', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', weaponGlow: 0x8a4dff, tint: 0xd6ccf2, scale: 1.7, boss: true, lich: true, undead: true, eyes: 0xb57dff, bolt: 0xb57dff, hp: 450, dmg: 22, speed: 3.3, range: 15, keep: 7, atkCd: 2.0, aggro: 16, xp: 720, radius: 0.85, gold: [140, 220], drop: 1, respawn: 150 },
};

export const SPAWNS = [
  { type: 'slime', x: 0, z: -30, r: 10, n: 6, lvl: 1 },
  { type: 'slime', x: 26, z: 12, r: 7, n: 4, lvl: 1 },
  { type: 'slime_blue', x: -27, z: 20, r: 13, n: 5, lvl: 2, ring: true },
  { type: 'slime', x: 14, z: -14, r: 5, n: 2, lvl: 1 },
  { type: 'bandit', x: 38, z: -46, r: 8, n: 4, lvl: 3 },
  { type: 'cultist', x: 38, z: -46, r: 5, n: 1, lvl: 3 },
  { type: 'slime_red', x: -38, z: -44, r: 9, n: 3, lvl: 4 },
  { type: 'cultist', x: -38, z: -44, r: 5, n: 3, lvl: 5 },
  { type: 'bandit', x: 22, z: -58, r: 6, n: 2, lvl: 4 },
  { type: 'brute', x: 0, z: -71, r: 1, n: 1, lvl: 6 },
  { type: 'bandit', x: 0, z: -66, r: 6, n: 2, lvl: 5 },
  // Forgotten Graveyard
  { type: 'skeleton_minion', x: 3, z: 45, r: 10, n: 4, lvl: 5 },
  { type: 'skeleton_rogue', x: 3, z: 45, r: 9, n: 2, lvl: 6 },
  { type: 'skeleton_warrior', x: 3, z: 47, r: 7, n: 2, lvl: 6 },
  { type: 'skeleton_mage', x: 3, z: 49, r: 6, n: 2, lvl: 7 },
  ...CRYPT_SPAWNS, // the Forgotten Crypt (dungeon.js); they only rise once someone goes down
];

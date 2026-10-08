// The monsters: what each kind is like, and where Emberwood's live (the other lands keep their own lists,
// see maps.js). Plain data, shared by the game (enemies.js draws them) and the game server (sim/world.js
// runs them).
//   hp, dmg: at level 1 (they grow with level: monsterHp, monsterDmg); speed m/s; range: attack reach (casters:
//   how far they shoot, keeping `keep` metres away); atkCd/atkDur: seconds; aggro: notice distance
//   bosses: slam every third blow; summons: what they raise at 70% and 40% life; lich: Morvain's whole
//   bag of tricks (bolt volleys, grave circles, blinking away); archer: shoots arrows, not spells

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
  lich: { name: 'Morvain the Lich', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', weaponGlow: 0x8a4dff, tint: 0xd6ccf2, scale: 1.7, boss: true, lich: true, summons: ['skeleton_minion', 'skeleton_warrior'], undead: true, eyes: 0xb57dff, bolt: 0xb57dff, hp: 450, dmg: 22, speed: 3.3, range: 15, keep: 7, atkCd: 2.0, aggro: 16, xp: 720, radius: 0.85, gold: [140, 220], drop: 1, respawn: 150 },

  // ---- Frostfang Highlands (10–22) and Rimeheart Caverns (20–24)
  slime_frost: { name: 'Frost Slime', kind: 'slime', color: 0xbfe8ff, glow: 0.22, size: 1.0, hp: 38, dmg: 7, speed: 3.0, range: 1.45, atkCd: 1.3, aggro: 9, xp: 20, radius: 0.6, gold: [2, 6], drop: 0.16 },
  frost_scout: { name: 'Frostborn Scout', kind: 'humanoid', model: 'Rogue_Hooded', weapon: 'dagger', tint: 0xcfe2f5, hp: 64, dmg: 10, speed: 4.6, range: 1.9, atkCd: 1.2, atkDur: 0.55, aggro: 12, xp: 34, radius: 0.5, gold: [4, 12], drop: 0.3 },
  frost_raider: { name: 'Frostborn Raider', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_1handed', offhand: 'shield_round_barbarian', tint: 0xc4d6e8, hp: 95, dmg: 13, speed: 4.0, range: 2.1, atkCd: 1.5, atkDur: 0.75, aggro: 11, xp: 42, radius: 0.55, gold: [5, 13], drop: 0.32 },
  ice_witch: { name: 'Ice Witch', kind: 'caster', model: 'Mage', weapon: 'staff', weaponGlow: 0x7fd8ff, tint: 0xa8d4ff, bolt: 0x8fdcff, hp: 56, dmg: 13, speed: 3.6, range: 12, keep: 7, atkCd: 2.2, aggro: 14, xp: 44, radius: 0.5, gold: [5, 12], drop: 0.32 },
  slime_glacial: { name: 'Glacial Slime', kind: 'slime', color: 0x7fcfff, glow: 0.35, size: 1.35, hp: 72, dmg: 12, speed: 3.0, range: 1.75, atkCd: 1.4, aggro: 10, xp: 38, radius: 0.8, gold: [4, 10], drop: 0.24 },
  frostbone: { name: 'Frostbone Warrior', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', offhand: 'Skeleton_Shield_Large_B', style: 'chop', scale: 1.1, tint: 0xd4ecff, undead: true, eyes: 0x6fd8ff, hp: 120, dmg: 16, speed: 3.4, range: 2.2, atkCd: 1.8, atkDur: 0.85, aggro: 11, xp: 55, radius: 0.6, gold: [6, 14], drop: 0.35, loot: 'bone' },
  frost_archer: { name: 'Frost Archer', kind: 'caster', archer: true, model: 'Ranger', weapon: 'bow_withString', tint: 0xd2e6fa, bolt: 0xe6f6ff, hp: 58, dmg: 13, speed: 4.0, range: 14, keep: 9, atkCd: 1.9, aggro: 15, xp: 46, radius: 0.5, gold: [5, 12], drop: 0.32 },
  raider_berserker: { name: 'Raider Berserker', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', style: 'chop', scale: 1.15, tint: 0xe8c8b4, hp: 130, dmg: 18, speed: 4.4, range: 2.6, atkCd: 1.6, atkDur: 0.9, aggro: 12, xp: 60, radius: 0.65, gold: [7, 16], drop: 0.36 },
  frost_jarl: { name: 'Hrimgar the Frost Jarl', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', weaponGlow: 0x8fd8ff, tint: 0xbcd8f2, style: 'chop', scale: 1.65, boss: true, summons: ['frost_raider', 'frost_scout'], hp: 300, dmg: 26, speed: 4.0, range: 3.0, atkCd: 1.6, atkDur: 1.0, aggro: 14, xp: 360, radius: 1.0, gold: [80, 140], drop: 1, respawn: 120 },
  rime_king: { name: 'Vorrak the Rime King', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', weaponGlow: 0x6fd8ff, offhand: 'Skeleton_Shield_Large_A', style: 'chop', scale: 1.9, tint: 0xcfe8ff, undead: true, eyes: 0x6fd8ff, boss: true, summons: ['frostbone', 'skeleton_minion'], hp: 420, dmg: 28, speed: 3.6, range: 3.2, atkCd: 1.7, atkDur: 1.0, aggro: 16, xp: 780, radius: 1.05, gold: [160, 240], drop: 1, respawn: 150, loot: 'bone' },

  // ---- Cinderfall Wastes (22–40) and the Molten Forge (38–42)
  slime_cinder: { name: 'Cinder Slime', kind: 'slime', color: 0xff6a1a, glow: 0.7, size: 1.3, hp: 66, dmg: 12, speed: 3.3, range: 1.7, atkCd: 1.3, aggro: 10, xp: 34, radius: 0.75, gold: [4, 10], drop: 0.24 },
  ash_bandit: { name: 'Ash Bandit', kind: 'humanoid', model: 'Rogue_Hooded', weapon: 'dagger', tint: 0x77706a, hp: 72, dmg: 11, speed: 4.4, range: 1.9, atkCd: 1.3, atkDur: 0.6, aggro: 11, xp: 38, radius: 0.5, gold: [5, 13], drop: 0.32 },
  cinder_cultist: { name: 'Cinder Cultist', kind: 'caster', model: 'Mage', weapon: 'wand', weaponGlow: 0xff6a1a, tint: 0xffa47a, bolt: 0xff7a2a, hp: 56, dmg: 14, speed: 3.6, range: 12, keep: 7, atkCd: 2.1, aggro: 14, xp: 46, radius: 0.5, gold: [5, 13], drop: 0.32 },
  ash_knight: { name: 'Ash Knight', kind: 'humanoid', model: 'Knight', weapon: 'sword_1handed', offhand: 'shield_square', tint: 0x6a6470, hp: 140, dmg: 15, speed: 3.6, range: 2.2, atkCd: 1.6, atkDur: 0.7, aggro: 11, xp: 58, radius: 0.55, gold: [7, 16], drop: 0.36 },
  molten_brute: { name: 'Molten Brute', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', weaponGlow: 0xff5a10, style: 'chop', scale: 1.3, tint: 0x9a4a3a, hp: 170, dmg: 20, speed: 3.6, range: 2.8, atkCd: 1.8, atkDur: 1.0, aggro: 12, xp: 70, radius: 0.7, gold: [8, 18], drop: 0.38 },
  ember_skeleton: { name: 'Ember Skeleton', kind: 'humanoid', model: 'Skeleton_Rogue', weapon: 'Skeleton_Blade', offhand: 'Skeleton_Shield_Small_B', tint: 0xb08070, undead: true, eyes: 0xff6a1a, hp: 64, dmg: 12, speed: 5.2, range: 1.8, atkCd: 1.0, atkDur: 0.45, aggro: 12, xp: 42, radius: 0.5, gold: [5, 12], drop: 0.32, loot: 'bone' },
  pyre_archer: { name: 'Pyre Archer', kind: 'caster', archer: true, model: 'Ranger', weapon: 'bow_withString', tint: 0xc89070, bolt: 0xff8a3a, hp: 60, dmg: 14, speed: 4.0, range: 14, keep: 9, atkCd: 1.9, aggro: 15, xp: 48, radius: 0.5, gold: [5, 13], drop: 0.33 },
  flame_warden: { name: 'Flame Warden', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', weaponGlow: 0xff6a1a, tint: 0xc08a78, undead: true, eyes: 0xff7a2a, bolt: 0xff6a1a, hp: 62, dmg: 15, speed: 3.4, range: 12, keep: 8, atkCd: 2.1, aggro: 15, xp: 52, radius: 0.5, gold: [6, 13], drop: 0.35, loot: 'bone' },
  ashen_king: { name: 'Vulkhar the Ashen King', kind: 'humanoid', model: 'Knight', weapon: 'sword_2handed', weaponGlow: 0xff5a10, tint: 0x5a4a4a, style: 'chop', scale: 1.8, boss: true, summons: ['ash_knight', 'ember_skeleton'], hp: 330, dmg: 28, speed: 3.9, range: 3.1, atkCd: 1.6, atkDur: 1.0, aggro: 14, xp: 400, radius: 1.05, gold: [120, 200], drop: 1, respawn: 120 },
  forgemaster: { name: 'Forgemaster Kaldur', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', weaponGlow: 0xff7a2a, tint: 0x7a5a4a, style: 'chop', scale: 1.95, boss: true, summons: ['molten_brute', 'ember_skeleton'], hp: 460, dmg: 30, speed: 3.7, range: 3.3, atkCd: 1.6, atkDur: 1.0, aggro: 16, xp: 820, radius: 1.1, gold: [200, 300], drop: 1, respawn: 150 },

  // ---- Shadowmere (40–58) and the Abyssal Vault (56–60)
  slime_void: { name: 'Void Slime', kind: 'slime', color: 0x8a4aff, glow: 0.6, size: 1.25, hp: 70, dmg: 12, speed: 3.3, range: 1.7, atkCd: 1.3, aggro: 10, xp: 36, radius: 0.75, gold: [5, 11], drop: 0.25 },
  bog_lurker: { name: 'Bog Lurker', kind: 'humanoid', model: 'Rogue', weapon: 'dagger', offhand: 'dagger', tint: 0x6a8a6a, hp: 70, dmg: 12, speed: 5.0, range: 1.9, atkCd: 1.1, atkDur: 0.5, aggro: 12, xp: 42, radius: 0.5, gold: [5, 13], drop: 0.32 },
  wraith: { name: 'Wraith', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', weaponGlow: 0xb07aff, tint: 0x8a7aaa, undead: true, eyes: 0xc07aff, bolt: 0xb07aff, hp: 64, dmg: 15, speed: 3.6, range: 12, keep: 8, atkCd: 2.0, aggro: 15, xp: 52, radius: 0.5, gold: [6, 14], drop: 0.35, loot: 'bone' },
  death_knight: { name: 'Death Knight', kind: 'humanoid', model: 'Knight', weapon: 'sword_2handed', weaponGlow: 0x9a5aff, tint: 0x3a3448, style: 'chop', scale: 1.15, hp: 160, dmg: 19, speed: 3.7, range: 2.6, atkCd: 1.7, atkDur: 0.9, aggro: 12, xp: 68, radius: 0.6, gold: [8, 18], drop: 0.38 },
  dread_skeleton: { name: 'Dread Skeleton', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', offhand: 'Skeleton_Shield_Large_B', style: 'chop', scale: 1.15, tint: 0x7a7088, undead: true, eyes: 0xff3a6a, hp: 130, dmg: 18, speed: 3.5, range: 2.3, atkCd: 1.7, atkDur: 0.85, aggro: 12, xp: 60, radius: 0.6, gold: [7, 16], drop: 0.36, loot: 'bone' },
  dread_minion: { name: 'Dread Minion', kind: 'humanoid', model: 'Skeleton_Minion', weapon: 'Skeleton_Blade', tint: 0x8a8098, undead: true, eyes: 0xff3a6a, hp: 58, dmg: 11, speed: 4.3, range: 1.9, atkCd: 1.2, atkDur: 0.55, aggro: 11, xp: 34, radius: 0.5, gold: [4, 10], drop: 0.28, loot: 'bone' },
  night_stalker: { name: 'Night Stalker', kind: 'humanoid', model: 'Rogue_Hooded', weapon: 'dagger', offhand: 'dagger', tint: 0x3a3a4e, hp: 76, dmg: 14, speed: 5.6, range: 1.9, atkCd: 0.95, atkDur: 0.45, aggro: 13, xp: 50, radius: 0.5, gold: [6, 14], drop: 0.34 },
  shadow_archer: { name: 'Shadow Archer', kind: 'caster', archer: true, model: 'Ranger', weapon: 'bow_withString', tint: 0x4a4060, bolt: 0xa05aff, hp: 62, dmg: 15, speed: 4.2, range: 14, keep: 9, atkCd: 1.8, aggro: 15, xp: 52, radius: 0.5, gold: [6, 14], drop: 0.35 },
  hollow_king: { name: 'Malakar the Hollow King', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', weaponGlow: 0xa05aff, offhand: 'Skeleton_Shield_Large_A', style: 'chop', scale: 2.0, tint: 0x6a5a7e, undead: true, eyes: 0xc07aff, boss: true, summons: ['dread_skeleton', 'dread_minion'], hp: 360, dmg: 30, speed: 3.8, range: 3.3, atkCd: 1.6, atkDur: 1.0, aggro: 15, xp: 460, radius: 1.1, gold: [160, 260], drop: 1, respawn: 120, loot: 'bone' },
  abyss_queen: { name: 'Nyxara, Queen of the Abyss', kind: 'caster', model: 'Mage', weapon: 'staff', weaponGlow: 0xff4ad8, tint: 0x9a7ab0, scale: 1.8, boss: true, lich: true, summons: ['dread_minion', 'death_knight'], bolt: 0xff4ad8, hp: 520, dmg: 30, speed: 3.4, range: 15, keep: 7, atkCd: 1.8, aggro: 16, xp: 900, radius: 0.9, gold: [240, 360], drop: 1, respawn: 150 },


  // ---- the deeper floors: the Bone Pits, the Frozen Deep, the Magma Core, the Void Below
  bone_guard: { name: 'Bone Guard', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', offhand: 'Skeleton_Shield_Large_B', style: 'chop', scale: 1.2, tint: 0xe8dcc0, undead: true, eyes: 0x6dffd8, hp: 140, dmg: 17, speed: 3.4, range: 2.3, atkCd: 1.7, atkDur: 0.85, aggro: 12, xp: 62, radius: 0.62, gold: [7, 15], drop: 0.36, loot: 'bone' },
  bone_colossus: { name: 'The Bone Colossus', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', weaponGlow: 0x6dffd8, offhand: 'Skeleton_Shield_Large_A', style: 'chop', scale: 2.3, tint: 0xf0e6d0, undead: true, eyes: 0x6dffd8, boss: true, summons: ['bone_guard', 'skeleton_minion'], hp: 500, dmg: 26, speed: 3.4, range: 3.4, atkCd: 1.7, atkDur: 1.0, aggro: 16, xp: 800, radius: 1.15, gold: [160, 240], drop: 1, respawn: 150, loot: 'bone' },
  ymira: { name: 'Ymira of the Deep', kind: 'caster', model: 'Mage', weapon: 'staff', weaponGlow: 0x8fdcff, tint: 0xc8e8ff, scale: 1.8, boss: true, lich: true, summons: ['frostbone', 'ice_witch'], bolt: 0x9fe4ff, hp: 540, dmg: 29, speed: 3.4, range: 15, keep: 7, atkCd: 1.9, aggro: 16, xp: 880, radius: 0.9, gold: [200, 300], drop: 1, respawn: 150 },
  magmaborn: { name: 'The Magmaborn', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', weaponGlow: 0xff5a10, tint: 0x8a3a20, style: 'chop', scale: 2.2, boss: true, summons: ['molten_brute', 'ember_skeleton'], hp: 600, dmg: 32, speed: 3.6, range: 3.4, atkCd: 1.6, atkDur: 1.0, aggro: 16, xp: 940, radius: 1.15, gold: [240, 340], drop: 1, respawn: 150 },
  void_herald: { name: 'The Void Herald', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', weaponGlow: 0xff4ad8, tint: 0x8a7ab0, scale: 2.0, boss: true, lich: true, undead: true, eyes: 0xff4ad8, summons: ['death_knight', 'wraith'], bolt: 0xff4ad8, hp: 640, dmg: 32, speed: 3.4, range: 15, keep: 7, atkCd: 1.7, aggro: 16, xp: 1000, radius: 0.95, gold: [280, 400], drop: 1, respawn: 150 },

  // ---- the hidden caves' keepers (caves.js), in the tenth chamber
  mossjaw: { name: 'Old Mossjaw', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', weaponGlow: 0x7dff9a, tint: 0x8aa070, style: 'chop', scale: 2.1, boss: true, summons: ['bandit', 'slime_red'], hp: 380, dmg: 24, speed: 3.9, range: 3.1, atkCd: 1.6, atkDur: 1.0, aggro: 18, xp: 560, radius: 1.05, gold: [100, 170], drop: 1 },
  frostmaw: { name: 'Frostmaw, the Rimewell Warden', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', weaponGlow: 0x7fd8ff, offhand: 'Skeleton_Shield_Large_B', style: 'chop', scale: 2.2, tint: 0xbfe0ff, undead: true, eyes: 0x7fd8ff, boss: true, summons: ['frostbone', 'frost_scout'], hp: 470, dmg: 28, speed: 3.7, range: 3.3, atkCd: 1.6, atkDur: 1.0, aggro: 18, xp: 860, radius: 1.1, gold: [180, 260], drop: 1, loot: 'bone' },
  scorchmother: { name: 'The Scorchmother', kind: 'caster', model: 'Mage', weapon: 'staff', weaponGlow: 0xff6a1a, tint: 0xd07a5a, scale: 1.9, boss: true, lich: true, summons: ['ember_skeleton', 'molten_brute'], bolt: 0xff7a2a, hp: 560, dmg: 30, speed: 3.4, range: 15, keep: 7, atkCd: 1.8, aggro: 18, xp: 960, radius: 0.9, gold: [240, 340], drop: 1 },
  gloam_stalker: { name: 'The Gloam Stalker', kind: 'humanoid', model: 'Rogue_Hooded', weapon: 'dagger', weaponGlow: 0xc07aff, offhand: 'dagger', tint: 0x4a3e5e, scale: 1.9, boss: true, summons: ['night_stalker', 'wraith'], hp: 620, dmg: 30, speed: 5.0, range: 2.9, atkCd: 1.1, atkDur: 0.6, aggro: 18, xp: 1080, radius: 0.95, gold: [280, 400], drop: 1 },

  // ---- world bosses: they roam a land and leave heroes alone until struck (passive); ten times the Life of
  // the land's boss, and armor: they take a tenth less of every blow. worldBoss: the class of unique items
  // they carry. Each comes back ten minutes after it falls.
  gorehorn: { name: 'Gorehorn the Wanderer', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', weaponGlow: 0xffa040, tint: 0xb0906a, style: 'chop', scale: 2.4, boss: true, worldBoss: 'low', passive: true, summons: ['bandit', 'slime_red'], hp: 2700, armor: 0.1, dmg: 30, speed: 3.6, range: 3.6, atkCd: 1.7, atkDur: 1.1, aggro: 18, xp: 2400, radius: 1.25, gold: [90, 160], drop: 1 },
  skadi: { name: 'Skadi the Frost Giant', kind: 'humanoid', model: 'Barbarian', weapon: 'axe_2handed', weaponGlow: 0x8fdcff, tint: 0xc8dcf0, style: 'chop', scale: 2.6, boss: true, worldBoss: 'low', passive: true, summons: ['frost_raider', 'raider_berserker'], hp: 3000, armor: 0.1, dmg: 34, speed: 3.6, range: 3.8, atkCd: 1.7, atkDur: 1.1, aggro: 18, xp: 3200, radius: 1.3, gold: [140, 220], drop: 1 },
  ignis: { name: 'Ignis, the Living Pyre', kind: 'humanoid', model: 'Skeleton_Warrior', weapon: 'Skeleton_Axe', weaponGlow: 0xff5a10, offhand: 'Skeleton_Shield_Large_A', style: 'chop', scale: 2.6, tint: 0xa05a3a, undead: true, eyes: 0xff6a10, boss: true, worldBoss: 'mid', passive: true, summons: ['ember_skeleton', 'molten_brute'], hp: 3300, armor: 0.1, dmg: 38, speed: 3.6, range: 3.8, atkCd: 1.6, atkDur: 1.0, aggro: 18, xp: 4200, radius: 1.3, gold: [220, 320], drop: 1, loot: 'bone' },
  umbra: { name: 'Umbra the Devourer', kind: 'caster', model: 'Skeleton_Mage', weapon: 'Skeleton_Staff', weaponGlow: 0xb07aff, tint: 0x5a4a7a, scale: 2.5, undead: true, eyes: 0xc07aff, boss: true, lich: true, worldBoss: 'high', passive: true, summons: ['death_knight', 'night_stalker'], bolt: 0xb07aff, hp: 3600, armor: 0.1, dmg: 40, speed: 3.4, range: 16, keep: 7, atkCd: 1.8, aggro: 18, xp: 5200, radius: 1.2, gold: [300, 440], drop: 1 },
};

// Where each land's world boss roams (its level), and how long after it falls it comes back.
export const WORLD_BOSSES = {
  emberwood: { type: 'gorehorn', lvl: 12 },
  frostfang: { type: 'skadi', lvl: 22 },
  cinderfall: { type: 'ignis', lvl: 40 },
  shadowmere: { type: 'umbra', lvl: 58 },
};
export const WORLD_BOSS_FIRST = 180; // s after heroes arrive in a land (the world keeps time only where heroes are)
export const WORLD_BOSS_RETURN = 600; // s after it falls

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
];

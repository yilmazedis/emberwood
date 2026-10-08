// The hidden caves: one in every land, its mouth hidden in bushes. A key to it drops (rarely) from the
// monsters around the mouth, and only a hero who carries one sees the mouth, glowing so it's found. The key
// opens a private copy of the cave for the hero's party (or the hero alone, which is hard): ten stages, a
// chamber each; every monster in a chamber must fall before the way to the next opens, and the tenth holds the
// cave's keeper. When it falls the way out opens, with a treasure, and everyone in the cave gets a good share
// of a level's XP. Past level 58 there are no monsters of a hero's level outside the caves: they are the way
// up to 80.
//   One cave a day (a day by Turkey's clock) for each hero: entering is what counts. Any party member's key
//   opens it for the whole party, but a member who has been in a cave today stays out (one who was already
//   in this very copy, and fell or stepped out, may go back).
//   A hero carries one key at most, can't bank, trade or sell it, and only finds (and uses) the key of the
//   furthest land it may enter: a hero who may go to Shadowmere only finds Shadowmere's. Outgrowing a land
//   crumbles its key.
// Shared by the game and the game server, so plain data and numbers only.

export const STAGES = 10;
export const STAGE_ROOMS = ['A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'B']; // the chambers in order (B: the keeper's)
export const KEY_RANGE = 30; // m from the mouth: monsters this close may drop its key…
export const KEY_CHANCE = 0.04; // …this often (each hero credited with the kill rolls for their own)
export const CAVE_XP = 0.4; // clearing a cave: this share of the XP for the hero's next level
export const MOUTH_REACH = 6; // m: how close to the mouth a hero must be to go in
export const ELITE_HP = 1.3, ELITE_DMG = 1.15; // cave monsters are a cut above the land's
export const PARTY_HP = 0.5; // each hero in the cave beyond the first: monsters have this much more Life (and give more XP)

// A cave day starts at midnight in Turkey (UTC+3).
const DAY_MS = 86400000, DAY_OFFSET = 3 * 3600000;
export const dayNumber = (now = Date.now()) => Math.floor((now + DAY_OFFSET) / DAY_MS);
export const msToNextDay = (now = Date.now()) => DAY_MS - ((now + DAY_OFFSET) % DAY_MS);
export function untilTomorrow(now = Date.now()) {
  const m = Math.ceil(msToNextDay(now) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

// The lands with caves, and the hero levels each one's cave is for (from the level the land opens: maps.js
// minLevel, until the next land does).
export const CAVE_LANDS = ['emberwood', 'frostfang', 'cinderfall', 'shadowmere'];

// mouth: where it is in its land (around the land's centre; Emberwood's own coordinates) and the way it faces
// (yaw: about toward the camera, which always looks north); near: the zone beside it; heroes: the hero levels
// it is for; levels: its monsters' levels (the heroes' own, within these); packs: the monsters of its early,
// middle and late chambers; boss: its keeper; look: its colours (mouth: the stone of its land).
export const CAVES = {
  emberwood: {
    id: 'cave_emberwood', land: 'emberwood', name: 'Bramble Hollow', heroes: [1, 7], levels: [3, 9],
    mouth: { x: 54, z: -34, yaw: -0.4 }, near: 'the Bandit Hideout', key: 'cave_key_emberwood',
    packs: [['slime_blue', 'bandit', 'slime_red'], ['bandit', 'cultist', 'skeleton_minion', 'skeleton_rogue'], ['skeleton_warrior', 'skeleton_rogue', 'skeleton_mage', 'cultist']],
    boss: 'mossjaw', bushes: 0x4c9439,
    look: { floor: [0x5a4c38, 0x6a5a40, 0x4a5636], rock: [0x6e6658, 0x5e584c, 0x7a7262], mouth: 0x8c897d, crystal: 0x7dff9a, fog: 0x0a0c08, hemiSky: 0xa8b898, hemiGround: 0x2a2418, sun: 0xc8d0b0 },
  },
  frostfang: {
    id: 'cave_frostfang', land: 'frostfang', name: 'The Rimewell', heroes: [8, 19], levels: [10, 24],
    mouth: { x: 26, z: 30, yaw: -0.3 }, near: 'the Snowdrift Fields', key: 'cave_key_frostfang',
    packs: [['slime_frost', 'frost_scout', 'frost_raider'], ['frost_raider', 'ice_witch', 'slime_glacial', 'frost_archer'], ['frostbone', 'raider_berserker', 'ice_witch', 'frost_archer']],
    boss: 'frostmaw', bushes: 0x3e6a52,
    look: { floor: [0x5e6e84, 0x6e7e94, 0x52607a], rock: [0x8a9aae, 0x7a8a9e, 0xa8b8cc], mouth: 0x9aa4b0, crystal: 0x7fd8ff, fog: 0x070b12, hemiSky: 0xa8c4ec, hemiGround: 0x243040, sun: 0xb0ccf4 },
  },
  cinderfall: {
    id: 'cave_cinderfall', land: 'cinderfall', name: 'The Ember Vein', heroes: [20, 37], levels: [22, 42],
    mouth: { x: -27, z: 50, yaw: 0.35 }, near: 'the Ashen Flats', key: 'cave_key_cinderfall',
    packs: [['slime_cinder', 'ash_bandit', 'ember_skeleton'], ['ash_knight', 'cinder_cultist', 'pyre_archer', 'ember_skeleton'], ['molten_brute', 'ash_knight', 'flame_warden', 'pyre_archer']],
    boss: 'scorchmother', bushes: 0x5a5a3a,
    look: { floor: [0x46383a, 0x54443c, 0x3c3030], rock: [0x5a4e48, 0x4c423e, 0x6a5c54], mouth: 0x4c4542, crystal: 0xff7a2a, fog: 0x120604, hemiSky: 0xe0a080, hemiGround: 0x3a1a0c, sun: 0xffa070 },
  },
  shadowmere: {
    id: 'cave_shadowmere', land: 'shadowmere', name: 'The Gloamdeep', heroes: [38, 80], levels: [40, 80],
    mouth: { x: 53, z: 49, yaw: -0.35 }, near: 'the Gloom Marsh', key: 'cave_key_shadowmere',
    packs: [['slime_void', 'bog_lurker', 'dread_minion'], ['wraith', 'death_knight', 'night_stalker', 'dread_minion'], ['dread_skeleton', 'death_knight', 'shadow_archer', 'wraith', 'night_stalker']],
    boss: 'gloam_stalker', bushes: 0x3e4a3a,
    look: { floor: [0x403850, 0x4a405c, 0x363046], rock: [0x5a5468, 0x4c4858, 0x6a6278], mouth: 0x56526a, crystal: 0xc07aff, fog: 0x07040c, hemiSky: 0xb0a0d8, hemiGround: 0x1e1828, sun: 0xc0b0f0 },
  },
};

// The land whose cave a hero of this level may use: the furthest land it may enter.
export function caveLandFor(level) {
  let land = CAVE_LANDS[0];
  for (const id of CAVE_LANDS) if (level >= CAVES[id].heroes[0]) land = id;
  return land;
}

// The monster level in a cave for heroes of these levels (their average), at a stage: a level up every three
// chambers, the keeper three above.
export function caveLevel(cave, levels, stage) {
  const avg = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : cave.levels[0];
  const base = Math.max(cave.levels[0], Math.min(cave.levels[1], Math.round(avg)));
  return base + (stage >= STAGES ? 3 : Math.floor((stage - 1) / 3));
}

// The monsters of stage `stage` (1–10) for `heroes` heroes of these levels, in chamber `room` (a
// DungeonMap room): spawn slots for the world (sim/world.js), each one monster, never coming back.
export function stageSlots(cave, stage, room, levels, rng = Math.random) {
  const n = levels.length || 1, party = 1 + PARTY_HP * (n - 1), lvl = caveLevel(cave, levels, stage);
  const r = Math.max(2, Math.min(room.x1 - room.x0, room.z1 - room.z0) / 2 - 2);
  const slot = (type, extra = {}) => ({ type, x: room.cx, z: room.cz, r, n: 1, lvl, stage, once: true, hpMul: ELITE_HP * party, dmgMul: ELITE_DMG, xpMul: ELITE_HP * party, ...extra });
  const pick = (list) => list[Math.floor(rng() * list.length)];
  if (stage >= STAGES) { // the keeper, and two of its guards
    const guards = cave.packs[2];
    return [
      slot(cave.boss, { r: 0.5, x: room.cx, z: room.cz - 2, hpMul: party, dmgMul: 1, xpMul: party, room: 'B' }),
      slot(pick(guards), { lvl: lvl - 2 }), slot(pick(guards), { lvl: lvl - 2 }),
    ];
  }
  const pack = cave.packs[Math.min(2, Math.floor((stage - 1) / 3))];
  const count = 4 + Math.floor((stage - 1) / 3) + Math.round(0.75 * (n - 1));
  return Array.from({ length: count }, (_, i) => slot(i === 0 && stage % 3 === 0 ? pack[pack.length - 1] : pick(pack)));
}

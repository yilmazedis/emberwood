// Every place a hero can be: Emberwood (the first land), the lands beyond the waystones, and a dungeon in
// each (a private copy per party or lone hero). Shared by the game and the game server: where each place
// lies, its levels, where you arrive and where you rise after falling there, its monsters, and its ways
// out (portals: the waystones, dungeon doors and stairs). Plain data.
//   look: the light, fog and sky there (the game's); music: its theme
import { CRYPT, WORLD_RADIUS } from './terrain.js';
import { SPAWNS } from './monsters.js';
import { crypt, CRYPT_SPAWNS } from './maps/crypt.js';
import { frostfang, FROSTFANG_SPAWNS, rimeheart, RIMEHEART_SPAWNS } from './maps/frostfang.js';
import { cinderfall, CINDERFALL_SPAWNS, forge, FORGE_SPAWNS } from './maps/cinderfall.js';
import { shadowmere, SHADOWMERE_SPAWNS, abyss, ABYSS_SPAWNS } from './maps/shadowmere.js';

export const START = 'emberwood';
export const WAYSTONE = { x: 5.5, z: 5.5 }; // Emberwood's, in camp
export const LANDS = ['emberwood', 'frostfang', 'cinderfall', 'shadowmere']; // the waystones' destinations
const PORTAL_REACH = 6; // m: how close the server wants you to a portal you use

// In front of a door that faces `yaw`, `d` metres out.
const before = (door, d, yaw = door.yaw) => ({ x: door.x + Math.sin(door.yaw) * d, z: door.z + Math.cos(door.yaw) * d, yaw });

// A land beyond the waystones (an OutdoorMap) and the dungeon whose door is in it.
function land(om, { id, name, levels, minLevel, look, music, spawns, dungeon }) {
  const camp = om.camp, stone = om.plan.props.find((p) => p.kind === 'waystone');
  return {
    id, name, sub: `Level ${levels[0]} – ${levels[1]}`, kind: 'outdoor', levels, minLevel, look, music, spawns,
    outdoor: om, contains: (x, z) => om.contains(x, z),
    camp, waystone: { x: stone.x, z: stone.z },
    arrive: { x: stone.x - 2.5, z: stone.z - 1, yaw: Math.PI },
    respawn: { map: id, x: camp.x - 2.5, z: camp.z - 3, yaw: Math.PI },
    portals: [
      { id: 'waystone', x: stone.x, z: stone.z, to: LANDS, name: 'Waystone', title: 'Travel to another land', action: 'Travel' },
      { id: 'door', ...before(om.door, 2.2), to: dungeon, name: null, title: null, action: 'Enter' }, // (named after the dungeon)
    ],
  };
}

// A dungeon (a DungeonMap) under a land, left by its stairs to `at` (outside its door).
function dungeon(dm, { id, name, levels, minLevel, look, from, at, respawn, spawns }) {
  return {
    id, name, sub: `Dungeon · Level ${levels[0]} – ${levels[1]}`, kind: 'dungeon', levels, minLevel, look, music: 'crypt', spawns,
    dungeon: dm, instanced: true, contains: (x, z) => dm.contains(x, z),
    arrive: dm.arrive, respawn,
    portals: [{ id: 'stairs', x: dm.exit.x, z: dm.exit.z, to: from, at, name: 'Stairs', title: `Up to ${MAPS_NAMES[from]}`, action: 'Leave' }],
  };
}
const MAPS_NAMES = { emberwood: 'the graveyard', frostfang: 'the snowfields', cinderfall: 'the wastes', shadowmere: 'the marsh' };

const DUNGEON_LOOK = { fog: 0x0b0a0e, near: 26, far: 64, hemiSky: 0x9aa0c8, hemiGround: 0x3a3028, hemi: 1.0, sun: 0xa4b0e0, sunI: 1.2, flame: 0xff8a3a, tint: 0xffffff };

export const MAPS = {
  emberwood: {
    id: 'emberwood', name: 'Emberwood', sub: 'Level 1 – 9', kind: 'outdoor', levels: [1, 9], minLevel: 1, music: 'world',
    spawns: SPAWNS, contains: (x, z) => Math.hypot(x, z) < WORLD_RADIUS + 40,
    camp: { x: 0, z: 0, r: 12 }, waystone: WAYSTONE,
    arrive: { x: WAYSTONE.x - 2.2, z: WAYSTONE.z - 1.6, yaw: Math.PI },
    respawn: { map: 'emberwood', x: 0, z: 3.5, yaw: Math.PI },
    look: null, // (the overworld's own: see game.js)
    portals: [
      { id: 'waystone', x: WAYSTONE.x, z: WAYSTONE.z, to: LANDS, name: 'Waystone', title: 'Travel to another land', action: 'Travel' },
      { id: 'crypt', x: CRYPT.x - 3.0, z: CRYPT.z, to: 'crypt', name: 'Forgotten Crypt', title: 'Dungeon · Level 7 – 9', action: 'Enter' },
    ],
  },
  crypt: dungeon(crypt, {
    id: 'crypt', name: 'Forgotten Crypt', levels: [7, 9], minLevel: 1, look: DUNGEON_LOOK, spawns: CRYPT_SPAWNS,
    from: 'emberwood', at: { x: CRYPT.x - 3.2, z: CRYPT.z, yaw: -Math.PI / 2 }, respawn: { map: 'emberwood', x: 0, z: 3.5, yaw: Math.PI },
  }),
  frostfang: land(frostfang, {
    id: 'frostfang', name: 'Frostfang Highlands', levels: [10, 22], minLevel: 8, music: 'world', spawns: FROSTFANG_SPAWNS, dungeon: 'rimeheart',
    look: { fog: 0xdbe6ef, near: 48, far: 135, hemiSky: 0xe4f0ff, hemiGround: 0x8a98a8, hemi: 1.3, sun: 0xf2f6ff, sunI: 2.3, sky: [0x86acd2, 0xd6e4f0, 0xeaf1f6], snow: true },
  }),
  rimeheart: dungeon(rimeheart, {
    id: 'rimeheart', name: 'Rimeheart Caverns', levels: [20, 24], minLevel: 16, spawns: RIMEHEART_SPAWNS,
    look: { ...DUNGEON_LOOK, fog: 0x080d14, hemiSky: 0x9ab8e0, hemiGround: 0x283440, sun: 0xa8c8f0, flame: 0x6fc8ff, tint: 0xd8e8ff, circle: 0x4dc8ff },
    from: 'frostfang', at: before(frostfang.door, 3.6), respawn: { map: 'frostfang', ...campSpot(frostfang) },
  }),
  cinderfall: land(cinderfall, {
    id: 'cinderfall', name: 'Cinderfall Wastes', levels: [22, 40], minLevel: 20, music: 'world', spawns: CINDERFALL_SPAWNS, dungeon: 'forge',
    look: { fog: 0x4a2e26, near: 40, far: 118, hemiSky: 0xf0c4ac, hemiGround: 0x3a2018, hemi: 1.1, sun: 0xffc090, sunI: 2.1, sky: [0x24120e, 0x74361e, 0x9a5634], embers: true },
  }),
  forge: dungeon(forge, {
    id: 'forge', name: 'The Molten Forge', levels: [38, 42], minLevel: 34, spawns: FORGE_SPAWNS,
    look: { ...DUNGEON_LOOK, fog: 0x140a06, hemiSky: 0xd8a080, hemiGround: 0x3a2014, sun: 0xffb080, flame: 0xff7a2a, tint: 0xffd8c0, circle: 0xff6a1a },
    from: 'cinderfall', at: before(cinderfall.door, 3.6), respawn: { map: 'cinderfall', ...campSpot(cinderfall) },
  }),
  shadowmere: land(shadowmere, {
    id: 'shadowmere', name: 'Shadowmere', levels: [40, 58], minLevel: 38, music: 'crypt', spawns: SHADOWMERE_SPAWNS, dungeon: 'abyss',
    look: { fog: 0x2a2238, near: 36, far: 112, hemiSky: 0xb4a6e0, hemiGround: 0x2e2638, hemi: 1.25, sun: 0xc8b8ff, sunI: 1.85, sky: [0x0c0818, 0x34264e, 0x54446e], motes: true },
  }),
  abyss: dungeon(abyss, {
    id: 'abyss', name: 'The Abyssal Vault', levels: [56, 60], minLevel: 52, spawns: ABYSS_SPAWNS,
    look: { ...DUNGEON_LOOK, fog: 0x0a0610, hemiSky: 0xa898d0, hemiGround: 0x241a30, sun: 0xc0a8ff, flame: 0xb070ff, tint: 0xd8c8f0, circle: 0xff4ad8 },
    from: 'shadowmere', at: before(shadowmere.door, 3.6), respawn: { map: 'shadowmere', ...campSpot(shadowmere) },
  }),
};

function campSpot(om) {
  return { x: om.camp.x - 2.5, z: om.camp.z - 3, yaw: Math.PI };
}

// the dungeons' doors are named after them
for (const m of Object.values(MAPS)) {
  for (const p of m.portals) {
    if (p.id !== 'door') continue;
    const d = MAPS[p.to];
    p.name = d.name;
    p.title = d.sub;
    p.at = d.arrive;
  }
  for (const p of m.portals) if (p.id === 'crypt') p.at = MAPS.crypt.arrive;
}

export const MAP_IDS = Object.keys(MAPS);
export const mapOf = (id) => MAPS[id] || null;

// Which place a spot is in (the dungeons and lands claim theirs; everything else is Emberwood).
export function mapAt(x, z) {
  for (const m of Object.values(MAPS)) if (m.id !== 'emberwood' && m.contains(x, z)) return m;
  return MAPS.emberwood;
}

// A portal of `from` within reach of (x, z) that leads to `to` (the server checks travel with this).
export function portalTo(from, to, x, z) {
  return from.portals.find((p) => (Array.isArray(p.to) ? p.to.includes(to) : p.to === to) && Math.hypot(p.x - x, p.z - z) < PORTAL_REACH) || null;
}

// Where a hero lands going through portal p to map `to`.
export function arrival(p, to) {
  return p.at || MAPS[to].arrive;
}

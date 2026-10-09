// Every place a hero can be: Emberwood (the first land), the lands beyond the waystones, a dungeon in
// each with a deeper floor under it (private copies per party or lone hero), and the Arena, where heroes
// fight heroes. Shared by the game and the game server: where each place
// lies, its levels, where you arrive and where you rise after falling there, its monsters, and its ways
// out (portals: the waystones, dungeon doors and stairs). Plain data.
//   look: the light, fog and sky there (the game's); music: its theme
import { CRYPT, WORLD_RADIUS, ZONES } from './terrain.js';
import { SPAWNS } from './monsters.js';
import { crypt, CRYPT_SPAWNS } from './maps/crypt.js';
import { frostfang, FROSTFANG_SPAWNS, rimeheart, RIMEHEART_SPAWNS } from './maps/frostfang.js';
import { cinderfall, CINDERFALL_SPAWNS, forge, FORGE_SPAWNS } from './maps/cinderfall.js';
import { shadowmere, SHADOWMERE_SPAWNS, abyss, ABYSS_SPAWNS, CANYON_GATE } from './maps/shadowmere.js';
import { canyon, CANYON_SPAWNS, GATE as CANYON_BACK } from './maps/canyon.js';
import { arena, ARENA } from './maps/arena.js';
import { crypt2, CRYPT2_SPAWNS, rimeheart2, RIMEHEART2_SPAWNS, forge2, FORGE2_SPAWNS, abyss2, ABYSS2_SPAWNS } from './maps/depths.js';
import { CAMPS } from './camps.js'; // (the people in each camp, and what blocks the way there)
import { CAVES } from './caves.js';
import { CAVE_MAPS } from './maps/caves.js';
import { addCollider } from './terrain.js';

export const START = 'emberwood';
export const WAYSTONE = { x: 5.5, z: 5.5 }; // Emberwood's, in camp
export const LANDS = ['emberwood', 'frostfang', 'cinderfall', 'shadowmere', 'arena']; // the waystones' destinations
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

// A dungeon (a DungeonMap) under a land, left by its stairs to `at` (outside its door). deeper: the floor
// below it, whose stairs down open behind its boss.
function dungeon(dm, { id, name, levels, minLevel, look, from, at, respawn, spawns, deeper = null }) {
  const m = {
    id, name, sub: `Dungeon · Level ${levels[0]} – ${levels[1]}`, kind: 'dungeon', levels, minLevel, look, music: 'crypt', spawns,
    dungeon: dm, instanced: true, contains: (x, z) => dm.contains(x, z),
    arrive: dm.arrive, respawn,
    portals: [{ id: 'stairs', x: dm.exit.x, z: dm.exit.z, to: from, at, name: 'Stairs', title: `Up to ${MAPS_NAMES[from]}`, action: 'Leave' }],
  };
  if (deeper) { // stairs down, behind the boss's hoard
    const B = dm.rooms.B;
    m.down = { x: B.cx + 5, z: B.z0 + 2.8 };
    m.portals.push({ id: 'down', ...m.down, to: deeper, name: 'Stairs down', title: '', action: 'Descend' });
  }
  return m;
}
const MAPS_NAMES = { emberwood: 'the graveyard', frostfang: 'the snowfields', cinderfall: 'the wastes', shadowmere: 'the marsh', crypt: 'the crypt', rimeheart: 'the caverns', forge: 'the forge', abyss: 'the vault' };

const DUNGEON_LOOK = { fog: 0x0b0a0e, near: 26, far: 64, hemiSky: 0x9aa0c8, hemiGround: 0x3a3028, hemi: 1.0, sun: 0xa4b0e0, sunI: 1.2, flame: 0xff8a3a, tint: 0xffffff };

export const MAPS = {
  emberwood: {
    id: 'emberwood', name: 'Emberwood', sub: 'Level 1 – 9', kind: 'outdoor', levels: [1, 9], minLevel: 1, music: 'world',
    spawns: SPAWNS, zones: ZONES, contains: (x, z) => Math.hypot(x, z) < WORLD_RADIUS + 40,
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
    id: 'crypt', name: 'Forgotten Crypt', levels: [7, 9], minLevel: 1, look: DUNGEON_LOOK, spawns: CRYPT_SPAWNS, deeper: 'crypt2',
    from: 'emberwood', at: { x: CRYPT.x - 3.2, z: CRYPT.z, yaw: -Math.PI / 2 }, respawn: { map: 'emberwood', x: 0, z: 3.5, yaw: Math.PI },
  }),
  frostfang: land(frostfang, {
    id: 'frostfang', name: 'Frostfang Highlands', levels: [10, 22], minLevel: 8, music: 'world', spawns: FROSTFANG_SPAWNS, dungeon: 'rimeheart',
    look: { fog: 0xdbe6ef, near: 48, far: 135, hemiSky: 0xe4f0ff, hemiGround: 0x8a98a8, hemi: 1.3, sun: 0xf2f6ff, sunI: 2.3, sky: [0x86acd2, 0xd6e4f0, 0xeaf1f6], snow: true },
  }),
  rimeheart: dungeon(rimeheart, {
    id: 'rimeheart', name: 'Rimeheart Caverns', levels: [20, 24], minLevel: 16, spawns: RIMEHEART_SPAWNS, deeper: 'rimeheart2',
    look: { ...DUNGEON_LOOK, fog: 0x080d14, hemiSky: 0x9ab8e0, hemiGround: 0x283440, sun: 0xa8c8f0, flame: 0x6fc8ff, tint: 0xd8e8ff, circle: 0x4dc8ff },
    from: 'frostfang', at: before(frostfang.door, 3.6), respawn: { map: 'frostfang', ...campSpot(frostfang) },
  }),
  cinderfall: land(cinderfall, {
    id: 'cinderfall', name: 'Cinderfall Wastes', levels: [22, 40], minLevel: 20, music: 'world', spawns: CINDERFALL_SPAWNS, dungeon: 'forge',
    look: { fog: 0x4a2e26, near: 40, far: 118, hemiSky: 0xf0c4ac, hemiGround: 0x3a2018, hemi: 1.1, sun: 0xffc090, sunI: 2.1, sky: [0x24120e, 0x74361e, 0x9a5634], embers: true },
  }),
  forge: dungeon(forge, {
    id: 'forge', name: 'The Molten Forge', levels: [38, 42], minLevel: 34, spawns: FORGE_SPAWNS, deeper: 'forge2',
    look: { ...DUNGEON_LOOK, fog: 0x140a06, hemiSky: 0xd8a080, hemiGround: 0x3a2014, sun: 0xffb080, flame: 0xff7a2a, tint: 0xffd8c0, circle: 0xff6a1a },
    from: 'cinderfall', at: before(cinderfall.door, 3.6), respawn: { map: 'cinderfall', ...campSpot(cinderfall) },
  }),
  shadowmere: land(shadowmere, {
    id: 'shadowmere', name: 'Shadowmere', levels: [40, 58], minLevel: 38, music: 'crypt', spawns: SHADOWMERE_SPAWNS, dungeon: 'abyss',
    look: { fog: 0x2a2238, near: 36, far: 112, hemiSky: 0xb4a6e0, hemiGround: 0x2e2638, hemi: 1.25, sun: 0xc8b8ff, sunI: 1.85, sky: [0x0c0818, 0x34264e, 0x54446e], motes: true },
  }),
  abyss: dungeon(abyss, {
    id: 'abyss', name: 'The Abyssal Vault', levels: [56, 60], minLevel: 52, spawns: ABYSS_SPAWNS, deeper: 'abyss2',
    look: { ...DUNGEON_LOOK, fog: 0x0a0610, hemiSky: 0xa898d0, hemiGround: 0x241a30, sun: 0xc0a8ff, flame: 0xb070ff, tint: 0xd8c8f0, circle: 0xff4ad8 },
    from: 'shadowmere', at: before(shadowmere.door, 3.6), respawn: { map: 'shadowmere', ...campSpot(shadowmere) },
  }),
};

// the deeper floors: down from the boss's room above; falling there, you rise in the land's camp
const below = (above) => ({ x: MAPS[above].down.x - 2.2, z: MAPS[above].down.z + 0.6, yaw: Math.PI });
MAPS.crypt2 = dungeon(crypt2, {
  id: 'crypt2', name: 'The Bone Pits', levels: [11, 14], minLevel: 9, spawns: CRYPT2_SPAWNS,
  look: { ...DUNGEON_LOOK, fog: 0x0c0a08, hemiSky: 0xc0b8a0, sun: 0xd0c0a0, flame: 0x7dffb0, tint: 0xf0e8d8, circle: 0x6dffd8 },
  from: 'crypt', at: below('crypt'), respawn: MAPS.crypt.respawn,
});
MAPS.rimeheart2 = dungeon(rimeheart2, {
  id: 'rimeheart2', name: 'The Frozen Deep', levels: [25, 28], minLevel: 23, spawns: RIMEHEART2_SPAWNS,
  look: { ...DUNGEON_LOOK, fog: 0x060a12, hemiSky: 0x8ab0e8, hemiGround: 0x1a2838, sun: 0x9ac0f8, flame: 0x8fdcff, tint: 0xc8dcff, circle: 0x8fdcff },
  from: 'rimeheart', at: below('rimeheart'), respawn: MAPS.rimeheart.respawn,
});
MAPS.forge2 = dungeon(forge2, {
  id: 'forge2', name: 'The Magma Core', levels: [43, 46], minLevel: 41, spawns: FORGE2_SPAWNS,
  look: { ...DUNGEON_LOOK, fog: 0x1a0804, hemiSky: 0xe89070, hemiGround: 0x4a1a0a, sun: 0xff9a60, flame: 0xff5a10, tint: 0xffc8a8, circle: 0xff4a10 },
  from: 'forge', at: below('forge'), respawn: MAPS.forge.respawn,
});
MAPS.abyss2 = dungeon(abyss2, {
  id: 'abyss2', name: 'The Void Below', levels: [60, 62], minLevel: 58, spawns: ABYSS2_SPAWNS,
  look: { ...DUNGEON_LOOK, fog: 0x08040e, hemiSky: 0x9888c8, hemiGround: 0x1a1028, sun: 0xb8a0ff, flame: 0xff4ad8, tint: 0xd0c0f0, circle: 0xff4ad8 },
  from: 'abyss', at: below('abyss'), respawn: MAPS.abyss.respawn,
});
for (const [above, deep] of [['crypt', 'crypt2'], ['rimeheart', 'rimeheart2'], ['forge', 'forge2'], ['abyss', 'abyss2']]) {
  const p = MAPS[above].portals.find((x) => x.id === 'down');
  p.at = MAPS[deep].arrive;
  p.title = `${MAPS[deep].name} · Level ${MAPS[deep].levels[0]} – ${MAPS[deep].levels[1]}`;
}
for (const [id, list] of Object.entries(CAMPS)) if (MAPS[id]) MAPS[id].npcs = list; // (the canyon's: below)

MAPS.arena = {
  id: 'arena', name: 'The Arena', sub: 'Hero against hero · from level 5', kind: 'arena', pvp: true, levels: [5, 80], minLevel: 5, music: 'world',
  spawns: [], contains: arena.contains,
  camp: { x: ARENA.cx, z: ARENA.cz + 35, r: 8 }, waystone: arena.waystone, board: arena.board,
  arrive: arena.arrive, respawn: { map: 'arena', ...arena.arrive },
  look: { fog: 0xdccdb0, near: 70, far: 170, hemiSky: 0xfff0d8, hemiGround: 0x8a6a4a, hemi: 1.25, sun: 0xfff0d0, sunI: 2.6, sky: [0x4a8ad8, 0xb8d4ec, 0xead8bc] },
  portals: [{ id: 'waystone', ...arena.waystone, to: LANDS, name: 'Waystone', title: 'Travel to another land', action: 'Travel' }],
};

// The Death Canyon (maps/canyon.js), through its gate in Shadowmere, from level 70: heroes fight heroes there
// (pvp: anyone not in their party, out of its camp), its monsters alone carry the rare items, and calamities
// (sim/world.js) strike its heroes.
{
  const sm = MAPS.shadowmere, gate = { x: shadowmere.cx + CANYON_GATE.x, z: shadowmere.cz + CANYON_GATE.z };
  const back = { x: canyon.cx + CANYON_BACK.x, z: canyon.cz + CANYON_BACK.z };
  MAPS.canyon = { // (no waystone: the gate is the way out)
    id: 'canyon', name: 'Death Canyon', sub: 'Level 70 – 78 · heroes fight heroes', kind: 'outdoor', pvp: true, calamities: true, levels: [70, 78], minLevel: 70, music: 'world',
    spawns: CANYON_SPAWNS, outdoor: canyon, contains: (x, z) => canyon.contains(x, z),
    camp: canyon.camp, waystone: null,
    arrive: { x: back.x, z: back.z + 2.6, yaw: 0 }, respawn: { map: 'canyon', x: canyon.camp.x - 2.5, z: canyon.camp.z - 3, yaw: Math.PI },
    look: { fog: 0x5a3020, near: 40, far: 120, hemiSky: 0xffc8a0, hemiGround: 0x4a2418, hemi: 1.15, sun: 0xffb080, sunI: 2.2, sky: [0x2a120c, 0x7a3a22, 0xb86a3e], embers: true },
    portals: [
      { id: 'gate', x: back.x, z: back.z + 2.2, to: 'shadowmere', at: { x: gate.x, z: gate.z + 2.6, yaw: 0 }, name: 'Gate to Shadowmere', title: 'Out of the canyon', action: 'Leave' },
    ],
  };
  MAPS.canyon.npcs = CAMPS.canyon;
  sm.portals.push({ id: 'canyon', x: gate.x, z: gate.z + 2.2, to: 'canyon', at: MAPS.canyon.arrive, name: 'Death Canyon', title: 'Level 70+ · heroes fight heroes', action: 'Enter' });
}

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

// The hidden caves (caves.js): their mouths in the lands (none is a portal: a key, or a party's open cave,
// is the way in, see the game server's 'cave'), and the caves themselves, left by the way in or, once the
// keeper has fallen, by the daylight in its hall.
for (const [land, d] of Object.entries(CAVE_MAPS)) {
  const c = CAVES[land], L = MAPS[land], om = L.outdoor;
  const mouth = { x: c.mouth.x + (om ? om.cx : 0), z: c.mouth.z + (om ? om.cz : 0), yaw: c.mouth.yaw };
  const outside = { x: mouth.x + Math.sin(mouth.yaw) * 3, z: mouth.z + Math.cos(mouth.yaw) * 3, yaw: mouth.yaw };
  L.hiddenCave = { ...c, mouth, outside }; // (a cave map's own `cave` is its definition)
  // the rocks around the mouth (cave-view.js CaveMouth draws them): solid behind and beside the way in
  const cs = Math.cos(mouth.yaw), sn = Math.sin(mouth.yaw);
  for (const [lx, lz, r] of [[0, -2.1, 2.0], [-1.75, -0.75, 0.9], [1.75, -0.75, 0.9], [-2.9, -1.7, 0.9], [2.8, -1.8, 0.85]]) addCollider(mouth.x + lx * cs + lz * sn, mouth.z - lx * sn + lz * cs, r);
  const B = d.rooms.B, fromWest = d.gates[d.gates.length - 1].x < B.cx; // (the daylight: across the hall from the way in)
  MAPS[c.id] = {
    id: c.id, name: c.name, sub: `Hidden cave · ${L.name}`, kind: 'dungeon', cave: c, land, levels: c.levels, minLevel: 1, music: 'crypt', spawns: [],
    dungeon: d, instanced: true, contains: (x, z) => d.contains(x, z), arrive: d.arrive, respawn: L.respawn,
    look: { ...DUNGEON_LOOK, fog: c.look.fog, near: 24, far: 62, hemiSky: c.look.hemiSky, hemiGround: c.look.hemiGround, hemi: 1.45, sun: c.look.sun, sunI: 1.25, flame: c.look.crystal, circle: c.look.crystal },
    portals: [
      { id: 'mouth', x: d.exit.x, z: d.exit.z, to: land, at: outside, name: 'The way out', title: `Back to ${L.name}`, action: 'Leave' },
      { id: 'out', x: fromWest ? B.x1 - 3 : B.x0 + 3, z: B.z0 + 2.2, to: land, at: outside, name: 'Daylight', title: `Back to ${L.name}`, action: 'Leave', needs: 'cleared' },
    ],
  };
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

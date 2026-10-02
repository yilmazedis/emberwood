// The Forgotten Crypt beneath Emberwood's graveyard: its plan, its monsters and the pieces that dress it
// (see dungeon-map.js). Rooms: S start, H hall of bones, C chapel, O ossuary, V vault, B the Lich's sanctum.
import { DungeonMap } from '../dungeon-map.js';
import { mulberry32 } from '../util.js';

export const crypt = new DungeonMap({
  id: 'crypt',
  cx: 0, cz: -400, // far north of the overworld
  map: [
    '###############',
    '###BBBBBBBBB###',
    '###BBBBBBBBB###',
    '###BBBBBBBBB###',
    '###BBBBBBBBB###',
    '###BBBBBBBBB###',
    '#######.#######',
    '#######.#######',
    '#CCC#OOOOO#VVV#',
    '#CCC.OOOOO.VVV#',
    '#CCC#OOOOO#VVV#',
    '##.############',
    '##.######U#####',
    '#HHHHH##SSS####',
    '#HHHHH..SSS####',
    '#HHHHH##SSS####',
    '###############',
  ],
  zone: { id: 'crypt', name: 'Forgotten Crypt', sub: 'Undead · Level 7 – 9' },
  boss: { id: 'sanctum', name: "Morvain's Sanctum", sub: 'Boss · Level 9' },
});

const d = crypt, R = d.rooms;
export const CRYPT_SPAWNS = [
  { type: 'skeleton_minion', x: R.H.cx, z: R.H.cz, r: 7, n: 4, lvl: 7 },
  { type: 'skeleton_warrior', x: R.H.cx + 5, z: R.H.cz, r: 2, n: 1, lvl: 7 },
  { type: 'skeleton_mage', x: R.C.cx, z: R.C.cz - 2, r: 3, n: 2, lvl: 7 },
  { type: 'skeleton_rogue', x: R.C.cx, z: R.C.cz + 1, r: 3, n: 2, lvl: 8 },
  { type: 'skeleton_minion', x: R.O.cx, z: R.O.cz + 1, r: 7, n: 3, lvl: 8 },
  { type: 'skeleton_warrior', x: R.O.cx, z: R.O.cz - 2, r: 5, n: 2, lvl: 8 },
  { type: 'skeleton_mage', x: R.O.cx, z: R.O.cz - 3.5, r: 2, n: 1, lvl: 8 },
  { type: 'skeleton_warrior', x: R.V.cx - 1, z: R.V.cz, r: 3, n: 2, lvl: 8 },
  { type: 'lich', x: R.B.cx, z: R.B.cz - 4.5, r: 0.5, n: 1, lvl: 9, room: 'B' },
];

// ---------------------------------------------------------------- dressing
// a few hand-placed variants (cracked walls are 4× the triangles of plain ones, so they stay rare)
d.shell({
  seed: 0xc0ffee,
  floors: { '10,6': 'floor_tile_big_grate', '10,8': 'floor_tile_big_grate' }, // the ossuary's two grated pits
  walls: {
    '8,3,n': 'wall_shelves', '8,12,n': 'wall_shelves', '13,4,n': 'wall_shelves',
    '15,1,w': 'wall_cracked', '10,5,w': 'wall_cracked', '3,11,e': 'wall_cracked', '1,4,n': 'wall_cracked',
  },
});
const rng = mulberry32(0xbadc0de);
const { S: St, H, C, O, V, B } = R;
// start room
d.torch(13, 8, 'w'); d.torch(13, 10, 'e');
d.put('barrel_large', St.x0 + 1.4, St.z1 - 1.5, { collide: 0.85 });
d.put('barrel_small', St.x0 + 3.1, St.z1 - 1.1, { collide: 0.5 });
d.put('crates_stacked', St.x1 - 1.6, St.z1 - 1.5, { rot: 0.3, collide: 1.05 });
d.put('box_small', St.x1 - 1.3, St.cz - 0.5, { rot: 0.5, collide: 0.6 });
d.put('candle_triple', St.x0 + 1.2, St.z0 + 1.0);
d.put('candle_triple', St.x1 - 1.2, St.z0 + 1.0, { rot: 2 });

// hall of bones
d.torch(13, 1, 'n'); d.torch(13, 4, 'n'); d.torch(14, 1, 'w');
d.banner('banner_patternA_red', 13, 3, 'n');
d.banner('banner_thin_red', 13, 5, 'n');
d.put('pillar', H.x0 + 5, H.cz - 1.5, { collide: 0.85 });
d.put('pillar', H.x1 - 5, H.cz - 1.5, { collide: 0.85 });
d.put('table_medium_broken', H.x1 - 3.2, H.z1 - 2.2, { rot: 0.5, collide: 1.1 });
d.put('sword_shield_broken', H.x0 + 1.6, H.z1 - 1.4, { rot: 0.6 });
d.put('barrel_small', H.x0 + 1.2, H.z0 + 1.3, { collide: 0.5 });
d.put('box_small', H.x0 + 2.5, H.z0 + 1.2, { rot: 0.4, collide: 0.6 });
d.put('candle_triple', H.x1 - 1.2, H.z0 + 1.1);

// chapel
d.torch(8, 2, 'n'); d.torch(9, 1, 'w');
d.banner('banner_shield_red', 8, 1, 'n');
d.chest({ id: 'chapel', model: 'chest', x: C.x0 + 2, z: C.z0 + 1.45, rot: 0, name: 'Old Chest', title: 'Crypt offerings' });
d.put('candle_triple', C.x1 - 1.1, C.z0 + 1.1);
d.put('candle_triple', C.x0 + 1.0, C.z1 - 1.2, { rot: 1 });
d.put('candle_lit', C.cx + 1.6, C.z0 + 0.9);

// ossuary
d.torch(8, 5, 'n'); d.torch(8, 9, 'n');
d.banner('banner_patternB_brown', 8, 6, 'n');
d.banner('banner_patternB_brown', 8, 8, 'n');
d.put('pillar_decorated', O.cx - 5.5, O.z0 + 3, { collide: 1.0 });
d.put('pillar_decorated', O.cx + 5.5, O.z0 + 3, { collide: 1.0 });
d.put('sword_shield_broken', O.x1 - 1.6, O.z1 - 1.4, { rot: -0.5 });
d.put('box_small', O.x0 + 1.3, O.z1 - 1.3, { rot: 0.3, collide: 0.6 });
d.put('barrel_small', O.x0 + 1.2, O.z0 + 1.2, { collide: 0.5 });

// vault
d.torch(8, 12, 'n'); d.torch(9, 13, 'e');
d.chest({ id: 'vault', model: 'chest', x: V.x1 - 1.5, z: V.cz, rot: -Math.PI / 2, name: 'Iron-bound Chest', title: 'The vault' });
d.put('coin_stack_large', V.x1 - 1.3, V.cz - 2.6, { collide: 0.7 });
d.put('coin_stack_medium', V.x1 - 1.2, V.cz + 2.6, { rot: 1, collide: 0.6 });
d.put('barrel_large', V.x0 + 1.4, V.z0 + 1.4, { collide: 0.85 });
d.put('keg', V.x0 + 3.6, V.z0 + 1.3, { collide: 0.9 });
d.put('crates_stacked', V.x1 - 1.6, V.z0 + 1.5, { rot: -0.2, collide: 1.05 });
d.put('box_large', V.x0 + 1.3, V.z1 - 1.3, { rot: 0.2, collide: 0.8 });
d.put('barrel_small', V.x0 + 3.1, V.z1 - 1.1, { collide: 0.5 });

// the sanctum
d.torch(1, 3, 'n'); d.torch(1, 11, 'n'); d.torch(2, 3, 'w'); d.torch(4, 3, 'w'); d.torch(2, 11, 'e'); d.torch(4, 11, 'e');
d.banner('banner_triple_red', 1, 5, 'n');
d.banner('banner_triple_red', 1, 9, 'n');
d.banner('banner_shield_red', 1, 7, 'n');
for (const sx of [-1, 1]) for (const dz of [-4.5, 4.5]) d.put('pillar_decorated', B.cx + sx * 10.5, B.cz + dz, { collide: 1.0 });
d.chest({ id: 'hoard', model: 'chest_gold', x: B.cx, z: B.z0 + 1.6, rot: 0, hoard: true, name: "Morvain's Hoard", title: 'Sealed while Morvain lives' });
d.put('coin_stack_large', B.cx - 2.6, B.z0 + 1.3, { collide: 0.7 });
d.put('coin_stack_medium', B.cx + 2.6, B.z0 + 1.2, { rot: 2, collide: 0.6 });
for (const deg of [30, 150, 210, 270, 330]) {
  const a = (deg * Math.PI) / 180;
  d.put('candle_triple', B.cx + Math.cos(a) * 6.4, B.cz + Math.sin(a) * 6.4, { rot: rng() * 6 });
}

// corridors
d.torch(11, 2, 'w'); d.torch(14, 6, 'n'); d.torch(6, 7, 'w'); d.torch(7, 7, 'e');

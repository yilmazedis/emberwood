// Frostfang Highlands (levels 10–22): snowfields north of Emberwood, reached by waystone. Frostborn raiders,
// ice witches and frost archers; Hrimgar the Frost Jarl in his hold; and below the ice, Rimeheart Caverns,
// where Vorrak the Rime King sits on a frozen throne.
import { OutdoorMap } from '../outdoor-map.js';
import { DungeonMap } from '../dungeon-map.js';

export const frostfang = new OutdoorMap({
  id: 'frostfang', cx: 1000, cz: 0, radius: 96, seed: 1101,
  ground: { base: 1.4, hills: 2.8, rough: 0.25 },
  camp: { x: 0, z: 66, r: 11 },
  door: { x: 54, z: -50, yaw: 0 }, // Rimeheart Caverns
  zones: [
    { id: 'ff_camp', name: 'Frostfang Outpost', sub: 'Safe haven · waystone', x: 0, z: 66, r: 12, safe: true },
    { id: 'ff_fields', name: 'Snowdrift Fields', sub: 'Level 10 – 12', x: 0, z: 34, r: 15 },
    { id: 'ff_raiders', name: 'Raider Encampment', sub: 'Level 12 – 15', x: -44, z: 8, r: 15 },
    { id: 'ff_lake', name: 'Frozen Lake', sub: 'Level 14 – 17', x: 42, z: 6, r: 17 },
    { id: 'ff_ridge', name: 'Howling Ridge', sub: 'Level 17 – 20', x: -32, z: -44, r: 15 },
    { id: 'ff_hold', name: "Jarl's Hold", sub: 'Boss · Level 21', x: 8, z: -72, r: 13 },
    { id: 'ff_door', name: 'Rimeheart Caverns', sub: 'Dungeon · Level 20 – 24', x: 54, z: -50, r: 7 },
  ],
  pools: [{ x: 42, z: 6, r: 11, kind: 'ice' }],
  paths: [
    [[0, 66], [2, 50], [0, 34]],
    [[0, 34], [-20, 22], [-44, 8]],
    [[0, 34], [20, 20], [34, 8]],
    [[0, 34], [-6, 0], [-20, -24], [-32, -44]],
    [[-6, 0], [4, -40], [8, -60]],
    [[4, -40], [30, -40], [50, -38], [54, -46]],
  ],
  trees: { kinds: { snowpine: 6, pine: 2, deadtree: 1 }, density: 0.62, dots: { snowpine: '#d8e6ee', pine: '#2f5a43', deadtree: '#5a5048' } },
  rocks: 260,
  props(m, put, rng) {
    // the outpost: a fire, tents, crates, the waystone, a ring of stakes
    put('campfire', 0, 66, {}, 1.1);
    put('waystone', 6, 61, {}, 0.9);
    put('tent', 6.5, 71, { rotY: -2.4, color: 0x9a6a4a }, 1.5);
    put('tent', -5.5, 72.5, { rotY: 2.6, color: 0x6f7f8f, s: 0.9 }, 1.35);
    put('crate', -8.5, 66, { rotY: 0.3, s: 0.85 }, 0.55);
    put('crate', -9.2, 67.2, { rotY: 0.9, s: 0.7 }, 0.45);
    put('barrel', 8.7, 65.5, {}, 0.45);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2, x = Math.cos(a) * 12.5, z = 66 + Math.sin(a) * 12.5;
      if (m.pathDist(x + m.cx, z + m.cz) < 3.2) continue;
      put('stake', x, z, { snow: true }, 0.3);
    }
    // the raiders' camp: hide tents, a fire, a lookout
    put('campfire', -44, 8, {}, 1.1);
    put('tent', -50, 3, { rotY: 0.5, color: 0x6b4a3a }, 1.5);
    put('tent', -38, 13, { rotY: -2.4, color: 0x5a3a2a }, 1.5);
    put('tent', -49, 14, { rotY: 2.3, color: 0x7a5a42, s: 0.9 }, 1.35);
    put('watchtower', -36, 0, {}, 1.3);
    put('banner', -41, 2, { color: 0x3a6aa8 }, 0.2);
    // ice spikes around the frozen lake, and on the ridge
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2, r = 12.5 + rng() * 4;
      put('icespike', 42 + Math.cos(a) * r, 6 + Math.sin(a) * r, { s: 0.7 + rng() * 0.9, rotY: rng() * 6.3 }, 0.5);
    }
    for (const [x, z] of [[-24, -40], [-40, -38], [-28, -54], [-38, -50]]) put('boulder', x, z, { s: 1.6 + rng() }, 1.3);
    // Jarl's hold: standing stones in a ring, braziers, a throne
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 1.1 + (i / 8) * Math.PI * 0.8;
      put('standing', 8 + Math.cos(a) * 11, -72 + Math.sin(a) * 9, { a }, 0.7);
    }
    put('throne', 8, -80, { color: 0x8fb8d8 }, 1.4);
    for (const s of [-4, 4]) put('brazier', 8 + s, -77, { color: 0x6fc8ff }, 0.35);
    put('bones', 8, -70);
    // Rimeheart's mouth in the hillside
    put('cave', 54, -50, { rotY: 0, color: 0xa8c8e0, glow: 0x7fd8ff }, 0);
  },
});

const F = (x, z) => ({ x: x + frostfang.cx, z: z + frostfang.cz });
export const FROSTFANG_SPAWNS = [
  { type: 'slime_frost', ...F(-6, 36), r: 11, n: 5, lvl: 10 },
  { type: 'slime_frost', ...F(10, 30), r: 7, n: 3, lvl: 11 },
  { type: 'frost_scout', ...F(4, 26), r: 6, n: 3, lvl: 11 },
  { type: 'frost_scout', ...F(-14, 52), r: 6, n: 2, lvl: 10 },
  { type: 'frost_raider', ...F(-44, 8), r: 10, n: 5, lvl: 13 },
  { type: 'ice_witch', ...F(-46, 6), r: 6, n: 2, lvl: 14 },
  { type: 'frost_raider', ...F(-30, 20), r: 6, n: 2, lvl: 12 },
  { type: 'slime_glacial', ...F(42, 6), r: 10, n: 4, lvl: 15 },
  { type: 'frostbone', ...F(48, 0), r: 8, n: 3, lvl: 16 },
  { type: 'ice_witch', ...F(36, 14), r: 5, n: 1, lvl: 16 },
  { type: 'frost_archer', ...F(-32, -44), r: 9, n: 3, lvl: 18 },
  { type: 'raider_berserker', ...F(-30, -40), r: 8, n: 3, lvl: 19 },
  { type: 'frost_archer', ...F(-12, -20), r: 6, n: 2, lvl: 17 },
  { type: 'raider_berserker', ...F(10, -64), r: 5, n: 2, lvl: 20 },
  { type: 'frost_jarl', ...F(8, -75), r: 1, n: 1, lvl: 21 },
];

// Rimeheart Caverns: S start, F frozen tombs, T treasury, G the glacier hall, B the Rime King's throne.
export const rimeheart = new DungeonMap({
  id: 'rimeheart',
  cx: 1000, cz: -420,
  map: [
    '#################',
    '#####BBBBBBB#####',
    '#####BBBBBBB#####',
    '#####BBBBBBB#####',
    '#####BBBBBBB#####',
    '#####BBBBBBB#####',
    '########.########',
    '########.########',
    '#FFF#GGGGGGG#TTT#',
    '#FFF.GGGGGGG.TTT#',
    '#FFF#GGGGGGG#TTT#',
    '##.##########.###',
    '##.#####U####.###',
    '##.####SSS###.###',
    '##.....SSS....###',
    '#######SSS#######',
    '#################',
  ],
  zone: { id: 'rimeheart', name: 'Rimeheart Caverns', sub: 'Dungeon · Level 20 – 24' },
  boss: { id: 'rime_throne', name: 'The Frozen Throne', sub: 'Boss · Level 24' },
});
{
  const d = rimeheart, R = d.rooms;
  d.shell({ seed: 0x51ce, dirt: true, plain: ['wall', 'wall', 'wall_cracked', 'wall', 'wall_arched'] });
  d.torch(13, 7, 'w'); d.torch(13, 9, 'e');
  d.put('barrel_small', R.S.x0 + 1.2, R.S.z1 - 1.2, { collide: 0.5 });
  d.put('box_stacked', R.S.x1 - 1.4, R.S.z1 - 1.4, { rot: 0.4, collide: 0.9 });
  d.torch(8, 1, 'n'); d.torch(8, 3, 'n');
  d.put('pillar', R.F.cx, R.F.cz, { collide: 0.85 });
  d.chest({ id: 'tomb', model: 'chest', x: R.F.x0 + 1.5, z: R.F.z1 - 1.6, rot: Math.PI / 2, name: 'Frozen Coffer', title: 'Iced shut… almost' });
  d.torch(8, 13, 'n'); d.torch(8, 15, 'n');
  d.put('coin_stack_medium', R.T.x1 - 1.3, R.T.z0 + 1.3, { collide: 0.6 });
  d.put('crates_stacked', R.T.x1 - 1.6, R.T.z1 - 1.6, { rot: -0.3, collide: 1.05 });
  d.chest({ id: 'treasury', model: 'chest', x: R.T.cx, z: R.T.z0 + 1.5, rot: 0, name: 'Raider Strongbox', title: 'Plunder from the north' });
  d.torch(8, 5, 'n'); d.torch(8, 11, 'n'); d.torch(10, 5, 'w'); d.torch(10, 11, 'e');
  for (const dx of [-8, 8]) d.put('pillar_decorated', R.G.cx + dx, R.G.cz, { collide: 1.0 });
  d.banner('banner_patternC_blue', 8, 7, 'n'); d.banner('banner_patternC_blue', 8, 9, 'n');
  d.torch(1, 5, 'n'); d.torch(1, 11, 'n'); d.torch(3, 5, 'w'); d.torch(3, 11, 'e');
  d.banner('banner_triple_blue', 1, 7, 'n'); d.banner('banner_triple_blue', 1, 9, 'n');
  for (const sx of [-1, 1]) for (const dz of [-3.5, 4]) d.put('pillar_decorated', R.B.cx + sx * 9.5, R.B.cz + dz, { collide: 1.0 });
  d.chest({ id: 'hoard', model: 'chest_gold', x: R.B.cx, z: R.B.z0 + 1.6, rot: 0, hoard: true, name: "Vorrak's Hoard", title: 'Sealed while Vorrak lives' });
}
export const RIMEHEART_SPAWNS = (() => {
  const R = rimeheart.rooms;
  return [
    { type: 'frostbone', x: R.F.cx, z: R.F.cz + 1, r: 3, n: 2, lvl: 20 },
    { type: 'frost_scout', x: R.F.cx, z: R.F.cz - 2, r: 3, n: 2, lvl: 20 },
    { type: 'ice_witch', x: R.T.cx, z: R.T.cz, r: 3, n: 2, lvl: 21 },
    { type: 'frost_raider', x: R.T.cx, z: R.T.cz + 1, r: 3, n: 2, lvl: 21 },
    { type: 'frostbone', x: R.G.cx, z: R.G.cz, r: 8, n: 3, lvl: 22 },
    { type: 'skeleton_minion', x: R.G.cx, z: R.G.cz + 2, r: 9, n: 4, lvl: 21 },
    { type: 'frost_archer', x: R.G.cx, z: R.G.z0 + 1.5, r: 5, n: 2, lvl: 22 },
    { type: 'rime_king', x: R.B.cx, z: R.B.cz - 3, r: 0.5, n: 1, lvl: 24, room: 'B' },
  ];
})();

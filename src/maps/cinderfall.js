// Cinderfall Wastes (levels 22–40): a land of ash and lava pools beyond the waystones. Ash bandits, cinder
// cultists and ash knights; Vulkhar the Ashen King on his throne; and the Molten Forge, where Forgemaster
// Kaldur still works the fires.
import { OutdoorMap } from '../outdoor-map.js';
import { DungeonMap } from '../dungeon-map.js';

export const cinderfall = new OutdoorMap({
  id: 'cinderfall', cx: 2000, cz: 0, radius: 100, seed: 2207,
  ground: { base: 1.3, hills: 3.0, rough: 0.35, freq: 0.03 },
  camp: { x: 0, z: 70, r: 11 },
  door: { x: 60, z: -40, yaw: 0 }, // the Molten Forge
  zones: [
    { id: 'cf_camp', name: 'Ashguard Bastion', sub: 'Safe haven · waystone', x: 0, z: 70, r: 12, safe: true },
    { id: 'cf_flats', name: 'Ashen Flats', sub: 'Level 22 – 26', x: -6, z: 38, r: 16 },
    { id: 'cf_obsidian', name: 'Obsidian Fields', sub: 'Level 26 – 30', x: 46, z: 16, r: 16 },
    { id: 'cf_lava', name: 'Lava Rivers', sub: 'Level 30 – 34', x: -46, z: 4, r: 17 },
    { id: 'cf_ridge', name: 'Burning Ridge', sub: 'Level 34 – 38', x: -26, z: -48, r: 15 },
    { id: 'cf_throne', name: "Vulkhar's Throne", sub: 'Boss · Level 38', x: 22, z: -74, r: 13 },
    { id: 'cf_door', name: 'The Molten Forge', sub: 'Dungeon · Level 38 – 42', x: 60, z: -40, r: 7 },
  ],
  pools: [
    { x: -60, z: 18, r: 7, kind: 'lava' }, { x: -36, z: -8, r: 6, kind: 'lava' }, { x: -52, z: -10, r: 4.5, kind: 'lava' },
    { x: 16, z: -14, r: 5, kind: 'lava' }, { x: 72, z: 40, r: 6, kind: 'lava' }, { x: -28, z: 60, r: 4, kind: 'lava' },
    { x: 34, z: -56, r: 5, kind: 'lava' },
  ],
  paths: [
    [[0, 70], [-2, 52], [-6, 38]],
    [[-6, 38], [20, 28], [46, 16]],
    [[-6, 38], [-26, 22], [-46, 4]],
    [[-6, 38], [2, 6], [-12, -26], [-26, -48]],
    [[-12, -26], [8, -52], [22, -66]],
    [[46, 16], [56, -14], [60, -36]],
  ],
  trees: { kinds: { charred: 5, emberwood: 1 }, density: 0.42, dots: { charred: '#3a3430', emberwood: '#b8642a' } },
  rocks: 320,
  props(m, put, rng) {
    put('campfire', 0, 70, {}, 1.1);
    put('waystone', 6, 65, {}, 0.9);
    put('tent', -6, 64, { rotY: 0.7, color: 0x8a4a3a }, 1.5);
    put('tent', 6.5, 75, { rotY: -2.4, color: 0x5a4a3a }, 1.5);
    put('crate', -8.5, 70, { rotY: 0.3, s: 0.85 }, 0.55);
    put('barrel', 8.7, 69.5, {}, 0.45);
    put('barrel', 9.3, 70.6, {}, 0.45);
    for (let i = 0; i < 40; i++) { // a low wall of black rock around the bastion
      const a = (i / 40) * Math.PI * 2, x = Math.cos(a) * 12.5, z = 70 + Math.sin(a) * 12.5;
      if (m.pathDist(x + m.cx, z + m.cz) < 3.2) continue;
      put('boulder', x, z, { s: 0.7 + rng() * 0.3, dark: true }, 0.6);
    }
    // ash bandits' lean-tos
    put('tent', -12, 34, { rotY: 0.9, color: 0x4a4440 }, 1.5);
    put('tent', 2, 44, { rotY: -2.0, color: 0x5a3a30 }, 1.5);
    put('campfire', -4, 38, {}, 1.1);
    // obsidian spires
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2, r = 4 + rng() * 12;
      put('obsidian', 46 + Math.cos(a) * r, 16 + Math.sin(a) * r, { s: 0.8 + rng() * 1.1, rotY: rng() * 6.3 }, 0.6);
    }
    // the ridge: broken walls of an old fort
    for (const [x, z, r] of [[-20, -44, 0.3], [-32, -52, 1.2], [-26, -38, 2.0], [-36, -42, 0.8]]) put('ruin', x, z, { rotY: r }, 1.2);
    // Vulkhar's throne between fire pits
    put('throne', 22, -82, { color: 0x3a3030 }, 1.4);
    for (const s of [-4, 4]) put('brazier', 22 + s, -79, { color: 0xff6a1a }, 0.35);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (i / 5) * Math.PI;
      put('boulder', 22 + Math.cos(a) * 11, -74 + Math.sin(a) * 9, { s: 1.6 + rng(), dark: true }, 1.3);
    }
    put('bones', 22, -72);
    put('forge', 60, -40, { rotY: 0 }, 0);
  },
});

const C = (x, z) => ({ x: x + cinderfall.cx, z: z + cinderfall.cz });
export const CINDERFALL_SPAWNS = [
  { type: 'slime_cinder', ...C(-10, 40), r: 11, n: 5, lvl: 22 },
  { type: 'ash_bandit', ...C(-4, 36), r: 8, n: 4, lvl: 24 },
  { type: 'slime_cinder', ...C(14, 52), r: 6, n: 3, lvl: 23 },
  { type: 'ash_bandit', ...C(-22, 50), r: 6, n: 2, lvl: 25 },
  { type: 'cinder_cultist', ...C(46, 16), r: 9, n: 3, lvl: 27 },
  { type: 'ash_knight', ...C(44, 20), r: 9, n: 3, lvl: 28 },
  { type: 'ash_knight', ...C(30, 30), r: 5, n: 2, lvl: 27 },
  { type: 'molten_brute', ...C(-46, 4), r: 10, n: 3, lvl: 31 },
  { type: 'ember_skeleton', ...C(-44, 10), r: 9, n: 4, lvl: 32 },
  { type: 'cinder_cultist', ...C(-30, 18), r: 5, n: 2, lvl: 30 },
  { type: 'pyre_archer', ...C(-26, -48), r: 9, n: 3, lvl: 35 },
  { type: 'flame_warden', ...C(-30, -44), r: 8, n: 2, lvl: 36 },
  { type: 'molten_brute', ...C(-10, -30), r: 6, n: 2, lvl: 34 },
  { type: 'ash_knight', ...C(22, -66), r: 6, n: 2, lvl: 37 },
  { type: 'ashen_king', ...C(22, -77), r: 1, n: 1, lvl: 38 },
];

// The Molten Forge: S start, M the hall of anvils, A armoury, K kilns, B Kaldur's great forge.
export const forge = new DungeonMap({
  id: 'forge',
  cx: 2000, cz: -420,
  map: [
    '#################',
    '###BBBBBBBBBBB###',
    '###BBBBBBBBBBB###',
    '###BBBBBBBBBBB###',
    '###BBBBBBBBBBB###',
    '###BBBBBBBBBBB###',
    '########.########',
    '#AAAA###.###KKKK#',
    '#AAAA.......KKKK#',
    '#AAAA###.###KKKK#',
    '########.########',
    '####MMMMMMMMM####',
    '####MMMMMMMMM####',
    '####MMMMMMMMM####',
    '####.#######.####',
    '####.###U###.####',
    '####...SSS...####',
    '#######SSS#######',
    '#################',
  ],
  zone: { id: 'forge', name: 'The Molten Forge', sub: 'Dungeon · Level 38 – 42' },
  boss: { id: 'great_forge', name: 'The Great Forge', sub: 'Boss · Level 42' },
});
{
  const d = forge, R = d.rooms;
  d.shell({ seed: 0xf09e, plain: ['wall', 'wall', 'wall', 'wall_arched', 'wall_Tsplit'] });
  d.torch(17, 7, 'w'); d.torch(17, 9, 'e');
  d.put('keg', R.S.x0 + 1.3, R.S.z1 - 1.2, { collide: 0.9 });
  d.torch(11, 4, 'w'); d.torch(13, 12, 'e'); d.torch(11, 6, 'n'); d.torch(11, 10, 'n');
  for (const dx of [-10, -3.5, 3.5, 10]) d.put('table_medium', R.M.cx + dx, R.M.cz + 0.5, { rot: dx > 0 ? 0.2 : -0.2, collide: 1.0 });
  d.put('sword_shield', R.M.cx - 7, R.M.z0 + 1.2);
  d.torch(7, 1, 'n'); d.torch(7, 4, 'n');
  d.put('sword_shield_gold', R.A.x0 + 1.4, R.A.z0 + 1.2);
  d.put('barrel_large_decorated', R.A.x0 + 1.4, R.A.z1 - 1.4, { collide: 0.85 });
  d.put('shelf_large', R.A.cx, R.A.z0 + 0.9);
  d.chest({ id: 'armoury', model: 'chest', x: R.A.x1 - 1.6, z: R.A.z1 - 1.6, rot: -Math.PI / 2, name: 'Armoury Chest', title: 'Forged and forgotten' });
  d.torch(7, 12, 'n'); d.torch(7, 15, 'n');
  d.put('barrel_small_stack', R.K.x1 - 1.4, R.K.z1 - 1.3, { collide: 0.9 });
  d.put('crates_stacked', R.K.cx, R.K.z1 - 1.5, { rot: 0.3, collide: 1.05 });
  d.chest({ id: 'kiln', model: 'chest', x: R.K.x1 - 1.5, z: R.K.z0 + 1.5, rot: -Math.PI / 2, name: 'Kiln Coffer', title: 'Still warm' });
  d.torch(1, 3, 'n'); d.torch(1, 13, 'n'); d.torch(2, 3, 'w'); d.torch(4, 3, 'w'); d.torch(2, 13, 'e'); d.torch(4, 13, 'e');
  d.banner('banner_triple_yellow', 1, 6, 'n'); d.banner('banner_triple_yellow', 1, 10, 'n'); d.banner('banner_shield_yellow', 1, 8, 'n');
  for (const sx of [-1, 1]) for (const dz of [-4.5, 4.5]) d.put('pillar_decorated', R.B.cx + sx * 13.5, R.B.cz + dz, { collide: 1.0 });
  d.put('coin_stack_large', R.B.cx - 2.6, R.B.z0 + 1.3, { collide: 0.7 });
  d.chest({ id: 'hoard', model: 'chest_gold', x: R.B.cx, z: R.B.z0 + 1.6, rot: 0, hoard: true, name: "Kaldur's Hoard", title: 'Sealed while Kaldur lives' });
}
export const FORGE_SPAWNS = (() => {
  const R = forge.rooms;
  return [
    { type: 'ash_knight', x: R.M.cx, z: R.M.cz, r: 10, n: 4, lvl: 38 },
    { type: 'ember_skeleton', x: R.M.cx, z: R.M.cz + 1, r: 11, n: 3, lvl: 38 },
    { type: 'flame_warden', x: R.A.cx, z: R.A.cz, r: 3, n: 2, lvl: 39 },
    { type: 'molten_brute', x: R.A.cx, z: R.A.cz + 1, r: 3, n: 1, lvl: 40 },
    { type: 'cinder_cultist', x: R.K.cx, z: R.K.cz, r: 3, n: 2, lvl: 39 },
    { type: 'molten_brute', x: R.K.cx, z: R.K.cz + 1, r: 3, n: 1, lvl: 40 },
    { type: 'ash_knight', x: R.B.cx, z: R.B.z1 - 2.5, r: 6, n: 2, lvl: 41 },
    { type: 'forgemaster', x: R.B.cx, z: R.B.cz - 2.5, r: 0.5, n: 1, lvl: 42, room: 'B' },
  ];
})();

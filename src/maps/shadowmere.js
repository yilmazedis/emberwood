// Shadowmere (levels 40–58): a cursed twilight marsh beyond the waystones. Void slimes, wraiths, death
// knights and night stalkers; Malakar the Hollow King on his throne of bones; and the Abyssal Vault, where
// Nyxara, Queen of the Abyss, waits at the bottom of everything.
import { OutdoorMap } from '../outdoor-map.js';
import { DungeonMap } from '../dungeon-map.js';

export const CANYON_GATE = { x: -24, z: 62 }; // (around the land's centre)

export const shadowmere = new OutdoorMap({
  id: 'shadowmere', cx: 3000, cz: 0, radius: 100, seed: 3313,
  ground: { base: 1.2, hills: 2.2, rough: 0.2 },
  camp: { x: 0, z: 70, r: 11 },
  door: { x: 62, z: -58, yaw: 0 }, // the Abyssal Vault
  zones: [
    { id: 'sm_camp', name: 'Duskwatch', sub: 'Safe haven · waystone', x: 0, z: 70, r: 12, safe: true },
    { id: 'sm_marsh', name: 'Gloom Marsh', sub: 'Level 40 – 44', x: 30, z: 40, r: 17 },
    { id: 'sm_wraith', name: 'Wraithwood', sub: 'Level 44 – 48', x: -42, z: 24, r: 16 },
    { id: 'sm_bones', name: 'Bone Fields', sub: 'Level 48 – 52', x: 40, z: -18, r: 16 },
    { id: 'sm_spire', name: 'Spire of Night', sub: 'Level 52 – 56', x: -36, z: -46, r: 15 },
    { id: 'sm_throne', name: 'The Hollow Throne', sub: 'Boss · Level 56', x: 4, z: -76, r: 13 },
    { id: 'sm_door', name: 'The Abyssal Vault', sub: 'Dungeon · Level 56 – 60', x: 62, z: -58, r: 7 },
  ],
  pools: [
    { x: 22, z: 46, r: 6, kind: 'tar' }, { x: 40, z: 32, r: 5, kind: 'tar' }, { x: 36, z: 52, r: 3.5, kind: 'tar' },
    { x: -14, z: 40, r: 4, kind: 'tar' }, { x: 12, z: -30, r: 5, kind: 'tar' }, { x: -60, z: -10, r: 6, kind: 'tar' },
  ],
  paths: [
    [[0, 70], [6, 56], [16, 42]],
    [[0, 70], [-14, 54], [-28, 34], [-42, 24]],
    [[6, 56], [-2, 20], [16, 0], [40, -18]],
    [[-2, 20], [-20, -16], [-36, -46]],
    [[-20, -16], [-6, -50], [4, -64]],
    [[40, -18], [56, -36], [62, -50]],
  ],
  trees: { kinds: { twisted: 5, deadtree: 2, glowcap: 1 }, density: 0.55, dots: { twisted: '#3a2f48', deadtree: '#4a4048', glowcap: '#8a5aff' } },
  rocks: 220,
  props(m, put, rng) {
    put('campfire', 0, 70, { color: 0x9a6aff }, 1.1);
    put('waystone', 6, 65, {}, 0.9);
    put('tent', 6.5, 75, { rotY: -2.4, color: 0x3a3a4a }, 1.5);
    put('crate', -8.5, 70, { rotY: 0.3, s: 0.85 }, 0.55);
    put('barrel', 8.7, 69.5, {}, 0.45);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2, x = Math.cos(a) * 12.5, z = 70 + Math.sin(a) * 12.5;
      if (m.pathDist(x + m.cx, z + m.cz) < 3.2) continue;
      put('stake', x, z, {}, 0.3);
    }
    for (const [x, z] of [[-4, 60], [5, 80], [-9, 76]]) put('brazier', x, z, { color: 0x9a6aff }, 0.35);
    // wraithwood's gravestones
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2, r = 3 + rng() * 11;
      put('headstone', -42 + Math.cos(a) * r, 24 + Math.sin(a) * r, { rotY: (rng() - 0.5) * 0.6, variant: rng() < 0.5 ? 'round' : rng() < 0.7 ? 'cross' : 'broken' }, 0.4);
    }
    // the bone fields
    for (let i = 0; i < 5; i++) put('bones', 40 + (rng() - 0.5) * 20, -18 + (rng() - 0.5) * 20);
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2, r = 6 + rng() * 9;
      put('ribcage', 40 + Math.cos(a) * r, -18 + Math.sin(a) * r, { rotY: rng() * 6.3, s: 0.8 + rng() * 0.6 }, 0.7);
    }
    // the spire: a dark obelisk ringed by standing stones
    put('obelisk', -36, -50, { color: 0x2a2433, glow: 0x9a5aff }, 1.4);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      put('standing', -36 + Math.cos(a) * 9, -46 + Math.sin(a) * 9, { a, dark: true }, 0.7);
    }
    put('throne', 4, -84, { color: 0x5a4a6a }, 1.4);
    for (const s of [-4, 4]) put('brazier', 4 + s, -81, { color: 0x9a5aff }, 0.35);
    put('bones', 4, -74);
    put('vault', 62, -58, { rotY: 0 }, 0);
    // the gate to the Death Canyon, west of Duskwatch (maps.js: the way through, from level 70)
    put('canyongate', CANYON_GATE.x, CANYON_GATE.z, { rotY: 0, glow: 0xff4a1a }, 0);
    for (const s of [-1, 1]) put('pillar', CANYON_GATE.x + s * 1.9, CANYON_GATE.z - 0.2, {}, 0.75);
  },
});

const S = (x, z) => ({ x: x + shadowmere.cx, z: z + shadowmere.cz });
export const SHADOWMERE_SPAWNS = [
  { type: 'slime_void', ...S(28, 40), r: 12, n: 5, lvl: 40 },
  { type: 'bog_lurker', ...S(30, 44), r: 10, n: 4, lvl: 42 },
  { type: 'slime_void', ...S(10, 54), r: 6, n: 2, lvl: 41 },
  { type: 'wraith', ...S(-42, 24), r: 9, n: 3, lvl: 45 },
  { type: 'death_knight', ...S(-40, 28), r: 9, n: 3, lvl: 46 },
  { type: 'bog_lurker', ...S(-24, 40), r: 6, n: 2, lvl: 44 },
  { type: 'dread_skeleton', ...S(40, -18), r: 10, n: 4, lvl: 49 },
  { type: 'dread_minion', ...S(42, -14), r: 11, n: 4, lvl: 48 },
  { type: 'wraith', ...S(36, -24), r: 6, n: 2, lvl: 50 },
  { type: 'night_stalker', ...S(-36, -46), r: 10, n: 4, lvl: 53 },
  { type: 'shadow_archer', ...S(-32, -42), r: 9, n: 3, lvl: 54 },
  { type: 'death_knight', ...S(-14, -24), r: 6, n: 2, lvl: 51 },
  { type: 'dread_skeleton', ...S(4, -68), r: 6, n: 3, lvl: 55 },
  { type: 'hollow_king', ...S(4, -79), r: 1, n: 1, lvl: 56 },
];

// The Abyssal Vault: S start, W and E the wings, P and Q the reliquaries, R the bridge, B Nyxara's abyss.
export const abyss = new DungeonMap({
  id: 'abyss',
  cx: 3000, cz: -420,
  map: [
    '###################',
    '####BBBBBBBBBBB####',
    '####BBBBBBBBBBB####',
    '####BBBBBBBBBBB####',
    '####BBBBBBBBBBB####',
    '####BBBBBBBBBBB####',
    '#########.#########',
    '#########.#########',
    '#PPPP###RRR###QQQQ#',
    '#PPPP...RRR...QQQQ#',
    '#PPPP###RRR###QQQQ#',
    '#.###############.#',
    '#.###############.#',
    '#WWW#####U#####EEE#',
    '#WWW....SSS....EEE#',
    '#WWW####SSS####EEE#',
    '###################',
  ],
  zone: { id: 'abyss', name: 'The Abyssal Vault', sub: 'Dungeon · Level 56 – 60' },
  boss: { id: 'abyss_heart', name: 'The Heart of the Abyss', sub: 'Boss · Level 60' },
});
{
  const d = abyss, R = d.rooms;
  d.shell({ seed: 0xab155, plain: ['wall', 'wall', 'wall_arched', 'wall_cracked'] });
  d.torch(14, 8, 'n'); d.torch(14, 10, 'n');
  d.torch(13, 3, 'n'); d.torch(13, 15, 'n');
  d.put('candle_triple', R.W.x0 + 1.1, R.W.z1 - 1.2); d.put('candle_triple', R.E.x1 - 1.1, R.E.z1 - 1.2);
  d.put('rubble_large', R.W.cx, R.W.cz, { rot: 0.4, collide: 1.0 });
  d.put('rubble_half', R.E.cx, R.E.cz, { rot: 1.2, collide: 0.8 });
  d.torch(8, 1, 'n'); d.torch(8, 4, 'n'); d.torch(8, 14, 'n'); d.torch(8, 17, 'n');
  d.banner('banner_patternA_white', 8, 2, 'n'); d.banner('banner_patternA_white', 8, 16, 'n');
  d.chest({ id: 'reliquary_w', model: 'chest', x: R.P.x0 + 1.5, z: R.P.cz, rot: Math.PI / 2, name: 'Reliquary', title: 'Bones and silver' });
  d.chest({ id: 'reliquary_e', model: 'chest', x: R.Q.x1 - 1.5, z: R.Q.cz, rot: -Math.PI / 2, name: 'Reliquary', title: 'Bones and silver' });
  d.put('pillar_decorated', R.R.cx - 3.5, R.R.cz, { collide: 1.0 });
  d.put('pillar_decorated', R.R.cx + 3.5, R.R.cz, { collide: 1.0 });
  d.torch(1, 4, 'n'); d.torch(1, 14, 'n'); d.torch(3, 4, 'w'); d.torch(3, 14, 'e'); d.torch(5, 4, 'w'); d.torch(5, 14, 'e');
  d.banner('banner_triple_white', 1, 7, 'n'); d.banner('banner_triple_white', 1, 11, 'n'); d.banner('banner_shield_white', 1, 9, 'n');
  for (const sx of [-1, 1]) for (const dz of [-4.5, 4.5]) d.put('pillar_decorated', R.B.cx + sx * 13.5, R.B.cz + dz, { collide: 1.0 });
  for (const deg of [20, 60, 120, 160, 200, 340]) {
    const a = (deg * Math.PI) / 180;
    d.put('candle_triple', R.B.cx + Math.cos(a) * 7, R.B.cz + Math.sin(a) * 6, { rot: deg });
  }
  d.chest({ id: 'hoard', model: 'chest_gold', x: R.B.cx, z: R.B.z0 + 1.6, rot: 0, hoard: true, name: "Nyxara's Hoard", title: 'Sealed while Nyxara lives' });
}
export const ABYSS_SPAWNS = (() => {
  const R = abyss.rooms;
  return [
    { type: 'night_stalker', x: R.W.cx, z: R.W.cz, r: 3, n: 2, lvl: 56 },
    { type: 'night_stalker', x: R.E.cx, z: R.E.cz, r: 3, n: 2, lvl: 56 },
    { type: 'death_knight', x: R.P.cx, z: R.P.cz, r: 4, n: 2, lvl: 57 },
    { type: 'wraith', x: R.P.cx + 1, z: R.P.cz + 1, r: 3, n: 1, lvl: 57 },
    { type: 'death_knight', x: R.Q.cx, z: R.Q.cz, r: 4, n: 2, lvl: 57 },
    { type: 'wraith', x: R.Q.cx - 1, z: R.Q.cz + 1, r: 3, n: 1, lvl: 57 },
    { type: 'dread_skeleton', x: R.R.cx, z: R.R.cz, r: 3, n: 3, lvl: 58 },
    { type: 'shadow_archer', x: R.B.cx, z: R.B.z1 - 2, r: 8, n: 2, lvl: 58 },
    { type: 'abyss_queen', x: R.B.cx, z: R.B.cz - 3, r: 0.5, n: 1, lvl: 60, room: 'B' },
  ];
})();

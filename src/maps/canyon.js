// The Death Canyon (levels 70–78), through a gate in Shadowmere: a red gorge of cliffs, lava cracks and old
// bones where heroes fight heroes (anyone not in their party) as well as its monsters, which alone carry the
// rare items and the recipes to upgrade them. Only its camp, Last Rest, is safe. And the canyon itself fights
// everyone: earthquakes, meteors, lightning storms and sandstorms (sim/world.js picks them, canyon-view.js
// shows them).
import { OutdoorMap } from '../outdoor-map.js';

// The gate to Shadowmere, at the camp's west side (around the canyon's centre).
export const GATE = { x: -9, z: 63 };

export const canyon = new OutdoorMap({
  id: 'canyon', cx: 4000, cz: 0, radius: 100, seed: 4441,
  ground: { base: 1.2, hills: 4.6, rough: 0.6, freq: 0.04 },
  camp: { x: 0, z: 72, r: 11 },
  zones: [
    { id: 'dc_camp', name: 'Last Rest', sub: 'Safe haven · no fighting here', x: 0, z: 72, r: 12, safe: true },
    { id: 'dc_gorge', name: 'The Red Gorge', sub: 'Level 70 – 72 · heroes fight heroes', x: -10, z: 36, r: 18, pvp: true },
    { id: 'dc_spine', name: "The Dragon's Spine", sub: 'Level 72 – 74 · heroes fight heroes', x: 46, z: 8, r: 18, pvp: true },
    { id: 'dc_scar', name: 'The Scar', sub: 'Level 74 – 76 · heroes fight heroes', x: -46, z: -14, r: 18, pvp: true },
    { id: 'dc_maw', name: 'The Maw', sub: 'Boss · Level 76 – 78 · heroes fight heroes', x: 8, z: -60, r: 18, pvp: true },
    // everywhere else out of camp (zones are matched in order: this one last)
    { id: 'dc_wild', name: 'Death Canyon', sub: 'Heroes fight heroes', x: 0, z: 0, r: 150, pvp: true, all: true },
  ],
  pools: [
    { x: -30, z: 10, r: 4, kind: 'lava' }, { x: 24, z: -24, r: 5, kind: 'lava' }, { x: -60, z: -36, r: 5, kind: 'lava' },
    { x: 60, z: 40, r: 4, kind: 'lava' }, { x: -20, z: -70, r: 4.5, kind: 'lava' },
  ],
  paths: [
    [[0, 72], [-4, 54], [-10, 36]],
    [[-10, 36], [20, 22], [46, 8]],
    [[-10, 36], [-30, 14], [-46, -14]],
    [[-10, 36], [2, 2], [6, -30], [8, -56]],
    [[46, 8], [34, -30], [8, -56]],
    [[-46, -14], [-26, -44], [8, -56]],
  ],
  trees: { kinds: { charred: 2, deadtree: 3 }, density: 0.26, dots: { charred: '#3a2a24', deadtree: '#5a4a40' } },
  rocks: 460,
  props(m, put, rng) {
    put('campfire', 0, 72, { color: 0xff6a2a }, 1.1);
    put('waystone', 6, 66, {}, 0.9);
    put('tent', 6.5, 77, { rotY: -2.4, color: 0x6a3a2a }, 1.5);
    put('tent', -6.5, 78, { rotY: 2.4, color: 0x5a4a3a }, 1.5);
    put('barrel', 9.2, 74.5, {}, 0.45);
    put('crate', -9, 72, { rotY: 0.4 }, 0.55);
    for (let i = 0; i < 40; i++) { // a ring of boulders around the camp
      const a = (i / 40) * Math.PI * 2, x = Math.cos(a) * 12.8, z = 72 + Math.sin(a) * 12.8;
      if (m.pathDist(x + m.cx, z + m.cz) < 3.2 || Math.hypot(x - GATE.x, z - GATE.z) < 4) continue;
      put('boulder', x, z, { s: 0.7 + rng() * 0.35, dark: true }, 0.6);
    }
    for (const [x, z] of [[-4, 62], [5, 82], [-9, 80]]) put('brazier', x, z, { color: 0xff5a1a }, 0.35);
    // the gate back to Shadowmere
    put('canyongate', GATE.x, GATE.z, { rotY: 0, glow: 0xb07aff }, 0);
    for (const s of [-1, 1]) put('pillar', GATE.x + s * 1.9, GATE.z - 0.2, {}, 0.75);
    // the dragon's spine: its ribs in a row along the ridge, and its skull
    for (let i = 0; i < 7; i++) put('ribcage', 30 + i * 5.5, 14 - i * 2.2, { rotY: 1.2, s: 1.3 + rng() * 0.3 }, 0.9);
    put('bones', 46, 8);
    // the scar: black glass spires out of a burned ground
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2, r = 4 + rng() * 12;
      put('obsidian', -46 + Math.cos(a) * r, -14 + Math.sin(a) * r, { s: 0.8 + rng() * 1.2, rotY: rng() * 6.3 }, 0.6);
    }
    // the maw: the tyrant's broken seat among fallen walls
    for (const [x, z, r] of [[-2, -54, 0.3], [18, -52, 1.2], [14, -68, 2.0], [-4, -66, 0.8]]) put('ruin', x, z, { rotY: r }, 1.2);
    put('throne', 8, -70, { color: 0x4a2a24 }, 1.4);
    for (const s of [-4, 4]) put('brazier', 8 + s, -67, { color: 0xff3a10 }, 0.35);
    put('bones', 8, -58);
  },
});

const C = (x, z) => ({ x: x + canyon.cx, z: z + canyon.cz });
export const CANYON_SPAWNS = [
  { type: 'rock_slime', ...C(-14, 40), r: 11, n: 4, lvl: 70 },
  { type: 'dust_stalker', ...C(-6, 32), r: 9, n: 3, lvl: 71 },
  { type: 'canyon_archer', ...C(-20, 28), r: 6, n: 2, lvl: 71 },
  { type: 'rock_slime', ...C(14, 50), r: 6, n: 3, lvl: 70 },
  { type: 'canyon_ravager', ...C(44, 10), r: 10, n: 3, lvl: 73 },
  { type: 'bone_shaman', ...C(50, 4), r: 9, n: 3, lvl: 73 },
  { type: 'dust_stalker', ...C(30, 22), r: 6, n: 2, lvl: 72 },
  { type: 'scorched_knight', ...C(-46, -14), r: 10, n: 3, lvl: 75 },
  { type: 'canyon_archer', ...C(-42, -8), r: 9, n: 3, lvl: 75 },
  { type: 'bone_shaman', ...C(-30, -30), r: 6, n: 2, lvl: 74 },
  { type: 'canyon_ravager', ...C(4, -50), r: 8, n: 3, lvl: 77 },
  { type: 'scorched_knight', ...C(14, -58), r: 8, n: 2, lvl: 77 },
  { type: 'canyon_tyrant', ...C(8, -64), r: 1, n: 1, lvl: 78 },
  { type: 'rock_slime', ...C(2, 0), r: 8, n: 3, lvl: 72 },
  { type: 'dust_stalker', ...C(-60, 30), r: 7, n: 2, lvl: 73 },
  { type: 'canyon_archer', ...C(60, -30), r: 7, n: 2, lvl: 74 },
];

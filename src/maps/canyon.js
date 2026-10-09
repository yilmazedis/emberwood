// The Death Canyon (levels 70–78), through a gate in Shadowmere: a narrow gorge winding north between red
// mountains, from its camp, Last Rest, past five wider chambers to the Maw, where Grakhul the Canyon Tyrant
// waits. Heroes fight heroes there (anyone not in their party) as well as its monsters, elites all, which
// alone carry the rare items and the recipes to upgrade them. Only the camp is safe. And the canyon itself fights
// everyone: earthquakes, meteors, lightning storms and sandstorms, one after another (sim/world.js picks them,
// canyon-view.js shows them). It's meant to be survived in a party.
import { OutdoorMap } from '../outdoor-map.js';

// The gate to Shadowmere, at the camp's north-west side, facing the camera (around the canyon's centre).
export const GATE = { x: -7, z: 72 };

export const canyon = new OutdoorMap({
  id: 'canyon', cx: 4000, cz: 0, radius: 100, seed: 4441,
  ground: { base: 1.2, hills: 0.6, rough: 0.2 },
  camp: { x: 0, z: 80, r: 12 },
  // the gorge: its floor's middle line from the camp north to the Maw, and half its width there
  corridor: {
    spine: [[0, 94], [0, 80], [5, 64], [6, 50], [0, 36], [-5, 22], [-5, 10], [3, -2], [8, -14], [4, -27], [-3, -40], [-3, -52], [0, -62], [0, -72], [0, -86]],
    widths: [9, 10, 6.5, 7, 6.5, 6.5, 7, 6.5, 7, 6.5, 6, 6.5, 7, 8, 6],
    cliff: 20, low: 5,
  },
  zones: [
    { id: 'dc_camp', name: 'Last Rest', sub: 'Safe haven · no fighting here', x: 0, z: 80, r: 12, safe: true },
    { id: 'dc_gorge', name: 'The Red Gorge', sub: 'Level 70 – 72 · heroes fight heroes', x: 6, z: 50, r: 13, pvp: true },
    { id: 'dc_spine', name: "The Dragon's Spine", sub: 'Level 72 – 74 · heroes fight heroes', x: -5, z: 16, r: 14, pvp: true },
    { id: 'dc_scar', name: 'The Scar', sub: 'Level 74 – 76 · heroes fight heroes', x: 8, z: -14, r: 13, pvp: true },
    { id: 'dc_pass', name: 'The Bone Pass', sub: 'Level 75 – 77 · heroes fight heroes', x: -3, z: -42, r: 11, pvp: true },
    { id: 'dc_maw', name: 'The Maw', sub: 'Boss · Level 76 – 78 · heroes fight heroes', x: 0, z: -70, r: 16, pvp: true },
    // everywhere else out of camp: the gorge between the chambers (zones are matched in order: this one last)
    { id: 'dc_wild', name: 'Death Canyon', sub: 'Heroes fight heroes', x: 0, z: 0, r: 150, pvp: true, all: true },
  ],
  pools: [ // lava welling up at the chambers' edges
    { x: 15, z: 46, r: 2.6, kind: 'lava' }, { x: -15, z: 20, r: 3, kind: 'lava' }, { x: 17, z: -18, r: 2.5, kind: 'lava' },
    { x: -10, z: -66, r: 3, kind: 'lava' }, { x: 11, z: -74, r: 2.6, kind: 'lava' },
  ],
  paths: [[[0, 80], [5, 64], [6, 50], [0, 36], [-5, 22], [-5, 10], [3, -2], [8, -14], [4, -27], [-3, -40], [-3, -52], [0, -62], [0, -72]]],
  trees: { kinds: { deadtree: 3, charred: 1 }, density: 0.4, dots: { charred: '#3a2a24', deadtree: '#5a4a40' } },
  rocks: 360,
  props(m, put, rng) {
    // Last Rest: a fire, tents and braziers in a hollow of the rock
    put('campfire', 0, 80, { color: 0xff6a2a }, 1.1);
    put('tent', 6.5, 85, { rotY: -2.4, color: 0x6a3a2a }, 1.5);
    put('tent', -5.5, 86.5, { rotY: 2.4, color: 0x5a4a3a }, 1.5);
    put('barrel', 8.6, 81.5, {}, 0.45);
    put('crate', 8.2, 78, { rotY: 0.4 }, 0.55);
    for (const [x, z] of [[-4, 70.5], [5, 90], [-9, 82]]) put('brazier', x, z, { color: 0xff5a1a }, 0.35);
    put('banner', 3, 70, { color: 0x8a2a1a });
    // the gate back to Shadowmere
    put('canyongate', GATE.x, GATE.z, { rotY: 0, glow: 0xb07aff }, 0);
    for (const s of [-1, 1]) put('pillar', GATE.x + s * 1.9, GATE.z - 0.2, {}, 0.75);
    // the Dragon's Spine: its ribs in a row across the chamber, and its skull
    for (let i = 0; i < 5; i++) put('ribcage', -12 + i * 3.6, 22 - i * 3.2, { rotY: 0.8, s: 1.4 + rng() * 0.3 }, 0.9);
    put('bones', -5, 12);
    // the Scar: black glass spires out of burned ground
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2, r = 6 + rng() * 6;
      put('obsidian', 8 + Math.cos(a) * r, -14 + Math.sin(a) * r, { s: 0.8 + rng() * 1.0, rotY: rng() * 6.3 }, 0.6);
    }
    // the Bone Pass
    put('bones', -3, -40);
    put('ribcage', 3, -46, { rotY: 2.2, s: 1.1 }, 0.8);
    // the Maw: the tyrant's broken seat among fallen walls
    for (const [x, z, r] of [[-9, -62, 0.3], [9, -63, 1.2], [10, -78, 2.0], [-9, -79, 0.8]]) put('ruin', x, z, { rotY: r }, 1.2);
    put('throne', 0, -80, { color: 0x4a2a24 }, 1.4);
    for (const s of [-4, 4]) put('brazier', s, -77, { color: 0xff3a10 }, 0.35);
    put('bones', 0, -66);
  },
});

// Its monsters: elites all (more Life, harder blows, more XP), in packs in each chamber and along the way.
const C = (x, z) => ({ x: x + canyon.cx, z: z + canyon.cz });
const ELITE = { hpMul: 1.4, dmgMul: 1.25, xpMul: 1.4 };
export const CANYON_SPAWNS = [
  // the way from camp, and the Red Gorge
  { type: 'rock_slime', ...C(4, 60), r: 4, n: 2, lvl: 70 },
  { type: 'rock_slime', ...C(6, 50), r: 9, n: 3, lvl: 70 },
  { type: 'dust_stalker', ...C(4, 46), r: 8, n: 3, lvl: 71 },
  { type: 'canyon_archer', ...C(10, 54), r: 5, n: 2, lvl: 71 },
  { type: 'dust_stalker', ...C(2, 34), r: 4, n: 2, lvl: 72 },
  // the Dragon's Spine
  { type: 'canyon_ravager', ...C(-5, 16), r: 9, n: 3, lvl: 73 },
  { type: 'bone_shaman', ...C(-8, 20), r: 7, n: 2, lvl: 73 },
  { type: 'dust_stalker', ...C(-2, 12), r: 8, n: 2, lvl: 73 },
  { type: 'canyon_archer', ...C(0, -2), r: 4, n: 2, lvl: 74 },
  // the Scar
  { type: 'scorched_knight', ...C(8, -14), r: 9, n: 3, lvl: 75 },
  { type: 'canyon_archer', ...C(10, -10), r: 7, n: 2, lvl: 75 },
  { type: 'bone_shaman', ...C(6, -18), r: 7, n: 2, lvl: 74 },
  { type: 'canyon_ravager', ...C(2, -30), r: 4, n: 2, lvl: 75 },
  // the Bone Pass
  { type: 'scorched_knight', ...C(-3, -42), r: 7, n: 2, lvl: 76 },
  { type: 'dust_stalker', ...C(-3, -38), r: 7, n: 3, lvl: 76 },
  { type: 'bone_shaman', ...C(-2, -52), r: 4, n: 2, lvl: 76 },
  // the Maw
  { type: 'canyon_ravager', ...C(-4, -64), r: 8, n: 3, lvl: 77 },
  { type: 'scorched_knight', ...C(5, -66), r: 8, n: 2, lvl: 77 },
  { type: 'canyon_archer', ...C(0, -76), r: 8, n: 2, lvl: 77 },
  { type: 'canyon_tyrant', ...C(0, -74), r: 1, n: 1, lvl: 78 },
].map((s) => ({ ...s, ...ELITE }));

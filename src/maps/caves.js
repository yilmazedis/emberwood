// The hidden caves' plans (caves.js has the rules): ten chambers winding through the rock, one after another,
// from the way in (S, the daylight of the mouth above it) to the keeper's hall (B). Between each chamber and
// the next a gate of fallen rock stands until every monster in the chamber has fallen. Each land's cave has
// this plan (two of them turned around) and its own look; cave-view.js draws it from the plan in rock and
// glowing crystal, the game server walks its monsters on it.
import { DungeonMap } from '../dungeon-map.js';
import { CAVES, STAGE_ROOMS } from '../caves.js';
import { mulberry32 } from '../util.js';

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

// S the way in (the mouth, U, above it), then the chambers A C D E (east, then up) F G H (west) I J and the
// keeper's hall B (east again), 4 m to a letter.
const PLAN = [
  '########################',
  '########################',
  '#############BBBBBBBBBB#',
  '#############BBBBBBBBBB#',
  '#############BBBBBBBBBB#',
  '#IIII##JJJJ##BBBBBBBBBB#',
  '#IIII..JJJJ..BBBBBBBBBB#',
  '#IIII##JJJJ##BBBBBBBBBB#',
  '##.##########BBBBBBBBBB#',
  '##.#####################',
  '##.#####################',
  '#HHHH##GGGG##FFFF##EEEE#',
  '#HHHH..GGGG..FFFF..EEEE#',
  '#HHHH##GGGG##FFFF##EEEE#',
  '#####################.##',
  '#####################.##',
  '##U##################.##',
  '#SSSS##AAAA##CCCC##DDDD#',
  '#SSSS..AAAA..CCCC..DDDD#',
  '#SSSS##AAAA##CCCC##DDDD#',
  '########################',
];

// Where they lie: far south of their lands, away from everything.
const AT = { emberwood: [0, -800], frostfang: [1000, -800], cinderfall: [2000, -800], shadowmere: [3000, -800] };
const TURNED = { frostfang: true, shadowmere: true };

// The gates: for each chamber but the last, the first cell of the passage out of it toward the next.
function gatesOf(d) {
  const roomOf = (r, c) => d.tile(r, c);
  const gates = [];
  for (let i = 0; i < STAGE_ROOMS.length - 1; i++) {
    const from = STAGE_ROOMS[i], to = STAGE_ROOMS[i + 1];
    // breadth-first through the passages ('.') from the cells beside `from` until a cell beside `to`
    const seen = new Set(), queue = [];
    for (let r = 0; r < d.ROWS; r++) {
      for (let c = 0; c < d.COLS; c++) {
        if (d.tile(r, c) !== '.') continue;
        if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => roomOf(r + dr, c + dc) === from)) { queue.push([r, c, [r, c]]); seen.add(r * d.COLS + c); }
      }
    }
    let gate = null;
    for (let h = 0; h < queue.length && !gate; h++) {
      const [r, c, first] = queue[h];
      if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => roomOf(r + dr, c + dc) === to)) { gate = first; break; }
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const k = (r + dr) * d.COLS + (c + dc);
        if (d.tile(r + dr, c + dc) === '.' && !seen.has(k)) { seen.add(k); queue.push([r + dr, c + dc, first]); }
      }
    }
    const [r, c] = gate;
    const vertical = d.tile(r - 1, c) !== '#' || d.tile(r + 1, c) !== '#'; // (a passage running north–south)
    gates.push({ stage: i + 1, r, c, x0: d.cellX(c), x1: d.cellX(c) + 4, z0: d.cellZ(r), z1: d.cellZ(r) + 4, x: d.midX(c), z: d.midZ(r), vertical });
  }
  return gates;
}

// Stalagmites (they block the way), crystals (the light down here), bones and mushrooms: put by seed in each
// chamber, clear of its doorways.
function dress(d, seed) {
  const rng = mulberry32(seed);
  const doorways = [];
  for (let r = 0; r < d.ROWS; r++) for (let c = 0; c < d.COLS; c++) if (d.tile(r, c) === '.' || d.tile(r, c) === 'U') doorways.push([d.midX(c), d.midZ(r)]);
  const clearOf = (x, z, m) => doorways.every(([px, pz]) => Math.hypot(px - x, pz - z) > m);
  for (const [letter, R] of Object.entries(d.rooms)) {
    const w = R.x1 - R.x0, h = R.z1 - R.z0;
    const inner = (pad) => [R.x0 + pad + rng() * (w - 2 * pad), R.z0 + pad + rng() * (h - 2 * pad)];
    if (letter === 'B') {
      for (const sx of [-1, 1]) for (const dz of [-h / 4, h / 4]) d.put('stalagmite', R.cx + sx * (w / 2 - 4.5), R.cz + dz, { collide: 1.0, scale: [1.5, 1.5, 1.5] });
      for (const [cx, cz] of [[R.x0 + 1.6, R.z0 + 1.6], [R.x1 - 1.6, R.z0 + 1.6], [R.x0 + 1.6, R.z1 - 1.6], [R.x1 - 1.6, R.z1 - 1.6]]) d.put('crystal', cx, cz, { rot: rng() * 6.3, scale: [1.4, 1.4, 1.4] });
      d.chest({ id: 'treasure', x: R.cx, z: R.z0 + 1.7, rot: 0, hoard: true, name: 'The Keeper\'s Treasure', title: 'Sealed while its keeper lives' });
      continue;
    }
    if (letter === 'S') {
      d.put('crystal', R.x0 + 1.3, R.z1 - 1.3, { rot: rng() * 6.3 });
      d.put('crystal', R.x1 - 1.3, R.z1 - 1.3, { rot: rng() * 6.3 });
      continue;
    }
    for (let i = 0; i < 2; i++) { // stalagmites, near the walls
      for (let tries = 0; tries < 12; tries++) {
        const [x, z] = inner(1.6);
        if (Math.abs(x - R.cx) < w / 4 && Math.abs(z - R.cz) < h / 4) continue; // (not in the middle)
        if (!clearOf(x, z, 3.2)) continue;
        d.put('stalagmite', x, z, { collide: 0.55, rot: rng() * 6.3, scale: [0.9 + rng() * 0.5, 0.8 + rng() * 0.7, 0.9 + rng() * 0.5] });
        break;
      }
    }
    for (const [cx, cz] of [[R.x0 + 1.2, R.z0 + 1.2], [R.x1 - 1.2, R.z1 - 1.2]]) if (clearOf(cx, cz, 2.2)) d.put('crystal', cx, cz, { rot: rng() * 6.3, scale: [0.8 + rng() * 0.5, 0.8 + rng() * 0.6, 0.8 + rng() * 0.5] });
    for (let i = 0; i < 3; i++) { const [x, z] = inner(1); d.put(rng() < 0.5 ? 'bones' : 'mushrooms', x, z, { rot: rng() * 6.3 }); }
  }
}

export const CAVE_MAPS = {};
for (const [land, c] of Object.entries(CAVES)) {
  const [cx, cz] = AT[land];
  const d = new DungeonMap({
    id: c.id, cx, cz, map: TURNED[land] ? mirror(PLAN) : PLAN,
    zone: { id: c.id, name: c.name, sub: 'Hidden cave · ten chambers' },
    boss: { id: `${c.id}_hall`, name: "The Keeper's Hall", sub: 'The tenth chamber' },
  });
  d.cave = c;
  d.gates = gatesOf(d);
  dress(d, 0xca7e + cx * 7);
  CAVE_MAPS[land] = d;
}

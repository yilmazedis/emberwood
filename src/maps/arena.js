// The Arena: a walled pit of sand where heroes fight heroes (any but their own party), and the yard in
// front of its gate, where they arrive, rest and read who's champion. Reached by waystone. Plain numbers
// only (the game server checks every blow against it): its floor, walls and two zones.
import { registerRegion, addCollider } from '../terrain.js';

export const ARENA = { cx: -1000, cz: 0, r: 24, wall: 25.6, gate: 2.6 }; // the pit (gate: half its width)
export const YARD = { x0: -10, x1: 10, z0: 26.5, z1: 44 }; // in front of the gate (south), around (cx, cz)
export const FLOOR = 0.6;
// broken pillars in the pit, to fight around (local x, z)
export const PILLARS = [45, 135, 225, 315].map((deg) => [Math.cos((deg * Math.PI) / 180) * 12.5, Math.sin((deg * Math.PI) / 180) * 12.5]);
const PIT = { id: 'arena_pit', name: 'The Pit', sub: 'Hero against hero · no gold is lost here', pvp: true };
const STANDS = { id: 'arena_yard', name: 'The Arena', sub: 'Safe · rest, then step into the pit', safe: true };

const lx = (x) => x - ARENA.cx, lz = (z) => z - ARENA.cz;
const inPit = (x, z) => Math.hypot(lx(x), lz(z)) < ARENA.wall - 0.3;
const inYard = (x, z) => lx(x) > YARD.x0 && lx(x) < YARD.x1 && lz(z) > YARD.z0 - 2 && lz(z) < YARD.z1;

export const arena = {
  id: 'arena',
  contains: (x, z) => Math.abs(lx(x)) < 60 && lz(z) > -60 && lz(z) < 70,
  zoneAt: (x, z) => (inPit(x, z) && lz(z) < ARENA.wall - 1.2 ? PIT : STANDS),
  arrive: { x: ARENA.cx - 2.5, z: ARENA.cz + 36, yaw: Math.PI },
  waystone: { x: ARENA.cx + 5.5, z: ARENA.cz + 38.5 },
  board: { x: ARENA.cx - 6, z: ARENA.cz + 37.5 }, // the champions' board
};

registerRegion({
  contains: arena.contains,
  heightAt: () => FLOOR,
  zoneAt: arena.zoneAt,
  // keep heroes in the pit or the yard (the gate joins them); the walls are colliders
  resolve(pos, radius) {
    if (inPit(pos.x, pos.z) || inYard(pos.x, pos.z)) {
      const x = lx(pos.x), z = lz(pos.z);
      if (z > YARD.z0 - 2.5) { // the yard's sides and back
        pos.x = ARENA.cx + Math.max(YARD.x0 + radius, Math.min(YARD.x1 - radius, x));
        pos.z = ARENA.cz + Math.min(YARD.z1 - radius, z);
      }
      return;
    }
    // outside both: back to the nearest
    const x = lx(pos.x), z = lz(pos.z), d = Math.hypot(x, z);
    if (z > ARENA.wall - 4) {
      pos.x = ARENA.cx + Math.max(YARD.x0 + radius, Math.min(YARD.x1 - radius, x));
      pos.z = ARENA.cz + Math.max(YARD.z0 - 2, Math.min(YARD.z1 - radius, z));
    } else {
      const k = (ARENA.wall - 0.5 - radius) / (d || 1);
      pos.x = ARENA.cx + x * k;
      pos.z = ARENA.cz + z * k;
    }
  },
  clear: (x, z, radius) => inPit(x, z) || inYard(x, z),
});

// the ring wall (open at the gate, toward the yard) and the yard's walls
for (let i = 0; i < 120; i++) {
  const a = (i / 120) * Math.PI * 2, x = Math.cos(a) * ARENA.wall, z = Math.sin(a) * ARENA.wall;
  if (z > 0 && Math.abs(x) < ARENA.gate) continue;
  addCollider(ARENA.cx + x, ARENA.cz + z, 0.9);
}
for (let z = YARD.z0; z <= YARD.z1; z += 1.5) for (const x of [YARD.x0 - 0.6, YARD.x1 + 0.6]) addCollider(ARENA.cx + x, ARENA.cz + z, 0.7);
for (let x = YARD.x0; x <= YARD.x1; x += 1.5) addCollider(ARENA.cx + x, ARENA.cz + YARD.z1 + 0.6, 0.7);
for (const [x, z] of PILLARS) addCollider(ARENA.cx + x, ARENA.cz + z, 1.0);
addCollider(arena.waystone.x, arena.waystone.z, 0.9);
addCollider(arena.board.x, arena.board.z - 0.3, 0.8);

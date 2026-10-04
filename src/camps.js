// Who stands in each land's camp: a weaponsmith, an armorer, a provisioner (potions, elixirs, camp scrolls),
// a banker (the account's shared bank) and a notice board (that land's quests); Emberwood's camp also has the
// blacksmith with the upgrade anvil, who sells the recipes. Shared by the game (npcs.js draws them) and the
// game server (what blocks the way), so plain data only.
//   role: weapons | armor | goods | bank | board | anvil
//   x, z: where they stand; yaw: which way they face; model, palette, tint: how they look
//   cap: the highest level of what a weapons or armor merchant sells here
import { addCollider } from './terrain.js';

const toward = (x, z, cx, cz) => Math.atan2(cx - x, cz - z);
const at = (cx, cz, list) => list.map((n) => ({ ...n, x: cx + n.x, z: cz + n.z, yaw: n.yaw ?? toward(cx + n.x, cz + n.z, cx, cz + 1.5) }));

// the lands beyond the waystones share one layout around their campfire
const LAND = (names, models) => [
  { role: 'weapons', x: -4.0, z: -7.4, name: names[0], title: 'Weaponsmith', ...models[0] },
  { role: 'armor', x: -7.8, z: -2.6, name: names[1], title: 'Armorer', ...models[1] },
  { role: 'goods', x: -7.4, z: 3.6, name: names[2], title: 'Provisioner', ...models[2] },
  { role: 'bank', x: 3.4, z: -8.2, name: names[3], title: 'Banker', ...models[3] },
  { role: 'board', x: 8.0, z: 1.6, name: 'Notice Board', title: 'Quests' },
];

export const CAMPS = {
  emberwood: [
    { role: 'weapons', x: -3.2, z: -8.35, yaw: 0, name: 'Wren', title: 'Weaponsmith', model: 'Ranger', stall: true },
    { role: 'bank', x: -7.4, z: -6.8, yaw: 0.35, name: 'Oswin', title: 'Banker', model: 'Rogue_Hooded', tint: 0xe8d8b0 },
    { role: 'board', x: 4.6, z: -7.4, yaw: -0.4, name: 'Notice Board', title: 'Quests' },
    { role: 'armor', x: 6.1, z: -3.6, name: 'Hilda', title: 'Armorer', model: 'Knight', tint: 0xd8dde6 },
    { role: 'goods', x: -7.8, z: 1.4, name: 'Pip', title: 'Provisioner', model: 'Mage', palette: 'alchemist' },
    { role: 'anvil', x: -6.0, z: -2.5, name: 'Brom', title: 'Blacksmith · upgrades', model: 'Barbarian', tint: 0xd8b8a0 },
  ].map((n) => ({ ...n, yaw: n.yaw ?? toward(n.x, n.z, 0, 1.5) })),
  frostfang: at(1000, 66, LAND(['Sigrun', 'Ulf', 'Elka', 'Torvald'], [{ model: 'Barbarian', tint: 0xd0e0f0 }, { model: 'Knight', tint: 0xc8d8e8 }, { model: 'Mage', palette: 'cleric' }, { model: 'Rogue_Hooded', tint: 0xb8c8d8 }])),
  cinderfall: at(2000, 70, LAND(['Kael', 'Brann', 'Mira', 'Dorn'], [{ model: 'Knight', tint: 0xa89890 }, { model: 'Barbarian', tint: 0xc8a090 }, { model: 'Mage', tint: 0xffc0a0 }, { model: 'Rogue_Hooded', tint: 0x9a8a80 }])),
  shadowmere: at(3000, 70, LAND(['Vesna', 'Morrow', 'Lyra', 'Silas'], [{ model: 'Rogue', tint: 0xb8a8d8 }, { model: 'Knight', tint: 0x9890b0 }, { model: 'Mage', palette: 'alchemist' }, { model: 'Rogue_Hooded', tint: 0x8a80a0 }])),
};

// what weapon and armor merchants sell, by land: items up to this level
export const SHOP_CAP = { emberwood: 10, frostfang: 20, cinderfall: 30, shadowmere: 50 };

// where a hero stands to talk to them (in front)
export const spotOf = (n) => { const d = n.stall ? 2.2 : n.role === 'board' ? 1.3 : 1.6; return { x: n.x + Math.sin(n.yaw) * d, z: n.z + Math.cos(n.yaw) * d }; };

// what blocks the way: each one and their stall (Emberwood's weaponsmith has the old market stall: terrain.js)
for (const list of Object.values(CAMPS)) {
  for (const n of list) {
    if (n.stall) continue;
    if (n.role === 'board') {
      for (const lx of [-1, 0, 1]) addCollider(n.x + lx * Math.cos(n.yaw), n.z - lx * Math.sin(n.yaw), 0.4);
      continue;
    }
    addCollider(n.x, n.z, 0.5); // the merchant
    addCollider(n.x + Math.sin(n.yaw) * 0.85, n.z + Math.cos(n.yaw) * 0.85, 0.55); // their table, chest or anvil
  }
}

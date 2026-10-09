// The deeper floors under each land's dungeon, down the stairs behind its boss: the Deep Pits under the crypt,
// the Frozen Deep under Rimeheart, the Magma Core under the forge, and the Deep Mines under the vault. Harder
// than the floors above, each with a keeper of its own. Their plans are the floors above, turned around, and
// they're dressed from the plan (dungeon-map.js autoDress).
import { DungeonMap } from '../dungeon-map.js';

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

// A floor's monsters, room by room: a few of its kinds in each side room, its keeper and two guards in the
// boss's room (levels: [low, high], the keeper a level above).
function spawnsFor(d, { kinds, levels: [lo, hi], boss }) {
  const out = [];
  let i = 0;
  for (const [letter, R] of Object.entries(d.rooms)) {
    if (letter === 'S') continue;
    const w = R.x1 - R.x0, h = R.z1 - R.z0, r = Math.max(2, Math.min(w, h) / 2 - 1.5);
    if (letter === 'B') {
      out.push({ type: boss, x: R.cx, z: R.cz - 3, r: 0.5, n: 1, lvl: hi + 1, room: 'B' });
      out.push({ type: kinds[0], x: R.cx, z: R.z1 - 2.5, r: Math.min(6, r), n: 2, lvl: hi });
      continue;
    }
    const n = w * h > 300 ? 6 : w * h > 140 ? 4 : 3;
    out.push({ type: kinds[i % kinds.length], x: R.cx, z: R.cz, r, n: Math.ceil(n / 2), lvl: lo + (i % (hi - lo + 1)) });
    out.push({ type: kinds[(i + 1) % kinds.length], x: R.cx, z: R.cz + 0.5, r, n: Math.floor(n / 2), lvl: Math.min(hi, lo + ((i + 1) % (hi - lo + 1))) });
    i++;
  }
  return out;
}

// the plans of the floors above (see maps/*.js)
const CRYPT = ['###############', '###BBBBBBBBB###', '###BBBBBBBBB###', '###BBBBBBBBB###', '###BBBBBBBBB###', '###BBBBBBBBB###', '#######.#######', '#######.#######', '#CCC#OOOOO#VVV#', '#CCC.OOOOO.VVV#', '#CCC#OOOOO#VVV#', '##.############', '##.######U#####', '#HHHHH##SSS####', '#HHHHH..SSS####', '#HHHHH##SSS####', '###############'];
const RIMEHEART = ['#################', '#####BBBBBBB#####', '#####BBBBBBB#####', '#####BBBBBBB#####', '#####BBBBBBB#####', '#####BBBBBBB#####', '########.########', '########.########', '#FFF#GGGGGGG#TTT#', '#FFF.GGGGGGG.TTT#', '#FFF#GGGGGGG#TTT#', '##.##########.###', '##.#####U####.###', '##.####SSS###.###', '##.....SSS....###', '#######SSS#######', '#################'];
const FORGE = ['#################', '###BBBBBBBBBBB###', '###BBBBBBBBBBB###', '###BBBBBBBBBBB###', '###BBBBBBBBBBB###', '###BBBBBBBBBBB###', '########.########', '#AAAA###.###KKKK#', '#AAAA.......KKKK#', '#AAAA###.###KKKK#', '########.########', '####MMMMMMMMM####', '####MMMMMMMMM####', '####MMMMMMMMM####', '####.#######.####', '####.###U###.####', '####...SSS...####', '#######SSS#######', '#################'];
const ABYSS = ['###################', '####BBBBBBBBBBB####', '####BBBBBBBBBBB####', '####BBBBBBBBBBB####', '####BBBBBBBBBBB####', '####BBBBBBBBBBB####', '#########.#########', '#########.#########', '#PPPP###RRR###QQQQ#', '#PPPP...RRR...QQQQ#', '#PPPP###RRR###QQQQ#', '#.###############.#', '#.###############.#', '#WWW#####U#####EEE#', '#WWW....SSS....EEE#', '#WWW####SSS####EEE#', '###################'];

export const crypt2 = new DungeonMap({
  id: 'crypt2', cx: 0, cz: -560, map: mirror(RIMEHEART),
  zone: { id: 'crypt_deep', name: 'The Deep Pits', sub: 'Dungeon · Level 11 – 14' },
  boss: { id: 'bone_throne', name: 'The Colossus Pit', sub: 'Boss · Level 14' },
});
crypt2.autoDress({ seed: 0xb0e5, banner: 'banner_patternB_brown', plain: ['wall', 'wall', 'wall_cracked', 'wall_shelves', 'wall_arched'] });
export const CRYPT2_SPAWNS = spawnsFor(crypt2, { kinds: ['bone_guard', 'skeleton_mage', 'skeleton_rogue', 'skeleton_warrior'], levels: [11, 13], boss: 'bone_colossus' });

export const rimeheart2 = new DungeonMap({
  id: 'rimeheart2', cx: 1000, cz: -580, map: mirror(FORGE),
  zone: { id: 'rime_deep', name: 'The Frozen Deep', sub: 'Dungeon · Level 25 – 28' },
  boss: { id: 'ymira_hall', name: "Ylva's Hall", sub: 'Boss · Level 28' },
});
rimeheart2.autoDress({ seed: 0x1ce, banner: 'banner_patternC_blue', dirt: true, plain: ['wall', 'wall', 'wall_cracked', 'wall_arched'] });
export const RIMEHEART2_SPAWNS = spawnsFor(rimeheart2, { kinds: ['frostbone', 'ice_witch', 'raider_berserker', 'frost_archer'], levels: [25, 27], boss: 'ymira' });

export const forge2 = new DungeonMap({
  id: 'forge2', cx: 2000, cz: -580, map: mirror(ABYSS),
  zone: { id: 'forge_deep', name: 'The Magma Core', sub: 'Dungeon · Level 43 – 46' },
  boss: { id: 'core_heart', name: 'The Heart of the Core', sub: 'Boss · Level 46' },
});
forge2.autoDress({ seed: 0xf00d, banner: 'banner_triple_yellow', plain: ['wall', 'wall', 'wall_Tsplit', 'wall_arched'] });
export const FORGE2_SPAWNS = spawnsFor(forge2, { kinds: ['molten_brute', 'flame_warden', 'ash_knight', 'ember_skeleton'], levels: [43, 45], boss: 'magmaborn' });

export const abyss2 = new DungeonMap({
  id: 'abyss2', cx: 3000, cz: -580, map: mirror(CRYPT),
  zone: { id: 'abyss_deep', name: 'The Deep Mines', sub: 'Dungeon · Level 60 – 62' },
  boss: { id: 'void_throne', name: "The Envoy's Hall", sub: 'Boss · Level 62' },
});
abyss2.autoDress({ seed: 0xab2, banner: 'banner_patternA_white', plain: ['wall', 'wall', 'wall_arched', 'wall_cracked'] });
export const ABYSS2_SPAWNS = spawnsFor(abyss2, { kinds: ['death_knight', 'wraith', 'night_stalker', 'shadow_archer'], levels: [60, 61], boss: 'void_herald' });

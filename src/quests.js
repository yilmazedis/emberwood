// Quests: a short main story that leads through the woods, plus rotating bounties on the camp
// notice board. The state lives on the player (so it is saved); this class runs the rules.
// Quest flow: offer → (Accept) → active → (goal reached) → done → (Claim at the board) → rewards.
import { randInt, pick } from './util.js';
import { randomItem, RARITY } from './items.js';
import { xpForLevel } from './player.js';

// The story, in order. `level` is the suggested level (the zone's monsters).
export const MAIN_QUESTS = [
  {
    id: 'm1', title: 'Trouble in the Meadow', level: 1, zone: 'meadow',
    text: 'Slimes have overrun the meadow north of camp. Thin them out.',
    goal: { kind: 'kill', family: 'slime', count: 8 },
    reward: { gold: 40, xp: 80, potions: 2 },
  },
  {
    id: 'm2', title: 'The Bandit Hideout', level: 3, zone: 'bandits',
    text: 'Bandits camp to the north-east and raid our supplies. Drive them off.',
    goal: { kind: 'kill', family: 'bandit', count: 5 },
    reward: { gold: 90, xp: 220, item: { minRarity: 'magic' } },
  },
  {
    id: 'm3', title: 'Whispers in the Stones', level: 4, zone: 'stones',
    text: 'Cultists chant among the standing stones to the north-west. Silence them.',
    goal: { kind: 'kill', family: 'cultist', count: 4 },
    reward: { gold: 140, xp: 340, item: { minRarity: 'magic', boost: 2 } },
  },
  {
    id: 'm4', title: 'The Restless Dead', level: 5, zone: 'graveyard',
    text: 'The dead are rising in the graveyard south of camp. Put them back to rest.',
    goal: { kind: 'kill', family: 'skeleton', count: 10 },
    reward: { gold: 200, xp: 520, item: { minRarity: 'rare' } },
  },
  {
    id: 'm5', title: 'Grok the Brute', level: 6, zone: 'lair',
    text: "Grok's lair lies at the far north end of the woods. End his reign.",
    goal: { kind: 'kill', type: 'brute', count: 1 },
    reward: { gold: 350, xp: 900, item: { minRarity: 'legendary' } },
  },
  {
    id: 'm6', title: 'The Crypt Below', level: 9, zone: 'crypt',
    text: 'The dead keep rising. Go down through the crypt door in the graveyard and destroy Morvain the Lich.',
    goal: { kind: 'kill', type: 'lich', count: 1 },
    reward: { gold: 500, xp: 1500, item: { minRarity: 'legendary', boost: 2 } },
  },
  // beyond the waystones
  {
    id: 'm7', title: 'The Frozen North', level: 12, zone: 'ff_raiders',
    text: 'The waystone in camp now reaches Frostfang. Frostborn raiders gather in the snow: break their war band.',
    goal: { kind: 'kill', family: 'frostborn', count: 10 },
    reward: { gold: 600, xp: 1500, item: { minRarity: 'magic', boost: 2 } },
  },
  {
    id: 'm8', title: 'Hrimgar the Frost Jarl', level: 21, zone: 'ff_hold',
    text: "The raiders answer to Hrimgar, who holds court at the far end of Frostfang. Take his hold.",
    goal: { kind: 'kill', type: 'frost_jarl', count: 1 },
    reward: { gold: 1200, xp: 6000, item: { minRarity: 'legendary' } },
  },
  {
    id: 'm9', title: 'Rimeheart', level: 24, zone: 'rimeheart',
    text: 'Below the ice, in Rimeheart Caverns, Vorrak the Rime King raises frozen dead. End him.',
    goal: { kind: 'kill', type: 'rime_king', count: 1 },
    reward: { gold: 1600, xp: 9000, item: { minRarity: 'legendary', boost: 2 } },
  },
  {
    id: 'm10', title: 'Ash and Ember', level: 26, zone: 'cf_flats',
    text: 'The waystone opens on Cinderfall, a land of ash and lava. Drive back the ash bandits and their kin.',
    goal: { kind: 'kill', family: 'ashen', count: 12 },
    reward: { gold: 1800, xp: 10000, item: { minRarity: 'rare' } },
  },
  {
    id: 'm11', title: 'The Ashen King', level: 38, zone: 'cf_throne',
    text: 'Vulkhar the Ashen King sits on his throne between the fire pits. Cast him down.',
    goal: { kind: 'kill', type: 'ashen_king', count: 1 },
    reward: { gold: 3000, xp: 25000, item: { minRarity: 'legendary' } },
  },
  {
    id: 'm12', title: 'The Molten Forge', level: 42, zone: 'forge',
    text: 'Forgemaster Kaldur still arms the wastes from the Molten Forge. Put out his fires.',
    goal: { kind: 'kill', type: 'forgemaster', count: 1 },
    reward: { gold: 3600, xp: 32000, item: { minRarity: 'legendary', boost: 2 } },
  },
  {
    id: 'm13', title: 'Into the Dusk', level: 42, zone: 'sm_marsh',
    text: 'Shadowmere lies beyond the last waystone, a marsh where the dead walk at twilight. Thin out its shades.',
    goal: { kind: 'kill', family: 'shade', count: 12 },
    reward: { gold: 3200, xp: 25000, item: { minRarity: 'rare', boost: 2 } },
  },
  {
    id: 'm14', title: 'The Hollow King', level: 56, zone: 'sm_throne',
    text: 'Malakar the Hollow King commands the dead of Shadowmere from his throne of bones. Shatter him.',
    goal: { kind: 'kill', type: 'hollow_king', count: 1 },
    reward: { gold: 5000, xp: 60000, item: { minRarity: 'legendary' } },
  },
  {
    id: 'm15', title: 'The Queen of the Abyss', level: 60, zone: 'abyss',
    text: 'At the bottom of the Abyssal Vault waits Nyxara, Queen of the Abyss, who began all of this. Finish it.',
    goal: { kind: 'kill', type: 'abyss_queen', count: 1 },
    reward: { gold: 8000, xp: 100000, item: { minRarity: 'legendary', boost: 3 } },
  },
];

// Bounty templates: {n} is rolled from `n` (for gold: about n kills' worth). Rewards scale with the
// player's level, `value` and how big the roll was.
const BOUNTIES = [
  { key: 'slime', minLevel: 1, title: 'Slime Cull', text: 'Slimes keep creeping toward camp. Slay {n} of any color.', goal: { kind: 'kill', family: 'slime' }, n: [8, 14], zone: 'meadow', value: 1, potions: 1 },
  { key: 'bandit', minLevel: 2, title: 'Bandit Bounty', text: 'The camp pays for every bandit brought down. Defeat {n}.', goal: { kind: 'kill', family: 'bandit' }, n: [4, 7], zone: 'bandits', value: 1.6, item: { minRarity: 'magic' } },
  { key: 'cultist', minLevel: 3, title: 'Cultist Purge', text: 'Stop the cultists before their ritual is finished. Defeat {n}.', goal: { kind: 'kill', family: 'cultist' }, n: [3, 5], zone: 'stones', value: 1.8, item: { minRarity: 'magic' } },
  { key: 'skeleton', minLevel: 4, title: 'Bone Breaker', text: 'Shatter {n} skeletons in the Forgotten Graveyard.', goal: { kind: 'kill', family: 'skeleton' }, n: [6, 10], zone: 'graveyard', value: 2, item: { minRarity: 'magic' } },
  { key: 'gold', minLevel: 1, title: 'Coin Collector', text: 'Wren wants proof you can turn a profit. Pick up {n} gold from monsters.', goal: { kind: 'gold' }, n: [12, 18], value: 1.2 },
  { key: 'loot', minLevel: 1, title: 'Treasure Hunter', text: 'Find {n} magic or better items out in the wilds.', goal: { kind: 'loot', minRarity: 'magic' }, n: [1, 3], value: 1.5 },
  { key: 'lich', minLevel: 7, title: 'Lich Bane', text: 'Morvain has risen again in the crypt. Destroy him once more.', goal: { kind: 'kill', type: 'lich' }, n: [1, 1], zone: 'crypt', value: 2.5, item: { minRarity: 'rare' } },
  { key: 'brute', minLevel: 5, title: 'Brute Force', text: 'Grok is back in his lair. Take him down again.', goal: { kind: 'kill', type: 'brute' }, n: [1, 1], zone: 'lair', value: 2, item: { minRarity: 'rare' } },
  // beyond the waystones
  { key: 'frostborn', minLevel: 10, title: 'Northern Raiders', text: 'Frostborn raiders harry the outposts in the snow. Defeat {n}.', goal: { kind: 'kill', family: 'frostborn' }, n: [6, 10], zone: 'ff_raiders', value: 2.2, item: { minRarity: 'magic' } },
  { key: 'jarl', minLevel: 18, title: 'Jarl Slayer', text: 'Hrimgar the Frost Jarl has taken his hold again. Bring him down.', goal: { kind: 'kill', type: 'frost_jarl' }, n: [1, 1], zone: 'ff_hold', value: 2.8, item: { minRarity: 'rare' } },
  { key: 'rimeking', minLevel: 20, title: 'Cold Crown', text: 'Vorrak the Rime King has risen in Rimeheart Caverns. Destroy him once more.', goal: { kind: 'kill', type: 'rime_king' }, n: [1, 1], zone: 'rimeheart', value: 3, item: { minRarity: 'rare' } },
  { key: 'ashen', minLevel: 22, title: 'Ash and Bone', text: 'Ash bandits and their kind rule the wastes of Cinderfall. Defeat {n}.', goal: { kind: 'kill', family: 'ashen' }, n: [6, 10], zone: 'cf_flats', value: 2.4, item: { minRarity: 'magic' } },
  { key: 'vulkhar', minLevel: 34, title: 'Kingslayer', text: 'Vulkhar the Ashen King sits his throne again. Unseat him.', goal: { kind: 'kill', type: 'ashen_king' }, n: [1, 1], zone: 'cf_throne', value: 3, item: { minRarity: 'rare' } },
  { key: 'kaldur', minLevel: 38, title: 'Quench the Forge', text: 'The Molten Forge burns again. Defeat Forgemaster Kaldur.', goal: { kind: 'kill', type: 'forgemaster' }, n: [1, 1], zone: 'forge', value: 3.2, item: { minRarity: 'rare' } },
  { key: 'shade', minLevel: 40, title: 'Shades of Dusk', text: 'Bog lurkers, night stalkers and death knights haunt Shadowmere. Defeat {n}.', goal: { kind: 'kill', family: 'shade' }, n: [6, 10], zone: 'sm_marsh', value: 2.6, item: { minRarity: 'magic' } },
  { key: 'malakar', minLevel: 52, title: 'Hollow Crown', text: 'Malakar the Hollow King has gathered his bones again. Scatter them.', goal: { kind: 'kill', type: 'hollow_king' }, n: [1, 1], zone: 'sm_throne', value: 3.2, item: { minRarity: 'rare' } },
  { key: 'nyxara', minLevel: 56, title: 'Abyssal Queen', text: 'Nyxara stirs at the bottom of the Abyssal Vault. Send her back.', goal: { kind: 'kill', type: 'abyss_queen' }, n: [1, 1], zone: 'abyss', value: 3.5, item: { minRarity: 'rare' } },
];

const ZONE_LEVEL = {
  meadow: 1, bandits: 3, stones: 4, graveyard: 5, lair: 6, crypt: 8,
  ff_raiders: 13, ff_hold: 21, rimeheart: 22, cf_flats: 24, cf_throne: 38, forge: 40, sm_marsh: 42, sm_throne: 56, abyss: 58,
};
const RARITY_RANK = { common: 0, magic: 1, rare: 2, legendary: 3 };
const FAMILY_LABEL = { slime: 'Slimes', bandit: 'Bandits', cultist: 'Cultists', skeleton: 'Skeletons', frostborn: 'Frostborn', ashen: 'Ashen foes', shade: 'Shades' };
const FAMILY = {
  frost_scout: 'frostborn', frost_raider: 'frostborn', raider_berserker: 'frostborn', ice_witch: 'frostborn', frost_archer: 'frostborn',
  ash_bandit: 'ashen', cinder_cultist: 'ashen', ash_knight: 'ashen', molten_brute: 'ashen', pyre_archer: 'ashen',
  bog_lurker: 'shade', night_stalker: 'shade', shadow_archer: 'shade', death_knight: 'shade', wraith: 'shade',
};
const familyOf = (type) => (type.startsWith('slime') ? 'slime' : type.startsWith('skeleton') ? 'skeleton' : FAMILY[type] || type);
const BOSS_LABEL = {
  brute: 'Grok defeated', lich: 'Morvain destroyed', frost_jarl: 'Hrimgar defeated', rime_king: 'Vorrak destroyed', ashen_king: 'Vulkhar defeated',
  forgemaster: 'Kaldur defeated', hollow_king: 'Malakar destroyed', abyss_queen: 'Nyxara destroyed',
};

export class Quests {
  constructor(game) {
    this.game = game;
    this.ensure();
  }

  get state() {
    return this.game.player.quests;
  }

  // Fill empty slots: the next story quest and three bounty offers.
  ensure() {
    const s = this.state;
    if (s.main) s.main.def = MAIN_QUESTS.find((d) => d.id === s.main.def.id) || s.main.def; // keep saved quests up to date
    if (!s.main && s.mainIndex < MAIN_QUESTS.length) s.main = { def: MAIN_QUESTS[s.mainIndex], progress: 0, state: 'offer' };
    for (let i = 0; i < 3; i++) if (!s.bounties[i]) s.bounties[i] = this.newBounty(s.bounties);
  }

  newBounty(current) {
    const lvl = this.game.player.level;
    const taken = new Set(current.filter(Boolean).map((b) => b.def.key));
    // prefer different bounties near your level (zones you have outgrown drop out)
    const open = (t) => lvl >= t.minLevel && !taken.has(t.key);
    const pool = [
      BOUNTIES.filter((t) => open(t) && (!t.zone || lvl <= ZONE_LEVEL[t.zone] + 3)),
      BOUNTIES.filter(open),
      BOUNTIES.filter((t) => lvl >= t.minLevel),
    ].find((list) => list.length);
    const t = pick(pool);
    let n = randInt(t.n[0], t.n[1]);
    const value = t.value * (n / ((t.n[0] + t.n[1]) / 2)); // bigger rolls pay more
    if (t.goal.kind === 'gold') n = Math.max(20, Math.round((n * 1.9 * Math.pow(lvl, 1.2)) / 5) * 5);
    // easy bounties in low zones pay at most a couple of levels above the zone
    const rl = t.zone ? Math.min(lvl, ZONE_LEVEL[t.zone] + 2) : lvl;
    // (XP: a third of a level early on; past level 10 about six kills' worth, or bounties would outpace hunting)
    const reward = { gold: Math.round(value * (20 + rl * 8)), xp: Math.round(Math.min(xpForLevel(rl) * 0.3, 300 * (1 + 0.25 * (rl - 1))) * value) };
    if (t.item) reward.item = t.item;
    if (t.potions) reward.potions = t.potions;
    return {
      def: {
        id: `b${Date.now().toString(36)}${randInt(0, 9999)}`, key: t.key, title: t.title, text: t.text.replace('{n}', n),
        goal: { ...t.goal, count: n }, zone: t.zone || null, level: t.zone ? ZONE_LEVEL[t.zone] : null, reward,
      },
      progress: 0,
      state: 'offer',
    };
  }

  entries() {
    const s = this.state;
    return [['main', s.main], [0, s.bounties[0]], [1, s.bounties[1]], [2, s.bounties[2]]];
  }

  quest(slot) {
    return slot === 'main' ? this.state.main : this.state.bounties[slot];
  }

  // ---------------------------------------------------------------- board actions
  accept(slot) {
    const q = this.quest(slot);
    if (!q || q.state !== 'offer') return;
    q.state = 'active';
    q.progress = 0;
    this.game.ui.log(`Quest accepted: <b>${q.def.title}</b>`, 'lvl');
    this.game.sfx.play('page');
    this.changed();
  }

  abandon(slot) {
    const q = this.quest(slot);
    if (!q || q.state === 'offer') return;
    q.state = 'offer';
    q.progress = 0;
    this.changed();
  }

  skip(slot) {
    const q = this.quest(slot);
    if (slot === 'main' || !q || q.state !== 'offer') return;
    this.state.bounties[slot] = this.newBounty(this.state.bounties);
    this.game.sfx.play('page');
    this.changed();
  }

  claim(slot) {
    const g = this.game, p = g.player, q = this.quest(slot);
    if (!q || q.state !== 'done') return;
    const r = q.def.reward;
    let item = null;
    if (r.item) {
      if (p.freeSlot() < 0) { g.ui.centerMsg('Make room in your bag for the reward'); return; }
      item = randomItem(Math.max(p.level, q.def.level || 1), { minRarity: r.item.minRarity, boost: r.item.boost || 1 });
      p.addItem(item);
    }
    p.gold += r.gold || 0;
    p.potions += r.potions || 0;
    const head = p.headPos();
    if (r.gold) g.ui.floater(head, `+${r.gold}g`, 'gold');
    if (r.xp) g.ui.floater(head.clone().setY(head.y + 0.5), `+${r.xp} XP`, 'xp');
    const parts = [r.gold && `+${r.gold}g`, r.xp && `+${r.xp} XP`, r.potions && `+${r.potions} ale`,
      item && `<b style="color:${RARITY[item.rarity].color}">${item.name}</b>`].filter(Boolean);
    g.ui.log(`Reward for <b>${q.def.title}</b>: ${parts.join(' · ')}`, 'gold');
    g.sfx.play('quest');
    if (slot === 'main') { this.state.mainIndex++; this.state.main = null; } else this.state.bounties[slot] = null;
    p.gainXp(r.xp || 0); // first, so the new offers match a level-up
    this.ensure();
    this.changed();
    g.save();
  }

  // ---------------------------------------------------------------- progress
  // kind: 'kill' { type }, 'gold' { amount }, 'loot' { rarity }
  onEvent(kind, data) {
    const g = this.game;
    let changed = false;
    for (const [, q] of this.entries()) {
      if (!q || q.state !== 'active' || q.def.goal.kind !== kind) continue;
      const goal = q.def.goal;
      let add = 0;
      if (kind === 'kill') add = (goal.family && familyOf(data.type) === goal.family) || (goal.type && data.type === goal.type) ? 1 : 0;
      else if (kind === 'gold') add = data.amount;
      else if (kind === 'loot') add = RARITY_RANK[data.rarity] >= RARITY_RANK[goal.minRarity] ? 1 : 0;
      if (!add) continue;
      q.progress = Math.min(goal.count, q.progress + add);
      changed = true;
      if (q.progress >= goal.count) {
        q.state = 'done';
        g.ui.zoneToast({ name: 'Quest complete', sub: `${q.def.title} · return to the notice board` });
        g.ui.log(`Quest complete: <b>${q.def.title}</b>. Claim your reward at the notice board.`, 'lvl');
        g.sfx.play('quest');
      }
    }
    if (changed) this.changed();
  }

  changed() {
    const ui = this.game.ui;
    ui.refreshTracker();
    if (ui.invOpen && ui.invMode === 'board') ui.refreshInventory();
  }

  // ---------------------------------------------------------------- for the UI
  // The golden "!" over the board: a new story quest, or a reward waiting.
  markerVisible() {
    return this.state.main?.state === 'offer' || this.entries().some(([, q]) => q && q.state === 'done');
  }

  tracked() {
    return this.entries().filter(([, q]) => q && q.state !== 'offer').map(([slot, q]) => ({ slot, q }));
  }

  goalLabel(q) {
    const goal = q.def.goal;
    if (goal.kind === 'kill') return goal.type ? BOSS_LABEL[goal.type] || 'Defeated' : `${FAMILY_LABEL[goal.family]} slain`;
    if (goal.kind === 'gold') return 'Gold picked up';
    return 'Magic+ items found';
  }
}

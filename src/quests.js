// Quests (quest-data.js): each land's notice board offers its quests as the hero's level allows and earlier
// ones are done; up to six can be under way at once, and each is done just once. The state lives on the hero
// ({ done: [ids], active: [{ id, progress }] }, so it is saved); this class runs the rules.
// A quest's flow: offered (at its land's board) → accepted → its goal reached → claimed at any board.
import { QUESTS, QUEST_BY_ID, familyOf, FAMILY_LABEL } from './quest-data.js';
import { ITEMS, makeItem, itemName, itemColor, TIERS } from './items.js';
import { xpForLevel } from './player.js';
import { MAPS } from './maps.js';
import { chance } from './util.js';

export const MAX_ACTIVE = 6;
const BOSS_LABEL = {
  brute: 'Grok defeated', lich: 'Morvain destroyed', frost_jarl: 'Hrimgar defeated', rime_king: 'Vorrak destroyed', ashen_king: 'Vulkhar defeated',
  forgemaster: 'Kaldur defeated', hollow_king: 'Malakar destroyed', abyss_queen: 'Nyxara destroyed', bone_colossus: 'Colossus destroyed', ymira: 'Ymira defeated',
  magmaborn: 'Magmaborn destroyed', void_herald: 'Herald silenced', gorehorn: 'Gorehorn defeated', skadi: 'Skadi defeated', ignis: 'Ignis put out', umbra: 'Umbra destroyed',
};

// A quest's XP and gold: a share of a level's XP (bigger for bosses), and gold for its level.
export function questReward(q) {
  const r = q.reward || {}, L = q.level;
  return {
    xp: Math.round(xpForLevel(L) * 0.16 * q.w),
    gold: (r.gold || 0) + Math.round((15 + L * 9) * q.w / 5) * 5,
    items: r.items || [], recipes: r.recipes || [], gear: r.gear || null,
  };
}

export class Quests {
  constructor(game) {
    this.game = game;
  }

  get state() {
    return this.game.player.quests;
  }

  // (saves made by older versions, or broken ones)
  ensure() {
    const s = this.state;
    if (!Array.isArray(s.done)) s.done = [];
    if (!Array.isArray(s.active)) s.active = [];
    s.active = s.active.filter((a) => a && QUEST_BY_ID[a.id] && !s.done.includes(a.id));
  }

  isDone(id) { return this.state.done.includes(id); }
  activeEntry(id) { return this.state.active.find((a) => a.id === id) || null; }

  // A land's quests for its board: { claim, active, open, later } (later: not yet, with why).
  board(land) {
    const p = this.game.player, out = { claim: [], active: [], open: [], later: [] };
    for (const a of this.state.active) {
      const q = QUEST_BY_ID[a.id];
      if (a.progress >= q.goal.count) out.claim.push(q);
      else if (q.land === land) out.active.push(q);
    }
    for (const q of QUESTS) {
      if (q.land !== land || this.isDone(q.id) || this.activeEntry(q.id)) continue;
      const before = (q.after || []).filter((id) => !this.isDone(id));
      if (before.length || p.level < q.min) out.later.push({ q, why: before.length ? `After “${QUEST_BY_ID[before[0]].title}”` : `From level ${q.min}` });
      else out.open.push(q);
    }
    out.later.sort((a, b) => a.q.min - b.q.min);
    return out;
  }

  // ---------------------------------------------------------------- board actions
  accept(id) {
    const q = QUEST_BY_ID[id], g = this.game;
    if (!q || this.isDone(id) || this.activeEntry(id)) return;
    if (this.state.active.length >= MAX_ACTIVE) { g.ui.centerMsg(`At most ${MAX_ACTIVE} quests at once`); return; }
    this.state.active.push({ id, progress: 0 });
    g.ui.log(`Quest accepted: <b>${q.title}</b>`, 'lvl');
    g.sfx.play('page');
    // goals already met (a place you're in, gear you wear) count at once
    if (q.goal.kind === 'visit') this.onEvent('visit', { map: g.places.id, zone: g.currentZone?.id });
    if (q.goal.kind === 'equip') this.onEvent('equip', {});
    if (q.goal.kind === 'upgrade') this.onEvent('upgrade', {});
    if (q.goal.kind === 'learn' && g.player.spentPoints() > 0) this.onEvent('learn', {});
    this.changed();
  }

  abandon(id) {
    this.state.active = this.state.active.filter((a) => a.id !== id);
    this.changed();
  }

  claim(id) {
    const g = this.game, p = g.player, a = this.activeEntry(id), q = QUEST_BY_ID[id];
    if (!a || a.progress < q.goal.count) return;
    const r = questReward(q);
    const gear = r.gear ? this.gearFor(r.gear) : null;
    const things = [...r.items, ...r.recipes].map(([key, n]) => makeItem(key, { n }));
    if (gear) things.push(gear);
    if (p.bag.filter((x) => !x).length < things.length) { g.ui.centerMsg('Make room in your bag for the reward'); return; }
    for (const it of things) p.addItem(it, true);
    p.gold += r.gold;
    const head = p.headPos();
    g.ui.floater(head, `+${r.gold}g`, 'gold');
    g.ui.floater(head.clone().setY(head.y + 0.5), `+${r.xp} XP`, 'xp');
    const parts = [`+${r.gold}g`, `+${r.xp} XP`, ...things.map((it) => `<b style="color:${itemColor(it)}">${itemName(it)}${it.n > 1 ? ` ×${it.n}` : ''}</b>`)];
    g.ui.log(`Reward for <b>${q.title}</b>: ${parts.join(' · ')}`, 'gold');
    g.sfx.play('quest');
    this.state.active = this.state.active.filter((x) => x.id !== id);
    this.state.done.push(id);
    p.gainXp(r.xp);
    this.changed();
    g.ui.refreshInventory();
    g.save();
  }

  // The best item of the hero's class of a kind, at most a level (a quest's reward): for weapons, of the
  // kind the hero holds if it can.
  gearFor({ kind, level }) {
    const p = this.game.player, held = ITEMS[p.equipment.weapon?.k];
    const fits = (d) => !d.unique && !d.stack && d.classes?.includes(p.cls) && d.level <= level && (kind === 'weapon' ? d.kind === 'weapon' : d.slot === kind);
    const pool = Object.values(ITEMS).filter(fits).sort((a, b) => b.level - a.level);
    const best = (kind === 'weapon' && held && pool.find((d) => d.type === held.type)) || pool[0];
    return best ? makeItem(best.key) : null;
  }

  // ---------------------------------------------------------------- progress
  // kind: kill { type } · visit { map, zone } · talk { land, role } · learn · equip · upgrade · bank · buy { role }
  onEvent(kind, data = {}) {
    const g = this.game, p = g.player;
    let changed = false;
    for (const a of this.state.active) {
      const q = QUEST_BY_ID[a.id], goal = q.goal;
      if (a.progress >= goal.count) continue;
      let add = 0, set = null;
      if (kind === 'kill' && goal.kind === 'kill') {
        add = (goal.family && familyOf(data.type) === goal.family) || (goal.type && data.type === goal.type) ? 1 : 0;
      } else if (kind === 'kill' && goal.kind === 'collect') {
        const from = goal.from;
        if ((from === data.type || from === familyOf(data.type)) && chance(goal.chance)) {
          add = 1;
          if (data.pos) g.ui.floater(data.pos, `+1 ${goal.item}`, 'info small');
        }
      } else if (kind === 'visit' && goal.kind === 'visit') {
        add = (goal.map && goal.map === data.map) || (goal.zone && goal.zone === data.zone) ? 1 : 0;
      } else if (kind === 'talk' && goal.kind === 'talk') {
        add = goal.role === data.role && goal.land === data.land ? 1 : 0;
      } else if (kind === goal.kind && (kind === 'learn' || kind === 'bank' || (kind === 'buy' && (!goal.role || goal.role === data.role)))) {
        add = 1;
      } else if (kind === 'equip' && goal.kind === 'equip') {
        set = Object.values(p.equipment).some((it) => it && ((goal.slot && ITEMS[it.k].slot === goal.slot) || (goal.tier && ITEMS[it.k].tier === goal.tier && !ITEMS[it.k].unique))) ? 1 : 0;
      } else if (kind === 'upgrade' && goal.kind === 'upgrade') {
        set = [...Object.values(p.equipment), ...p.bag].some((it) => it && !ITEMS[it.k].stack && (it.p ?? 0) >= goal.plus) ? 1 : 0;
      }
      if (!add && !set) continue;
      a.progress = Math.min(goal.count, set !== null ? Math.max(a.progress, set) : a.progress + add);
      changed = true;
      if (a.progress >= goal.count) {
        g.ui.zoneToast({ name: 'Quest complete', sub: `${q.title} · return to a notice board` });
        g.ui.log(`Quest complete: <b>${q.title}</b>. Claim your reward at any notice board.`, 'lvl');
        g.sfx.play('quest');
      }
    }
    if (changed) this.changed();
  }

  onLevel() {
    this.changed(); // (new quests may be open)
  }

  changed() {
    const ui = this.game.ui;
    ui.refreshTracker();
    if (ui.invOpen && ui.invMode === 'board') ui.refreshInventory();
  }

  // ---------------------------------------------------------------- for the UI
  // The golden "!" over a land's board: a quest there you can take, or a reward waiting.
  markerVisible(land) {
    const b = this.board(land);
    return b.claim.length > 0 || (b.open.length > 0 && this.state.active.length < MAX_ACTIVE);
  }

  tracked() {
    return this.state.active.map((a) => ({ q: QUEST_BY_ID[a.id], progress: a.progress }));
  }

  goalLabel(q) {
    const goal = q.goal;
    switch (goal.kind) {
      case 'kill': return goal.type ? BOSS_LABEL[goal.type] || `${(goal.type || '').replace(/_/g, ' ')} slain` : `${FAMILY_LABEL[goal.family] || goal.family} slain`;
      case 'collect': return `${goal.item}`;
      case 'visit': return goal.map ? `Reach ${MAPS[goal.map]?.name || goal.map}` : 'Explore';
      case 'talk': return 'Talk to them';
      case 'learn': return 'Skill point spent';
      case 'equip': return goal.tier ? `${TIERS[goal.tier].name} item worn` : 'Worn';
      case 'upgrade': return `An item at +${goal.plus}`;
      case 'bank': return 'Something banked';
      case 'buy': return 'Bought';
      default: return '';
    }
  }

  // A tracked quest's dashed ring on the minimap: its zone.
  zoneOf(q) {
    return q.zone || null;
  }
}

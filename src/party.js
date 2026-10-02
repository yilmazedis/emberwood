// Parties (up to 8 heroes, kept by the game server): the party frame under the minimap (each member's
// name, level, life and where they are; the leader's crown), invitations, and the party's own chat. Party
// members share the XP and loot of kills near them (sim/world.js credits) and one copy of each dungeon.
// Invite someone by tapping their name over their head, or type /invite Name in chat.
import { MAPS } from './maps.js';
import { CLASSES } from './classes.js';
import { has } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const MAX_PARTY = 8;

export class Party {
  constructor(game) {
    this.game = game;
    this.id = 0;
    this.leader = null;
    this.members = []; // { id: character id, n: name, c: class, l: level, i: hero in the world (pid) or 0, m: place, h: life 0..1, a: alive, on }
    this.pids = new Set(); // the members' heroes in the world (others.js colours them, the arena spares them)
    this.el = $('party');
    this.list = $('party-list');
    this.inviteEl = $('invite');
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('.pm[data-id]');
      if (row) this.memberMenu(row);
    });
    $('party-leave').addEventListener('click', () => this.leave());
    $('invite-yes').addEventListener('click', () => this.answer(true));
    $('invite-no').addEventListener('click', () => this.answer(false));
  }

  get myId() {
    return this.game.character?.id;
  }

  get leading() {
    return !this.id || this.leader === this.myId;
  }

  has(pid) {
    return this.pids.has(pid);
  }

  // ---------------------------------------------------------------- from the server
  receive(m) {
    this.id = m.id || 0;
    this.leader = m.leader || null;
    this.members = Array.isArray(m.members) ? m.members.filter((x) => x && typeof x.id === 'string') : [];
    this.pids = new Set(this.members.filter((x) => x.i && x.id !== this.myId).map((x) => x.i));
    this.render();
    for (const o of this.game.others.list) this.game.ui.refreshPlayerPlate(o);
  }

  // Someone wants us in their party: { from, c: class, l: level }.
  invited(m) {
    const cls = has(CLASSES, m.c) ? CLASSES[m.c].name : '';
    $('invite-text').innerHTML = `<b class="c-${has(CLASSES, m.c) ? m.c : ''}">${esc(m.from)}</b> (level ${Number(m.l) || 1} ${cls}) invites you to their party.`;
    this.inviteEl.classList.remove('hidden');
    clearTimeout(this.inviteT);
    this.inviteT = setTimeout(() => this.inviteEl.classList.add('hidden'), 58000);
    this.game.sfx.play('page');
  }

  reset() {
    this.receive({ id: 0, members: [] });
    this.inviteEl.classList.add('hidden');
  }

  // ---------------------------------------------------------------- what we do
  async ask(t, data = {}) {
    try {
      return await this.game.net.request(t, data);
    } catch (err) {
      this.game.chat.line({ text: err.message, sys: true });
      return null;
    }
  }

  async invite(name) {
    const r = await this.ask('partyInvite', { name });
    if (r) this.game.chat.line({ text: `You invited ${r.name} to your party.`, sys: true, party: true });
  }

  answer(yes) {
    this.inviteEl.classList.add('hidden');
    clearTimeout(this.inviteT);
    this.ask('partyAnswer', { yes });
  }

  leave() {
    if (this.id) this.ask('partyLeave');
  }

  kick(id) {
    this.ask('partyKick', { id });
  }

  promote(id) {
    this.ask('partyLead', { id });
  }

  // A member's row: the leader can pass the lead or remove them; our own row leaves.
  memberMenu(row) {
    const ui = this.game.ui, id = row.dataset.id, m = this.members.find((x) => x.id === id);
    if (!m) return;
    const actions = id === this.myId ? [['Leave party', () => this.leave()]]
      : this.leader === this.myId ? [['Make leader', () => this.promote(id)], ['Remove', () => this.kick(id)]] : [];
    if (!actions.length) return;
    ui.openMenu(row, `<div class="tt-name">${esc(m.n)}</div><div class="tt-type">Level ${m.l} ${CLASSES[m.c]?.name || ''}</div>`, actions);
  }

  // ---------------------------------------------------------------- the frame
  render() {
    const show = this.id && this.members.length > 1;
    this.el.classList.toggle('hidden', !show);
    if (!show) { this.list.innerHTML = ''; return; }
    $('party-count').textContent = `${this.members.length} / ${MAX_PARTY}`;
    const here = this.game.places?.id;
    this.list.innerHTML = this.members.map((m) => {
      const me = m.id === this.myId, away = m.on && m.m && m.m !== here;
      const where = !m.on ? 'offline' : !m.i ? 'resting' : away ? MAPS[m.m]?.name || '' : '';
      const life = me ? this.game.player.hp / this.game.player.stats.maxHp : m.h;
      return `<div class="pm c-${has(CLASSES, m.c) ? m.c : ''}${me ? ' me' : ''}${m.id === this.leader ? ' lead' : ''}${!m.on || !m.i ? ' off' : ''}${m.on && m.i && !m.a ? ' down' : ''}" data-id="${esc(m.id)}">
        <div class="pm-top"><b>${esc(m.n)}</b><i>${m.l}</i>${where ? `<span>${esc(where)}</span>` : ''}</div>
        <div class="pm-hp"><b style="transform:scaleX(${Math.max(0, Math.min(1, life || 0)).toFixed(3)})"></b></div></div>`;
    }).join('');
  }

  // (our own life bar moves every frame; the others' come with the server's updates)
  update() {
    if (!this.id) return;
    const row = this.list.querySelector('.pm.me .pm-hp b'), p = this.game.player;
    if (row) row.style.transform = `scaleX(${Math.max(0, p.hp / p.stats.maxHp).toFixed(3)})`;
  }
}

// Trading with another hero (the server does the swap: server/trade.mjs). Ask from their menu (right-click or
// tap them); when they say yes the bag opens for both with the trade beside it: click items in the bag to put
// them in (again to take them out), set some gold, and accept. Any change takes both accepts back; when both
// have accepted, the server swaps and tells our game the bag and gold we have now.
import { itemDef, itemName, itemColor } from './items.js';
import { has } from './util.js';
import { CLASSES } from './classes.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const MAX_ITEMS = 12;

export class Trade {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.mine = { items: [], gold: 0, ok: false };
    this.theirs = { items: [], gold: 0, ok: false };
    $('trade-close').addEventListener('click', () => this.cancel());
    $('trade-cancel').addEventListener('click', () => this.cancel());
    $('trade-accept').addEventListener('click', () => this.accept());
    $('trade-gold').addEventListener('change', () => this.setGold($('trade-gold').value));
    $('trade-mine').addEventListener('click', (e) => {
      const d = e.target.closest('[data-id]');
      if (d) this.remove(d.dataset.id);
    });
    for (const id of ['trade-mine', 'trade-theirs']) {
      $(id).addEventListener('mouseover', (e) => {
        const d = e.target.closest('[data-i]');
        if (!d || this.game.ui.touch) return;
        const list = id === 'trade-mine' ? this.mine.items : this.theirs.items, it = list[Number(d.dataset.i)];
        if (it) this.game.ui.showTip(d, () => this.game.ui.itemTip(it, { compare: id === 'trade-theirs' }));
      });
      $(id).addEventListener('mouseout', () => { if (!this.game.ui.touch) this.game.ui.hideTip(); });
    }
  }

  async ask(t, data = {}) {
    try { return await this.game.net.request(t, data); } catch (err) { this.game.ui.centerMsg(err.message); return null; }
  }

  // ---------------------------------------------------------------- from our side
  async request(rp) {
    const r = await this.ask('tradeRequest', { pid: rp.id });
    if (r) this.game.chat.line({ text: `You asked ${r.name} to trade.`, sys: true });
  }

  // Someone wants to trade: { from, c: class }.
  asked(m) {
    const cls = has(CLASSES, m.c) ? CLASSES[m.c].name : '';
    this.game.ui.prompt(`<b>${esc(m.from)}</b> (${cls}) wants to trade with you.`, [
      ['Trade', () => this.ask('tradeAnswer', { yes: true }), 'go'],
      ['No thanks', () => this.ask('tradeAnswer', { yes: false })],
    ], 28000);
  }

  // A bag item clicked while trading: in it goes (not equipped ones: those aren't in the bag).
  offerFromBag(i) {
    const it = this.game.player.bag[i];
    if (!it) return;
    if (itemDef(it)?.bound) { this.game.ui.centerMsg('A cave key stays with the hero who found it'); return; }
    if (this.mine.items.some((x) => x.id === it.id)) return this.remove(it.id);
    if (this.mine.items.length >= MAX_ITEMS) { this.game.ui.centerMsg(`At most ${MAX_ITEMS} items at once`); return; }
    this.send([...this.mine.items, { ...it }], this.mine.gold);
  }

  remove(id) {
    this.send(this.mine.items.filter((x) => x.id !== id), this.mine.gold);
  }

  setGold(v) {
    const p = this.game.player, gold = Math.max(0, Math.min(p.gold, Math.floor(Number(v) || 0)));
    $('trade-gold').value = gold;
    this.send(this.mine.items, gold);
  }

  // (kept here at once too, so a quick second change builds on the first, not on what the server last said)
  send(items, gold) {
    this.mine = { items, gold, ok: false };
    this.ask('tradeOffer', { items, gold });
  }

  accept() {
    this.game.flushSave();
    this.ask('tradeAccept', { save: this.game.player.serialize() });
  }

  cancel() {
    if (this.isOpen) this.ask('tradeCancel');
    this.close();
  }

  isOffered(it) {
    return this.isOpen && !!it && this.mine.items.some((x) => x.id === it.id);
  }

  // ---------------------------------------------------------------- from the server
  // The window as it is: { with, mine: { items, gold, ok }, theirs: … }
  state(m) {
    const ui = this.game.ui;
    if (!this.isOpen) {
      this.isOpen = true;
      ui.openInventory('trade');
      $('trade-note').textContent = `${ui.touch ? 'Tap' : 'Click'} items in your bag to offer them (again to take them back), and set any gold. When you both accept, they swap.`;
      this.game.sfx.play('page');
    }
    this.mine = m.mine;
    this.theirs = m.theirs;
    $('trade-with').textContent = `with ${m.with}`;
    const row = (list, mine) => list.map((it, i) => {
      const d = itemDef(it);
      return `<div class="bag-slot r-${d?.unique ? 'unique' : d?.stack ? 'common' : d?.tier}" data-i="${i}"${mine ? ` data-id="${esc(it.id)}"` : ''} title="${esc(itemName(it))}">${ui.slotHtml(it)}</div>`;
    }).join('') || '<div class="trade-empty">Nothing yet</div>';
    $('trade-mine').innerHTML = row(this.mine.items, true);
    $('trade-theirs').innerHTML = row(this.theirs.items, false);
    if (document.activeElement !== $('trade-gold')) $('trade-gold').value = this.mine.gold;
    $('trade-their-gold').textContent = this.theirs.gold;
    $('trade-ok-mine').textContent = this.mine.ok ? '✓ You accepted' : '';
    $('trade-ok-theirs').textContent = this.theirs.ok ? '✓ They accepted' : '';
    $('trade-accept').disabled = this.mine.ok;
    ui.refreshInventory();
  }

  // The swap happened: our bag and gold as they are now (and the save number after it).
  done(m) {
    const g = this.game, p = g.player;
    if (Array.isArray(m.bag)) { p.bag = Array.from({ length: p.bag.length }, (_, i) => (m.bag[i] && itemDef(m.bag[i]) ? m.bag[i] : null)); p.compactStacks(); }
    p.gold = Math.max(0, Math.round(Number(m.gold) || 0));
    g.rev = Number(m.rev) || g.rev;
    const got = this.theirs.items.map((it) => `<b style="color:${itemColor(it)}">${itemName(it)}</b>`).join(', ');
    g.ui.log(`Traded: you got ${got || 'no items'}${this.theirs.gold ? ` and ${this.theirs.gold}g` : ''}.`, 'gold');
    g.sfx.play('gold');
    this.close();
    p.onGearChanged();
  }

  closed(m) {
    if (m?.msg) this.game.ui.centerMsg(m.msg);
    this.close();
  }

  close() {
    const ui = this.game.ui;
    this.isOpen = false;
    this.mine = { items: [], gold: 0, ok: false };
    this.theirs = { items: [], gold: 0, ok: false };
    if (ui.invOpen && ui.invMode === 'trade') ui.closeInventory();
    else ui.refreshInventory();
  }
}


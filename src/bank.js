// The bank: what an account keeps for all its heroes (any of them can put things in and take them out, at the
// banker in any camp), and some gold. It lives on the game server with the account (offline, in this browser)
// and is saved along with the hero in play.
import { ITEMS, itemDef, newId } from './items.js';
import { clamp, has } from './util.js';

export const BANK_SIZE = 60;
const LOCAL_KEY = 'emberwood-bank-v1'; // offline play's bank

export class Bank {
  constructor(game) {
    this.game = game;
    this.items = new Array(BANK_SIZE).fill(null);
    this.gold = 0;
  }

  load(b) {
    const valid = (it) => (it && typeof it === 'object' && has(ITEMS, it.k) ? it : null);
    this.items = Array.from({ length: BANK_SIZE }, (_, i) => valid(b?.items?.[i]));
    this.gold = Math.max(0, Math.round(Number(b?.gold) || 0));
  }

  loadLocal() {
    try { this.load(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')); } catch { this.load(null); }
  }

  saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.serialize())); } catch { /* storage unavailable */ }
  }

  serialize() {
    return { items: this.items, gold: this.gold };
  }

  get used() {
    return this.items.filter(Boolean).length;
  }

  // From the bag into the bank (a stackable joins a stack of its kind first).
  store(bagIndex) {
    const g = this.game, p = g.player, it = p.bag[bagIndex], d = itemDef(it);
    if (!it) return;
    let left = it.n || 1;
    if (d.stack) {
      for (const b of this.items) {
        if (!b || b.k !== it.k || b.n >= d.stack) continue;
        const take = Math.min(left, d.stack - b.n);
        b.n += take;
        left -= take;
        if (!left) break;
      }
    }
    if (left > 0) {
      const j = this.items.indexOf(null);
      if (j < 0) {
        if (d.stack && left < (it.n || 1)) it.n = left; // (part of the stack went in)
        else { g.ui.centerMsg('The bank is full'); return; }
        this.changed();
        return;
      }
      this.items[j] = d.stack ? { id: newId(), k: it.k, n: left } : it;
    }
    p.bag[bagIndex] = null;
    this.changed();
  }

  take(i) {
    const g = this.game, p = g.player, it = this.items[i];
    if (!it) return;
    if (itemDef(it).stack) { // (as much of the stack as fits)
      const copy = { ...it };
      if (p.addItem(copy, true)) this.items[i] = null;
      else if (copy.n < it.n) it.n = copy.n;
      else { g.ui.centerMsg('Your bag is full'); return; }
    } else {
      if (!p.addItem(it, true)) { g.ui.centerMsg('Your bag is full'); return; }
      this.items[i] = null;
    }
    this.changed();
  }

  deposit(n) {
    const p = this.game.player;
    n = clamp(Math.floor(n), 0, p.gold);
    if (!n) return;
    p.gold -= n;
    this.gold += n;
    this.changed();
  }

  withdraw(n) {
    const p = this.game.player;
    n = clamp(Math.floor(n), 0, this.gold);
    if (!n) return;
    this.gold -= n;
    p.gold += n;
    this.changed();
  }

  changed() {
    const g = this.game;
    g.sfx.play('equip');
    g.ui.refreshInventory();
    g.save();
  }
}

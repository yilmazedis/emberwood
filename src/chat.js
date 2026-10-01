// World chat: everyone in Emberwood reads it, and heroes nearby also show it in a bubble over their
// heads. Enter (or the Chat button on phones) opens the line, Enter sends, Esc closes. Recent lines
// stay on screen for a while; the whole conversation shows while the line is open.
import { CLASSES } from './classes.js';
import { has } from './util.js';

const KEEP = 60; // lines kept
const SHOW = 6; // lines shown while closed…
const FRESH = 30000; // …if they're newer than this (ms)
const $ = (id) => document.getElementById(id);

export class Chat {
  constructor(game) {
    this.game = game;
    this.box = $('chat');
    this.lines = $('chat-log');
    this.form = $('chat-form');
    this.input = $('chat-input');
    this.online = $('chat-online');
    this.isOpen = false;
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
    $('btn-chat').addEventListener('click', () => this.toggle());
    // phones: tapping the game closes it (the on-screen keyboard goes too)
    document.getElementById('game').addEventListener('pointerdown', () => { if (this.isOpen) this.close(); });
    setInterval(() => this.refresh(), 2000);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.box.classList.add('open');
    this.form.classList.remove('hidden');
    this.game.input.releaseAll(); // keys held when the line opened never "come up" in the game
    this.input.focus();
    this.refresh();
    this.lines.scrollTop = this.lines.scrollHeight;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.box.classList.remove('open');
    this.form.classList.add('hidden');
    this.input.blur();
    this.refresh();
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  async send() {
    const text = this.input.value.trim();
    this.input.value = '';
    this.close();
    if (!text) return;
    try {
      await this.game.net.request('chat', { text });
    } catch (err) {
      this.line({ text: err.message, sys: true });
    }
  }

  // We entered the world: what was said lately, and who's around.
  entered(r) {
    this.lines.textContent = '';
    for (const m of r.chat || []) this.add(m, true);
    this.setOnline(r.online);
  }

  // A message from the server: { i: hero id, n: name, c: class, x: text } or { s: 1, x: text, o: online }
  receive(m) {
    if (m.s) {
      this.line({ text: m.x, sys: true });
      this.setOnline(m.o);
      return;
    }
    this.add(m, false);
    const g = this.game;
    const who = m.i === g.link.pid ? g.player : g.others.byId.get(m.i);
    if (who) g.ui.say(who, String(m.x));
  }

  add(m, old) {
    this.line({ name: String(m.n || '?'), cls: has(CLASSES, m.c) ? m.c : '', text: String(m.x || ''), old, me: m.i === this.game.link.pid });
  }

  setOnline(n) {
    if (Number.isFinite(n)) this.online.textContent = `${n} online`;
  }

  // text only (never HTML): it comes from other players
  line({ name = '', cls = '', text, sys = false, old = false, me = false }) {
    const d = document.createElement('div');
    if (sys) d.className = 'sys';
    if (me) d.className = 'me';
    if (name) {
      const b = document.createElement('b');
      b.className = `c-${cls}`;
      b.textContent = name;
      d.append(b, ' ');
    }
    d.append(text);
    d.dataset.t = old ? 0 : Date.now();
    this.lines.append(d);
    while (this.lines.children.length > KEEP) this.lines.firstChild.remove();
    this.refresh();
    if (this.isOpen) this.lines.scrollTop = this.lines.scrollHeight;
  }

  // Closed: only the last few fresh lines show. Open: all of it.
  refresh() {
    const all = [...this.lines.children], now = Date.now();
    all.forEach((d, i) => d.classList.toggle('stale', !this.isOpen && (i < all.length - SHOW || now - Number(d.dataset.t) > FRESH)));
  }
}

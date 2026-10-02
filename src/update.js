// A new version of the game is out (the site was updated): say so, with a Refresh button. version.json
// changes with every update of the game's code (tools/stamp-version.mjs); the game checks it every few
// minutes, whenever it comes back to the screen, and when the game server says the site changed.
// Refreshing is up to the player (their hero is saved first, and they sign straight back in).
// An update that changes how the game talks to the server can't wait: main.js reloads for that itself.
import { VERSION } from './version.js';

const EVERY = 3 * 60 * 1000;
const SNOOZE = 10 * 60 * 1000; // "Later" hides it this long
const RELOADED = 'emberwood-update-reload';

// Reload for an update the game can't play without; false (and no reload) if we just did that, so a
// stale copy of the game can never send the page round in circles.
export function reloadForUpdate() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED) || 0) < 60000) return false;
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch { /* private mode: reload anyway */ }
  location.reload();
  return true;
}

export class UpdateNotice {
  // beforeReload: async, saves the hero (main.js)
  constructor({ beforeReload } = {}) {
    this.el = document.getElementById('update');
    this.go = document.getElementById('update-go');
    this.beforeReload = beforeReload;
    this.snoozeUntil = 0;
    this.go.addEventListener('click', () => this.reload());
    document.getElementById('update-later').addEventListener('click', () => this.later());
    setInterval(() => this.check(), EVERY);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.check(); });
    setTimeout(() => this.check(), 20000);
  }

  async check() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) this.found((await r.json()).v);
    } catch { /* offline: next time */ }
  }

  // The newest version we heard of (from version.json, or the game server).
  found(v) {
    if (typeof v !== 'string' || !/^\w{6,40}$/.test(v) || v === VERSION) return;
    this.latest = v;
    if (Date.now() >= this.snoozeUntil) this.el.classList.remove('hidden');
  }

  later() {
    this.el.classList.add('hidden');
    this.snoozeUntil = Date.now() + SNOOZE;
  }

  async reload() {
    this.go.disabled = true;
    this.go.textContent = 'Saving…';
    try {
      await Promise.race([this.beforeReload?.(), new Promise((r) => setTimeout(r, 2500))]);
    } catch { /* reload anyway: the game saves every few seconds */ }
    location.reload();
  }
}

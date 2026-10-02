// The connection to the game server: requests with replies, messages the server pushes, and
// reconnecting by itself (signing back in with the saved token) if the line drops mid-game.
import { PROTOCOL } from './sim/world.js';

export { PROTOCOL };
const PRODUCTION = 'wss://gameserver.kerimcaglar.com/ws';
const TOKEN_KEY = 'emberwood-token';

// Local and home-network pages talk to a server on the same machine (port 8787); ?server=… overrides.
export function serverUrl() {
  const forced = new URLSearchParams(location.search).get('server');
  if (forced) return forced;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || /^(192\.168|10)\./.test(h)) return `ws://${h}:8787/ws`;
  return PRODUCTION;
}

export const savedToken = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

export class Net {
  constructor(url = serverUrl()) {
    this.url = url;
    this.ws = null;
    this.rq = 0;
    this.waiting = new Map();
    this.handlers = {};
    this.online = false;
    this.session = null; // { charId } once playing: reconnecting resumes it
    this.retry = 0;
    this.hello = null; // the server's greeting: { v: protocol version, online, world }
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  emit(type, data) {
    this.handlers[type]?.(data);
  }

  // Connect, and greet the server. The host only starts the game server for an ordinary web request
  // (and may stop it after a while without visitors); a WebSocket alone doesn't wake it. So knock on
  // /status alongside the first try, and if that try fails, try again once the server is up.
  async connect() {
    const awake = this.wake();
    try {
      return await this.open(8000);
    } catch {
      if (!(await awake)) throw new Error('The game server is not answering (it may be restarting).');
      return this.open(20000); // awake now: again, with patience for a slow connection
    }
  }

  wake() {
    const url = this.url.replace(/^ws(s?):/, 'http$1:').replace(/\/ws$/, '/status');
    return fetch(url, { cache: 'no-store' }).then((r) => r.ok, () => false);
  }

  open(timeout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => { if (!settled) { settled = true; ws.close(); reject(new Error('The game server did not answer.')); } }, timeout);
      ws.onopen = async () => {
        this.online = true;
        try {
          const hello = await this.request('hello');
          this.hello = hello;
          settled = true;
          clearTimeout(timer);
          resolve(hello);
        } catch (err) { settled = true; clearTimeout(timer); reject(err); }
      };
      ws.onmessage = (e) => { if (this.ws === ws) this.receive(e.data); };
      ws.onclose = () => {
        if (this.ws !== ws) return; // a try we already gave up on
        this.online = false;
        for (const w of this.waiting.values()) w.reject(new Error('Lost the connection to the game server.'));
        this.waiting.clear();
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not reach the game server.')); return; }
        this.lost();
      };
    });
  }

  receive(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'kicked') this.session = null; // signed in elsewhere: don't fight it by reconnecting
    if (m.re && this.waiting.has(m.re)) {
      const w = this.waiting.get(m.re);
      this.waiting.delete(m.re);
      if (m.t === 'error') w.reject(new Error(m.msg)); else w.resolve(m);
      return;
    }
    this.emit(m.t, m);
  }

  request(t, data = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.online) { reject(new Error('Not connected to the game server.')); return; }
      const rq = ++this.rq;
      const timer = setTimeout(() => { this.waiting.delete(rq); reject(new Error('The game server took too long to answer.')); }, timeout);
      this.waiting.set(rq, { resolve: (m) => { clearTimeout(timer); resolve(m); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ t, rq, ...data }));
    });
  }

  send(t, data = {}) {
    if (this.online) this.ws.send(JSON.stringify({ t, ...data }));
  }

  // The line dropped while signed in: keep trying (1 s, 2 s, 4 s … up to 15 s) and pick up where we were.
  async lost() {
    if (!this.session || this.closing || this.reconnecting) return;
    this.reconnecting = true;
    this.emit('connection', { online: false });
    while (this.session && !this.closing) {
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** this.retry++)));
      try {
        const v = (await this.connect()).v;
        if (v > PROTOCOL) { // the game was updated and the server speaks a newer language: main.js saves and reloads
          this.reconnecting = false;
          this.emit('outdated');
          return;
        }
        if (v < PROTOCOL) { this.ws.close(); continue; } // the server is still being updated: keep trying
      } catch { continue; } // still unreachable
      try {
        await this.request('resume', { token: savedToken.get() });
        if (this.session?.charId) await this.request('play', { id: this.session.charId });
        this.retry = 0;
        this.reconnecting = false;
        this.emit('connection', { online: true });
        return;
      } catch (err) {
        if (this.online) { // the server answered but won't take us back (e.g. the session expired)
          this.session = null;
          this.emit('signedOut', { msg: err.message });
        }
      }
    }
    this.reconnecting = false;
  }

  close() {
    this.closing = true;
    this.ws?.close();
  }
}

// Emberwood game server: accounts, characters and the shared world (src/sim/world.js: monsters, other
// heroes) over one WebSocket (/ws), plus a /status page. Messages are JSON objects
// { t: type, rq?: request number, ... }; a reply carries re: that number. The world sends each hero's
// game an update ten times a second ({ t: 'w', ... }), and chat ({ t: 'chat', ... }) as it happens.
import http from 'node:http';
import { attachWebSocket } from './ws.mjs';
import * as store from './store.mjs';
import { hashPassword, checkPassword, makeToken, readToken } from './auth.mjs';
import { CLASSES, MAX_CHARACTERS, NAME_RULE, USER_RULE } from '../src/classes.js';
import { WorldSim, TICK, PROTOCOL } from '../src/sim/world.js';

const PORT = Number(process.env.PORT) || 8787;
const MAX_SAVE = 200 * 1024; // bytes of JSON per character save
const secret = store.loadSecret();
const started = Date.now();

// the game's own site (http too, though the site sends visitors on to https), plus local and
// home-network addresses for testing
const ORIGINS = [/^https?:\/\/emberwood\.kerimcaglar\.com$/, /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/];
const allowOrigin = (o) => ORIGINS.some((r) => r.test(o));

process.on('uncaughtException', (err) => console.error('uncaught', err));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { store.flush(); process.exit(0); });

class Oops extends Error {} // a problem to show the player, not a bug

// ---------------------------------------------------------------- guarding sign-in
const attempts = new Map(); // ip -> recent sign-in attempt times
function throttle(ip) {
  const now = Date.now(), recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60000);
  if (recent.length >= 12) throw new Oops('Too many sign-in attempts. Wait a few minutes and try again.');
  recent.push(now);
  attempts.set(ip, recent);
}
setInterval(() => { const now = Date.now(); for (const [ip, ts] of attempts) if (ts.every((t) => now - t > 10 * 60000)) attempts.delete(ip); }, 60000).unref();

// ---------------------------------------------------------------- sessions
const online = new Map(); // account (lower case) -> connection

const charList = (acc) => acc.characters.map(({ id, name, cls, level }) => ({ id, name, cls, level }));

// ---------------------------------------------------------------- the world
const world = new WorldSim();
const inWorld = new Map(); // hero id in the world (pid) -> connection
let lastPid = 0;
const chatLog = []; // the last things said, for heroes who just arrived

// A line from the world itself (someone came or went), to everyone in it.
function announce(text, except = null) {
  const msg = { t: 'chat', s: 1, x: text, o: inWorld.size };
  for (const c of inWorld.values()) if (c !== except) c.send(msg);
}

function leaveWorld(c, quiet = false) {
  if (!c.pid) return;
  world.leave(c.pid);
  inWorld.delete(c.pid);
  c.pid = null;
  if (!quiet && c.char) announce(`${c.char.name} has left.`);
}

// Ten times a second: the world moves on and every hero's game hears about its surroundings.
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000); // (after a stall, don't jump far ahead)
  lastTick = now;
  world.step(dt, (pid, msg) => inWorld.get(pid)?.send(msg));
}, TICK * 1000);

function signIn(c, acc) {
  const other = online.get(acc.lower);
  if (other && other !== c) { // one place at a time: the older session is closed
    other.send({ t: 'kicked', msg: 'You signed in from somewhere else.' });
    other.acc = null;
    other.close(4001, 'signed in elsewhere');
  }
  leaveWorld(c, true);
  c.acc = acc;
  c.char = null;
  online.set(acc.lower, c);
  acc.lastLogin = Date.now();
  store.markDirty(acc);
  return { t: 'auth', user: acc.user, token: makeToken(secret, acc.lower), chars: charList(acc), world: inWorld.size };
}

function needAccount(c) {
  if (!c.acc) throw new Oops('Please sign in first.');
  return c.acc;
}

function checkSave(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) throw new Oops('Bad save data.');
  if (JSON.stringify(save).length > MAX_SAVE) throw new Oops('Save data too large.');
  if (!Number.isInteger(save.level) || save.level < 1 || save.level > 99) throw new Oops('Bad save data.');
  return save;
}

// ---------------------------------------------------------------- messages
const handlers = {
  hello: () => ({ t: 'hello', v: PROTOCOL, online: online.size, world: inWorld.size }),

  async register(c, m) {
    throttle(c.ip);
    const user = String(m.user || '').trim(), pass = String(m.pass || '');
    if (!USER_RULE.test(user)) throw new Oops('Usernames are 3–16 letters, numbers or _.');
    if (pass.length < 6 || pass.length > 72) throw new Oops('Passwords need at least 6 characters.');
    if (store.getAccount(user)) throw new Oops('That username is taken.');
    const acc = store.createAccount(user, await hashPassword(pass));
    console.log(`new account ${user} from ${c.ip}`);
    return c.open ? signIn(c, acc) : null;
  },

  async login(c, m) {
    throttle(c.ip);
    const acc = store.getAccount(String(m.user || '').trim());
    if (!acc || !(await checkPassword(String(m.pass || ''), acc.salt, acc.hash))) throw new Oops('Wrong username or password.');
    return c.open ? signIn(c, acc) : null;
  },

  resume(c, m) {
    const lower = readToken(secret, m.token);
    const acc = lower && store.getAccount(lower);
    if (!acc) throw new Oops('Your session ran out. Please sign in again.');
    return signIn(c, acc);
  },

  chars(c) {
    return { t: 'chars', chars: charList(needAccount(c)), world: inWorld.size };
  },

  createChar(c, m) {
    const acc = needAccount(c);
    const name = String(m.name || '').trim(), cls = String(m.cls || '');
    if (!CLASSES[cls]) throw new Oops('Pick a class.');
    if (!NAME_RULE.test(name)) throw new Oops('Names are 3–14 letters, no spaces or numbers.');
    if (acc.characters.length >= MAX_CHARACTERS) throw new Oops(`You can have up to ${MAX_CHARACTERS} characters.`);
    if (store.nameTaken(name)) throw new Oops('Someone already has that name.');
    const save = m.save ? checkSave(m.save) : null;
    const ch = store.addCharacter(acc, { name, cls, save });
    console.log(`${acc.user} created ${cls} ${name}`);
    return { t: 'chars', chars: charList(acc), created: ch.id };
  },

  deleteChar(c, m) {
    const acc = needAccount(c);
    if (c.char && c.char.id === m.id) c.char = null;
    if (!store.removeCharacter(acc, String(m.id))) throw new Oops('No such character.');
    return { t: 'chars', chars: charList(acc) };
  },

  play(c, m) {
    const acc = needAccount(c);
    const ch = acc.characters.find((x) => x.id === m.id);
    if (!ch) throw new Oops('No such character.');
    leaveWorld(c);
    c.char = ch;
    return { t: 'char', char: { id: ch.id, name: ch.name, cls: ch.cls, save: ch.save } };
  },

  save(c, m) {
    const acc = needAccount(c);
    if (!c.char) throw new Oops('No character in play.');
    store.saveCharacter(acc, c.char.id, checkSave(m.save));
    return null;
  },

  // The hero steps into the world (its game sends where it stands and how it looks).
  enter(c, m) {
    needAccount(c);
    if (!c.char) throw new Oops('Pick a hero first.');
    leaveWorld(c, true);
    c.pid = ++lastPid;
    world.join(c.pid, { name: c.char.name, cls: c.char.cls, p: m.p, k: m.k });
    inWorld.set(c.pid, c);
    announce(`${c.char.name} has entered Emberwood.`, c);
    return { t: 'entered', pid: c.pid, chat: chatLog.slice(-20), online: inWorld.size };
  },

  // Where our hero is, what it hit and did (see WorldSim.input); no reply, the world's updates are it.
  u(c, m) {
    if (c.pid) world.input(c.pid, m);
    return null;
  },

  exit(c) {
    leaveWorld(c);
    return { t: 'exited' };
  },

  chat(c, m) {
    if (!c.pid) throw new Oops('Step into the world to chat.');
    const text = String(m.text || '').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!text) return null;
    const now = Date.now();
    c.said = (c.said || []).filter((t) => now - t < 10000);
    if (c.said.length >= 6) throw new Oops('Slow down a little.');
    c.said.push(now);
    const msg = { t: 'chat', i: c.pid, n: c.char.name, c: c.char.cls, x: text, ts: now };
    chatLog.push(msg);
    if (chatLog.length > 50) chatLog.shift();
    for (const o of inWorld.values()) o.send(msg);
    return { t: 'said' };
  },

  logout(c) {
    leaveWorld(c);
    if (c.acc && online.get(c.acc.lower) === c) online.delete(c.acc.lower);
    c.acc = null;
    c.char = null;
    return { t: 'loggedOut' };
  },
};

const OPEN_TO_ALL = new Set(['hello', 'register', 'login', 'resume']);

async function handle(c, text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m.t !== 'string' || !Object.hasOwn(handlers, m.t)) return;
  // a little flood protection: at most 60 messages a second (the game sends up to 20)
  const now = Date.now();
  if (now - c.windowStart > 1000) { c.windowStart = now; c.count = 0; }
  if (++c.count > 60) return;
  try {
    if (!OPEN_TO_ALL.has(m.t) && !c.acc) throw new Oops('Please sign in first.');
    const reply = await handlers[m.t](c, m);
    if (reply && m.rq) c.send({ ...reply, re: m.rq });
  } catch (err) {
    if (!(err instanceof Oops)) console.error(`error in ${m.t}`, err);
    if (m.rq) c.send({ t: 'error', re: m.rq, msg: err instanceof Oops ? err.message : 'Something went wrong on the server.' });
  }
}

// ---------------------------------------------------------------- servers
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/status' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, game: 'Emberwood', protocol: PROTOCOL, online: online.size, world: inWorld.size, uptimeS: Math.round((Date.now() - started) / 1000) }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

const sockets = attachWebSocket(server, {
  path: '/ws',
  maxMessage: MAX_SAVE + 4096,
  allowOrigin,
  onConnection(c) {
    c.acc = null;
    c.char = null;
    c.pid = null;
    c.windowStart = 0;
    c.count = 0;
    c.onmessage = (text) => handle(c, text);
    c.onclose = () => {
      leaveWorld(c);
      if (c.acc && online.get(c.acc.lower) === c) online.delete(c.acc.lower);
    };
  },
});

// ---------------------------------------------------------------- staying awake
// The host (LiteSpeed) starts this app for an ordinary web request and stops it when it hasn't seen
// one for a while; WebSocket traffic may not count, and a WebSocket alone can't wake it. So while
// anyone is connected, knock on our own front door (through the host, like a visitor) every few
// minutes. The address comes from the requests the host passes on (its Host header).
let selfUrl = null;
function learnAddress(req) {
  const host = String(req.headers.host || '');
  if (!selfUrl && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) selfUrl = `https://${host}/status`; // (not localhost)
}
server.on('request', learnAddress);
server.on('upgrade', learnAddress);
setInterval(() => {
  if (selfUrl && sockets.size) fetch(selfUrl, { cache: 'no-store' }).catch(() => { /* the next one */ });
}, 4 * 60000).unref();

server.listen(PORT, () => console.log(`Emberwood server on port ${PORT}, data in ${store.DATA_DIR}`));

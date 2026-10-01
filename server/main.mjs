// Emberwood game server: accounts and characters over one WebSocket (/ws), plus a /status page.
// Messages are JSON objects { t: type, rq?: request number, ... }; a reply carries re: that number.
import http from 'node:http';
import { attachWebSocket } from './ws.mjs';
import * as store from './store.mjs';
import { hashPassword, checkPassword, makeToken, readToken } from './auth.mjs';
import { CLASSES, MAX_CHARACTERS, NAME_RULE, USER_RULE } from '../src/classes.js';

const PORT = Number(process.env.PORT) || 8787;
const PROTOCOL = 1;
const MAX_SAVE = 200 * 1024; // bytes of JSON per character save
const secret = store.loadSecret();
const started = Date.now();

// the game's own site, plus local and home-network addresses for testing
const ORIGINS = [/^https:\/\/emberwood\.kerimcaglar\.com$/, /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/];
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

function signIn(c, acc) {
  const other = online.get(acc.lower);
  if (other && other !== c) { // one place at a time: the older session is closed
    other.send({ t: 'kicked', msg: 'You signed in from somewhere else.' });
    other.acc = null;
    other.close(4001, 'signed in elsewhere');
  }
  c.acc = acc;
  c.char = null;
  online.set(acc.lower, c);
  acc.lastLogin = Date.now();
  store.markDirty(acc);
  return { t: 'auth', user: acc.user, token: makeToken(secret, acc.lower), chars: charList(acc) };
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
  hello: () => ({ t: 'hello', v: PROTOCOL, online: online.size }),

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
    return { t: 'chars', chars: charList(needAccount(c)) };
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
    c.char = ch;
    return { t: 'char', char: { id: ch.id, name: ch.name, cls: ch.cls, save: ch.save } };
  },

  save(c, m) {
    const acc = needAccount(c);
    if (!c.char) throw new Oops('No character in play.');
    store.saveCharacter(acc, c.char.id, checkSave(m.save));
    return null;
  },

  logout(c) {
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
  // a little flood protection: at most 40 messages a second
  const now = Date.now();
  if (now - c.windowStart > 1000) { c.windowStart = now; c.count = 0; }
  if (++c.count > 40) return;
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
    res.end(JSON.stringify({ ok: true, game: 'Emberwood', protocol: PROTOCOL, online: online.size, uptimeS: Math.round((Date.now() - started) / 1000) }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

attachWebSocket(server, {
  path: '/ws',
  maxMessage: MAX_SAVE + 4096,
  allowOrigin,
  onConnection(c) {
    c.acc = null;
    c.char = null;
    c.windowStart = 0;
    c.count = 0;
    c.onmessage = (text) => handle(c, text);
    c.onclose = () => {
      if (c.acc && online.get(c.acc.lower) === c) online.delete(c.acc.lower);
    };
  },
});

server.listen(PORT, () => console.log(`Emberwood server on port ${PORT}, data in ${store.DATA_DIR}`));

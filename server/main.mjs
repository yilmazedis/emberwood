// Emberwood game server: accounts, characters, the shared world (src/sim/world.js: monsters, other
// heroes, every place in maps.js) and parties over one WebSocket (/ws), plus a /status page. Messages are JSON objects
// { t: type, rq?: request number, ... }; a reply carries re: that number. The world sends each hero's
// game an update ten times a second ({ t: 'w', ... }), and chat ({ t: 'chat', ... }) as it happens.
import http from 'node:http';
import fs from 'node:fs';
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
const heroes = new Map(); // character id -> the connection playing it

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
  if (c.char) partyChanged(c.char.id);
}

// No longer playing this hero (another one, signed out, or gone): its party keeps a place for it a while.
function dropHero(c) {
  const id = c.char?.id;
  if (!id || heroes.get(id) !== c) return;
  heroes.delete(id);
  const party = partyOf(id);
  if (party) { party.members.get(id).gone = Date.now(); sendParty(party); }
}

// ---------------------------------------------------------------- parties
// Up to 8 heroes, led by the one who invited the first. Members share the XP and loot of kills near
// them (WorldSim.credits) and one copy of each dungeon, and have their own chat. Parties live only on
// the server (a restart ends them); a member who drops out keeps their place for a few minutes.
const MAX_PARTY = 8;
const GONE_FOR = 5 * 60000;
const INVITE_FOR = 60000;
const parties = new Map(); // id -> { id, leader: character id, members: Map(character id -> { name, cls, level, gone }) }
const memberOf = new Map(); // character id -> party id
const invites = new Map(); // invited character id -> { from: character id, party, at }
let lastParty = 0;
const partyOf = (id) => parties.get(memberOf.get(id)) || null;

// What the members' games show: who's in it, their level, life, where they are, and who leads.
function partyView(party) {
  return {
    t: 'party', id: party.id, leader: party.leader,
    members: [...party.members.entries()].map(([id, m]) => {
      const c = heroes.get(id), p = c?.pid ? world.players.get(c.pid) : null;
      return { id, n: m.name, c: m.cls, l: p?.level || m.level, i: c?.pid || 0, m: p?.area?.map.id || null, h: p ? Math.round(p.hp * 100) / 100 : 0, a: p?.alive ? 1 : 0, on: c ? 1 : 0 };
    }),
  };
}

function sendParty(party) {
  const msg = partyView(party), text = JSON.stringify(msg);
  party.sent = text;
  for (const id of party.members.keys()) heroes.get(id)?.send(msg);
}

// (a member's hero entered or left the world: its place in the world now follows the party)
function partyChanged(id) {
  const party = partyOf(id), c = heroes.get(id);
  if (c?.pid) world.setParty(c.pid, party ? party.id : 0);
  if (party) sendParty(party);
}

function partySay(party, text) {
  const msg = { t: 'chat', s: 1, p: 1, x: text };
  for (const id of party.members.keys()) heroes.get(id)?.send(msg);
}

function leaveParty(id, why = 'left') {
  const party = partyOf(id);
  if (!party) return;
  const m = party.members.get(id);
  party.members.delete(id);
  memberOf.delete(id);
  const c = heroes.get(id);
  c?.send({ t: 'party', id: 0, members: [] });
  if (c?.pid) world.setParty(c.pid, 0);
  partySay(party, `${m.name} ${why === 'kicked' ? 'was removed from' : why === 'gone' ? 'dropped out of' : 'left'} the party.`);
  if (party.members.size < 2) return disband(party);
  if (party.leader === id) party.leader = [...party.members.keys()].find((k) => heroes.has(k)) || [...party.members.keys()][0];
  sendParty(party);
}

function disband(party) {
  for (const id of party.members.keys()) {
    memberOf.delete(id);
    const c = heroes.get(id);
    c?.send({ t: 'party', id: 0, members: [] });
    if (c?.pid) world.setParty(c.pid, 0);
  }
  parties.delete(party.id);
}

// Every second: life and whereabouts (only when something changed); and those gone too long leave.
setInterval(() => {
  const now = Date.now();
  for (const party of [...parties.values()]) {
    for (const [id, m] of [...party.members]) if (!heroes.has(id) && now - (m.gone || now) > GONE_FOR) leaveParty(id, 'gone');
    if (!parties.has(party.id)) continue;
    if (JSON.stringify(partyView(party)) !== party.sent) sendParty(party);
  }
  for (const [id, inv] of invites) if (now - inv.at > INVITE_FOR) invites.delete(id);
}, 1000).unref();

function findHero(name) {
  const lower = String(name || '').trim().toLowerCase();
  for (const c of heroes.values()) if (c.char?.name.toLowerCase() === lower) return c;
  return null;
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
    const id = String(m.id);
    if (acc.characters.some((x) => x.id === id)) leaveParty(id);
    if (c.char && c.char.id === m.id) { leaveWorld(c, true); dropHero(c); c.char = null; }
    if (!store.removeCharacter(acc, String(m.id))) throw new Oops('No such character.');
    return { t: 'chars', chars: charList(acc) };
  },

  play(c, m) {
    const acc = needAccount(c);
    const ch = acc.characters.find((x) => x.id === m.id);
    if (!ch) throw new Oops('No such character.');
    leaveWorld(c);
    dropHero(c);
    c.char = ch;
    const before = heroes.get(ch.id);
    if (before && before !== c) before.char = null; // (an older connection of the same account)
    heroes.set(ch.id, c);
    const party = partyOf(ch.id);
    if (party) {
      const mem = party.members.get(ch.id);
      mem.gone = 0;
      mem.level = ch.level;
    }
    return { t: 'char', char: { id: ch.id, name: ch.name, cls: ch.cls, save: ch.save } };
  },

  save(c, m) {
    const acc = needAccount(c);
    if (!c.char) throw new Oops('No character in play.');
    store.saveCharacter(acc, c.char.id, checkSave(m.save));
    return { t: 'saved' }; // (only sent when the game asked for an answer: before a reload)
  },

  // The hero steps into the world (its game sends where it stands, in which place, and how it looks).
  enter(c, m) {
    needAccount(c);
    if (!c.char) throw new Oops('Pick a hero first.');
    leaveWorld(c, true);
    c.pid = ++lastPid;
    const party = partyOf(c.char.id); // (given to join: a dungeon it's in is the party's)
    const where = world.join(c.pid, { name: c.char.name, cls: c.char.cls, key: c.char.id, party: party?.id || 0, map: String(m.map || ''), p: m.p, k: m.k });
    inWorld.set(c.pid, c);
    announce(`${c.char.name} has entered Emberwood.`, c);
    if (party) setTimeout(() => partyChanged(c.char?.id), 0); // (after the reply: its game knows its pid)
    return { t: 'entered', pid: c.pid, chat: chatLog.slice(-20), online: inWorld.size, ...where };
  },

  // ---- parties
  // Invite a hero (by name) into our party; a new party is made when they say yes.
  partyInvite(c, m) {
    if (!c.pid) throw new Oops('Step into the world first.');
    const them = findHero(m.name);
    if (!them?.pid) throw new Oops(`Nobody called ${String(m.name || '').slice(0, 20)} is in the world.`);
    if (them === c) throw new Oops('You are always in your own party.');
    const mine = partyOf(c.char.id);
    if (mine && mine.leader !== c.char.id) throw new Oops('Only the party leader can invite.');
    if (mine && mine.members.size >= MAX_PARTY) throw new Oops(`A party has at most ${MAX_PARTY} heroes.`);
    if (partyOf(them.char.id)) throw new Oops(`${them.char.name} is already in a party.`);
    invites.set(them.char.id, { from: c.char.id, at: Date.now() });
    const p = world.players.get(c.pid);
    them.send({ t: 'partyInvite', from: c.char.name, c: c.char.cls, l: p?.level || 1 });
    return { t: 'invited', name: them.char.name };
  },

  partyAnswer(c, m) {
    if (!c.char) throw new Oops('Pick a hero first.');
    const inv = invites.get(c.char.id);
    invites.delete(c.char.id);
    if (!inv || Date.now() - inv.at > INVITE_FOR) throw new Oops('That invitation ran out.');
    const host = heroes.get(inv.from);
    if (!m.yes) {
      host?.send({ t: 'chat', s: 1, p: 1, x: `${c.char.name} said no to your party.` });
      return { t: 'answered' };
    }
    if (!host) throw new Oops('They are not in the world any more.');
    if (partyOf(c.char.id)) throw new Oops('You are already in a party.');
    let party = partyOf(inv.from);
    if (!party) {
      party = { id: ++lastParty, leader: inv.from, members: new Map(), sent: '' };
      parties.set(party.id, party);
      party.members.set(inv.from, { name: host.char.name, cls: host.char.cls, level: host.char.level || 1, gone: 0 });
      memberOf.set(inv.from, party.id);
      partyChanged(inv.from);
    }
    if (party.members.size >= MAX_PARTY) throw new Oops('That party is full.');
    party.members.set(c.char.id, { name: c.char.name, cls: c.char.cls, level: c.char.level || 1, gone: 0 });
    memberOf.set(c.char.id, party.id);
    partySay(party, `${c.char.name} joined the party.`);
    partyChanged(c.char.id);
    return { t: 'answered' };
  },

  partyLeave(c) {
    if (c.char) leaveParty(c.char.id);
    return { t: 'left' };
  },

  partyKick(c, m) {
    const party = c.char && partyOf(c.char.id);
    if (!party || party.leader !== c.char.id) throw new Oops('Only the party leader can do that.');
    const id = String(m.id || '');
    if (!party.members.has(id) || id === c.char.id) throw new Oops('They are not in your party.');
    leaveParty(id, 'kicked');
    return { t: 'kicked' };
  },

  partyLead(c, m) {
    const party = c.char && partyOf(c.char.id);
    if (!party || party.leader !== c.char.id) throw new Oops('Only the party leader can do that.');
    const id = String(m.id || '');
    if (!party.members.has(id)) throw new Oops('They are not in your party.');
    party.leader = id;
    partySay(party, `${party.members.get(id).name} leads the party now.`);
    sendParty(party);
    return { t: 'led' };
  },

  // Through a waystone, a dungeon's door or its stairs (or, fallen, back to where heroes rise).
  travel(c, m) {
    if (!c.pid) throw new Oops('Step into the world first.');
    const r = world.travel(c.pid, String(m.to || ''), { respawn: !!m.respawn });
    if (r.error) throw new Oops(r.error);
    return { t: 'traveled', ...r };
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

  // to: 'party' for the party's own channel
  chat(c, m) {
    if (!c.pid) throw new Oops('Step into the world to chat.');
    const text = String(m.text || '').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!text) return null;
    const now = Date.now();
    c.said = (c.said || []).filter((t) => now - t < 10000);
    if (c.said.length >= 6) throw new Oops('Slow down a little.');
    c.said.push(now);
    if (m.to === 'party') {
      const party = partyOf(c.char.id);
      if (!party) throw new Oops('You are not in a party.');
      const msg = { t: 'chat', i: c.pid, n: c.char.name, c: c.char.cls, x: text, ts: now, p: 1 };
      for (const id of party.members.keys()) heroes.get(id)?.send(msg);
      return { t: 'said' };
    }
    const msg = { t: 'chat', i: c.pid, n: c.char.name, c: c.char.cls, x: text, ts: now };
    chatLog.push(msg);
    if (chatLog.length > 50) chatLog.shift();
    for (const o of inWorld.values()) o.send(msg);
    return { t: 'said' };
  },

  logout(c) {
    leaveWorld(c);
    dropHero(c);
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
    res.end(JSON.stringify({ ok: true, game: 'Emberwood', protocol: PROTOCOL, version: siteVersion, online: online.size, world: inWorld.size, uptimeS: Math.round((Date.now() - started) / 1000) }));
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
      dropHero(c);
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

// ---------------------------------------------------------------- the website was updated
// The site and this server share a folder: a `git pull` changes version.json (tools/stamp-version.mjs),
// and every open game is told at once, so it can offer a Refresh.
const VERSION_FILE = new URL('../version.json', import.meta.url);
const readVersion = () => { try { return String(JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).v || ''); } catch { return ''; } };
let siteVersion = readVersion();
setInterval(() => {
  const v = readVersion();
  if (!v || v === siteVersion) return;
  siteVersion = v;
  console.log(`site updated to ${v}`);
  for (const c of sockets) if (c.open) c.send({ t: 'update', v });
}, 30000).unref();

server.listen(PORT, () => console.log(`Emberwood server on port ${PORT}, data in ${store.DATA_DIR}`));

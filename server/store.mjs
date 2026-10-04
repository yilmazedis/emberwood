// Accounts and their characters on disk: one JSON file per account, written atomically (a temp file,
// then a rename), so a crash never leaves half a file. Lives outside the website folder:
// $EMBERWOOD_DATA, or ~/emberwood-data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { OLD_CLASSES } from '../src/classes.js';

export const DATA_DIR = process.env.EMBERWOOD_DATA || path.join(os.homedir(), 'emberwood-data');
const ACCOUNTS = path.join(DATA_DIR, 'accounts');
const NAMES = path.join(DATA_DIR, 'names.json');
fs.mkdirSync(ACCOUNTS, { recursive: true, mode: 0o700 });

function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// The key that signs session tokens; made once, kept with the data.
export function loadSecret() {
  const file = path.join(DATA_DIR, 'secret.key');
  let s = '';
  try { s = fs.readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
  }
  return s;
}

const accounts = new Map(); // lower-case name -> account
const dirty = new Set();
const names = readJSON(NAMES, {}); // lower-case character name -> lower-case account name
const fileOf = (lower) => path.join(ACCOUNTS, `${lower}.json`);

export function getAccount(user) {
  const lower = String(user).toLowerCase();
  if (accounts.has(lower)) return accounts.get(lower);
  const acc = readJSON(fileOf(lower), null);
  if (acc) { migrate(acc); accounts.set(lower, acc); }
  return acc;
}

// Heroes made before the four classes become one of them (their game converts their save when they next
// play), and every account gets a bank.
function migrate(acc) {
  let changed = false;
  for (const ch of acc.characters) {
    const was = OLD_CLASSES[ch.cls];
    if (!was) continue;
    ch.cls = was[0];
    ch.look = was[1];
    changed = true;
  }
  if (!acc.bank) { acc.bank = { items: [], gold: 0 }; changed = true; }
  if (changed) dirty.add(acc.lower);
}

export function createAccount(user, { salt, hash }) {
  const lower = user.toLowerCase();
  const acc = { user, lower, salt, hash, created: Date.now(), lastLogin: 0, characters: [], bank: { items: [], gold: 0 } };
  accounts.set(lower, acc);
  writeJSON(fileOf(lower), acc);
  return acc;
}

export function markDirty(acc) {
  dirty.add(acc.lower);
}

export function flush() {
  for (const lower of dirty) {
    const acc = accounts.get(lower);
    if (acc) writeJSON(fileOf(lower), acc);
  }
  dirty.clear();
  if (arenaDirty) { arenaDirty = false; writeJSON(ARENA, arena); }
}
setInterval(flush, 5000).unref();

// ---------------------------------------------------------------- characters
export const nameTaken = (name) => Object.hasOwn(names, name.toLowerCase());

export function addCharacter(acc, { name, cls, look = 0, save = null }) {
  const ch = { id: crypto.randomBytes(4).toString('hex'), name, cls, look, created: Date.now(), level: save?.level || 1, save, rev: 0 };
  acc.characters.push(ch);
  names[name.toLowerCase()] = acc.lower;
  writeJSON(NAMES, names);
  writeJSON(fileOf(acc.lower), acc);
  return ch;
}

export function removeCharacter(acc, id) {
  const i = acc.characters.findIndex((c) => c.id === id);
  if (i < 0) return false;
  const [ch] = acc.characters.splice(i, 1);
  delete names[ch.name.toLowerCase()];
  writeJSON(NAMES, names);
  writeJSON(fileOf(acc.lower), acc);
  return true;
}

// ---------------------------------------------------------------- the arena's champions
// Fights won and lost in the arena, by character: { id: { n: name, c: class, l: level, k: won, d: lost } }.
const ARENA = path.join(DATA_DIR, 'arena.json');
const arena = readJSON(ARENA, {});
let arenaDirty = false;
setInterval(() => { if (arenaDirty) { arenaDirty = false; writeJSON(ARENA, arena); } }, 5000).unref();

export function arenaResult(winner, loser) {
  for (const [ch, key] of [[winner, 'k'], [loser, 'd']]) {
    const e = arena[ch.id] || (arena[ch.id] = { n: ch.name, c: ch.cls, l: 1, k: 0, d: 0 });
    Object.assign(e, { n: ch.name, c: ch.cls, l: ch.level || e.l });
    e[key]++;
  }
  arenaDirty = true;
}

export function arenaTop(n = 10) {
  return Object.values(arena).filter((e) => e.k > 0).sort((a, b) => b.k - a.k || a.d - b.d).slice(0, n);
}

export const arenaOf = (id) => arena[id] || null;

export function forgetArena(id) {
  if (arena[id]) { delete arena[id]; arenaDirty = true; }
}

export function saveCharacter(acc, id, save) {
  const ch = acc.characters.find((c) => c.id === id);
  if (!ch) return false;
  ch.save = save;
  ch.level = save.level || ch.level;
  ch.saved = Date.now();
  markDirty(acc);
  return true;
}

// The account's bank, as its game last saved it (any of its heroes).
export function saveBank(acc, bank) {
  acc.bank = bank;
  markDirty(acc);
}

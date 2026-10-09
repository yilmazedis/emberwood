// The accounts on this game server, from its terminal (the game itself has no "forgot my password"):
//   node server/accounts.mjs                    every account: its heroes and when it last signed in
//   node server/accounts.mjs password <name>    a new password for an account (typed twice, not shown)
//   node server/accounts.mjs create <name>      a new account (its password typed twice, not shown)
//   node server/accounts.mjs hero <account> <Name> <class> [level]
//                                               a new hero there (warrior, scientist, rogue or healer) at that
//                                               level (1–80), in its class's best gear for it, upgraded, with
//                                               potions, scrolls and gold; its points all free to spend
// After any change, press Restart for the Node.js app, so the server reads the files afresh.
// It reads and writes the same data folder as the game server ($EMBERWOOD_DATA, or ~/emberwood-data). After a
// new password, press Restart for the Node.js app, so the server reads the account afresh. (A game still
// signed in to that account keeps saving it: close it first, or the server may write the old password back.)
// Passwords are kept only as scrypt hashes: nobody can read one back, only set a new one.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { hashPassword } from './auth.mjs';
import { CLASSES, MAX_CHARACTERS, NAME_RULE, USER_RULE } from '../src/classes.js';
import { ITEMS, SLOTS, emptyEquipment, makeItem, maxPlus, tierAt } from '../src/items.js';

const DATA_DIR = process.env.EMBERWOOD_DATA || path.join(os.homedir(), 'emberwood-data');
const ACCOUNTS = path.join(DATA_DIR, 'accounts');
const fileOf = (lower) => path.join(ACCOUNTS, `${lower}.json`);
const NAMES = path.join(DATA_DIR, 'names.json');
function writeJSON(file, data) { // (written whole, then swapped in, like the server does)
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const readJSON = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const when = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : 'never');

function list() {
  if (!fs.existsSync(ACCOUNTS)) { console.log(`No accounts in ${DATA_DIR} (is EMBERWOOD_DATA set for the game server?)`); return; }
  const accs = fs.readdirSync(ACCOUNTS).filter((f) => f.endsWith('.json')).map((f) => readJSON(path.join(ACCOUNTS, f))).filter(Boolean);
  accs.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
  console.log(`${accs.length} accounts in ${DATA_DIR} (last signed in first):\n`);
  for (const a of accs) {
    const heroes = (a.characters || []).map((c) => `${c.name} (${c.cls} ${c.level || 1})`).join(', ') || 'no heroes';
    console.log(`  ${a.user.padEnd(18)} last sign-in ${when(a.lastLogin)}   ${heroes}`);
  }
}

// Lines typed without showing them (one reader for all the questions: a pasted answer may hold both lines).
function asker() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const lines = [], waiting = [];
  let prompt = '';
  rl._writeToOutput = (s) => { if (s.startsWith(prompt)) rl.output.write(prompt); }; // (the prompt, not what's typed)
  rl.on('line', (l) => { if (waiting.length) waiting.shift()(l); else lines.push(l); });
  rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
  return {
    ask: (q) => { prompt = q; rl.output.write(q); return new Promise((resolve) => { if (lines.length) resolve(lines.shift()); else waiting.push(resolve); }).then((a) => { rl.output.write('\n'); return a; }); },
    close: () => rl.close(),
  };
}

async function setPassword(name) {
  const lower = String(name || '').trim().toLowerCase(), file = fileOf(lower);
  const acc = readJSON(file);
  if (!acc) { console.log(`No account called "${name}" in ${ACCOUNTS}. Run without arguments to see them all.`); process.exitCode = 1; return; }
  const q = asker(), pass = await q.ask(`New password for ${acc.user}: `);
  if (pass.length < 6 || pass.length > 72) { q.close(); console.log('Passwords need 6 to 72 characters. Nothing changed.'); process.exitCode = 1; return; }
  const again = await q.ask('The same again: ');
  q.close();
  if (again !== pass) { console.log('They differ. Nothing changed.'); process.exitCode = 1; return; }
  Object.assign(acc, await hashPassword(pass));
  writeJSON(file, acc);
  console.log(`Done: ${acc.user} has a new password. Now press Restart for the Node.js app, then sign in.`);
}

async function create(name) {
  const user = String(name || '').trim(), lower = user.toLowerCase();
  if (!USER_RULE.test(user)) { console.log('Account names are 3–16 letters, numbers or _.'); process.exitCode = 1; return; }
  if (fs.existsSync(fileOf(lower))) { console.log(`There is already an account called ${user}.`); process.exitCode = 1; return; }
  const q = asker(), pass = await q.ask(`Password for ${user}: `);
  if (pass.length < 6 || pass.length > 72) { q.close(); console.log('Passwords need 6 to 72 characters. Nothing made.'); process.exitCode = 1; return; }
  const again = await q.ask('The same again: ');
  q.close();
  if (again !== pass) { console.log('They differ. Nothing made.'); process.exitCode = 1; return; }
  fs.mkdirSync(ACCOUNTS, { recursive: true, mode: 0o700 });
  writeJSON(fileOf(lower), { user, lower, ...(await hashPassword(pass)), created: Date.now(), lastLogin: 0, characters: [], bank: { items: [], gold: 0 } });
  console.log(`Done: the account ${user} is made. Now press Restart for the Node.js app, then sign in.`);
}

// A hero ready to play at `level`: the best weapon(s) and clothes of its class for it (+5, the weapon +7),
// accessories of its class of items, potions, camp scrolls and gold. Skill and attribute points all free.
function heroSave(cls, level) {
  const c = CLASSES[cls], eq = emptyEquipment();
  const best = (pred) => Object.values(ITEMS).filter((d) => !d.unique && !d.stack && d.level <= level && d.classes?.includes(cls) && pred(d)).sort((a, b) => b.level - a.level)[0];
  for (const key of c.start) {
    const first = ITEMS[key];
    const d = best((x) => x.kind === first.kind && (x.kind === 'armor' ? true : x.type === first.type)) || first;
    if (d.kind === 'armor') { for (const slot of ['head', 'body', 'hands', 'feet']) eq[slot] = makeItem(`${d.set}_${slot}`, { p: 5 }); continue; }
    eq[d.slot === 'weapon' && eq.weapon ? 'offhand' : d.slot] = makeItem(d.key, { p: Math.min(maxPlus(d), d.kind === 'weapon' ? 7 : 5) });
  }
  if (level >= 6) {
    const t = tierAt(level), want = { warrior: [0, 0, 0, 0, 0], scientist: [1, 1, 1, 1, 1], rogue: [1, 1, 0, 0, 1], healer: [0, 1, 1, 1, 0] }[cls];
    [['ring1', 'ring'], ['ring2', 'ring'], ['ear1', 'ear'], ['ear2', 'ear'], ['neck', 'neck'], ['belt', 'belt']].forEach(([slot, kind], i) => {
      const key = `${t}_${kind}_${want[Math.min(i, 4)]}`;
      if (ITEMS[key]?.level <= level) eq[slot] = makeItem(key, { p: 5 });
    });
  }
  const g = level >= 35 ? 3 : level >= 15 ? 2 : 1, bag = new Array(30).fill(null);
  [makeItem(`hp_potion_${g}`, { n: 60 }), makeItem(`mp_potion_${g}`, { n: 40 }), makeItem('camp_scroll', { n: 10 })].forEach((it, i) => { bag[i] = it; });
  return { v: 2, level, xp: 0, gold: Math.round(500 + level * level * 4), bag, equipment: Object.fromEntries(SLOTS.map((s) => [s, eq[s] || null])), quests: { done: [], active: [] }, sk: { pts: {}, bar: [] }, cave: { day: 0 }, buffs: {} };
}

function hero(account, name, cls, lvl) {
  const acc = readJSON(fileOf(String(account || '').toLowerCase()));
  if (!acc) { console.log(`No account called "${account}". Run without arguments to see them all.`); process.exitCode = 1; return; }
  name = String(name || '').trim();
  if (!NAME_RULE.test(name)) { console.log('Hero names are 3–14 letters, no spaces or numbers.'); process.exitCode = 1; return; }
  if (!Object.hasOwn(CLASSES, cls)) { console.log(`The class is one of: ${Object.keys(CLASSES).join(', ')}.`); process.exitCode = 1; return; }
  const level = Math.max(1, Math.min(80, Math.round(Number(lvl) || 1)));
  const names = readJSON(NAMES) || {};
  if (Object.hasOwn(names, name.toLowerCase())) { console.log(`Someone already has the name ${name}.`); process.exitCode = 1; return; }
  if (acc.characters.length >= MAX_CHARACTERS) { console.log(`${acc.user} has ${MAX_CHARACTERS} heroes already.`); process.exitCode = 1; return; }
  const save = heroSave(cls, level);
  acc.characters.push({ id: crypto.randomBytes(4).toString('hex'), name, cls, look: 0, created: Date.now(), level, save, rev: 0 });
  names[name.toLowerCase()] = acc.lower;
  writeJSON(fileOf(acc.lower), acc);
  writeJSON(NAMES, names);
  const worn = Object.values(save.equipment).filter(Boolean).map((it) => `+${it.p} ${ITEMS[it.k].name}`).join(', ');
  console.log(`Done: ${name}, a level ${level} ${CLASSES[cls].name}, is in ${acc.user}'s heroes, wearing ${worn}. Now press Restart for the Node.js app.`);
}

const [cmd, arg, ...more] = process.argv.slice(2);
if (!cmd) list();
else if (cmd === 'password' && arg) await setPassword(arg);
else if (cmd === 'create' && arg) await create(arg);
else if (cmd === 'hero' && arg && more.length >= 2) hero(arg, more[0], more[1], more[2]);
else {
  console.log(`Usage: node server/accounts.mjs                                  list the accounts
       node server/accounts.mjs password <name>                  a new password
       node server/accounts.mjs create <name>                    a new account
       node server/accounts.mjs hero <account> <Name> <class> [level]   a new hero (warrior, scientist, rogue, healer)`);
}

// The accounts on this game server, from its terminal (the game itself has no "forgot my password"):
//   node server/accounts.mjs                    every account: its heroes and when it last signed in
//   node server/accounts.mjs password <name>    a new password for an account (typed twice, not shown)
//   node server/accounts.mjs create <name>      a new account (its password typed twice, not shown)
//   node server/accounts.mjs hero <account> <Name> <class> [level]
//                                               a new hero there (warrior, scientist, rogue or doctor) at that
//                                               level (1–80), in its class's best gear for it, upgraded, with
//                                               potions, scrolls and gold; its points all free to spend
//   node server/accounts.mjs level <account> <Hero> <level>
//                                               an existing hero's level (1–80), nothing else (its new points
//                                               are free to spend; fewer levels than points spent: all back)
//   node server/accounts.mjs gold <account> <Hero> <amount>
//                                               gold for a hero (added to what it has)
//   node server/accounts.mjs gear <account> <Hero> [low|mid|high|rare] [+N]
//                                               a full kit of its class's best items of that class of items (high
//                                               if not said), upgraded to +N (+5 if not said; clothes and
//                                               accessories go to +7 at most): every weapon it can wield (and a
//                                               shield or book), its set of clothes and six accessories, into its
//                                               bag (what doesn't fit: the account's bank)
// The game server keeps accounts in memory and writes them back, so changes don't go into its files from here:
// they go to it, as an order in <data>/admin/, which it carries out within a couple of seconds (no Restart; a
// hero being played goes back to its hero list) and answers here. If it isn't running, the order waits for it.
// It uses the same data folder as the game server ($EMBERWOOD_DATA, or ~/emberwood-data). Passwords are kept
// only as scrypt hashes: nobody can read one back, only set a new one.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { hashPassword } from './auth.mjs';
import { CLASSES, NAME_RULE, USER_RULE } from '../src/classes.js';
import { ITEMS, SLOTS, TIERS, emptyEquipment, makeItem, maxPlus, tierAt } from '../src/items.js';

const DATA_DIR = process.env.EMBERWOOD_DATA || path.join(os.homedir(), 'emberwood-data');
const ACCOUNTS = path.join(DATA_DIR, 'accounts');
const fileOf = (lower) => path.join(ACCOUNTS, `${lower}.json`);
const ADMIN = path.join(DATA_DIR, 'admin');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.log(msg); process.exitCode = 1; };

// Hand an order to the game server and wait (10 s at most) for what it says.
async function order(o) {
  fs.mkdirSync(ADMIN, { recursive: true, mode: 0o700 });
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, done = path.join(ADMIN, `${id}.done`);
  writeJSON(path.join(ADMIN, `${id}.json`), o);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (!fs.existsSync(done)) continue;
    const said = fs.readFileSync(done, 'utf8');
    fs.unlinkSync(done);
    console.log(`The game server: ${said}`);
    return;
  }
  console.log('The game server didn\'t answer in 10 seconds (is the Node.js app running?). The order waits: it is carried out as soon as the server starts.');
}

// a password typed twice; null (and why) if it won't do
async function newPassword(prompt) {
  const q = asker(), pass = await q.ask(prompt);
  if (pass.length < 6 || pass.length > 72) { q.close(); fail('Passwords need 6 to 72 characters. Nothing changed.'); return null; }
  const again = await q.ask('The same again: ');
  q.close();
  if (again !== pass) { fail('They differ. Nothing changed.'); return null; }
  return hashPassword(pass);
}
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
  const acc = readJSON(fileOf(String(name || '').trim().toLowerCase()));
  if (!acc) return fail(`No account called "${name}" in ${ACCOUNTS}. Run without arguments to see them all.`);
  const h = await newPassword(`New password for ${acc.user}: `);
  if (h) await order({ op: 'password', account: acc.lower, ...h });
}

async function create(name) {
  const user = String(name || '').trim();
  if (!USER_RULE.test(user)) return fail('Account names are 3–16 letters, numbers or _.');
  if (fs.existsSync(fileOf(user.toLowerCase()))) return fail(`There is already an account called ${user}.`);
  const h = await newPassword(`Password for ${user}: `);
  if (h) await order({ op: 'create', user, ...h });
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

// Class names as players know them (the Doctor's key is still 'healer').
const classKey = (c) => { c = String(c || '').toLowerCase(); return c === 'doctor' ? 'healer' : c; };
const className = (c) => CLASSES[c]?.name.toLowerCase() || c;

async function hero(account, name, cls, lvl) {
  cls = classKey(cls);
  const acc = readJSON(fileOf(String(account || '').toLowerCase()));
  if (!acc) return fail(`No account called "${account}". Run without arguments to see them all.`);
  name = String(name || '').trim();
  if (!NAME_RULE.test(name)) return fail('Hero names are 3–14 letters, no spaces or numbers.');
  if (!Object.hasOwn(CLASSES, cls)) return fail(`The class is one of: ${Object.keys(CLASSES).map(className).join(', ')}.`);
  const level = Math.max(1, Math.min(80, Math.round(Number(lvl) || 1)));
  await order({ op: 'hero', account: acc.lower, name, cls, save: heroSave(cls, level) });
}

// An account and one of its heroes, from the command line (null, and why, if there's no such thing).
function findHero(account, name) {
  const acc = readJSON(fileOf(String(account || '').toLowerCase()));
  if (!acc) { fail(`No account called "${account}". Run without arguments to see them all.`); return null; }
  const ch = acc.characters.find((c) => c.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!ch) { fail(`${acc.user} has no hero called "${name}" (${acc.characters.map((c) => c.name).join(', ') || 'no heroes'}).`); return null; }
  return { acc, ch };
}

// A hero never played has no save yet: the server starts it from this (its class's first things, as a new hero gets).
function blankSave(cls, level) {
  const eq = emptyEquipment(), bag = new Array(30).fill(null);
  for (const key of CLASSES[cls].start) { const d = ITEMS[key]; eq[d.slot === 'weapon' && eq.weapon ? 'offhand' : d.slot] = makeItem(key); }
  [makeItem('hp_potion_1', { n: 5 }), makeItem('mp_potion_1', { n: 3 }), makeItem('camp_scroll', { n: 1 })].forEach((it, i) => { bag[i] = it; });
  return { v: 2, level, xp: 0, gold: 30, bag, equipment: eq, quests: { done: [], active: [] }, sk: { pts: {}, bar: [] }, cave: { day: 0 }, buffs: {} };
}

// An existing hero to another level: only its level (and its XP toward the next, back to 0).
async function setLevel(account, name, lvl) {
  const f = findHero(account, name);
  if (!f) return;
  const level = Math.round(Number(lvl));
  if (!(level >= 1 && level <= 80)) return fail('The level is a number from 1 to 80.');
  await order({ op: 'level', account: f.acc.lower, hero: f.ch.name, level, blank: blankSave(f.ch.cls, level) });
}

// Gold for a hero, on top of what it has.
async function addGold(account, name, amount) {
  const f = findHero(account, name);
  if (!f) return;
  const gold = Math.round(Number(String(amount).replace(/[_,]/g, '')));
  if (!(gold >= 1 && gold <= 1e9)) return fail('The gold is a number from 1 to 1000000000.');
  await order({ op: 'gold', account: f.acc.lower, hero: f.ch.name, gold, blank: blankSave(f.ch.cls, f.ch.level || 1) });
}

// A kit of a class's best items of one class of items (tier), at +plus: every kind of weapon it may wield (two
// daggers for a rogue), a shield or a book if it uses one, its set of clothes, and six accessories.
function gearKit(cls, tier, plus) {
  const all = Object.values(ITEMS).filter((d) => d.tier === tier && !d.unique && !d.stack && d.kind !== 'key');
  const best = (list) => list.sort((a, b) => b.level - a.level)[0];
  const kit = [];
  const types = [...new Set(all.filter((d) => d.classes?.includes(cls) && (d.kind === 'weapon' || d.kind === 'offhand')).map((d) => d.type))];
  for (const type of types) {
    const d = best(all.filter((x) => x.type === type && x.classes?.includes(cls) && (x.kind === 'weapon' || x.kind === 'offhand')));
    if (!d) continue;
    kit.push(d);
    if (cls === 'rogue' && type === 'dagger') kit.push(d); // (one for each hand)
  }
  const armor = all.filter((d) => d.kind === 'armor' && d.classes?.includes(cls));
  const set = best([...armor])?.set;
  for (const slot of ['head', 'body', 'hands', 'feet']) { const d = armor.find((x) => x.set === set && x.slot === slot); if (d) kit.push(d); }
  const want = { warrior: [0, 0, 0, 0, 0], scientist: [1, 1, 1, 1, 1], rogue: [1, 1, 0, 0, 1], healer: [0, 1, 1, 1, 0] }[cls];
  ['ring', 'ring', 'ear', 'ear', 'neck', 'belt'].forEach((kind, i) => { const d = ITEMS[`${tier}_${kind}_${want[Math.min(i, 4)]}`]; if (d) kit.push(d); });
  return kit.map((d) => makeItem(d.key, { p: Math.min(plus, maxPlus(d)) }));
}

async function addGear(account, name, tier = 'high', plus = '+5') {
  const f = findHero(account, name);
  if (!f) return;
  tier = String(tier).toLowerCase();
  if (tier === 'middle') tier = 'mid';
  if (!Object.hasOwn(TIERS, tier)) return fail(`The class of items is one of: ${Object.keys(TIERS).join(', ')}.`);
  const p = Math.round(Number(String(plus).replace('+', '')));
  if (!(p >= 1 && p <= 10)) return fail('The upgrade is +1 to +10.');
  const items = gearKit(f.ch.cls, tier, p);
  if (!items.length) return fail(`No ${tier} items for a ${CLASSES[f.ch.cls].name}.`);
  console.log(`${items.length} items: ${items.map((it) => `${ITEMS[it.k].name} +${it.p}`).join(', ')}`);
  await order({ op: 'items', account: f.acc.lower, hero: f.ch.name, items, blank: blankSave(f.ch.cls, f.ch.level || 1) });
}

const [cmd, arg, ...more] = process.argv.slice(2);
if (!cmd) list();
else if (cmd === 'password' && arg) await setPassword(arg);
else if (cmd === 'create' && arg) await create(arg);
else if (cmd === 'hero' && arg && more.length >= 2) await hero(arg, more[0], more[1], more[2]);
else if (cmd === 'level' && arg && more.length >= 2) await setLevel(arg, more[0], more[1]);
else if (cmd === 'gold' && arg && more.length >= 2) await addGold(arg, more[0], more[1]);
else if (cmd === 'gear' && arg && more.length >= 1) await addGear(arg, more[0], more[1], more[2]);
else {
  console.log(`Usage: node server/accounts.mjs                                  list the accounts
       node server/accounts.mjs password <name>                  a new password
       node server/accounts.mjs create <name>                    a new account
       node server/accounts.mjs hero <account> <Name> <class> [level]   a new hero (warrior, scientist, rogue, doctor)
       node server/accounts.mjs level <account> <Hero> <level>          an existing hero's level
       node server/accounts.mjs gold <account> <Hero> <amount>          gold for a hero
       node server/accounts.mjs gear <account> <Hero> [low|mid|high|rare] [+N]
                                                                         its class's best items, upgraded (high, +5)`);
}

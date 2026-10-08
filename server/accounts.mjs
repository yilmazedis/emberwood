// The accounts on this game server, from its terminal (the game itself has no "forgot my password"):
//   node server/accounts.mjs                    every account: its heroes and when it last signed in
//   node server/accounts.mjs password <name>    a new password for an account (typed twice, not shown)
// It reads and writes the same data folder as the game server ($EMBERWOOD_DATA, or ~/emberwood-data). After a
// new password, press Restart for the Node.js app, so the server reads the account afresh. (A game still
// signed in to that account keeps saving it: close it first, or the server may write the old password back.)
// Passwords are kept only as scrypt hashes: nobody can read one back, only set a new one.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { hashPassword } from './auth.mjs';

const DATA_DIR = process.env.EMBERWOOD_DATA || path.join(os.homedir(), 'emberwood-data');
const ACCOUNTS = path.join(DATA_DIR, 'accounts');
const fileOf = (lower) => path.join(ACCOUNTS, `${lower}.json`);
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
  const tmp = `${file}.${process.pid}.tmp`; // (written whole, then swapped in, like the server does)
  fs.writeFileSync(tmp, JSON.stringify(acc), { mode: 0o600 });
  fs.renameSync(tmp, file);
  console.log(`Done: ${acc.user} has a new password. Now press Restart for the Node.js app, then sign in.`);
}

const [cmd, arg] = process.argv.slice(2);
if (!cmd) list();
else if (cmd === 'password' && arg) await setPassword(arg);
else console.log('Usage: node server/accounts.mjs            (list the accounts)\n       node server/accounts.mjs password <name>   (set a new password)');

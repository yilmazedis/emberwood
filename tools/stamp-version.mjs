// Stamps the game's version: a short hash of everything the browser runs (the page, the styles, the
// service worker and every file in src/), written to version.json (which open games check, to offer a
// Refresh when it changes) and src/version.js (the version a game was loaded with). Run it before every
// commit; the repo's pre-commit hook does (install it once: node tools/stamp-version.mjs --install).
//
//   node tools/stamp-version.mjs            update both files
//   node tools/stamp-version.mjs --check    exit 1 if they're out of date
import { readFileSync, writeFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWN = ['version.json', 'src/version.js'];

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

if (process.argv.includes('--install')) {
  const hook = join(ROOT, '.git/hooks/pre-commit');
  writeFileSync(hook, '#!/bin/sh\n# stamp the game version (tools/stamp-version.mjs) into the commit\nnode tools/stamp-version.mjs && git add version.json src/version.js\n');
  chmodSync(hook, 0o755);
  console.log('installed .git/hooks/pre-commit');
  process.exit(0);
}

const list = ['index.html', 'style.css', 'sw.js', 'manifest.webmanifest', ...files(join(ROOT, 'src')).map((p) => relative(ROOT, p))]
  .map((p) => p.split('\\').join('/'))
  .filter((p) => !OWN.includes(p) && existsSync(join(ROOT, p)))
  .sort();
const hash = createHash('sha256');
for (const p of list) hash.update(`${p}\n`).update(readFileSync(join(ROOT, p))).update('\n');
const v = hash.digest('hex').slice(0, 12);
const protocol = Number(readFileSync(join(ROOT, 'src/sim/world.js'), 'utf8').match(/PROTOCOL = (\d+)/)[1]);

const json = `${JSON.stringify({ v, protocol })}\n`;
const js = `// Written by tools/stamp-version.mjs: the version of the game this page was loaded with.\nexport const VERSION = '${v}';\n`;
const current = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
if (process.argv.includes('--check')) {
  const ok = current('version.json') === json && current('src/version.js') === js;
  if (!ok) console.error('version.json / src/version.js are out of date: run node tools/stamp-version.mjs');
  process.exit(ok ? 0 : 1);
}
writeFileSync(join(ROOT, 'version.json'), json);
writeFileSync(join(ROOT, 'src/version.js'), js);
console.log(`version ${v} (protocol ${protocol})`);

// Stamps the game's version: a short hash of everything the browser runs (the page, the styles, the
// service worker and every file in src/), written to version.json (which open games check, to offer a
// Refresh when it changes) and src/version.js (the version a game was loaded with). It also points the
// page at that version on jsDelivr's CDN (the git tag ew-<version>, which the post-commit hook makes) and
// lists every module there, so the live site loads the code and models from the CDN, not the slow host.
// Run before every commit; the repo's hooks do (install them once: node tools/stamp-version.mjs --install),
// then push with: git push origin HEAD --follow-tags
//
//   node tools/stamp-version.mjs            update the files
//   node tools/stamp-version.mjs --check    exit 1 if they're out of date
//   node tools/stamp-version.mjs --tag      make the tag ew-<version> on HEAD if there isn't one
import { readFileSync, writeFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWN = ['version.json', 'src/version.js'];
const CDN_RE = /(cdn\.jsdelivr\.net\/gh\/yilmazedis\/emberwood@)[^/']*(\/)/;
const MODULES_RE = /const MODULES = \[[^\]]*\];/;

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

if (process.argv.includes('--install')) {
  const hook = (name, body) => {
    const p = join(ROOT, '.git/hooks', name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    console.log(`installed .git/hooks/${name}`);
  };
  hook('pre-commit', '# stamp the game version (tools/stamp-version.mjs) into the commit\nnode tools/stamp-version.mjs && git add version.json src/version.js index.html');
  hook('post-commit', '# the CDN serves the game by the tag ew-<version> (push with --follow-tags)\nnode tools/stamp-version.mjs --tag');
  process.exit(0);
}

if (process.argv.includes('--tag')) {
  const { v } = JSON.parse(read('version.json'));
  const tag = `ew-${v}`;
  let exists = true;
  try { execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: ROOT, stdio: 'ignore' }); } catch { exists = false; }
  if (!exists) {
    execFileSync('git', ['tag', '-a', tag, '-m', `Emberwood ${v}`], { cwd: ROOT });
    console.log(`tagged ${tag}`);
  }
  process.exit(0);
}

const srcFiles = files(join(ROOT, 'src')).map((p) => relative(ROOT, p).split('\\').join('/')).sort();
const list = ['index.html', 'style.css', 'sw.js', 'manifest.webmanifest', ...srcFiles]
  .filter((p) => !OWN.includes(p) && existsSync(join(ROOT, p)));
// (the page's own pointer to the CDN and its module list don't count: they follow from the rest)
const normal = (p, text) => (p === 'index.html' ? text.replace(CDN_RE, '$1?$2').replace(MODULES_RE, 'const MODULES = [];') : text);
const hash = createHash('sha256');
for (const p of list) hash.update(`${p}\n`).update(normal(p, read(p))).update('\n');
const v = hash.digest('hex').slice(0, 12);
const protocol = Number(read('src/sim/world.js').match(/PROTOCOL = (\d+)/)[1]);

const json = `${JSON.stringify({ v, protocol })}\n`;
const js = `// Written by tools/stamp-version.mjs: the version of the game this page was loaded with.\nexport const VERSION = '${v}';\n`;
const modules = srcFiles.filter((p) => p.endsWith('.js')).map((p) => `'${p.slice(4)}'`);
const page = read('index.html').replace(CDN_RE, `$1ew-${v}$2`).replace(MODULES_RE, `const MODULES = [${modules.join(', ')}];`);
if (process.argv.includes('--check')) {
  const ok = read('version.json') === json && read('src/version.js') === js && read('index.html') === page;
  if (!ok) console.error('version.json / src/version.js / index.html are out of date: run node tools/stamp-version.mjs');
  process.exit(ok ? 0 : 1);
}
writeFileSync(join(ROOT, 'version.json'), json);
writeFileSync(join(ROOT, 'src/version.js'), js);
writeFileSync(join(ROOT, 'index.html'), page);
console.log(`version ${v} (protocol ${protocol})`);

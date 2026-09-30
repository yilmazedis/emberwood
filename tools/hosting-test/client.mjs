// Measures a host running tools/hosting-test/server.js: request speed, CPU speed, WebSocket round trips,
// whether 20-per-second updates arrive on time, how many live connections it allows, and whether they
// stay open. Node 22+ (built-in WebSocket).
//   node tools/hosting-test/client.mjs https://gameserver.example.com [minutes to hold connections]
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const HOLD_MIN = Number(process.argv[3] ?? 10);
const WS_URL = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (xs) => {
  if (!xs.length) return 'none';
  const s = [...xs].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `median ${q(0.5).toFixed(0)} ms, 95% under ${q(0.95).toFixed(0)} ms, worst ${s[s.length - 1].toFixed(0)} ms (n=${s.length})`;
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(path) {
  const t = performance.now();
  const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  const body = await r.json();
  return { ms: performance.now() - t, body };
}

// one live connection that answers pings and counts the server's ticks
function connect(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(WS_URL);
    const c = { ws, open: false, closed: false, ticks: 0, gaps: [], last: 0, waiting: new Map(), pids: new Set(), error: null };
    const timer = setTimeout(() => { c.error = c.error || 'timeout'; try { ws.close(); } catch { /* */ } resolve(c); }, timeoutMs);
    ws.addEventListener('open', () => { c.open = true; c.connectMs = performance.now() - t0; clearTimeout(timer); resolve(c); });
    ws.addEventListener('error', (e) => { c.error = e.message || 'error'; });
    ws.addEventListener('close', (e) => { c.closed = true; c.closeCode = e.code; clearTimeout(timer); resolve(c); });
    ws.addEventListener('message', (e) => {
      const text = String(e.data);
      if (text.startsWith('pong:')) {
        const [, id, , pid] = text.split(':');
        c.pids.add(pid);
        const w = c.waiting.get(id);
        if (w) { c.waiting.delete(id); w(performance.now()); }
        return;
      }
      const now = performance.now();
      if (c.last) c.gaps.push(now - c.last);
      c.last = now;
      c.ticks++;
    });
  });
}

let pingId = 0;
function ping(c, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!c.open || c.closed) return resolve(null);
    const id = String(++pingId), t = performance.now();
    const timer = setTimeout(() => { c.waiting.delete(id); resolve(null); }, timeoutMs);
    c.waiting.set(id, (now) => { clearTimeout(timer); resolve(now - t); });
    c.ws.send(`ping:${id}:${Date.now()}`);
  });
}

const alive = (list) => list.filter((c) => c.open && !c.closed);

console.log(`\nHosting test against ${BASE}\n`);

// 1) plain requests
const reqMs = [];
let st = null;
for (let i = 0; i < 5; i++) { const r = await getJSON('/'); reqMs.push(r.ms); st = r.body; }
log(`requests: ${stats(reqMs)}`);
log(`server: Node ${st.node}, pid ${st.pid}, up ${st.uptimeS}s, ${st.cpus} CPUs visible, load ${st.load.join(' / ')}, memory ${st.rssMB} MB used, ${st.freeMB} of ${st.totalMB} MB free`);

// 2) CPU speed (for comparison, an Apple M-series MacBook does ~8900 rounds)
const cpu = [];
for (let i = 0; i < 3; i++) cpu.push((await getJSON('/cpu')).body.rounds);
log(`CPU probe: ${cpu.join(', ')} rounds in 0.5 s`);

// 3) one connection: round trips and tick timing
const one = await connect();
if (!one.open) {
  log(`WebSocket FAILED: ${one.error || `closed (${one.closeCode})`}. Live connections don't work on this host.`);
  process.exit(1);
}
log(`WebSocket connected in ${one.connectMs.toFixed(0)} ms`);
const rtt = [];
for (let i = 0; i < 40; i++) { const ms = await ping(one); if (ms !== null) rtt.push(ms); await sleep(50); }
one.gaps = [];
await sleep(10000);
log(`round trips: ${stats(rtt)}`);
const late = one.gaps.filter((g) => g > 120).length;
log(`updates: ${(one.gaps.length / 10).toFixed(1)} per second (should be 20); gaps ${stats(one.gaps)}; ${late} arrived >120 ms late`);

// 4) how many live connections at once
const conns = [one];
let maxOK = 1;
for (const target of [5, 10, 20, 30, 50, 80, 120]) {
  const batch = await Promise.all(Array.from({ length: target - conns.length }, () => connect()));
  conns.push(...batch);
  await sleep(3000);
  const open = alive(conns);
  const pr = (await Promise.all(open.map((c) => ping(c)))).filter((x) => x !== null);
  const failed = batch.filter((c) => !c.open).length;
  const status = (await getJSON('/')).body;
  log(`${target} connections: ${open.length} open, ${failed} refused, server sees ${status.clients}; round trips ${stats(pr)}`);
  if (open.length < target * 0.9 || pr.length < open.length * 0.9) { log(`limit reached around ${maxOK} connections`); break; }
  maxOK = target;
}
const pids = new Set(conns.flatMap((c) => [...c.pids]));
log(`server processes seen: ${pids.size} (${[...pids].join(', ')})${pids.size > 1 ? ' - MORE THAN ONE: players would end up in different worlds' : ''}`);

// 5) do they stay open?
const keep = alive(conns).slice(0, Math.min(20, maxOK));
for (const c of alive(conns)) if (!keep.includes(c)) c.ws.close();
log(`holding ${keep.length} connections for ${HOLD_MIN} minutes...`);
for (let m = 1; m <= HOLD_MIN; m++) {
  for (const c of keep) c.gaps = [];
  await sleep(60000);
  const open = alive(keep);
  const pr = (await Promise.all(open.map((c) => ping(c)))).filter((x) => x !== null);
  const rate = open.length ? open.reduce((s, c) => s + c.gaps.length, 0) / open.length / 60 : 0;
  const s = (await getJSON('/').catch(() => ({ body: {} }))).body;
  log(`minute ${m}: ${open.length}/${keep.length} still open, ${rate.toFixed(1)} updates/s each, round trips ${stats(pr)}; server pid ${s.pid}, up ${s.uptimeS}s`);
}
for (const c of conns) try { c.ws.close(); } catch { /* */ }
console.log('\ndone');
process.exit(0);

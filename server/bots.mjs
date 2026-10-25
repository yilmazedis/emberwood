// Bots: heroes the game server plays itself, so the world never feels empty. Players see them as heroes like
// any other: they come and go through the day (more in the evening, by Turkey's clock), rest in their land's
// camp, walk out to the hunting grounds of their level, fight the monsters there (who fight back: the world
// deals their blows to a bot itself, sim/world.js), drink potions, now and then faint and wake up in camp,
// level up slowly, and say a few things in the world chat (hello to newcomers, an answer when greeted or
// named). They don't join parties, trade, or go into dungeons, caves, the arena or the Death Canyon. Their
// heroes (class, level, look) are kept in <data>/bots.json.
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES } from '../src/classes.js';
import { ITEMS, maxPlus } from '../src/items.js';
import { MAPS } from '../src/maps.js';
import { monsterXp } from '../src/monsters.js';
import { resolveCollision, randomWalkablePoint, zoneAt } from '../src/terrain.js';

const FIRST_PID = 1_000_000; // (real heroes' world ids count up from 1)
const RUN = 5.6; // m/s
const LANDS = [['emberwood', 2, 10], ['frostfang', 11, 22], ['cinderfall', 23, 40], ['shadowmere', 41, 58]];
const NAMES = ['Mert', 'Elif', 'Kaan', 'Zeynep', 'Arda', 'Deniz', 'Emre', 'Selin', 'Burak', 'Ece', 'Baris', 'Defne',
  'Onur', 'Melis', 'Cem', 'Aylin', 'Tolga', 'Irem', 'Kerem', 'Derya', 'Lukas', 'Sofia', 'Mateo', 'Hana', 'Nora', 'Ivan'];
const LOOKS = { warrior: 'sword', scientist: 'staff', rogue: 'daggers', healer: 'mace' };
const SKILL = { warrior: ['power_strike', 'cleave'], scientist: ['fireball', 'ice_bolt'], rogue: ['eviscerate'], healer: ['smite', 'holy_strike'] };
const DR = { warrior: 0.6, healer: 0.55, rogue: 0.55, scientist: 0.45 }; // (a share of a blow their armor (or dodging) takes)

// What they say: now and then in general, in their land, to a newcomer, back to a greeting, when named.
const SAY = {
  any: ['anyone up for a dungeon?', 'finally lvl {lv}', 'gg', 'selam herkese', 'kimse var mi?', 'lag mi var yoksa bende mi', 'brb coffee',
    'auto hunt is a lifesaver lol', 'brom never fails, +{p} now', 'need a doctor for the next dungeon, anyone?', 'this music is so chill',
    'how many recipes for +8?', 'iyi oyunlar', 'who else is still up lol', 'got a nice drop finally', 'potions are so cheap here'],
  emberwood: ['slimes everywhere lol', 'those grave robbers keep coming back', 'grok down!', 'where is the crypt door again?', 'morvain poisoned me twice'],
  frostfang: ['so cold here', 'berserkers on the ridge are no joke', 'hrimgar down, finally', 'frost alchemists slow me every time'],
  cinderfall: ['lava rivers look amazing', 'ember cutthroats everywhere', 'anyone seen ignis?', 'ash knights hit hard'],
  shadowmere: ['mist hermits poison me every time', 'marsh reavers lol', 'anyone for the sunken vault?', 'malakar down!', 'saving for the canyon'],
  welcome: ['hi {name}', 'hey {name}', 'welcome!', 'selam {name}', 'yo', 'hey'],
  hello: ['hey!', 'hi', 'selam', 'as', 'hello', 'heyy', 'merhaba'],
  named: ['yeah?', 'hm?', 'busy hunting, sorry', 'sup', 'ne oldu?', 'here', "what's up"],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const levelsOf = (zone) => { const m = /Level (\d+)(?: – (\d+))?/.exec(zone.sub || ''); return m ? [Number(m[1]), Number(m[2] || m[1])] : null; };
const zonesOf = (map) => map.outdoor?.zones || map.zones || [];

// A hero's things for its look: the best of its class at its level (not the uniques or the rare), upgraded a little.
function kitFor(cls, level, bow) {
  const best = (f) => Object.values(ITEMS).filter((d) => !d.unique && !d.stack && d.tier !== 'rare' && d.level <= level && d.classes?.includes(cls) && f(d))
    .sort((a, b) => b.level - a.level)[0];
  const p = (d) => (d ? [d.key, Math.min(maxPlus(d), 1 + Math.floor(level / 12) + Math.floor(rand(0, 3)))] : undefined);
  const k = {};
  const type = { warrior: 'sword1h', scientist: 'staff', rogue: bow ? 'bow' : 'dagger', healer: 'mace1h' }[cls];
  const w = best((d) => d.type === type);
  k.w = p(w);
  if (cls === 'warrior' || cls === 'healer') k.o = p(best((d) => d.type === 'shield'));
  if (cls === 'rogue' && !bow) k.o = k.w;
  const set = best((d) => d.kind === 'armor')?.set;
  for (const [key, slot] of [['h', 'head'], ['b', 'body'], ['g', 'hands'], ['f', 'feet']]) {
    const d = set && ITEMS[`${set}_${slot}`];
    if (d && (slot !== 'head' || Math.random() < 0.7)) k[key] = p(d);
  }
  return k;
}

export class Bots {
  // world: the WorldSim; say(bot, text): into the world chat; announce(text): "… has entered"; nameTaken(name):
  // a player's hero has it; dataDir: where bots.json goes.
  constructor(world, { say, announce, nameTaken, dataDir }) {
    this.world = world;
    this.say = say;
    this.announce = announce;
    this.file = path.join(dataDir, 'bots.json');
    this.list = this.load(nameTaken);
    this.byPid = new Map();
    this.chatT = rand(120, 300); // s to the next thing someone says, unasked
    this.rosterT = 0;
    this.saveT = 300;
    this.greetAt = 0;
    this.started = false;
  }

  load(nameTaken) {
    let saved = [];
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* the first time */ }
    const out = [], have = new Map((Array.isArray(saved) ? saved : []).map((b) => [b.name, b]));
    let i = 0;
    for (const name of NAMES) {
      if (nameTaken(name)) continue; // (a player took it: theirs)
      const [land, lo, hi] = LANDS[i % LANDS.length], s = have.get(name);
      const cls = s?.cls && CLASSES[s.cls] ? s.cls : Object.keys(CLASSES)[(i + Math.floor(i / 4)) % 4]; // (every class in every land)
      out.push({
        name, cls, land: s?.land && MAPS[s.land] ? s.land : land, level: Math.round(s?.level || rand(lo, hi)), m: s?.m ?? (Math.random() < 0.5 ? 0 : 1),
        bow: s?.bow ?? (cls === 'rogue' && Math.random() < 0.4), xp: s?.xp || 0, pid: 0, p: null, offUntil: 0,
      });
      i++;
    }
    return out;
  }

  save() {
    const data = this.list.map(({ name, cls, land, level, m, bow, xp }) => ({ name, cls, land, level, m, bow, xp: Math.round(xp) }));
    try { fs.writeFileSync(this.file, JSON.stringify(data)); } catch { /* next time */ }
  }

  get online() { return this.byPid.size; }
  isBot(pid) { return this.byPid.has(pid); }
  byName(name) { const n = String(name || '').trim().toLowerCase(); return this.list.find((b) => b.name.toLowerCase() === n) || null; }
  has(name) { return !!this.byName(name); }

  // How many are about, by the hour in Turkey: few at night, most in the evening.
  wanted() {
    const h = (new Date().getUTCHours() + 3) % 24;
    const share = h < 2 ? 0.55 : h < 8 ? 0.3 : h < 12 ? 0.45 : h < 18 ? 0.6 : 0.8;
    return Math.round(this.list.length * share);
  }

  // ---------------------------------------------------------------- coming and going
  join(b, quiet) {
    const map = MAPS[b.land], at = map.respawn, pid = FIRST_PID + this.list.indexOf(b);
    b.look = { lv: b.level, m: b.m, ...kitFor(b.cls, b.level, b.bow) };
    this.world.join(pid, { name: b.name, cls: b.cls, key: `bot:${b.name}`, party: 0, map: b.land, p: [at.x, at.z, at.yaw, 0, 0, 1, 1, 0, 0, 0], k: b.look });
    const p = this.world.players.get(pid);
    if (!p) return;
    b.pid = pid;
    b.p = p;
    p.bot = this.ai(b);
    Object.assign(p, { mhp: this.maxLife(b), hp: 1 });
    p.life = p.mhp;
    b.until = this.world.time + rand(25, 120) * 60;
    this.camp(b, true);
    this.byPid.set(pid, b);
    if (!quiet) this.announce(`${b.name} has entered Emberwood.`);
  }

  leave(b) {
    this.world.leave(b.pid);
    this.byPid.delete(b.pid);
    b.p = null;
    b.offUntil = this.world.time + rand(5, 40) * 60;
    this.announce(`${b.name} has left.`);
    this.save();
  }

  // Bring one in, or let one go, until about as many are online as the hour wants.
  roster() {
    const want = this.wanted(), t = this.world.time;
    for (const b of this.byPid.values()) {
      if (t > b.until && (b.state === 'camp' || b.state === 'walk') && this.online > Math.max(1, want - 2)) { this.leave(b); return; }
    }
    if (this.online < want) {
      const off = this.list.filter((b) => !b.p && t >= b.offUntil);
      if (off.length) this.join(pick(off), !this.started);
    } else if (this.online > want + 1) {
      const b = [...this.byPid.values()].find((x) => x.state === 'camp');
      if (b) this.leave(b);
    }
  }

  maxLife(b) { return Math.round((40 + 30 * b.level) * CLASSES[b.cls].hp); } // (about a player's of its level, gear and Strength counted)

  // ---------------------------------------------------------------- what the world asks of one
  ai(b) {
    return {
      // a monster's blow lands on it (the world works out who and when)
      hurt: (raw, by) => {
        const p = b.p;
        if (!p?.alive) return;
        p.life = Math.max(0, p.life - Math.max(1, Math.round(raw * (1 - DR[b.cls]) * 0.6 * rand(0.9, 1.1)))); // (0.6: what a player's skills and dodging spare it)
        p.hp = p.life / p.mhp;
        b.hitT = this.world.time;
        if (!b.foe || b.foe.state === 'dead') b.foe = by;
        if (p.life <= 0) this.faint(b);
      },
    };
  }

  faint(b) {
    const p = b.p;
    p.alive = false;
    p.life = 0;
    p.hp = 0;
    p.mode = 0;
    p.sp = 0;
    b.state = 'down';
    b.stateT = rand(8, 18);
    b.foe = null;
  }

  // ---------------------------------------------------------------- per tick
  tick(dt) {
    if ((this.rosterT -= dt) <= 0) { this.rosterT = this.started ? rand(40, 90) : 0.5; this.roster(); }
    if (!this.started && this.online >= this.wanted()) this.started = true;
    if ((this.saveT -= dt) <= 0) { this.saveT = 300; this.save(); }
    for (const b of this.byPid.values()) this.think(b, dt);
    if ((this.chatT -= dt) <= 0) {
      this.chatT = rand(240, 540);
      const b = pick([...this.byPid.values()]);
      if (b) this.speak(b, pick(Math.random() < 0.4 ? SAY[b.land] : SAY.any), rand(0, 2));
    }
  }

  think(b, dt) {
    const p = b.p, w = this.world;
    if (!p) return;
    b.stateT -= dt;
    b.atkT = (b.atkT || 0) - dt;
    b.potT = (b.potT || 0) - dt;
    b.skT = (b.skT || 0) - dt;
    if (b.state === 'down') {
      if (b.stateT <= 0) { // wakes up in its land's camp
        w.travel(b.pid, b.land, { respawn: true });
        p.alive = true;
        p.life = p.mhp;
        p.hp = 1;
        this.camp(b);
      }
      return;
    }
    // Life: back a little at a time when nothing has hit it lately (a lot in camp), and a potion when low
    const calm = w.time - (b.hitT || -99) > 6, inCamp = zoneAt(p.x, p.z)?.safe;
    if (calm || inCamp) { p.life = Math.min(p.mhp, p.life + p.mhp * (inCamp ? 0.08 : 0.02) * dt); p.hp = p.life / p.mhp; }
    if (b.cls === 'healer' && p.hp < 0.55 && b.skT <= 0 && p.alive) { // a doctor treats its own wounds
      b.skT = 6;
      p.life = Math.min(p.mhp, p.life + p.mhp * 0.3);
      p.hp = p.life / p.mhp;
      this.act(b, { k: 'sk', id: 'heal', t: 0, pw: 1 });
    } else if (p.hp < 0.45 && b.pots > 0 && b.potT <= 0) {
      b.pots--;
      b.potT = 10;
      p.life = Math.min(p.mhp, p.life + p.mhp * 0.5);
      p.hp = p.life / p.mhp;
      this.act(b, { k: 'dr' });
    }
    if (b.state === 'camp') {
      if (b.stateT <= 0) this.goHunt(b);
      else if (b.to && this.walk(b, b.to, 0.5, 2.2)) b.to = null;
      else if (!b.to && Math.random() < dt * 0.04) b.to = this.campSpot(b);
      else if (!b.to) this.stand(b);
    } else if (b.state === 'walk') {
      if (this.walk(b, b.to, 2.5)) { b.state = b.back ? 'camp' : 'hunt'; b.stateT = b.back ? rand(30, 120) : rand(240, 720); b.to = null; if (b.back) b.pots = 8; }
    } else if (b.state === 'hunt') {
      this.hunt(b, dt);
    }
  }

  camp(b, first = false) {
    const zone = zonesOf(MAPS[b.land]).find((z) => z.safe), at = MAPS[b.land].respawn;
    b.home = zone ? { x: zone.x, z: zone.z, r: Math.max(4, zone.r * 0.6) } : { x: at.x, z: at.z, r: 5 };
    b.state = 'camp';
    b.stateT = first ? rand(5, 50) : rand(20, 120);
    b.to = this.campSpot(b);
    b.foe = null;
    b.back = false;
    b.pots = 8;
  }

  // Out to the zone of its level in its land (the best one below it, if none is quite its own).
  goHunt(b) {
    const zones = zonesOf(MAPS[b.land]).filter((z) => !z.safe && !z.all && levelsOf(z) && !/Boss|Dungeon/.test(z.sub));
    const fit = zones.filter((z) => { const [lo, hi] = levelsOf(z); return b.level >= lo - 1 && b.level <= hi + 2; });
    const below = zones.filter((x) => levelsOf(x)[1] <= b.level).sort((x, y) => levelsOf(y)[1] - levelsOf(x)[1]);
    const z = fit.length ? pick(fit) : below[0] || zones.sort((x, y) => levelsOf(x)[0] - levelsOf(y)[0])[0];
    if (!z) { b.stateT = 60; return; }
    b.zone = z;
    b.to = randomWalkablePoint(z.x, z.z, Math.max(3, z.r * 0.5), 0.6);
    b.state = 'walk';
    b.back = false;
  }

  // Somewhere in camp to stand, not right on top of another hero.
  campSpot(b) {
    let spot = null;
    for (let i = 0; i < 8; i++) {
      spot = randomWalkablePoint(b.home.x, b.home.z, b.home.r, 0.6);
      if ([...this.byPid.values()].every((o) => o === b || !o.p || Math.hypot(o.p.x - spot.x, o.p.z - spot.z) > 2.5)) break;
    }
    return spot;
  }

  goBack(b) {
    b.to = this.campSpot(b);
    b.state = 'walk';
    b.back = true;
    b.foe = null;
  }

  // Fight what's around the hunting ground: what's on it first, else the nearest monster nobody else is
  // fighting, of about its level; between fights, look around; when the hunt is over or it's out of potions
  // and hurt, back to camp.
  hunt(b, dt) {
    const p = b.p, z = b.zone;
    if (b.stateT <= 0 || (b.pots <= 0 && p.hp < 0.5) || (p.hp < 0.25 && b.potT > 3)) { this.goBack(b); return; } // (done, or running for it)
    let m = b.foe;
    if (m && (m.state === 'dead' || m.area !== p.area || Math.hypot(m.x - z.x, m.z - z.z) > z.r + 14)) m = b.foe = null;
    if (!m) {
      let best = null, bd = 16;
      for (const o of p.area.monsters.values()) {
        if (o.state === 'dead' || o.state === 'spawn' || o.def.boss || o.def.passive || o.level > b.level + 1) continue;
        if ((o.target && !o.target.bot) || [...o.hitters.keys()].some((pid) => !this.byPid.has(pid))) continue; // (a player's)
        if (Math.hypot(o.x - z.x, o.z - z.z) > z.r + 8) continue;
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (d < bd) { bd = d; best = o; }
      }
      m = b.foe = best;
    }
    if (!m) { // nothing to fight: look around the hunting ground
      if (b.to && !this.walk(b, b.to, 0.8, 2.2)) return;
      this.stand(b);
      b.to = Math.random() < dt * 0.5 ? randomWalkablePoint(z.x, z.z, Math.max(3, z.r * 0.6), 0.6) : null;
      return;
    }
    const ranged = b.cls === 'scientist' || (b.cls === 'rogue' && b.bow), reach = ranged ? 9 : 1.6 + m.radius;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d > reach) { this.walk(b, m, reach - 0.3); return; }
    this.stand(b);
    p.yaw = Math.atan2(m.x - p.x, m.z - p.z);
    if (b.atkT > 0) return;
    this.strike(b, m, ranged);
  }

  // One blow (or bolt, or arrow), now and then a skill: a monster of its level falls in about eight seconds.
  strike(b, m, ranged) {
    const p = b.p, gap = Math.max(0.6, m.level / b.level);
    const every = { warrior: 1.0, healer: 1.1, rogue: b.bow ? 1.0 : 0.65, scientist: 1.05 }[b.cls];
    b.atkT = every * rand(0.95, 1.1);
    const skill = b.skT <= 0 && Math.random() < 0.35;
    if (skill) b.skT = rand(5, 9);
    const crit = Math.random() < 0.12;
    const dmg = Math.max(1, Math.round((m.maxHp * every / rand(7, 10)) / Math.pow(gap, 1.6) * (skill ? 1.8 : 1) * (crit ? 1.6 : 1)));
    if (skill) this.act(b, { k: 'sk', id: pick(SKILL[b.cls]), x: +m.x.toFixed(2), z: +m.z.toFixed(2), t: m.id, pw: 1 });
    else if (ranged) this.act(b, { k: b.cls === 'rogue' ? 'ar' : 'bo', x: +m.x.toFixed(2), z: +m.z.toFixed(2) });
    else this.act(b, { k: 'sw', s: b.cls === 'rogue' ? pick(['stab', 'slash']) : b.cls === 'healer' ? 'chop' : pick(['slash', 'backslash', 'chop']), d: 0.5 });
    m.hurt(dmg, p.x, p.z, 0.2, p, null);
    m.emit(['h', m.id, dmg, crit ? 1 : 0, p.pid]);
    if (m.hp <= 0) {
      m.die(p);
      b.foe = null;
      this.gain(b, m);
    }
  }

  // XP for a kill: it grows slowly (a bot's levels are a little slower than a player's), up to its land's last.
  gain(b, m) {
    const top = LANDS.find(([land]) => land === b.land)?.[2] || 58;
    if (b.level >= top) return;
    b.xp += monsterXp(m.def, m.level) * (m.level >= b.level - 2 ? 1 : 0.4);
    const need = 55 * Math.pow(b.level, 1.55) * (1 + 0.1 * Math.max(0, b.level - 9)) * 8; // (a level in an hour or so of hunting)
    if (b.xp < need) return;
    b.xp = 0;
    b.level++;
    b.look = { lv: b.level, m: b.m, ...kitFor(b.cls, b.level, b.bow) };
    this.world.input(b.pid, { k: b.look });
    b.p.mhp = this.maxLife(b);
    b.p.life = b.p.mhp;
    b.p.hp = 1;
    this.act(b, { k: 'lv' });
    if (Math.random() < 0.3) this.speak(b, pick(['lvl {lv}!', 'ding {lv}', 'finally {lv}', '{lv} :)']), rand(1, 3));
    this.save();
  }

  // Walk toward `to` (a point or a monster); true when there (within `stop`). Stuck against something: a step aside.
  walk(b, to, stop, speed = RUN) {
    const p = b.p, dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
    if (d <= stop) { this.stand(b); return true; }
    const dt = 0.1, step = Math.min(d - stop + 0.05, speed * dt);
    const from = { x: p.x, z: p.z };
    const pos = { x: p.x + (dx / d) * step, z: p.z + (dz / d) * step };
    resolveCollision(pos, 0.5);
    if (!p.area.map.contains(pos.x, pos.z)) { this.stand(b); return true; }
    p.x = pos.x;
    p.z = pos.z;
    p.yaw = Math.atan2(dx, dz);
    p.mode = speed > 3 ? 2 : 1;
    p.sp = speed;
    const moved = Math.hypot(p.x - from.x, p.z - from.z);
    b.stuck = moved < step * 0.3 ? (b.stuck || 0) + dt : 0;
    if (b.stuck > 1.5) { // around whatever is in the way
      b.stuck = 0;
      const a = Math.atan2(dx, dz) + (Math.random() < 0.5 ? 1 : -1) * rand(0.9, 1.6);
      const side = randomWalkablePoint(p.x + Math.sin(a) * 6, p.z + Math.cos(a) * 6, 2, 0.6);
      p.x += (side.x - p.x) * 0.3;
      p.z += (side.z - p.z) * 0.3;
      resolveCollision(p, 0.5);
    }
    return false;
  }

  stand(b) { b.p.mode = 0; b.p.sp = 0; }

  act(b, a) { b.p.area?.events.push({ pid: b.pid, ev: ['p', b.pid, a] }); }

  // ---------------------------------------------------------------- the chat
  speak(b, text, delay = 0) {
    const line = text.replace('{lv}', b.level).replace('{p}', 4 + Math.floor(rand(0, 4)));
    setTimeout(() => { if (b.p) this.say(b, line); }, delay * 1000);
  }

  // A player came into the world: sometimes someone says hello.
  greet(name) {
    const now = Date.now();
    if (now - this.greetAt < 90000 || Math.random() > 0.35) return;
    const b = pick([...this.byPid.values()]);
    if (!b) return;
    this.greetAt = now;
    this.speak(b, pick(SAY.welcome).replace('{name}', name), rand(4, 9));
  }

  // A player said something in the world chat: a greeting is answered now and then, and a bot named answers.
  heard(from, text) {
    const t = String(text || '').toLowerCase(), now = Date.now();
    if (now - (this.answerAt || 0) < 15000) return;
    const named = [...this.byPid.values()].find((b) => new RegExp(`(^|[^\\p{L}])${b.name.toLowerCase()}([^\\p{L}]|$)`, 'u').test(t));
    if (named) { this.answerAt = now; this.speak(named, pick(SAY.named), rand(3, 8)); return; }
    if (/(^|\s)(hi|hello|hey|selam|merhaba|sa|slm|hola|yo)(\s|!|$)/.test(t) && Math.random() < 0.55) {
      const b = pick([...this.byPid.values()].filter((x) => x.name !== from));
      if (b) { this.answerAt = now; this.speak(b, pick(SAY.hello), rand(2, 6)); }
    }
  }
}

// The shared world: monsters spawn, wander, chase whoever is nearest and attack; heroes come and go.
// The game server runs one for everybody (server/main.mjs); offline, the game runs its own (local.js).
// Every place (maps.js) is an area of its own: one for each land, and a private copy of a dungeon for each
// party (or lone hero) that goes down. A hero travels between them through the waystones, doors and stairs
// (travel), and only areas with heroes in them move on.
//
// Each hero's game says where its hero is, what it hit and what it did; ten times a second the world
// tells every game where the monsters and other heroes around it are, and what happened. Whether a
// monster's blow lands is decided by the game of the hero it swings at (that game knows where its hero
// really stands, so dodging works). A kill's XP and loot are shared out here (see credits: parties
// share theirs) and each hero's game rolls what it was given.
// Plain numbers only (no three.js), so Node runs it as is.
import { ENEMY_TYPES, monsterHp, WORLD_BOSSES, WORLD_BOSS_FIRST, WORLD_BOSS_RETURN } from '../monsters.js';
import { planWorld, zoneAt, resolveCollision, isWalkable, randomWalkablePoint } from '../terrain.js';
import { MAPS, START, portalTo, arrival } from '../maps.js';
import { CAVES, STAGES, STAGE_ROOMS, MOUTH_REACH, stageSlots, caveLandFor, untilTomorrow } from '../caves.js';
import { rand, clamp, dampAngle, yawTo, TAU } from '../util.js';

export const PROTOCOL = 7; // bump when the messages change: older games are asked to reload
export const TICK = 0.1; // seconds between world updates
export const STATES = ['spawn', 'idle', 'chase', 'return', 'dead'];
const CODE = Object.fromEntries(STATES.map((s, i) => [s, i]));
const SEE_MONSTERS = 56; // a game hears about monsters this far (each way) from its hero
const SEE_PLAYERS = 80; // … and about other heroes
const ACTIVE = 90; // monsters further than this from every hero rest
const INSTANCE_TTL = 300; // seconds an empty dungeon copy is kept (come back for what you left)
const STAGE_PAUSE = 2.5; // s between a cave chamber cleared (its gate crumbles) and the next one's monsters rising
// The Death Canyon's calamities: how long each lasts (s), how many strikes fall around each hero out there, and
// how far from them (m)
const CALAMITIES = { quake: [7, 5, 10], meteors: [7, 7, 10], storm: [10, 8, 8], sandstorm: [12, 0, 0] };
const HERO_RADIUS = 0.5;
const SHARE_RANGE = 60; // party members this near a kill share it
const PARTY_BONUS = 0.2; // each extra member in range adds this much to the party's XP
const PVP_SCALE = 0.45; // heroes hit heroes much softer than monsters (fights last a few exchanges)
const PVP_CREDIT = 10; // seconds: a hero who falls this soon after another's blow was defeated by them
const MAX_DR = 0.85; // the most of a blow a hero's armor can take (what its game reports is held to this)…
const MAX_EVADE = 0.6; // …and the best chance it has to dodge one
const hitCap = (lvl) => 100 + 150 * lvl; // the most one blow can do (a check on what heroes' games report)
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const zonesOf = (map) => map.outdoor?.zones || map.zones || [];
const HELP_RANGE = 35; // m: how far a heal or tonic may reach another hero
const HELPS = { heal: [0, 1], rez: [0.1, 0.8] }; // what a hero's game may give another (buffs: skills.js checks)
const r3 = (v) => Math.round(v * 1000) / 1000;

// What a skill does besides damage, from a hero's game, checked: { stun: s, slow: [speed factor, s],
// taunt: s, dot: [damage a second, s, kind], weak: [share less damage, s], vuln: [share more taken, s] }
// (null if nothing sensible).
function cleanEffects(e) {
  if (!e || typeof e !== 'object') return null;
  const out = {};
  const stun = Number(e.stun), taunt = Number(e.taunt);
  if (stun > 0) out.stun = Math.min(3, stun);
  if (taunt > 0) out.taunt = Math.min(6, taunt);
  if (Array.isArray(e.slow) && Number(e.slow[1]) > 0) out.slow = [clamp(Number(e.slow[0]) || 1, 0.2, 1), Math.min(6, Number(e.slow[1]))];
  if (Array.isArray(e.dot) && Number(e.dot[0]) > 0 && Number(e.dot[1]) > 0) out.dot = [Math.round(Number(e.dot[0])), Math.min(10, Number(e.dot[1])), e.dot[2] === 'burn' ? 'burn' : 'poison'];
  if (Array.isArray(e.weak) && Number(e.weak[1]) > 0) out.weak = [clamp(Number(e.weak[0]) || 0, 0, 0.5), Math.min(12, Number(e.weak[1]))];
  if (Array.isArray(e.vuln) && Number(e.vuln[1]) > 0) out.vuln = [clamp(Number(e.vuln[0]) || 0, 0, 0.5), Math.min(12, Number(e.vuln[1]))];
  return Object.keys(out).length ? out : null;
}

// How a hit's effects look to the others: { s: stun, w: slow, t: taunt, p: poison s, pk: its kind, k: weak s,
// kf: how weak, v: exposed s, vf: how much }
function effectLooks(eff) {
  if (!eff) return 0;
  const l = {};
  if (eff.stun) l.s = eff.stun;
  if (eff.slow) l.w = eff.slow[1];
  if (eff.taunt) l.t = eff.taunt;
  if (eff.dot) { l.p = eff.dot[1]; l.pk = eff.dot[2]; }
  if (eff.weak) { l.k = eff.weak[1]; l.kf = eff.weak[0]; }
  if (eff.vuln) { l.v = eff.vuln[1]; l.vf = eff.vuln[0]; }
  return Object.keys(l).length ? l : 0;
}

// ---------------------------------------------------------------- monsters
class Monster {
  constructor(area, slot) {
    const sim = area.sim, d = ENEMY_TYPES[slot.type];
    this.area = area;
    this.sim = sim;
    this.slot = slot;
    this.id = ++sim.lastId;
    this.type = slot.type;
    this.def = d;
    this.level = slot.lvl;
    this.maxHp = Math.round(monsterHp(d, this.level) * (slot.hpMul || 1)); // (a cave's are stronger: caves.js)
    this.hp = this.maxHp;
    this.dmgMul = slot.dmgMul || 1;
    this.xpMul = slot.xpMul || 1;
    this.radius = d.radius * (d.scale || 1);
    this.dun = area.dun; // in a dungeon: walls to path around, and no seeing through them
    const home = slot.ring ? ringPoint(slot) : randomWalkablePoint(slot.x, slot.z, slot.r);
    this.home = { x: home.x, z: home.z };
    this.x = home.x;
    this.z = home.z;
    this.yaw = rand(0, TAU);
    this.state = 'spawn';
    this.stateT = 0;
    this.atkCd = rand(0.5, d.atkCd);
    this.attack = null;
    this.stagger = 0;
    this.stun = 0; // skills can stun, slow and taunt (see hit)
    this.slow = 0;
    this.slowBy = 1;
    this.taunt = 0;
    this.taunter = null;
    this.wanderT = rand(1, 4);
    this.wanderTarget = null;
    this.deadT = 0;
    this.swingCount = 0;
    this.speed = 0;
    this.target = null;
    this.sight = new Map(); // hero -> { at, clear }: line-of-sight checks in the crypt, 5 per second
    this.hitters = new Map(); // pid -> damage dealt: they (and their parties) share the kill
    this.raised = []; // a boss's calls for help so far (at 70% and 40% life)
    this.enraged = false; // bosses below 30% life
    this.dots = new Map(); // pid -> { dps, t, kind, acc }: poisons and burns heroes put on it (each their own)
    this.weak = 0; // weakened (a plague): hits softer (heroes' games apply it, they're told how much)
    this.vuln = 0; // exposed: takes more (heroes' games add it to their hits)
    if (d.lich) {
      this.circleT = 5;
      this.blinkCd = 6;
      this.closeT = 0;
    }
  }

  emit(ev, to = null) {
    this.area.events.push({ mid: this.id, ev, to });
  }

  dist(p) {
    return Math.hypot(p.x - this.x, p.z - this.z);
  }

  // A hero this monster may fight: here, alive, at the keyboard, outside camp and not vanished; a world
  // boss only fights heroes who struck it.
  fair(p) {
    return !!p && p.inWorld && p.area === this.area && p.alive && !p.away && !(p.hiddenUntil > this.sim.time) && !zoneAt(p.x, p.z)?.safe
      && (!this.def.passive || this.hitters.has(p.pid));
  }

  // Can it see the hero? Always, outside; in a dungeon, not through walls.
  sees(p) {
    if (!this.dun) return true;
    const t = this.sim.time;
    let s = this.sight.get(p);
    if (!s || t >= s.at) {
      if (this.sight.size > 8) this.sight.clear(); // heroes who left
      s = { at: t + 0.2, clear: this.dun.lineClear(this.x, this.z, p.x, p.z, 0.15) };
      this.sight.set(p, s);
    }
    return s.clear;
  }

  nearest(range, sight = true) {
    let best = null, bd = range;
    for (const p of this.area.players) {
      if (!this.fair(p)) continue;
      const d = this.dist(p);
      if (d < bd && (!sight || this.sees(p))) { bd = d; best = p; }
    }
    return best;
  }

  faceTo(x, z, dt, rate = 10) {
    this.yaw = dampAngle(this.yaw, yawTo(x - this.x, z - this.z), rate, dt);
  }

  moveToward(x, z, speed, dt) {
    if (this.slow > 0) speed *= this.slowBy;
    if (this.dun) { // head for the next corner of the path instead of into the wall
      const t = this.sim.time;
      if (t >= (this.navAt || 0) || (this.nav && Math.hypot(this.nav.x - this.x, this.nav.z - this.z) < 0.6)) {
        this.navAt = t + 0.25;
        this.nav = this.dun.steer(this.x, this.z, x, z, this.radius);
      }
      if (this.nav) { x = this.nav.x; z = this.nav.z; }
    }
    const dx = x - this.x, dz = z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    this.yaw = dampAngle(this.yaw, yawTo(dx, dz), 10, dt);
    return speed;
  }

  aggro(p, alertPack) {
    if (!p || this.state === 'dead' || this.state === 'spawn') return;
    if (this.def.passive && this.state !== 'chase') this.home = { x: this.x, z: this.z }; // (a roamer's fight is where it was struck)
    this.state = 'chase';
    this.stateT = 0;
    this.target = p;
    if (!alertPack || !this.slot.group) return;
    for (const o of this.area.monsters.values()) { // the rest of its pack joins in
      if (o !== this && o.state === 'idle' && o.slot.group === this.slot.group && Math.hypot(o.x - this.x, o.z - this.z) < 12) o.aggro(p, false);
    }
  }

  update(dt) {
    const d = this.def;
    this.stateT += dt;
    this.atkCd -= this.slow > 0 ? dt * this.slowBy : dt;
    this.stagger -= dt;
    this.stun -= dt;
    this.slow -= dt;
    this.taunt -= dt;
    this.speed = 0;

    if (this.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > 3.6) this.removed = true;
      return;
    }
    this.weak -= dt;
    this.vuln -= dt;
    if (this.dots.size && this.tickDots(dt)) return; // (poisoned to death)
    if (this.state === 'spawn') {
      if (this.stateT > (d.kind === 'slime' ? 0.5 : 1.0)) {
        this.state = 'idle';
        if (this.slot.summoned) this.aggro(this.nearest(30, false), false); // called by a boss: straight into the fight
      }
      return;
    }

    // who to fight: whoever taunted it; else the hero it's after while that's still fair; else the nearest
    let p = this.target;
    if (this.state === 'chase') {
      if (this.taunt > 0 && this.fair(this.taunter)) p = this.taunter;
      else if (!this.fair(p)) p = this.nearest(d.aggro * 1.2);
      else if (this.sim.time >= (this.rethinkAt || 0)) { // someone much closer gets its attention
        this.rethinkAt = this.sim.time + 1;
        p = this.nearest(this.dist(p) - 3) || p;
      }
      this.target = p;
    }
    const dx = p ? p.x - this.x : 0, dz = p ? p.z - this.z : 0;
    const dist = p ? Math.hypot(dx, dz) : Infinity;
    const distHome = Math.hypot(this.home.x - this.x, this.home.z - this.z);
    let speed = 0;

    if (this.attack) {
      this.updateAttack(dt, p, dist);
    } else if (this.stagger > 0 || this.stun > 0) {
      // reeling
    } else if (this.state === 'idle' && d.passive) {
      speed = this.roam(dt); // a world boss walks the land and leaves heroes alone
    } else if (this.state === 'idle') {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        const w = randomWalkablePoint(this.home.x, this.home.z, 4);
        this.wanderT = rand(3, 7);
        // in a dungeon, stay in your own room
        this.wanderTarget = this.dun && !this.dun.lineClear(this.home.x, this.home.z, w.x, w.z, this.radius) ? null : w;
      }
      if (this.wanderTarget) {
        speed = this.moveToward(this.wanderTarget.x, this.wanderTarget.z, d.speed * 0.35, dt);
        if (Math.hypot(this.wanderTarget.x - this.x, this.wanderTarget.z - this.z) < 0.3) this.wanderTarget = null;
      }
      const q = this.nearest(d.aggro);
      if (q) this.aggro(q, true);
    } else if (this.state === 'chase') {
      if (!p || distHome > d.aggro * 2.4) {
        this.state = 'return';
        this.target = null;
      } else if (d.lich) {
        speed = this.lichChase(dt, p, dist, dx, dz);
      } else if (d.boss && this.bossPhase()) {
        // (calling for help)
      } else if (d.kind === 'caster') {
        const sees = this.sees(p);
        this.standT = (this.standT || 0) - dt;
        // too close: it steps back, but a second or so at a time, then stands and fights a while (backing off
        // for as long as a hero stayed close, it never let one who fights up close reach it)
        if (dist < d.keep * 0.55 && sees && this.standT <= 0) {
          speed = this.moveToward(this.x - dx, this.z - dz, d.speed * 0.75, dt);
          if ((this.backT = (this.backT || 0) + dt) > 1.2) { this.backT = 0; this.standT = 3; }
        } else if (dist <= d.range && this.atkCd <= 0 && sees) {
          this.startCast(p);
        } else if (dist > d.range * 0.85 || !sees) {
          speed = this.moveToward(p.x, p.z, d.speed, dt);
        } else {
          this.faceTo(p.x, p.z, dt);
        }
      } else if (dist <= d.range + HERO_RADIUS && this.atkCd <= 0) {
        this.startAttack();
      } else if (dist > d.range * 0.8) {
        speed = this.moveToward(p.x, p.z, d.speed, dt);
      } else {
        this.faceTo(p.x, p.z, dt);
      }
    } else if (this.state === 'return') {
      speed = this.moveToward(this.home.x, this.home.z, d.speed * 1.2, dt);
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.4 * dt);
      if (distHome < 0.6) {
        this.state = 'idle';
        this.hitters.clear(); // a fresh start: nobody has a claim on it any more
      }
      const q = distHome < d.aggro ? this.nearest(d.aggro * 0.6) : null;
      if (q) this.aggro(q, false);
    }

    // keep apart from other monsters, and out of the heroes
    for (const o of this.area.monsters.values()) {
      if (o === this || o.state === 'dead') continue;
      const ex = this.x - o.x, ez = this.z - o.z, rr = this.radius + o.radius, dd = ex * ex + ez * ez;
      if (dd < rr * rr && dd > 1e-6) {
        const k = ((rr - Math.sqrt(dd)) * 0.5) / Math.sqrt(dd);
        this.x += ex * k;
        this.z += ez * k;
      }
    }
    for (const h of this.area.players) {
      if (!h.alive) continue;
      const ex = this.x - h.x, ez = this.z - h.z, rr = this.radius + HERO_RADIUS, dd = Math.hypot(ex, ez);
      if (dd < rr && dd > 1e-4) {
        this.x += (ex / dd) * (rr - dd);
        this.z += (ez / dd) * (rr - dd);
      }
    }
    resolveCollision(this, this.radius, !d.boss);
    this.speed = speed;
  }

  // A roaming world boss: from one of the land's zones to another, slowly.
  roam(dt) {
    const zones = zonesOf(this.area.map);
    if (!this.wanderTarget || Math.hypot(this.wanderTarget.x - this.x, this.wanderTarget.z - this.z) < 2) {
      const open = zones.filter((z) => !z.safe);
      const zn = open.length ? open[Math.floor(Math.random() * open.length)] : null;
      this.wanderTarget = zn ? randomWalkablePoint(zn.x, zn.z, zn.r * 0.6, 1.5) : randomWalkablePoint(this.x, this.z, 20, 1.5);
    }
    this.home = { x: this.x, z: this.z };
    return this.moveToward(this.wanderTarget.x, this.wanderTarget.z, this.def.speed * 0.45, dt);
  }

  // Poisons and burns: a tick a second for each hero's, credited to them. True if it fell.
  tickDots(dt) {
    for (const [pid, dot] of this.dots) {
      dot.t -= dt;
      dot.acc += dt;
      if (dot.acc >= 1 || dot.t <= 0) {
        const dmg = Math.max(1, Math.round(dot.dps * Math.min(1, dot.acc)));
        dot.acc = 0;
        const by = this.sim.players.get(pid);
        this.hp -= dmg;
        if (by) this.hitters.set(pid, (this.hitters.get(pid) || 0) + dmg);
        this.emit(['h', this.id, dmg, 0, 0, 0, pid]);
        if (this.hp <= 0) { this.die(by && by.area === this.area ? by : null); return true; }
      }
      if (dot.t <= 0) this.dots.delete(pid);
    }
    return false;
  }

  // ---------------------------------------------------------------- attacks (each hero's game resolves the hits)
  startAttack() {
    const d = this.def;
    this.swingCount++;
    if (d.boss && this.swingCount % 3 === 0) { // telegraphed ground slam
      const dur = 1.25, hitAt = 0.62 * dur;
      const at = { x: this.x + Math.sin(this.yaw) * 2.2, z: this.z + Math.cos(this.yaw) * 2.2 };
      this.attack = { t: 0, dur, hitAt, hit: false, slam: true };
      this.emit(['s', this.id, r2(at.x), r2(at.z), dur, r2(hitAt)]);
      return;
    }
    if (d.kind === 'slime') {
      this.attack = { t: 0, dur: 0.75, hitAt: 0.45, hit: false, lunge: true };
      this.emit(['l', this.id]);
      return;
    }
    const dur = d.atkDur, style = d.style || (d.boss ? 'chop' : this.swingCount % 2 ? 'slash' : 'backslash');
    this.attack = { t: 0, dur, hitAt: 0.45 * dur, hit: false };
    this.emit(['a', this.id, style, dur]);
  }

  startCast(p) {
    this.attack = { t: 0, dur: 1.0, hitAt: 0.5, hit: false, cast: true };
    this.emit(['c', this.id, p.pid, this.def.lich ? (this.enraged ? 5 : 3) : 1]);
  }

  updateAttack(dt, p, dist) {
    const a = this.attack, d = this.def;
    a.t += dt;
    if (p && a.t < a.hitAt) this.faceTo(p.x, p.z, dt, a.slam ? 3 : 8);
    if (!a.hit && a.t >= a.hitAt) {
      a.hit = true;
      if (a.summon) { // the first of each call is an elite after the first call
        const n = this.enraged ? 4 : 3, [common, elite = common] = d.summons || ['skeleton_minion', 'skeleton_warrior'];
        for (let i = 0; i < n; i++) {
          const ang = this.yaw + (i / n) * TAU;
          const x = this.x + Math.sin(ang) * 3.2, z = this.z + Math.cos(ang) * 3.2;
          const at = isWalkable(x, z, 0.6) ? { x, z } : randomWalkablePoint(this.x, this.z, 3, 0.6);
          this.area.summon(i === 0 && this.raised.length > 1 ? elite : common, this.level - 1, at.x, at.z, this);
        }
      } else if (a.circles && p) { // bursting flasks: under the hero and around them, on open floor
        const spots = [r2(p.x), r2(p.z)];
        for (let i = 1, tries = 0; i < (this.enraged ? 5 : 3) && tries < 30; tries++) {
          const ang = rand(0, TAU), r = rand(2.5, 5);
          const x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
          if (isWalkable(x, z, 2)) { spots.push(r2(x), r2(z)); i++; }
        }
        this.emit(['O', this.id, spots]);
      }
    }
    if (a.lunge && a.t > 0.2 && a.t < 0.5) {
      const f = Math.min(1, dist / 1.2);
      this.x += Math.sin(this.yaw) * 4 * f * dt;
      this.z += Math.cos(this.yaw) * 4 * f * dt;
    }
    if (a.t >= a.dur) {
      this.attack = null;
      if (!a.summon && !a.circles) this.atkCd = d.atkCd * (this.enraged ? 0.7 : 1) * rand(0.85, 1.15);
    }
  }

  // ---------------------------------------------------------------- bosses
  // At 70% and 40% life a boss calls for help (its robbers, its guards); below 30% it rages.
  // True when it starts a call (that's what it does this turn).
  bossPhase() {
    const frac = this.hp / this.maxHp;
    if (this.def.summons) {
      for (const th of [0.7, 0.4]) {
        if (frac < th && !this.raised.includes(th)) {
          this.raised.push(th);
          this.attack = { t: 0, dur: 1.5, hitAt: 0.8, hit: false, summon: true };
          this.emit(['u', this.id]);
          return true;
        }
      }
    }
    if (frac < 0.3 && !this.enraged) {
      this.enraged = true;
      this.emit(['e', this.id]);
    }
    return false;
  }

  // Morvain the Poisoner (and those like him): flask volleys, bursting flasks, slipping away when crowded.
  lichChase(dt, p, dist, dx, dz) {
    const d = this.def;
    if (this.bossPhase()) return 0;
    this.circleT -= dt;
    this.blinkCd -= dt;
    this.closeT = dist < 3.6 ? this.closeT + dt : Math.max(0, this.closeT - dt);
    if (this.closeT > 1.8 && this.blinkCd <= 0) { this.blink(p); return 0; }
    const sees = this.sees(p);
    if (sees && this.circleT <= 0 && dist < 20) {
      this.attack = { t: 0, dur: 1.1, hitAt: 0.5, hit: false, circles: true };
      this.circleT = this.enraged ? 5.5 : 8;
      this.emit(['o', this.id]);
      return 0;
    }
    if (sees && dist <= d.range && this.atkCd <= 0) { this.startCast(p); return 0; }
    if (dist < d.keep * 0.5) return this.moveToward(this.x - dx, this.z - dz, d.speed * 0.8, dt);
    if (!sees || dist > d.range * 0.85) return this.moveToward(p.x, p.z, d.speed, dt);
    this.faceTo(p.x, p.z, dt);
    return 0;
  }

  // Too close for comfort: vanish and reappear across its room.
  blink(p) {
    const B = this.dun?.rooms[this.slot.room || 'B'];
    if (!B) { this.blinkCd = 7; return; }
    let to = null;
    for (let i = 0; i < 12 && !to; i++) {
      const c = randomWalkablePoint(B.cx, B.cz, 8, 1.2);
      if (Math.hypot(c.x - p.x, c.z - p.z) > 8) to = c;
    }
    if (!to) return;
    this.emit(['b', this.id, r2(this.x), r2(this.z)]); // where it vanished; snapshots say where it went
    this.x = to.x;
    this.z = to.z;
    this.blinkCd = this.enraged ? 5 : 7;
    this.closeT = 0;
    this.atkCd = Math.min(this.atkCd, 0.5);
    this.nav = null;
  }

  // ---------------------------------------------------------------- taking hits
  // eff: { stun: s, slow: [factor, s], taunt: s } from skills (see cleanEffects); amount can be 0 (a taunt)
  hurt(amount, fx, fz, knock, by, eff) {
    const d = this.def;
    this.hp -= amount;
    this.hitters.set(by.pid, (this.hitters.get(by.pid) || 0) + Math.max(1, amount)); // (a taunt counts a little)
    if (this.state === 'idle' || this.state === 'return') this.aggro(by, true);
    else if (this.target !== by && (!this.fair(this.target) || this.dist(by) < this.dist(this.target))) this.target = by;
    if (!d.boss && knock > 0 && Number.isFinite(fx) && Number.isFinite(fz)) {
      const ex = this.x - fx, ez = this.z - fz, dd = Math.hypot(ex, ez) || 1;
      this.x += (ex / dd) * knock;
      this.z += (ez / dd) * knock;
      resolveCollision(this, this.radius);
    }
    if (eff) {
      const k = d.boss ? 0.4 : 1; // bosses shrug most of it off
      if (eff.stun) {
        this.stun = Math.max(this.stun, eff.stun * k);
        if (!d.boss && this.attack && !this.attack.summon && !this.attack.circles) { this.attack = null; this.emit(['x', this.id]); }
      }
      if (eff.slow) { this.slowBy = d.boss ? Math.max(eff.slow[0], 0.7) : eff.slow[0]; this.slow = Math.max(this.slow, eff.slow[1]); }
      if (eff.taunt) { this.taunt = eff.taunt; this.taunter = by; this.target = by; }
      if (eff.dot) this.dots.set(by.pid, { dps: eff.dot[0], t: eff.dot[1], kind: eff.dot[2], acc: 0 });
      if (eff.weak) this.weak = Math.max(this.weak, eff.weak[1]);
      if (eff.vuln) this.vuln = Math.max(this.vuln, eff.vuln[1]);
    }
    if (amount > 0 && this.hp > 0 && !d.boss) {
      if (this.attack && this.attack.t < this.attack.hitAt) { // interrupts wind-ups: rewards aggressive play
        this.attack = null;
        this.atkCd = Math.max(this.atkCd, 0.6);
        this.emit(['x', this.id]);
      }
      this.stagger = 0.28;
    }
  }

  // credit: false when it just crumbles (a boss's minions when it falls)
  die(by, credit = true) {
    this.state = 'dead';
    this.deadT = 0;
    this.attack = null;
    this.hp = 0;
    const credits = credit ? this.credits() : [];
    this.emit(['d', this.id, r2(this.x), r2(this.z), credits, by ? by.pid : 0, this.type, this.level], credits.map((c) => c[0]));
    if (this.def.boss) this.area.bossDown(this, credits);
  }

  // Who gets what for this kill: [[hero, XP share, loot 0/1], …]. The heroes who hurt it form teams: a
  // party (with its members nearby, hit or not) or a lone hero. The XP is split between teams by the
  // damage each dealt; a party's part goes to its members by their level, plus a bonus for each extra
  // member (grouping pays). The team that dealt the most gets the loot; a party's members take turns. A
  // world boss is fairer: everyone who dealt a tenth of its damage gets loot of their own too (each game
  // rolls its own: the unique one time in five). Everyone credited counts the kill for their quests.
  credits() {
    const sim = this.sim, teams = new Map();
    let total = 0;
    for (const [pid, dmg] of this.hitters) {
      const p = sim.players.get(pid);
      if (!p || p.area !== this.area) continue;
      const key = p.party ? `p${p.party}` : `h${pid}`;
      let t = teams.get(key);
      if (!t) teams.set(key, (t = { party: p.party, dmg: 0, heroes: [p] }));
      t.dmg += dmg;
      total += dmg;
    }
    let best = null;
    for (const t of teams.values()) {
      if (!best || t.dmg > best.dmg) best = t;
      if (t.party) {
        t.heroes = [...this.area.players].filter((o) => o.party === t.party
          && (this.hitters.has(o.pid) || (o.alive && Math.hypot(o.x - this.x, o.z - this.z) < SHARE_RANGE)));
      }
    }
    const out = [], fair = this.def.worldBoss ? total * 0.1 : Infinity;
    for (const t of teams.values()) {
      const n = t.heroes.length, pool = (t.dmg / total) * (1 + PARTY_BONUS * (n - 1));
      const levels = t.heroes.reduce((sum, h) => sum + h.level, 0);
      const looter = t !== best ? null : t.party ? t.heroes[sim.turn(t.party) % n] : t.heroes[0];
      for (const h of t.heroes) out.push([h.pid, r3((pool * h.level * this.xpMul) / levels), h === looter || (this.hitters.get(h.pid) || 0) >= fair ? 1 : 0]);
    }
    return out;
  }
}

// somewhere on a ring around the spawn (the pond's slimes live on its shore)
function ringPoint(slot) {
  const a = rand(0, TAU), r = rand(slot.r * 0.72, slot.r);
  return randomWalkablePoint(slot.x + Math.cos(a) * r, slot.z + Math.sin(a) * r, 1.5);
}

// ---------------------------------------------------------------- areas
// One place (maps.js) and what's in it: a land, or one party's copy of a dungeon.
class Area {
  constructor(sim, key, map) {
    this.sim = sim;
    this.key = key;
    this.map = map;
    this.dun = map.dungeon || null;
    this.players = new Set();
    this.monsters = new Map();
    this.events = [];
    this.emptyT = 0;
    this.slots = [];
    for (const sp of map.spawns || []) {
      for (let i = 0; i < sp.n; i++) this.slots.push({ ...sp, group: sp, monster: null, timer: rand(0, 1.5) });
    }
    // a land's world boss: it comes some minutes after heroes arrive, and again ten minutes after it falls
    const wb = !map.instanced && WORLD_BOSSES[map.id];
    this.wb = wb ? { ...wb, timer: WORLD_BOSS_FIRST, monster: null } : null;
    // a hidden cave (caves.js): its chambers one by one; cleared: how many have fallen silent
    this.cave = map.cave ? { def: map.cave, stage: 0, cleared: 0, done: false, nextAt: 3, entered: new Set(), t: 0 } : null;
    this.calamity = map.calamities ? { next: rand(30, 60), last: null } : null;
  }

  // The Death Canyon's calamities: every quarter of a minute or so one strikes around the heroes out in the canyon
  // (never in its camp), and as often as not another hard on its heels. The world picks the kind and where (the
  // first strike right by each hero: move!), so every game sees the same; each hero's game takes its own hurt
  // (canyon-view.js). ['Z', kind, seconds, [x, z, delay, …]]
  calamityTick(dt, heroes) {
    const c = this.calamity;
    if ((c.next -= dt) > 0) return;
    // the next: a minute or a minute and a half later, sometimes only 30-45 s; and often one more right after this
    // one, ten seconds or so later (never two in a row like that)
    c.chained = !c.chained && Math.random() < 0.35;
    c.next = c.chained ? rand(8, 12) : Math.random() < 0.25 ? rand(30, 45) : rand(60, 90);
    const out = heroes.filter((p) => p.alive && !p.away && !zoneAt(p.x, p.z)?.safe).slice(0, 10);
    if (!out.length) { c.next = rand(20, 40); c.chained = false; return; } // (all in camp: a while after one steps out)
    const kinds = Object.keys(CALAMITIES).filter((k) => k !== c.last);
    const kind = kinds[Math.floor(Math.random() * kinds.length)], [dur, n, far] = CALAMITIES[kind];
    c.last = kind;
    const spots = [];
    for (const p of out) {
      for (let i = 0; i < n; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const a = rand(0, TAU), d = i === 0 ? rand(0, 1.5) : rand(2, far), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
          if (!isWalkable(x, z, 0.4) || zoneAt(x, z)?.safe) continue;
          spots.push(r2(x), r2(z), r2(i === 0 ? rand(1.6, 2.4) : rand(1.8, dur - 0.4)));
          break;
        }
      }
    }
    this.events.push({ all: true, ev: ['Z', kind, dur, spots] });
  }

  // A cave's chambers: the first one's monsters a moment after the first hero arrives; then, as each
  // chamber's last monster falls, its gate opens and the next chamber's rise (for the heroes there then:
  // more heroes, stronger monsters). After the tenth (the keeper's), the cave is done.
  caveTick(dt) {
    const c = this.cave;
    c.t += dt;
    if (c.done) return;
    if (c.stage > c.cleared) { // a chamber is being fought
      for (const m of this.monsters.values()) if (m.slot.stage === c.stage && m.state !== 'dead') return;
      c.cleared = c.stage;
      if (c.cleared >= STAGES) { c.done = true; return; }
      c.nextAt = c.t + STAGE_PAUSE;
      return;
    }
    if (c.t < c.nextAt) return;
    c.stage++;
    const room = this.dun.rooms[STAGE_ROOMS[c.stage - 1]];
    for (const slot of stageSlots(c.def, c.stage, room, [...this.players].map((p) => p.level))) {
      const m = this.spawn(slot);
      m.state = 'spawn';
    }
  }

  // How the cave stands, for the heroes in it: [chambers cleared, monsters left in this one, done].
  caveView() {
    const c = this.cave;
    let left = 0;
    if (c.stage > c.cleared) for (const m of this.monsters.values()) if (m.slot.stage === c.stage && m.state !== 'dead') left++;
    return [c.cleared, left, c.done ? 1 : 0];
  }

  update(dt) {
    if (!this.players.size) { // nobody here: everything waits (a dungeon copy is let go after a while)
      this.emptyT += dt;
      return;
    }
    this.emptyT = 0;
    const heroes = [...this.players];
    if (this.cave) this.caveTick(dt);
    if (this.calamity) this.calamityTick(dt, heroes);
    if (this.wb && !this.wb.monster) {
      this.wb.timer -= dt;
      if (this.wb.timer <= 0) this.spawnWorldBoss(heroes);
    }
    for (const s of this.slots) {
      if (s.monster || s.once) continue;
      s.timer -= dt;
      // rise out of sight (or eight seconds later anyway: a hero hunting right there doesn't wait long)
      if (s.timer <= 0 && (s.timer < -8 || heroes.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > s.r + 6))) this.spawn(s);
    }
    for (const m of this.monsters.values()) {
      const near = heroes.some((p) => Math.abs(p.x - m.x) < ACTIVE && Math.abs(p.z - m.z) < ACTIVE);
      if (!near && (m.state === 'idle' || m.state === 'spawn')) continue;
      m.update(dt);
    }
    for (const m of this.monsters.values()) {
      if (!m.removed) continue;
      this.monsters.delete(m.id);
      if (this.wb?.monster === m) { this.wb.monster = null; this.wb.timer = WORLD_BOSS_RETURN; }
      if (m.slot.monster === m && !m.slot.once) {
        m.slot.monster = null;
        m.slot.timer = m.def.respawn || rand(9, 14); // (bosses: their own time)
      }
    }
  }

  // The world boss rises somewhere in the land, away from the heroes and the camp.
  spawnWorldBoss(heroes) {
    const zones = zonesOf(this.map).filter((z) => !z.safe);
    const ok = (z) => heroes.every((p) => Math.hypot(p.x - z.x, p.z - z.z) > 25);
    const zn = zones.filter(ok)[Math.floor(Math.random() * zones.filter(ok).length)] || zones[0];
    if (!zn) { this.wb.timer = 60; return; }
    const at = randomWalkablePoint(zn.x, zn.z, zn.r * 0.5, 1.6);
    const m = this.spawn({ type: this.wb.type, x: at.x, z: at.z, r: 1, n: 1, lvl: this.wb.lvl, world: true });
    this.wb.monster = m;
    this.sim.onWorldBoss?.(this, 'spawn', m, zn);
  }

  spawn(slot) {
    const m = new Monster(this, slot);
    slot.monster = m;
    this.monsters.set(m.id, m);
    return m;
  }

  // A monster called mid-fight (by a boss): no spawn slot, so it never comes back.
  summon(type, lvl, x, z, master) {
    const m = this.spawn({ type, x, z, r: 1, n: 1, lvl, summoned: true });
    m.summoner = master;
    return m;
  }

  // A boss fell: whatever it called crumbles, and everyone here hears (a dungeon's hoard opens; a world
  // boss's fall is told to the land).
  bossDown(boss, credits) {
    for (const o of this.monsters.values()) if (o.summoner === boss && o.state !== 'dead') o.die(null, false);
    this.events.push({ all: true, ev: ['L', boss.type] });
    if (boss === this.wb?.monster) this.sim.onWorldBoss?.(this, 'down', boss, credits);
  }
}

// ---------------------------------------------------------------- the world
export class WorldSim {
  constructor({ now = () => Date.now() } = {}) {
    planWorld(); // what blocks the way in Emberwood (the other places planned theirs when maps.js loaded)
    this.now = now;
    this.time = 0;
    this.lastId = 0;
    this.players = new Map(); // pid -> hero
    this.areas = new Map(); // key -> Area: a land by its id, a dungeon copy by `<dungeon>:<party or hero>`
    this.turns = new Map(); // party -> whose turn it is for loot (a counter)
    this.caves = new Map(); // `<cave>:<party or hero>` -> its open copy (an Area)
    this.caveN = 0;
  }

  // ---------------------------------------------------------------- the hidden caves (caves.js)
  // The copy of land's cave open for hero p's party (or p alone), if any is still there.
  caveFor(p, land) {
    const c = CAVES[land], a = c && this.caves.get(`${c.id}:${p.party ? `p${p.party}` : `h${p.key}`}`);
    return a && this.areas.get(a.key) === a ? a : null;
  }

  // A new copy of land's cave for hero p's party (a key was used; the server checked it).
  openCave(p, land) {
    const c = CAVES[land], who = p.party ? `p${p.party}` : `h${p.key}`;
    const a = this.area(`${c.id}:${who}:${++this.caveN}`, MAPS[c.id]);
    this.caves.set(`${c.id}:${who}`, a);
    return a;
  }

  // May hero pid go into land's hidden cave? At its mouth (or, join: anywhere but a cave or the arena, when its
  // party opened one), its land the furthest the hero may enter, not yet in a cave today (lastDay: the day of
  // its last cave run; once in, a hero never goes back in, even into the copy it left). A new copy needs a key
  // (hasKey). Each copy is its party's (or its hero's) alone: nobody else ever comes in.
  // { area } (the open copy to go into), { open: true } (use the key: openCave), or { error }.
  caveEntry(pid, land, { join = false, today = 0, lastDay = 0, hasKey = false } = {}) {
    const p = this.players.get(pid), c = CAVES[land], L = MAPS[land];
    if (!p?.area || !c) return { error: 'There is no such cave.' };
    if (!p.alive) return { error: 'You have fainted.' };
    const mine = caveLandFor(p.level);
    if (mine !== land) return { error: `${c.name} is for heroes of level ${c.heroes[0]} – ${c.heroes[1]}: yours is ${CAVES[mine].name} in ${MAPS[mine].name}.` };
    if (join) {
      if (p.area.map.kind === 'arena' || p.area.map.cave) return { error: 'The way there does not open from here.' };
    } else if (p.area.map.id !== land || Math.hypot(p.x - L.hiddenCave.mouth.x, p.z - L.hiddenCave.mouth.z) > MOUTH_REACH) return { error: 'Stand at the mouth of the cave.' };
    const area = this.caveFor(p, land);
    if (area?.cave.entered.has(p.key)) return { error: 'You have been in this cave today: once out, you can\'t go back in.' };
    if (lastDay === today) return { error: `You have been in a cave today. The caves open to you again in ${untilTomorrow()}.` };
    if (area && !area.cave.done) return { area };
    if (join) return { error: 'That cave has closed.' };
    if (!hasKey) return { error: `You need the key to ${c.name}.` };
    return { open: true };
  }

  // Hero pid into cave copy `area` (caveEntry said it may go in): it stands inside the mouth.
  enterCave(pid, area) {
    const p = this.players.get(pid);
    if (!p?.area || !area) return { error: 'The cave has closed.' };
    if (!p.alive) return { error: 'You have fainted.' };
    area.cave.entered.add(p.key);
    this.place(p, area);
    const at = area.map.arrive;
    Object.assign(p, { x: at.x, z: at.z, yaw: at.yaw ?? 0 });
    return { map: area.map.id, x: at.x, z: at.z, yaw: at.yaw ?? 0, ep: p.ep, copy: 'cave' };
  }

  // Whose turn for a party's loot (round robin).
  turn(party) {
    const n = this.turns.get(party) || 0;
    this.turns.set(party, n + 1);
    return n;
  }

  // Hero pid's party (0: none; the server keeps the parties). Their next dungeon is the party's copy.
  setParty(pid, party) {
    const p = this.players.get(pid);
    if (p) p.party = party || 0;
  }

  area(key, map) {
    let a = this.areas.get(key);
    if (!a) {
      a = new Area(this, key, map);
      this.areas.set(key, a);
    }
    return a;
  }

  // Where hero p goes in `map`: the land itself, or for a dungeon the copy its party is already in, else
  // its party's own (or the hero's own when alone).
  areaFor(map, p) {
    if (!map.instanced) return this.area(map.id, map);
    if (p.party) for (const o of this.players.values()) if (o !== p && o.party === p.party && o.area?.map === map) return o.area;
    return this.area(`${map.id}:${p.party ? `p${p.party}` : `h${p.key}`}`, map);
  }

  // A hero enters the world. info: { name, cls, key: the character's id, party, map, p, k } (p: position etc.,
  // k: looks, see input). Its game says where it is; a place it can't be (or can't be yet) sends it to
  // Emberwood's camp. Returns { map, ep, at? } (at: where it was put instead).
  join(pid, info) {
    this.leave(pid);
    const p = {
      pid, key: String(info.key || pid), name: info.name, cls: info.cls, level: 1, look: {}, lookVer: 1,
      x: 0, z: 3.5, yaw: Math.PI, mode: 0, sp: 0, alive: true, hp: 1, away: false, party: Number(info.party) || 0,
      area: null, ep: 0, inWorld: true, knownM: new Map(), knownP: new Map(), budget: 40,
    };
    this.players.set(pid, p);
    this.input(pid, { k: info.k }); // (its level first)
    const want = MAPS[info.map], x = Number(info.p?.[0]), z = Number(info.p?.[1]);
    const fits = want && p.level >= want.minLevel && Number.isFinite(x) && Number.isFinite(z) && want.contains(x, z);
    const map = fits ? want : MAPS[START];
    let area = null;
    if (fits && want.cave) { // back into its cave if it's still open and the hero was in it; else outside its mouth
      area = this.caveFor(p, want.land);
      if (!area?.cave.entered.has(p.key)) {
        const out = MAPS[want.land].hiddenCave.outside;
        this.place(p, this.areaFor(MAPS[want.land], p));
        Object.assign(p, { x: out.x, z: out.z, yaw: out.yaw });
        return { map: want.land, ep: p.ep, at: { ...out } };
      }
    }
    this.place(p, area || this.areaFor(map, p));
    if (fits) {
      this.input(pid, { p: info.p });
      return { map: map.id, ep: p.ep };
    }
    const at = map.respawn;
    Object.assign(p, { x: at.x, z: at.z, yaw: at.yaw });
    return { map: map.id, ep: p.ep, at: { x: at.x, z: at.z, yaw: at.yaw } };
  }

  leave(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    p.inWorld = false;
    p.area?.players.delete(p);
    this.players.delete(pid);
  }

  // Into another area (or a fresh start in the same one, e.g. rising where it fell): its game starts over
  // with what it sees there (ep tells its updates apart), so the world forgets what that game knew.
  place(p, area) {
    if (p.area !== area) {
      p.area?.players.delete(p);
      p.area = area;
      area.players.add(p);
    }
    p.ep++;
    p.knownM.clear();
    p.knownP.clear();
    p.lastHit = null;
    p.wbAt = undefined; // (tell it about the world boss here, if any)
    p.caveKey = undefined; // (and how the cave stands)
  }

  // Hero pid goes to map `to`: through a portal it stands at (a waystone, a dungeon's door or stairs), or,
  // fallen (respawn), to where heroes who fall here rise, or with a camp scroll (camp) to this land's camp.
  // { map, x, z, yaw, ep } or { error }.
  travel(pid, to, { respawn = false, camp = false } = {}) {
    const p = this.players.get(pid), map = MAPS[to];
    if (!p?.area || !map) return { error: 'There is no such place.' };
    const from = p.area.map;
    let at;
    if (respawn || camp) {
      if (respawn && p.alive) return { error: 'You are still standing.' };
      if (camp && (!p.alive || from.kind === 'arena')) return { error: 'The scroll does not work here.' };
      if (from.respawn.map !== to) return { error: 'You wake up elsewhere.' };
      at = from.respawn;
    } else {
      if (!p.alive) return { error: 'You have fainted.' };
      const portal = portalTo(from, to, p.x, p.z);
      if (!portal) return { error: 'The way there is not here.' };
      if (portal.needs === 'cleared' && !p.area.cave?.done) return { error: 'The way out opens when the keeper falls.' };
      if (p.level < map.minLevel) return { error: `${map.name} is for heroes of level ${map.minLevel} and up.` };
      at = arrival(portal, to);
    }
    this.place(p, this.areaFor(map, p));
    Object.assign(p, { x: at.x, z: at.z, yaw: at.yaw ?? 0 });
    return { map: map.id, x: at.x, z: at.z, yaw: at.yaw ?? 0, ep: p.ep, copy: map.instanced ? (p.party ? 'party' : 'own') : null };
  }

  // A party member steps through a scientist's door in space to their side (the server checked the party).
  summon(pid, toPid) {
    const p = this.players.get(pid), o = this.players.get(toPid);
    if (!p?.area || !o?.area || !o.alive || !p.alive) return { error: 'The door has closed.' };
    const map = o.area.map;
    if (map.kind === 'arena') return { error: 'The door does not open into the arena.' };
    if (p.level < map.minLevel) return { error: `${map.name} is for heroes of level ${map.minLevel} and up.` };
    const area = map.instanced ? (p.party && p.party === o.party ? o.area : null) : o.area;
    if (!area) return { error: 'The door has closed.' };
    if (area.cave) return { error: 'The door does not open into a cave.' };
    const a = rand(0, TAU), x = o.x + Math.cos(a) * 1.6, z = o.z + Math.sin(a) * 1.6;
    const at = isWalkable(x, z, 0.5) ? { x, z } : { x: o.x, z: o.z };
    this.place(p, area);
    Object.assign(p, { x: at.x, z: at.z, yaw: o.yaw });
    return { map: map.id, x: at.x, z: at.z, yaw: o.yaw, ep: p.ep };
  }

  // A hero's game reports in: p = [x, z, yaw, move (0 still, 1 walk, 2 run), speed, alive, life 0..1,
  // away, armor's share, dodge], h = hits [[monster, damage, crit, knockback, fromX, fromZ, effects?]], ph = hits
  // on other heroes in the arena [[hero, damage, crit, effects?]], bh = help for other heroes [[hero, 'heal' |
  // 'buff' | 'rez', value]], hd = vanish for s, a = actions for the others to see ({ k: kind, … }), k = looks
  // ({ lv: level, w: weapon, … }).
  input(pid, m) {
    const p = this.players.get(pid);
    if (!p || !m || typeof m !== 'object') return;
    const wasAlive = p.alive;
    if (Array.isArray(m.p) && m.p.length >= 3) {
      const [x, z, yaw, mode, sp, alive, hp, away, dr, ev] = m.p.map(Number);
      // (only where it is: a position from before a journey is left behind)
      if (Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(yaw) && p.area?.map.contains(x, z)) {
        p.x = x;
        p.z = z;
        p.yaw = yaw;
        p.mode = mode === 1 || mode === 2 ? mode : 0;
        p.sp = clamp(sp || 0, 0, 20);
        p.alive = alive !== 0;
        p.hp = clamp(Number.isFinite(hp) ? hp : 1, 0, 1);
        p.away = away === 1;
        p.dr = clamp(dr || 0, 0, MAX_DR); // how much of a blow its armor takes, and its chance to dodge one
        p.ev = clamp(ev || 0, 0, MAX_EVADE);
      }
    }
    if (m.k && typeof m.k === 'object' && JSON.stringify(m.k).length < 500) {
      p.look = m.k;
      p.level = clamp(Math.round(Number(m.k.lv) || 1), 1, 99);
      p.lookVer++;
    }
    if (Array.isArray(m.h)) for (const h of m.h.slice(0, 40)) this.hit(p, h);
    if (Array.isArray(m.ph)) for (const h of m.ph.slice(0, 20)) this.hitHero(p, h);
    if (Array.isArray(m.bh)) for (const h of m.bh.slice(0, 12)) this.help(p, h);
    if (Number(m.hd) > 0 && p.alive) p.hiddenUntil = this.time + Math.min(5, Number(m.hd));
    // fell in the arena right after another hero's blow: theirs is the win
    if (wasAlive && !p.alive && p.lastHit && this.time - p.lastHit.at < PVP_CREDIT) {
      const by = this.players.get(p.lastHit.by);
      p.lastHit = null;
      if (by && by.area === p.area) {
        p.area.events.push({ all: true, ev: ['K', by.pid, p.pid] });
        this.onHeroDown?.(by, p);
      }
    }
    if (Array.isArray(m.a)) {
      for (const a of m.a.slice(0, 8)) {
        if (a && typeof a === 'object' && typeof a.k === 'string' && JSON.stringify(a).length < 240) p.area?.events.push({ pid: p.pid, ev: ['p', p.pid, a] });
      }
    }
  }

  hit(p, h) {
    if (!Array.isArray(h) || p.budget < 1) return;
    const m = p.area?.monsters.get(h[0]);
    if (!m || m.state === 'dead' || m.state === 'spawn') return;
    let dmg = Math.round(Number(h[1]));
    const eff = cleanEffects(h[6]);
    if (!(dmg >= 0) || (dmg === 0 && !eff)) return; // (0 damage: a skill that only stuns or taunts)
    if (Math.hypot(m.x - p.x, m.z - p.z) > 30) return; // can't have reached it from there
    p.budget--;
    dmg = Math.min(dmg, hitCap(p.level));
    if (eff?.dot) eff.dot[0] = Math.min(eff.dot[0], Math.round(hitCap(p.level) * 0.25));
    m.hurt(dmg, Number(h[4]), Number(h[5]), clamp(Number(h[3]) || 0, 0, 2), p, eff);
    // the others see the number, and the stars, frost, poison… (see effectLooks)
    const looks = effectLooks(eff);
    m.emit(looks ? ['h', m.id, dmg, h[2] ? 1 : 0, p.pid, looks] : ['h', m.id, dmg, h[2] ? 1 : 0, p.pid]);
    if (m.hp <= 0) m.die(p);
  }

  // Hero p heals, boosts or brings round hero h[0] (a friend: not a foe in the arena's pit). Its game worked out
  // how much; the world keeps it within reason and passes it to the friend's game.
  help(p, h) {
    if (!Array.isArray(h) || p.budget < 1 || !p.alive) return;
    const o = this.players.get(h[0]), kind = h[1];
    if (!o || o === p || o.area !== p.area || o.away || Math.hypot(o.x - p.x, o.z - p.z) > HELP_RANGE) return;
    if (p.area.map.pvp && !(p.party && p.party === o.party) && (zoneAt(p.x, p.z)?.pvp || zoneAt(o.x, o.z)?.pvp)) return; // (no help for foes)
    let value;
    if (kind === 'heal' || kind === 'rez') {
      if ((kind === 'rez') === o.alive) return;
      value = clamp(Number(h[2]) || 0, ...HELPS[kind]);
    } else if (kind === 'buff' && Array.isArray(h[2]) && typeof h[2][0] === 'string' && h[2][0].length < 24) {
      if (!o.alive) return;
      value = [h[2][0], clamp(Number(h[2][1]) || 0, 0, 5000)];
    } else return;
    p.budget--;
    p.area.events.push({ hero: o.pid, ev: ['B', o.pid, kind, value, p.pid] });
  }

  // In the arena's pit: hero p hits hero h[0] (not in p's party). The world works out what the blow really
  // does (the victim's armor and dodging, which its game reports), so the striker, the victim and everyone
  // watching see the same number; the victim's game takes exactly that. The world remembers who struck last.
  hitHero(p, h) {
    if (!Array.isArray(h) || p.budget < 1 || !p.area?.map.pvp || !p.alive) return;
    const o = this.players.get(h[0]);
    if (!o || o === p || o.area !== p.area || !o.alive || o.away || (p.party && p.party === o.party)) return;
    if (!zoneAt(p.x, p.z)?.pvp || !zoneAt(o.x, o.z)?.pvp) return; // both in the pit
    if (Math.hypot(o.x - p.x, o.z - p.z) > 30) return;
    let dmg = Math.round(Number(h[1]));
    const eff = cleanEffects(h[3]);
    if (!(dmg >= 0) || (dmg === 0 && !eff)) return;
    p.budget--;
    let miss = 0;
    if (dmg > 0) {
      dmg = Math.min(dmg, hitCap(p.level)) * PVP_SCALE;
      if (Math.random() < (o.ev || 0)) { miss = 1; dmg = 0; } // dodged (smoke, evasion)
      else dmg = Math.max(1, Math.round(dmg * (1 - (o.dr || 0)) * rand(0.92, 1.08)));
    }
    o.lastHit = { by: p.pid, at: this.time };
    // (a stun on a hero is short: half, and at most 1.5 s; a dodged blow does nothing)
    const looks = eff && !miss ? { ...(eff.stun && { s: Math.min(1.5, eff.stun * 0.5) }), ...(eff.slow && { w: eff.slow[1], f: eff.slow[0] }) } : null;
    const ev = ['H', o.pid, dmg, h[2] && !miss ? 1 : 0, p.pid, looks && Object.keys(looks).length ? looks : 0, miss];
    p.area.events.push({ hero: o.pid, ev });
  }

  // Advance the world by dt seconds, then hand each hero's game its update: deliver(pid, message).
  step(dt, deliver) {
    this.time += dt;
    for (const p of this.players.values()) p.budget = Math.min(60, p.budget + dt * 40);
    for (const [key, a] of this.areas) {
      a.update(dt);
      if (a.map.instanced && !a.players.size && a.emptyT > INSTANCE_TTL) {
        this.areas.delete(key);
        for (const [k, v] of this.caves) if (v === a) this.caves.delete(k);
      }
    }
    const ts = this.now();
    for (const p of this.players.values()) deliver(p.pid, this.snapshot(p, ts));
    for (const a of this.areas.values()) a.events.length = 0;
  }

  // What one hero's game needs: monsters and heroes nearby (in full the first time, then only what
  // changed), who went out of sight, and what happened this tick.
  //   m: { i, t: type, l: level, x, z, y: yaw, h: life, mh: max life, s: state, st: time in state, sp: speed, e: enraged }
  //      or [i, x, z, yaw, speed, life, state];  mg: monsters gone
  //   p: { i, n: name, c: class, l: level, k: looks, u: [i, x, z, yaw, move, speed, alive, life, away] }
  //      or that u array alone;  pg: heroes gone;  e: events (see the emit calls)
  snapshot(me, ts) {
    const out = { t: 'w', ts, ep: me.ep };
    const area = me.area;
    if (!area) return out;
    const m = [], mg = [], seen = new Set();
    for (const mon of area.monsters.values()) {
      if (Math.abs(mon.x - me.x) > SEE_MONSTERS || Math.abs(mon.z - me.z) > SEE_MONSTERS) continue;
      seen.add(mon.id);
      const x = r2(mon.x), z = r2(mon.z), yaw = r2(mon.yaw), hp = Math.max(0, Math.round(mon.hp)), st = CODE[mon.state], sp = r1(mon.speed);
      const k = me.knownM.get(mon.id);
      if (!k) {
        const rec = { i: mon.id, t: mon.type, l: mon.level, x, z, y: yaw, h: hp, mh: mon.maxHp, s: st, st: r2(mon.stateT), sp, e: mon.enraged ? 1 : 0 };
        if (mon.dmgMul !== 1) rec.k = r2(mon.dmgMul); // (a cave's elite: hits harder)
        m.push(rec);
        me.knownM.set(mon.id, { x, z, yaw, hp, st, sp });
      } else if (k.x !== x || k.z !== z || k.yaw !== yaw || k.hp !== hp || k.st !== st || k.sp !== sp) {
        m.push([mon.id, x, z, yaw, sp, hp, st]);
        Object.assign(k, { x, z, yaw, hp, st, sp });
      }
    }
    for (const id of me.knownM.keys()) if (!seen.has(id)) { mg.push(id); me.knownM.delete(id); }

    const pl = [], pg = [], seenP = new Set();
    for (const o of area.players) {
      if (o === me || Math.abs(o.x - me.x) > SEE_PLAYERS || Math.abs(o.z - me.z) > SEE_PLAYERS) continue;
      seenP.add(o.pid);
      const u = [o.pid, r2(o.x), r2(o.z), r2(o.yaw), o.mode, r1(o.sp), o.alive ? 1 : 0, r2(o.hp), o.away ? 1 : 0];
      const key = u.join(), k = me.knownP.get(o.pid);
      if (!k || k.ver !== o.lookVer) {
        pl.push({ i: o.pid, n: o.name, c: o.cls, l: o.level, k: o.look, u });
        me.knownP.set(o.pid, { ver: o.lookVer, key });
      } else if (k.key !== key) {
        pl.push(u);
        k.key = key;
      }
    }
    for (const id of me.knownP.keys()) if (!seenP.has(id)) { pg.push(id); me.knownP.delete(id); }

    const ev = [];
    for (const e of area.events) {
      if (e.all) ev.push(e.ev);
      else if (e.mid !== undefined) { if (me.knownM.has(e.mid) || e.to?.includes(me.pid)) ev.push(e.ev); }
      else if (e.hero !== undefined) { if (e.hero === me.pid || me.knownP.has(e.hero)) ev.push(e.ev); } // (a blow to a hero)
      else if (e.pid !== me.pid && me.knownP.has(e.pid)) ev.push(e.ev);
    }
    // a world boss roaming this land: where it is, for everyone here (once a second, or when it comes or goes)
    if (area.wb) {
      const b = area.wb.monster, v = b && b.state !== 'dead' ? [b.type, r1(b.x), r1(b.z), r2(b.hp / b.maxHp)] : 0;
      if (v ? !me.wbAt || ts - me.wbAt >= 1000 : me.wbAt !== 0) { out.wb = v; me.wbAt = v ? ts : 0; }
    } else if (me.wbAt) { out.wb = 0; me.wbAt = 0; }
    // in a cave: its chambers, when that changes (and on arriving)
    if (area.cave) {
      const v = area.caveView(), key = v.join();
      if (me.caveKey !== key) { out.cv = v; me.caveKey = key; }
    }
    if (m.length) out.m = m;
    if (mg.length) out.mg = mg;
    if (pl.length) out.p = pl;
    if (pg.length) out.pg = pg;
    if (ev.length) out.e = ev;
    return out;
  }
}

// The game's side of the shared world (sim/world.js: run by the game server, or by local.js offline).
// We're in one place (area) of it at a time; the world numbers our stays (ep), so updates from a place we
// just left are ignored. Updates arrive ten times a second. Monsters and other heroes are shown a moment (DELAY) in the past,
// so their movement can be filled in smoothly between updates and what they do happens in step with
// it. Our own hero is never delayed: we tell the world where it is, what it hit and what it did.
import { lookOf } from './player.js';

const DELAY = 180; // ms
const SEND_EVERY = 0.05; // s: hits and actions go out this often…
const MOVE_EVERY = 0.1; // …our position when it changes, at most this often…
const IDLE_EVERY = 1; // …and at least this often
const STALE = 1500; // ms: older events (e.g. after the app was in the background) only count if they matter
const r2 = (v) => Math.round(v * 100) / 100;

export class WorldLink {
  constructor(game) {
    this.game = game;
    this.net = null;
    this.pid = 0;
    this.ep = 0; // which stay in which place the world's updates must be about
    this.inWorld = false;
    this.clock = 0; // s, our own time
    this.offset = null; // ms: our clock minus the world's, from the quickest updates
    this.renderT = 0; // ms, world time: the moment monsters and heroes are shown at
    this.queue = []; // { ts, ev }: events waiting for their moment
    this.hits = [];
    this.heroHits = [];
    this.helps = [];
    this.acts = [];
    this.hide = 0;
    this.lookDirty = false;
    this.sendT = 0;
    this.moveT = -IDLE_EVERY;
    this.lastKey = '';
  }

  attach(net) {
    this.net = net;
    net.on('w', (m) => this.receive(m));
  }

  // Our hero steps into the world (after picking a hero, and again after reconnecting), where it is. If
  // the world puts it somewhere else (a place it can't be in), we go there.
  async enter() {
    const g = this.game;
    this.reset();
    const r = await this.net.request('enter', { name: g.character.name, cls: g.character.cls, map: g.places.id, p: this.state(), k: lookOf(g.player) });
    this.reset();
    this.pid = r.pid;
    this.ep = r.ep ?? 0;
    this.inWorld = true;
    g.chat?.entered(r);
    if (r.at || (r.map && r.map !== g.places.id)) {
      const at = r.at || g.player.pos;
      await g.arrive({ map: r.map, x: at.x, z: at.z, yaw: at.yaw ?? g.player.yaw });
    }
    return r;
  }

  // Through a portal (or, fallen, to where heroes rise; camp: a camp scroll; summon: a party member's door
  // through space): the world moves us; what we saw stays behind.
  async travel(to, { respawn = false, camp = false, summon = null } = {}) {
    const r = await this.net.request('travel', { to, respawn, camp, summon });
    this.ep = r.ep;
    this.queue = [];
    this.hits = [];
    this.game.enemies.clear();
    this.game.others.clear();
    return r;
  }

  // Into a hidden cave (caves.js): the server checks the key (in save) or our party's open copy.
  async cave(land, { join = false, save = null } = {}) {
    const r = await this.net.request('cave', { land, join, save });
    this.ep = r.ep;
    this.queue = [];
    this.hits = [];
    this.game.enemies.clear();
    this.game.others.clear();
    return r;
  }

  exit() {
    if (this.inWorld) this.net.request('exit').catch(() => { /* gone anyway */ });
    this.reset();
  }

  reset() {
    this.inWorld = false;
    this.queue = [];
    this.offset = null;
    this.hits = [];
    this.heroHits = [];
    this.helps = [];
    this.acts = [];
    this.lastKey = '';
    this.moveT = -IDLE_EVERY;
    this.game.enemies?.clear();
    this.game.others?.clear();
  }

  // ---------------------------------------------------------------- what the world says
  receive(m) {
    if (!this.inWorld || !Number.isFinite(m.ts) || (m.ep !== undefined && m.ep !== this.ep)) return;
    const lag = this.clock * 1000 - m.ts;
    // the quickest update gives the truest offset; creep up slowly in case the clocks drift apart
    this.offset = this.offset === null || lag < this.offset ? lag : this.offset + 0.25;
    const g = this.game;
    if (m.m) g.enemies.records(m.m, m.ts);
    if (m.p) g.others.records(m.p, m.ts);
    for (const id of m.mg || []) g.enemies.remove(id); // out of sight (far away, or long dead)
    for (const id of m.pg || []) g.others.remove(id);
    for (const ev of m.e || []) this.queue.push({ ts: m.ts, ev });
    if (m.wb !== undefined) g.worldBoss = m.wb ? { type: m.wb[0], x: m.wb[1], z: m.wb[2], hp: m.wb[3], map: g.places.id } : null;
    if (m.cv) g.places.view.setState?.(m.cv); // (in a cave: its chambers)
  }

  update(dt) {
    this.clock += dt;
    if (!this.inWorld || this.offset === null) return;
    const T = this.clock * 1000 - this.offset - DELAY;
    this.renderT = T;
    let n = 0;
    while (n < this.queue.length && this.queue[n].ts <= T) n++;
    if (n) for (const { ts, ev } of this.queue.splice(0, n)) this.dispatch(ev, T - ts > STALE);
    this.flush(dt);
  }

  dispatch(ev, stale) {
    const g = this.game;
    if (ev[0] === 'd') g.enemies.died(ev); // credit for kills always counts
    else if (ev[0] === 'L') g.places.bossDown(ev[1]);
    else if (ev[0] === 'H') g.heroHit(ev); // (a blow in the arena: ours to take even if late)
    else if (ev[0] === 'K') g.heroDown(ev);
    else if (ev[0] === 'B') { if (ev[1] === this.pid) g.helped(ev); else g.others.helped(ev); } // (a friend's heal or tonic)
    else if (stale) return;
    else if (ev[0] === 'p') g.others.act(ev[1], ev[2]);
    else if (ev[0] === 'Z') g.places.view.calamity?.(ev); // (the Death Canyon's calamities)
    else g.enemies.event(ev);
  }

  // ---------------------------------------------------------------- what we tell it
  flush(dt) {
    this.sendT += dt;
    if (this.sendT < SEND_EVERY) return;
    this.sendT = 0;
    const msg = {};
    const st = this.state(), key = st.join(), since = this.clock - this.moveT;
    if ((key !== this.lastKey && since >= MOVE_EVERY) || since >= IDLE_EVERY) {
      msg.p = st;
      this.lastKey = key;
      this.moveT = this.clock;
    }
    if (this.hits.length) { msg.h = this.hits; this.hits = []; }
    if (this.heroHits.length) { msg.ph = this.heroHits; this.heroHits = []; }
    if (this.helps.length) { msg.bh = this.helps; this.helps = []; }
    if (this.acts.length) { msg.a = this.acts; this.acts = []; }
    if (this.hide) { msg.hd = this.hide; this.hide = 0; }
    if (this.lookDirty) { msg.k = lookOf(this.game.player); this.lookDirty = false; }
    if (msg.p || msg.h || msg.ph || msg.bh || msg.a || msg.k || msg.hd) this.net.send('u', msg);
  }

  // Right now, not at the next turn (e.g. the app is going to the background).
  sendNow() {
    if (!this.inWorld) return;
    this.sendT = SEND_EVERY;
    this.moveT = -IDLE_EVERY;
    this.flush(0);
  }

  // [x, z, yaw, move (0 still, 1 walk, 2 run), speed, alive, life 0..1, away, armor's share of a blow,
  // chance to dodge, Life, most Life] (armor and dodging: the world works out other heroes' blows with them, in
  // the arena; Life in numbers: for the others' target frames)
  state() {
    const p = this.game.player;
    return [r2(p.pos.x), r2(p.pos.z), r2(p.yaw), p.moveMode || 0, r2(p.moveSpeed || 0), p.alive ? 1 : 0,
      r2(Math.min(1, Math.max(0, p.hp / p.stats.maxHp))), document.hidden && !this.game.huntsInBackground() ? 1 : 0, r2(1 - (1 - p.stats.dr) * p.stats.taken), r2(p.stats.evade || 0),
      Math.max(0, Math.ceil(p.hp)), Math.round(p.stats.maxHp)];
  }

  // Our hero hit monster e (the world applies it). eff: { stun, slow: [factor, s], taunt } from skills
  hit(e, dmg, crit, knock, from, eff = null) {
    if (!this.inWorld) return;
    const h = [e.id, dmg, crit ? 1 : 0, r2(knock), r2(from.x), r2(from.z)];
    if (eff) h.push(eff);
    this.hits.push(h);
  }

  // Our hero hit another hero in the arena's pit (their game takes the blow). eff: { stun, slow }
  hitHero(o, dmg, crit, eff = null) {
    if (!this.inWorld) return;
    const h = [o.id, dmg, crit ? 1 : 0];
    if (eff) h.push(eff);
    this.heroHits.push(h);
  }

  // Our hero helped another (their game takes it): kind 'heal' (a share of their Life), 'buff' ([id, strength])
  // or 'rez' (a share of their Life to rise with).
  help(o, kind, value) {
    if (this.inWorld) this.helps.push([o.id, kind, value]);
  }

  // Our hero slipped out of sight (Vanish): monsters forget it for a few seconds.
  vanish(secs) {
    this.hide = Math.max(this.hide, secs);
  }

  // Something the others should see our hero do: { k: kind, … } (see others.js)
  act(a) {
    if (this.inWorld) this.acts.push(a);
  }

  lookChanged() {
    this.lookDirty = true;
  }
}

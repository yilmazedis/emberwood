// What our hero does besides the keys and the joystick: the target it has picked (click or tap a foe or a
// friend, Z for the nearest foe, Esc lets go), where a click on the ground sends it, walking into range of what
// it was told to attack or cast at, holding the attack, and hunting on its own (auto, T): it picks the
// nearest monster around the spot it was switched on, fights it, picks up the loot and drinks when hurt.
import * as THREE from 'three';
import { heightAt } from './world.js';
import { SKILLS } from './skills.js';

const AUTO_RANGE = 15; // m from where auto was switched on that it hunts
const AUTO_LEASH = 26; // …and it walks back if it ends up farther than this
const LOOT_RANGE = 9;

export class Control {
  constructor(game, player) {
    this.game = game;
    this.p = player;
    this.reset();
  }

  reset() {
    this.target = null; // a monster, or another hero (a foe in the pit, or a friend to heal)
    this.moveTo = null; // a spot clicked on the ground
    this.pending = null; // { kind: 'attack' } or { kind: 'skill', id }: walking into range first
    this.holding = false; // the attack is held down: keep swinging
    this.auto = null; // { anchor }: hunting on our own
    this.lootT = 0;
  }

  // ---------------------------------------------------------------- what can be targeted
  isFoe(e) {
    if (!e || !e.alive) return false;
    if (e.isHero) return !!e.hostile;
    return e.state !== 'spawn' && e.state !== 'dead';
  }

  isFriend(e) {
    return !!e && e.isHero && !e.hostile;
  }

  // Still there to aim at? (a fallen friend stays targeted: healers raise them)
  valid(e) {
    if (!e) return false;
    if (e.isHero) return this.game.others.byId.get(e.id) === e;
    return this.game.enemies.byId.get(e.id) === e && e.alive;
  }

  setTarget(e) {
    if (this.target === e) return;
    if (this.target) this.target.selected = false;
    this.target = e;
    if (e) e.selected = true;
    this.game.ui.setTarget(e);
  }

  clearTarget() {
    this.setTarget(null);
    this.pending = null;
    this.holding = false;
  }

  // The nearest foe within range of `from` (a monster or a hostile hero), skipping `skip`.
  nearestFoe(range, from = this.p.pos, skip = null) {
    let best = null, bd = range;
    for (const e of this.game.foes) {
      if (e === skip || !this.isFoe(e)) continue;
      const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z) - e.radius;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Z: the nearest foe; pressed again, the next nearest.
  cycleTarget() {
    const cur = this.isFoe(this.target) ? this.target : null;
    const list = this.game.foes.filter((e) => this.isFoe(e) && this.dist(e) < 22).sort((a, b) => this.dist(a) - this.dist(b));
    if (!list.length) { this.game.ui.centerMsg('No enemy nearby'); return; }
    const i = cur ? list.indexOf(cur) : -1;
    this.setTarget(list[(i + 1) % list.length]);
  }

  dist(e) {
    return Math.hypot(e.pos.x - this.p.pos.x, e.pos.z - this.p.pos.z);
  }

  // ---------------------------------------------------------------- commands
  // A click (or tap) on the ground: walk there.
  clickGround(point) {
    this.moveTo = point.clone();
    this.pending = null;
    this.holding = false;
    this.stopAuto();
  }

  // A click on a monster or a hero: pick it; on a foe, attack it (a press: it can combo).
  clickEntity(e, hold = false) {
    this.setTarget(e);
    this.moveTo = null;
    if (this.isFoe(e)) {
      this.pressAttack();
      this.holding = hold;
    }
  }

  // R, a click on the target, the attack button: attack the target (or the nearest foe), walking into range.
  pressAttack() {
    const p = this.p;
    if (!p.alive) return;
    this.stopAuto(true);
    if (!this.isFoe(this.target)) {
      const near = this.nearestFoe(p.stats.ranged ? 16 : 12);
      if (near) this.setTarget(near);
    }
    const t = this.isFoe(this.target) ? this.target : null;
    if (!t) { p.basicAttack(null, true); return; } // (nothing near: swing anyway)
    this.moveTo = null;
    if (this.dist(t) > p.attackRange(t)) this.pending = { kind: 'attack' };
    else { this.pending = null; p.basicAttack(t, true); }
  }

  holdAttack(on) {
    this.holding = on;
    if (on && !this.isFoe(this.target)) {
      const near = this.nearestFoe(this.p.stats.ranged ? 16 : 12);
      if (near) this.setTarget(near);
    }
  }

  // The keys or the joystick took over: forget where a click was going.
  manualMove() {
    this.moveTo = null;
    if (this.pending?.kind === 'attack' || this.pending?.kind === 'skill') this.pending = null;
    this.stopAuto(true);
  }

  toggleAuto() {
    if (this.auto) { this.stopAuto(); return; }
    if (!this.p.alive) return;
    if (this.game.currentZone?.safe) { this.game.ui.centerMsg('Hunt outside the camp'); return; }
    this.auto = { anchor: this.p.pos.clone() };
    this.game.ui.setAuto(true);
    this.game.ui.centerMsg('Auto-hunting here · T or any move to stop');
  }

  stopAuto(quietly = false) {
    if (!this.auto) return;
    this.auto = null;
    this.game.ui.setAuto(false);
    if (!quietly) this.game.ui.centerMsg('Auto-hunt off');
  }

  onDeath() {
    this.stopAuto(true);
    this.pending = null;
    this.holding = false;
    this.moveTo = null;
  }

  // ---------------------------------------------------------------- skills
  // Where a skill goes: { at, target }, or null (no target, or walking into range first).
  skillTarget(sk, opts = {}) {
    const g = this.game, p = this.p;
    const range = sk.range || 0;
    if (sk.target === 'enemy') {
      let t = this.isFoe(this.target) ? this.target : null;
      if (!t) {
        t = this.nearestFoe(range + 4);
        if (t) this.setTarget(t);
      }
      if (!t) { g.ui.centerMsg('No target'); return null; }
      if (this.dist(t) > range + t.radius + 0.3) {
        if (opts.queued) return null;
        this.pending = { kind: 'skill', id: sk.id };
        this.moveTo = null;
        return null;
      }
      return { target: t, at: t.pos.clone() };
    }
    if (sk.target === 'ground') {
      let at;
      if (this.isFoe(this.target) && this.dist(this.target) <= range + 2) at = this.target.pos.clone();
      else if (!g.input.touchMode) at = g.aimPoint.clone();
      else at = new THREE.Vector3(p.pos.x + Math.sin(p.yaw) * Math.min(range, 6), 0, p.pos.z + Math.cos(p.yaw) * Math.min(range, 6));
      const d = Math.hypot(at.x - p.pos.x, at.z - p.pos.z);
      if (d > range && d > 0) { at.x = p.pos.x + ((at.x - p.pos.x) / d) * range; at.z = p.pos.z + ((at.z - p.pos.z) / d) * range; }
      at.y = heightAt(at.x, at.z);
      return { at, target: this.isFoe(this.target) ? this.target : null };
    }
    if (sk.target === 'ally') {
      const t = this.isFriend(this.target) && this.target.alive ? this.target : null;
      if (!t) return { target: p };
      if (this.dist(t) > range) {
        if (opts.queued) return null;
        this.pending = { kind: 'skill', id: sk.id };
        return null;
      }
      return { target: t, at: t.pos.clone() };
    }
    if (sk.target === 'dead') {
      let t = this.isFriend(this.target) && !this.target.alive ? this.target : null;
      if (!t) t = g.others.list.filter((o) => !o.hostile && !o.alive && !o.away && this.dist(o) < range + 6).sort((a, b) => this.dist(a) - this.dist(b))[0] || null;
      if (!t) { g.ui.centerMsg('No fallen hero nearby'); return null; }
      if (this.dist(t) > range) {
        this.setTarget(t);
        if (!opts.queued) this.pending = { kind: 'skill', id: sk.id };
        return null;
      }
      return { target: t, at: t.pos.clone() };
    }
    return { at: null, target: null };
  }

  // ---------------------------------------------------------------- per frame
  // Where to walk (a direction and how hard), or null: toward what we're attacking or casting at when out of
  // range, toward a clicked spot, or back to the hunting ground.
  steer() {
    const g = this.game, p = this.p;
    if (!p.alive) return null;
    if (this.target && !this.valid(this.target)) this.setTarget(null);
    const t = this.target;
    let goal = null, stopAt = 0.25;
    const engaged = this.pending || this.holding || this.auto;
    if (engaged && t && (this.isFoe(t) || this.pending?.kind === 'skill')) {
      const want = this.pending?.kind === 'skill' ? this.skillRange(this.pending.id, t) : p.attackRange(t);
      if (this.dist(t) > want - 0.15) { goal = t.pos; stopAt = 0; }
    } else if (this.moveTo) {
      goal = this.moveTo;
      if (Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z) < 0.35) { this.moveTo = null; goal = null; }
    } else if (this.auto && !t && Math.hypot(this.auto.anchor.x - p.pos.x, this.auto.anchor.z - p.pos.z) > 3) {
      goal = this.lootSpot() || this.auto.anchor;
    }
    if (!goal) return null;
    let gx = goal.x, gz = goal.z;
    const dun = g.places.map.dungeon; // inside, follow the halls
    if (dun) {
      const via = dun.steer(p.pos.x, p.pos.z, gx, gz, p.radius);
      if (via) { gx = via.x; gz = via.z; }
    }
    const dx = gx - p.pos.x, dz = gz - p.pos.z, d = Math.hypot(dx, dz);
    if (d < stopAt + 0.01) return null;
    return { x: dx / d, z: dz / d, len: 1 };
  }

  // How close a skill wants us (to a foe's centre: its radius counts).
  skillRange(id, t) {
    const sk = SKILLS[id];
    return (sk?.range || 3) + (sk?.target === 'enemy' ? t?.radius || 0 : 0);
  }

  // Attacks and skills we're on our way to, a held attack, and hunting.
  act(dt) {
    const p = this.p, t = this.target;
    if (!p.alive) return;
    if (this.pending) {
      if (!this.valid(t) || (this.pending.kind === 'attack' && !this.isFoe(t))) this.pending = null;
      else if (this.pending.kind === 'attack') {
        if (this.dist(t) <= p.attackRange(t) && p.basicAttack(t, true)) this.pending = null;
      } else if (this.pending.kind === 'skill') {
        const id = this.pending.id;
        if (this.dist(t) <= this.skillRange(id, t) + 0.2) {
          this.pending = null;
          p.castSkill(id, { queued: true });
        }
      }
    }
    // a held attack (or hunting): keep swinging at the target while it's in reach
    if ((this.holding || this.auto) && this.isFoe(t) && !this.pending) {
      if (this.dist(t) <= p.attackRange(t) && !p.action && p.cd.attack <= 0) p.basicAttack(t, false);
    }
    if (this.auto) this.hunt(dt);
  }

  // Auto: a target around the hunting ground, potions when hurt, loot after a kill.
  hunt(dt) {
    const g = this.game, p = this.p, a = this.auto;
    if (g.currentZone?.safe) { this.stopAuto(); return; }
    if (p.hp < p.stats.maxHp * 0.35) p.drink('hp');
    if (p.mp < p.stats.maxMp * 0.15) p.drink('mp');
    const away = Math.hypot(a.anchor.x - p.pos.x, a.anchor.z - p.pos.z);
    if (this.isFoe(this.target) && (Math.hypot(this.target.pos.x - a.anchor.x, this.target.pos.z - a.anchor.z) < AUTO_LEASH || this.target.state === 'chase')) return;
    if (away > AUTO_LEASH) { this.setTarget(null); return; } // (walk back first)
    const next = this.nearestFoe(AUTO_RANGE, a.anchor);
    if (next && next.isHero) return; // (auto never starts a fight with another hero)
    if (next) this.setTarget(next);
    else if (this.target && !this.isFoe(this.target)) this.setTarget(null);
  }

  // The nearest loot on the ground near the hunting ground (auto walks over it).
  lootSpot() {
    const a = this.auto, g = this.game;
    let best = null, bd = LOOT_RANGE;
    for (const l of g.loot.list) {
      if (!l.landed) continue;
      const d = Math.hypot(l.group.position.x - a.anchor.x, l.group.position.z - a.anchor.z);
      if (d < bd) { bd = d; best = l.group.position; }
    }
    return best;
  }
}


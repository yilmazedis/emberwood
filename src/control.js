// What our hero does besides the keys and the joystick: the target it has picked (click or tap a foe or a
// friend, Z for the nearest foe, Esc lets go), where a click on the ground sends it, walking into range of what
// it was told to attack or cast at, holding the attack, and hunting on its own (auto, T): it picks the
// nearest monster around the spot it was switched on, fights it the way a player would (combos, and the skills
// on the action bar, each when it makes sense), picks up the loot and drinks when hurt. A Doctor in a party
// supports instead: it follows the party, keeps everyone standing with every care it has learned (wakes the
// fainted, treats the most hurt, painkillers, an aid station, remedies, tonics kept up) and helps fight the
// party's foes when nobody needs it.
import * as THREE from 'three';
import { heightAt } from './world.js';
import { SKILLS, manaCost } from './skills.js';

const AUTO_RANGE = 15; // m from where auto was switched on that it hunts
const AUTO_LEASH = 26; // …and it walks back if it ends up farther than this
const LOOT_RANGE = AUTO_RANGE + 3; // (what falls where its monster fell)
const SUPPORT_FOLLOW = 5; // m: a supporting Doctor keeps this close to the party member it follows…
const SUPPORT_REACH = 12; // …fights only foes this near them…
const SUPPORT_PARTY = 45; // …and looks after party members this near it

// How auto-hunt uses each skill on the action bar, in this order: guard (hurt: a wall, a smoke, a shield),
// heal (us, or a party member, hurt), bless (a long boost, such as a tonic, that isn't on), buff (in a fight, not on yet),
// around (foes around us), area (at the target, with foes around it, or a boss), finisher (a foe low on
// Life), opener (a foe still some way off), strike (at the target). Not used: blinks, doors, vanishing,
// bringing round a fainted hero (those are a player's calls).
const AUTO_SKILL = {
  shield_wall: 'guard', last_stand: 'guard', smoke_bomb: 'guard', divine_shield: 'guard', sanctuary: 'guard',
  heal: 'heal', renew: 'heal', circle_healing: 'heal',
  blessing: 'bless', holy_armor: 'bless', swiftness: 'bless',
  war_cry: 'buff', battle_rage: 'buff', poison_blade: 'buff', shadow_mantle: 'buff',
  cleave: 'around', whirlwind: 'around', frost_nova: 'around', consecration: 'around',
  leap: 'area', earthshatter: 'area', flame_wave: 'area', inferno: 'area', meteor: 'area', blizzard: 'area', toxic_flask: 'area', plague: 'area', multi_shot: 'area', arrow_rain: 'area', judgement: 'area',
  execute: 'finisher',
  charge: 'opener', shadow_step: 'opener',
  power_strike: 'strike', shield_bash: 'strike', fireball: 'strike', ice_bolt: 'strike', glacial_prison: 'strike', backstab: 'strike', eviscerate: 'strike', power_shot: 'strike', crippling_arrow: 'strike', smite: 'strike', holy_strike: 'strike',
};
const AUTO_ORDER = ['guard', 'heal', 'bless', 'buff', 'around', 'area', 'finisher', 'opener', 'strike'];
const BUFF_OF = { smoke_bomb: 'smoke' }; // (a skill's buff, when it's named otherwise)

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

  // Still there to aim at? (a fainted friend stays targeted: doctors bring them round)
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
    const support = this.p.cls === 'healer' && this.partyNear().length > 0;
    if (!support && this.game.currentZone?.safe) { this.game.ui.centerMsg('Hunt outside the camp'); return; }
    this.auto = { anchor: this.p.pos.clone(), support, cared: new Map() };
    this.game.ui.setAuto(true);
    this.game.ui.centerMsg(support ? 'Auto-support: following and caring for your party · T or any move to stop' : 'Auto-hunting here · T or any move to stop');
  }

  // Our party members around (their heroes in our place, fainted ones too).
  partyNear(range = SUPPORT_PARTY) {
    const g = this.game;
    return g.others.list.filter((o) => g.party.has(o.id) && !o.hostile && this.dist(o) < range);
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
      if (!t) { g.ui.centerMsg('No fainted hero nearby'); return null; }
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
    } else if (this.auto?.support && !this.isFoe(t)) { // supporting: stay near the one we follow
      const lead = this.auto.lead;
      if (lead && this.dist(lead) > SUPPORT_FOLLOW) { goal = lead.pos; stopAt = SUPPORT_FOLLOW - 1.5; }
    } else if (this.auto && !t) { // between fights: what fell, else back to the hunting ground
      goal = this.lootSpot() || (Math.hypot(this.auto.anchor.x - p.pos.x, this.auto.anchor.z - p.pos.z) > 3 ? this.auto.anchor : null);
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
          if (p.castSkill(id, { queued: true }) && this.auto?.support) this.cared(t, id);
        }
      }
    }
    // a held attack (or hunting): keep swinging at the target while it's in reach
    if ((this.holding || this.auto) && this.isFoe(t) && !this.pending && this.dist(t) <= p.attackRange(t)) {
      if (this.auto) this.autoSwing(t);
      else if (!p.action && p.cd.attack <= 0) p.basicAttack(t, false);
    }
    if (this.auto) this.hunt(dt);
  }

  // Hunting presses the attack as a player chaining combos would: each press as the last blow's window opens
  // (perfect), so the chain (and its bonus) shows as it does for a player.
  autoSwing(t) {
    const p = this.p, now = this.game.time;
    if (p.action && !p.action.swing) return; // (a skill is playing)
    if (p.action && now < p.combo.open) return;
    if (!this.autoSkills()) p.basicAttack(t, true); // (a skill, if one is ready, takes the moment: it's stronger then)
  }

  // Hunting casts the skills on the action bar, each when it makes sense (AUTO_SKILL), in a blow's combo window
  // when it's swinging (stronger, as for a player). A little mana is kept back for heals and walls.
  autoSkills() {
    const g = this.game, p = this.p, s = p.stats, now = g.time, foe = this.isFoe(this.target) ? this.target : null;
    if (p.stunT > 0 || p.channel || (p.action && !(p.action.swing && now >= p.combo.open))) return false;
    const hp = p.hp / s.maxHp, fighting = !!foe && (this.dist(foe) < 16 || foe.state === 'chase');
    const near = (at, r) => g.foes.reduce((n, e) => n + (this.isFoe(e) && Math.hypot(e.pos.x - at.x, e.pos.z - at.z) < r + e.radius ? 1 : 0), 0);
    const big = (e) => !!e && (e.def?.boss || e.elite);
    const on = (id) => !!p.buffs[BUFF_OF[id] || id];
    const hurtFriend = (range) => g.others.list.find((o) => o.alive && !o.hostile && g.party.has(o.id) && o.hp < 0.5 && this.dist(o) < range) || null;
    const support = !!this.auto?.support; // (care is support's own business: here only its blows, Mana kept for care)
    const ready = p.sk.bar.filter((id) => id && AUTO_SKILL[id] && p.skillOpen(id) && !p.skillBlocked(id) && !((p.cd[id] || 0) > 0))
      .filter((id) => !support || !['guard', 'heal', 'bless'].includes(AUTO_SKILL[id]))
      .filter((id) => { const k = AUTO_SKILL[id], cost = manaCost(SKILLS[id], p.level); return p.mp >= cost + (k === 'guard' || k === 'heal' ? 0 : s.maxMp * (support ? 0.35 : 0.1)); });
    if (!ready.length) return false;
    const want = (id) => {
      const sk = SKILLS[id], range = sk.range || 0, d = foe ? this.dist(foe) : Infinity;
      switch (AUTO_SKILL[id]) {
        case 'guard': return fighting && hp < 0.4 && !on(id);
        case 'heal': return (hp < 0.55 && !(id === 'renew' && on(id))) || (sk.target === 'ally' && !!hurtFriend(range));
        case 'bless': return hp > 0.5 && !on(id);
        case 'buff': return fighting && d < Math.max(6, range) && !on(id);
        case 'around': return fighting && (near(p.pos, 4.5) >= 2 || (big(foe) && d < 4.5));
        case 'area': return !!foe && d <= range && (near(foe.pos, 5) >= 2 || big(foe));
        case 'finisher': return !!foe && foe.hp / foe.maxHp < 0.33 && d <= range + foe.radius;
        case 'opener': return !!foe && d > 4 && d <= range + foe.radius;
        case 'strike': return !!foe && d <= range + foe.radius;
        default: return false;
      }
    };
    const pickOrder = (a, b) => AUTO_ORDER.indexOf(AUTO_SKILL[a]) - AUTO_ORDER.indexOf(AUTO_SKILL[b]) || SKILLS[b].cd - SKILLS[a].cd; // (bigger hits first)
    const id = ready.filter(want).sort(pickOrder)[0];
    if (!id) return false;
    const friend = AUTO_SKILL[id] === 'heal' && SKILLS[id].target === 'ally' && !(hp < 0.55) ? hurtFriend(SKILLS[id].range) : null;
    if (friend) { // (a heal on a party member: aim at them a moment)
      const back = this.target;
      this.setTarget(friend);
      const ok = p.castSkill(id, { queued: true });
      this.setTarget(back && this.valid(back) ? back : null);
      return ok;
    }
    return p.castSkill(id, { queued: true });
  }

  // Auto: a target around the hunting ground, skills and potions, loot after a kill.
  hunt(dt) {
    const g = this.game, p = this.p, a = this.auto;
    if (a.support) { this.support(dt); return; }
    if (g.currentZone?.safe) { this.stopAuto(); return; }
    if (p.hp < p.stats.maxHp * 0.35) p.drink('hp');
    if (p.mp < p.stats.maxMp * 0.15) p.drink('mp');
    if ((a.skillT = (a.skillT || 0) - dt) <= 0) { a.skillT = 0.2; this.autoSkills(); }
    const away = Math.hypot(a.anchor.x - p.pos.x, a.anchor.z - p.pos.z);
    // nothing on us: pick up what fell close by first (steer walks there)
    const threat = g.enemies.list.some((e) => this.isFoe(e) && e.state === 'chase' && this.dist(e) < 14);
    if (!threat && this.lootSpot(8)) { if (this.target && !this.pending) this.setTarget(null); return; }
    if (this.isFoe(this.target) && (Math.hypot(this.target.pos.x - a.anchor.x, this.target.pos.z - a.anchor.z) < AUTO_LEASH || this.target.state === 'chase')) return;
    if (away > AUTO_LEASH) { this.setTarget(null); return; } // (walk back first)
    const next = this.nearestFoe(AUTO_RANGE, a.anchor);
    if (next && next.isHero) return; // (auto never starts a fight with another hero)
    if (next) this.setTarget(next);
    else if (this.target && !this.isFoe(this.target)) this.setTarget(null);
  }

  // ---------------------------------------------------------------- a Doctor supporting its party
  // Follow a party member, care for everyone (care), and between cares help fight what's near them.
  support(dt) {
    const g = this.game, p = this.p, a = this.auto;
    const party = this.partyNear();
    if (!party.length) { this.stopAuto(true); g.ui.centerMsg('Auto-support off: no party member near'); return; }
    if (!a.lead || !party.includes(a.lead)) a.lead = party.slice().sort((x, y) => this.dist(x) - this.dist(y))[0];
    if (p.hp < p.stats.maxHp * 0.35) p.drink('hp');
    if (p.mp < p.stats.maxMp * 0.2) p.drink('mp');
    if ((a.careT = (a.careT || 0) - dt) <= 0) { a.careT = 0.25; if (this.care(party)) return; }
    if (this.pending || (this.isFriend(this.target) && this.target !== a.lead)) return; // (on its way to care for someone)
    // help fight: what's near the one we follow (or already on us), never another hero
    const lead = a.lead, near = (e) => Math.hypot(e.pos.x - lead.pos.x, e.pos.z - lead.pos.z) < SUPPORT_REACH;
    let foe = this.isFoe(this.target) && !this.target.isHero && (near(this.target) || (this.target.state === 'chase' && this.dist(this.target) < 6)) ? this.target : null;
    if (!foe) { foe = this.nearestFoe(SUPPORT_REACH, lead.pos); if (foe?.isHero) foe = null; }
    if (foe !== this.target) this.setTarget(foe);
  }

  // One care, if anyone needs one (true if it's cast, or we're on our way to cast it): bring round a fainted
  // member, treat the most hurt (Triage when several are), a painkiller for one very low, the aid station when
  // several are low, a remedy, and the tonics kept up on everyone.
  care(party) {
    const g = this.game, p = this.p, s = p.stats, now = g.time;
    if (this.pending) return true;
    if (p.stunT > 0 || p.channel || (p.action && !(p.action.swing && now >= p.combo.open))) return false;
    const can = (id) => p.skillOpen(id) && !p.skillBlocked(id) && !((p.cd[id] || 0) > 0) && p.mp >= manaCost(SKILLS[id], p.level);
    const life = (h) => (h === p ? p.hp / s.maxHp : h.hp);
    const folks = [p, ...party.filter((o) => o.alive)];
    const down = party.find((o) => !o.alive);
    if (down && can('resurrection')) return this.castOn(down, 'resurrection');
    const hurt = folks.filter((h) => life(h) < 0.95).sort((x, y) => life(x) - life(y)), worst = hurt[0];
    const low = (f) => folks.filter((h) => life(h) < f && (h === p || this.dist(h) < 10)).length;
    if (low(0.7) >= 2 && can('circle_healing')) return this.castOn(null, 'circle_healing');
    if (worst && life(worst) < 0.6 && can('heal')) return this.castOn(worst, 'heal');
    if (worst && life(worst) < 0.45 && can('divine_shield') && !this.caredLately(worst, 'divine_shield', 10)) return this.castOn(worst, 'divine_shield');
    if (low(0.55) >= 2 && can('sanctuary')) return this.castOn(null, 'sanctuary');
    const remedy = hurt.find((h) => life(h) < 0.85 && (h === p ? !p.buffs.renew : !this.caredLately(h, 'renew', 10)));
    if (remedy && can('renew')) return this.castOn(remedy, 'renew');
    if (worst && life(worst) < 0.8 && can('heal')) return this.castOn(worst, 'heal');
    if (p.mp < s.maxMp * 0.4) return false; // (tonics only with Mana to spare)
    for (const id of ['blessing', 'holy_armor']) {
      if (!can(id)) continue;
      const who = folks.find((h) => (h === p ? !p.buffs[id] : !this.caredLately(h, id, 590)));
      if (who) return this.castOn(who, id);
    }
    return false;
  }

  // Cast a care on a friend (walking to them first if they're too far), on us, or around us (who: null).
  castOn(who, id) {
    const p = this.p, back = this.target, friend = who && who !== p;
    if (friend) this.setTarget(who);
    else if (this.isFriend(back)) this.setTarget(null); // (on us: not on whoever we last cared for)
    const ok = p.castSkill(id);
    if (this.pending?.kind === 'skill') return true; // (walking there: act() casts it when in range)
    if (ok) this.cared(who || p, id);
    if (friend) this.setTarget(back && back !== who && this.valid(back) && this.isFoe(back) ? back : null);
    return ok;
  }

  cared(who, id) {
    this.auto?.cared.set(`${who === this.p ? 'me' : who.id}:${id}`, this.game.time);
  }

  caredLately(who, id, secs) {
    const t = this.auto?.cared.get(`${who.id}:${id}`);
    return t !== undefined && this.game.time - t < secs;
  }

  // The nearest loot on the ground around the hunting ground (within `near` of us), that we can take: with
  // a full bag only gold and what joins a stack (else we'd stand on it for ever).
  lootSpot(near = Infinity) {
    const a = this.auto, p = this.p;
    let best = null, bd = near;
    for (const l of this.game.loot.list) {
      if (!l.landed || l.dead || (l.kind === 'item' && !p.hasRoomFor(l.data))) continue;
      const at = l.group.position;
      if (Math.hypot(at.x - a.anchor.x, at.z - a.anchor.z) > LOOT_RANGE) continue;
      const d = Math.hypot(at.x - p.pos.x, at.z - p.pos.z);
      if (d < bd) { bd = d; best = at; }
    }
    return best;
  }
}


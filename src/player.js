// The player knight: stats, gear, leveling, movement and skills.
import * as THREE from 'three';
import { Humanoid } from './character.js';
import { heightAt, resolveCollision } from './world.js';
import { makeItem } from './items.js';
import { dampAngle, yawTo, rand } from './util.js';
import { hdr } from './fx.js';

export const SKILLS = [
  { id: 'cleave', key: '1', name: 'Cleave', level: 1, mp: 8, cd: 2.5, desc: 'A wide, heavy arc that hits everything in front of you for 170% weapon damage and knocks enemies back.' },
  { id: 'fireball', key: '2', name: 'Fireball', level: 2, mp: 14, cd: 1.1, desc: 'Hurl a fireball that explodes for 220% weapon damage in an area. Scales with Spell Power.' },
  { id: 'whirlwind', key: '3', name: 'Whirlwind', level: 3, mp: 22, cd: 7, desc: 'Spin for 1.4 s, striking all nearby enemies 5 times for 65% damage. You can move while spinning.' },
  { id: 'heal', key: '4', name: 'Second Wind', level: 4, mp: 25, cd: 14, desc: 'Restore 35% of your maximum Life.' },
];

export const xpForLevel = (lvl) => Math.round(60 * Math.pow(lvl, 1.55));
const _axis = new THREE.Vector2();

export function applyEquipmentVisuals(h, eq) {
  const glow = (it) => (it && it.rarity === 'legendary' ? 0xff6a10 : null);
  h.equip('r', eq.weapon?.model || null, glow(eq.weapon));
  h.equip('l', eq.offhand?.model || null, glow(eq.offhand));
  const head = eq.head?.meshes || [];
  h.setMeshVisible('Knight_Helmet', head.includes('Knight_Helmet'));
  h.setMeshVisible('Knight_HelmetVisor', head.includes('Knight_HelmetVisor'));
  h.setMeshVisible('Knight_Cape', !!eq.back);
}

export class Player {
  constructor(game) {
    this.game = game;
    this.h = new Humanoid('Knight');
    this.group = this.h.group;
    this.pos = this.group.position;
    this.radius = 0.5;
    this.yaw = Math.PI;
    this.targetYaw = this.yaw;
    this.level = 1;
    this.xp = 0;
    this.gold = 0;
    this.potions = 3;
    this.bag = new Array(20).fill(null);
    this.equipment = { weapon: null, offhand: null, head: null, back: null };
    this.cd = { attack: 0, cleave: 0, fireball: 0, whirlwind: 0, heal: 0, potion: 0 };
    this.action = null;
    this.queued = null;
    this.combo = 0;
    this.alive = true;
    this.stepT = 0;
    this.recompute();
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  starterKit() {
    this.equipment.weapon = makeItem('sword', 1, 'common', 'Rusty Sword');
    this.onGearChanged(false);
  }

  serialize() {
    return { v: 1, level: this.level, xp: this.xp, gold: this.gold, potions: this.potions, bag: this.bag, equipment: this.equipment };
  }

  load(s) {
    this.level = s.level || 1;
    this.xp = s.xp || 0;
    this.gold = s.gold || 0;
    this.potions = s.potions ?? 3;
    this.bag = Array.from({ length: 20 }, (_, i) => s.bag?.[i] || null);
    this.equipment = { weapon: null, offhand: null, head: null, back: null, ...s.equipment };
    this.onGearChanged(false);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  recompute() {
    const L = this.level;
    const s = {
      maxHp: 90 + L * 14, maxMp: 40 + L * 6, armor: L * 1.5, dmgMin: 2, dmgMax: 4, speed: 1.3,
      dmgPct: 0.06 * (L - 1), atkSpd: 0, moveSpd: 0, crit: 0.05, spell: 1, regen: 1 + L * 0.25, mpRegen: 3 + L * 0.3,
    };
    for (const it of Object.values(this.equipment)) {
      if (!it) continue;
      const st = it.stats;
      if (st.dmgMin) { s.dmgMin = st.dmgMin; s.dmgMax = st.dmgMax; s.speed = st.speed; }
      s.armor += st.armor || 0;
      s.maxHp += st.hp || 0;
      s.maxMp += st.mp || 0;
      s.dmgPct += st.dmgPct || 0;
      s.atkSpd += st.atkSpd || 0;
      s.moveSpd += st.moveSpd || 0;
      s.crit += st.crit || 0;
      s.spell += st.spell || 0;
      s.regen += st.regen || 0;
    }
    s.armor = Math.round(s.armor);
    s.atkSpeed = s.speed * (1 + s.atkSpd);
    s.moveSpeed = 5.6 * (1 + s.moveSpd);
    s.dmgLo = Math.max(1, Math.round(s.dmgMin * (1 + s.dmgPct)));
    s.dmgHi = Math.max(s.dmgLo + 1, Math.round(s.dmgMax * (1 + s.dmgPct)));
    s.dr = s.armor / (s.armor + 60);
    this.stats = s;
    if (this.hp !== undefined) {
      this.hp = Math.min(this.hp, s.maxHp);
      this.mp = Math.min(this.mp, s.maxMp);
    }
  }

  rollDamage(mult, spell = false) {
    const s = this.stats;
    let amount = rand(s.dmgLo, s.dmgHi) * mult * (spell ? s.spell : 1);
    const crit = Math.random() < s.crit;
    if (crit) amount *= 2;
    return { amount: Math.max(1, Math.round(amount)), crit };
  }

  // ---------------------------------------------------------------- inventory
  freeSlot() {
    return this.bag.findIndex((x) => !x);
  }

  addItem(item) {
    const i = this.freeSlot();
    if (i < 0) return false;
    this.bag[i] = item;
    this.game.ui.refreshInventory();
    return true;
  }

  equipFromBag(i) {
    const it = this.bag[i];
    if (!it) return;
    const eq = this.equipment;
    // what else has to come off?
    const extra = [];
    if (it.twoHanded && eq.offhand) extra.push('offhand');
    if (it.slot === 'offhand' && eq.weapon?.twoHanded) extra.push('weapon');
    const prev = eq[it.slot];
    const freeAfter = this.bag.filter((x) => !x).length + (prev ? 0 : 1);
    if (extra.length > freeAfter) {
      this.game.ui.centerMsg('Not enough room in your bag');
      return;
    }
    this.bag[i] = prev || null;
    eq[it.slot] = it;
    for (const s of extra) {
      this.bag[this.freeSlot()] = eq[s];
      eq[s] = null;
    }
    this.game.sfx.play('equip');
    this.onGearChanged();
  }

  unequip(slot) {
    const it = this.equipment[slot];
    if (!it) return;
    const i = this.freeSlot();
    if (i < 0) {
      this.game.ui.centerMsg('Your bag is full');
      return;
    }
    this.bag[i] = it;
    this.equipment[slot] = null;
    this.game.sfx.play('equip');
    this.onGearChanged();
  }

  sell(i) {
    const it = this.bag[i];
    if (!it) return;
    this.bag[i] = null;
    this.gold += it.value;
    this.game.sfx.play('gold');
    this.game.ui.log(`Sold ${it.name} for <b>${it.value}g</b>`, 'gold');
    this.game.ui.refreshInventory();
    this.game.save();
  }

  buyAle() {
    if (this.gold < 25) {
      this.game.ui.centerMsg('Not enough gold');
      return;
    }
    this.gold -= 25;
    this.potions++;
    this.game.sfx.play('gold');
    this.game.ui.refreshInventory();
    this.game.save();
  }

  onGearChanged(save = true) {
    const hpFrac = this.hp !== undefined ? this.hp / this.stats.maxHp : 1;
    this.recompute();
    if (this.hp !== undefined) this.hp = Math.min(this.stats.maxHp, Math.max(this.hp, hpFrac * this.stats.maxHp));
    applyEquipmentVisuals(this.h, this.equipment);
    this.game.ui?.refreshInventory();
    this.game.doll?.setEquipment(this.equipment);
    if (save) this.game.save();
  }

  gainXp(n) {
    this.xp += n;
    let leveled = false;
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      leveled = true;
      const skill = SKILLS.find((s) => s.level === this.level);
      this.game.ui.log(`<b>Level ${this.level}!</b>${skill ? ` New skill: <b>${skill.name}</b> [${skill.key}]` : ''}`, 'lvl');
    }
    if (leveled) {
      this.recompute();
      this.hp = this.stats.maxHp;
      this.mp = this.stats.maxMp;
      this.game.fx.levelUp(this.pos);
      this.game.sfx.play('levelup');
      this.game.ui.floater(this.headPos(), `Level ${this.level}`, 'info');
      this.game.ui.buildActionBar();
      this.game.save();
    }
  }

  headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 2.7, this.pos.z);
  }

  // ---------------------------------------------------------------- combat actions
  faceToward(p) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    this.yaw = this.targetYaw = yawTo(dx, dz);
    this.group.rotation.y = this.yaw;
  }

  basicAttack() {
    const g = this.game, s = this.stats;
    const { point } = g.aim(3.2);
    const dur = 0.62 / s.atkSpeed;
    const twoH = !!this.equipment.weapon?.twoHanded;
    this.faceToward(point);
    this.combo = (this.combo + 1) % 2;
    const style = twoH ? 'chop' : this.combo ? 'slash' : 'backslash';
    this.h.startSwing(dur, style);
    this.cd.attack = dur;
    g.sfx.play('swing', 0.7);
    this.action = {
      t: 0, dur, canMove: false, hit: false,
      tick: (dt, a) => {
        if (!a.hit && a.t >= dur * 0.45) {
          a.hit = true;
          a.canMove = true;
          a.moveMult = 0.6;
          const n = g.meleeHit({ range: twoH ? 2.7 : 2.3, arc: twoH ? 1.6 : 2.1, mult: 1, knock: 0.35 });
          if (style === 'chop') g.fx.arc(this.pos, this.yaw, { span: 1.3, rIn: 0.5, rOut: 2.8, color: 0xfff2d0, dur: 0.2 });
          else g.fx.arc(this.pos, this.yaw, { span: 2.1, rIn: 0.6, rOut: 2.4, color: 0xfff2d0, dur: 0.22, reverse: style === 'backslash' });
          if (!n) g.sfx.play('whiff', 0.5);
        }
      },
    };
  }

  useSkill(i) {
    const g = this.game, sk = SKILLS[i];
    if (!this.alive || !sk) return;
    if (this.level < sk.level) { g.ui.centerMsg(`${sk.name} unlocks at level ${sk.level}`); return; }
    if (this.cd[sk.id] > 0) return;
    if (this.mp < sk.mp) { g.ui.noMana(); return; }
    if (this.action) { this.queued = { t: 0.4, fn: () => this.useSkill(i) }; return; }
    this.mp -= sk.mp;
    this.cd[sk.id] = sk.cd;
    this[`skill_${sk.id}`]();
  }

  skill_cleave() {
    const g = this.game;
    const { point } = g.aim(3.6);
    this.faceToward(point);
    const dur = 0.78;
    this.h.startSwing(dur, 'cleave');
    g.sfx.play('swing', 1);
    this.action = {
      t: 0, dur, canMove: false, hit: false,
      tick: (dt, a) => {
        if (!a.hit && a.t >= dur * 0.5) {
          a.hit = true;
          g.meleeHit({ range: 3.4, arc: 3.4, mult: 1.7, knock: 1.5 });
          g.fx.arc(this.pos, this.yaw, { span: 3.4, rIn: 0.7, rOut: 3.6, color: 0xffc070, dur: 0.3 });
          g.fx.dust(new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 2, this.pos.y + 0.1, this.pos.z + Math.cos(this.yaw) * 2), 10);
          g.shake(0.22);
          g.sfx.play('cleave');
        }
      },
    };
  }

  skill_fireball() {
    const g = this.game;
    const { point } = g.aim(14);
    this.faceToward(point);
    this.h.anim.play('Throw', { timeScale: 2.1, startAt: 0.2 });
    g.sfx.play('cast');
    const target = point.clone();
    this.action = {
      t: 0, dur: 0.5, canMove: false, fired: false,
      tick: (dt, a) => {
        if (!a.fired && a.t >= 0.24) {
          a.fired = true;
          const from = new THREE.Vector3();
          this.h.bones.handslotr.getWorldPosition(from);
          from.y = Math.max(from.y, this.pos.y + 1.3);
          const to = new THREE.Vector3(target.x, from.y, target.z);
          if (to.distanceTo(from) < 1) to.set(from.x + Math.sin(this.yaw), from.y, from.z + Math.cos(this.yaw));
          g.projectiles.spawn({ from, to, owner: 'player', mult: 2.2, speed: 19, color: 0xff7a2a, trail: 0xff2a00, radius: 0.45, range: 20, aoe: 2.8, size: 0.32 });
          g.sfx.play('fireball');
        }
      },
      end: () => this.h.anim.stopOne(),
    };
  }

  skill_whirlwind() {
    const g = this.game;
    this.h.armsOut = 1;
    g.sfx.play('whirl');
    this.action = {
      t: 0, dur: 1.4, canMove: true, moveMult: 0.8, lockFacing: true, nextTick: 0.05,
      tick: (dt, a) => {
        this.h.model.rotation.y += dt * 17;
        if (a.t >= a.nextTick) {
          a.nextTick += 0.27;
          g.meleeHit({ range: 3.0, arc: 7, mult: 0.65, knock: 0.3 });
          g.fx.ring(this.pos, 0.8, 3.1, 0xffd9a0, 0.28, 0.9, 0.7);
          g.sfx.play('swing', 0.45);
        }
        if (Math.random() < 0.6) {
          const ang = this.h.model.rotation.y + this.yaw;
          g.fx.add.emit({ pos: { x: this.pos.x + Math.sin(ang) * 1.9, y: this.pos.y + 1.0, z: this.pos.z + Math.cos(ang) * 1.9 }, count: 2, spread: 0.1, velSpread: 0.6, color: hdr(0xfff0c0, 2), colorEnd: hdr(0xffa040, 0.3), size: 0.18, sizeEnd: 0.02, life: 0.3 });
        }
      },
      end: () => { this.h.armsOut = 0; this.h.model.rotation.y = 0; },
    };
  }

  skill_heal() {
    const g = this.game;
    this.h.anim.play('Use_Item', { timeScale: 2 });
    this.action = {
      t: 0, dur: 0.6, canMove: false, healed: false,
      tick: (dt, a) => {
        if (!a.healed && a.t >= 0.25) {
          a.healed = true;
          this.heal(Math.round(this.stats.maxHp * 0.35));
          g.fx.ring(this.pos, 0.3, 2.4, 0x6dff8a, 0.6);
        }
      },
      end: () => this.h.anim.stopOne(),
    };
  }

  drinkAle() {
    const g = this.game;
    if (!this.alive || this.cd.potion > 0) return;
    if (this.potions <= 0) { g.ui.centerMsg('No ale left — buy more in your bag (I)'); return; }
    if (this.hp >= this.stats.maxHp) { g.ui.centerMsg('Already at full life'); return; }
    this.potions--;
    this.cd.potion = 1.5;
    this.heal(Math.round(this.stats.maxHp * 0.4));
    g.sfx.play('drink');
    g.save();
  }

  heal(n) {
    const g = this.game;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    g.fx.heal(this.pos);
    g.ui.floater(this.headPos(), `+${Math.round(this.hp - before)}`, 'heal');
    g.sfx.play('heal');
  }

  die() {
    const g = this.game;
    this.alive = false;
    this.action = null;
    this.queued = null;
    this.h.swing = null;
    this.h.armsOut = 0;
    this.h.model.rotation.y = 0;
    this.h.anim.play('Death_A', { hold: true });
    const lost = Math.floor(this.gold * 0.1);
    this.gold -= lost;
    g.sfx.play('death');
    setTimeout(() => g.ui.showDeath(true), 1400);
    g.save();
  }

  respawn() {
    this.alive = true;
    this.pos.set(0, heightAt(0, 3.5), 3.5);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
    this.yaw = this.targetYaw = Math.PI;
    this.h.anim.play('Spawn_Ground', { timeScale: 1.2 });
    this.game.ui.showDeath(false);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, s = this.stats;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (!this.alive) {
      this.h.update(dt);
      return;
    }
    const safe = g.currentZone?.safe;
    this.hp = Math.min(s.maxHp, this.hp + s.regen * (safe ? 8 : 1) * dt);
    this.mp = Math.min(s.maxMp, this.mp + s.mpRegen * (safe ? 4 : 1) * dt);

    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.tick) a.tick(dt, a);
      if (a.t >= a.dur) {
        this.action = null;
        if (a.end) a.end();
      }
    }

    const ax = g.input.axis(_axis); // keyboard (0 or 1) or joystick (analog 0..1)
    const len = Math.min(1, ax.length());
    let speed = 0;
    const spawning = this.h.anim.oneName === 'Spawn_Ground';
    if (len > 0.01 && (!this.action || this.action.canMove) && !spawning) {
      const mx = ax.x / len, mz = ax.y / len;
      speed = s.moveSpeed * (this.action?.moveMult ?? 1) * Math.max(0.35, len);
      this.pos.x += mx * speed * dt;
      this.pos.z += mz * speed * dt;
      if (!this.action?.lockFacing) this.targetYaw = yawTo(mx, mz);
    }
    resolveCollision(this.pos, this.radius);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.yaw = dampAngle(this.yaw, this.targetYaw, 16, dt);
    this.group.rotation.y = this.yaw;

    if (speed > s.moveSpeed * 0.55) this.h.anim.setBase('Running_A', speed / 5.4);
    else if (speed > 0) this.h.anim.setBase('Walking_A', Math.max(0.7, speed / 2.2));
    else this.h.anim.setBase('Idle_A');
    if (speed > 0 && this.h.anim.oneName === 'Hit_A') this.h.anim.stopOne();

    if (this.queued) {
      this.queued.t -= dt;
      if (this.queued.t <= 0) this.queued = null;
    }
    if (!this.action && !spawning) {
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        q.fn();
      } else if (g.input.attacking && this.cd.attack <= 0) {
        this.basicAttack();
      }
    }

    if (speed > 0) {
      this.stepT += dt;
      if (this.stepT > 0.28) { this.stepT = 0; g.fx.dust(this.pos, 2); }
    }
    this.h.update(dt);
  }
}

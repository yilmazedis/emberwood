// The classes' skills: four each, unlocking at levels 1–4 (keys 1–4, or the round buttons on phones).
// One definition serves both our own hero and the other heroes we see: cast(actor, at, real) plays
// the show (animation, effects, sound) for any hero, and only when `real` (our hero) does it move the
// hero, deal damage and send it to the world. Other heroes' games send us what they cast ({ k: 'sk',
// id, x, z }) and we cast it with real = false.
//   actor: our Player or a RemotePlayer: game, h (the model), pos, yaw, faceToward(p), vol(), aura(id, s)
//   at: where it was aimed (or where the hero went, for leaps and teleports), or null
// cast() returns the action that runs while the skill plays: { t, dur, canMove, moveMult, lockFacing,
// tick(dt, action), end() } (see Player.update), plus dest: a place to tell the others instead of `at`.
import * as THREE from 'three';
import { heightAt, isWalkable, wallAt } from './world.js';
import { hdr } from './fx.js';
import { lerp, rand, TAU } from './util.js';

export const CLASS_SKILLS = {
  knight: ['bash', 'charge', 'warcry', 'heal'],
  barbarian: ['cleave', 'leap', 'whirlwind', 'rage'],
  mage: ['fireball', 'nova', 'blink', 'meteor'],
  rogue: ['twin', 'knives', 'smoke', 'shadowstep'],
};

// Timed effects on our own hero (Player.recompute applies them).
export const BUFFS = {
  warcry: { dur: 8, armorMul: 1.5 },
  rage: { dur: 8, atkSpd: 0.3, dmgPct: 0.25 },
  smoke: { dur: 4, evade: 0.5 },
};

const UP = new THREE.Vector3(0, 1, 0);
const ahead = (a, d) => new THREE.Vector3(a.pos.x + Math.sin(a.yaw) * d, a.pos.y, a.pos.z + Math.cos(a.yaw) * d);
const play = (a, name, vol = 1) => { const v = a.vol() * vol; if (v > 0.01) a.game.sfx.play(name, v); };

// The farthest spot toward `to`, at most `max` away, where a hero can stand, never through a crypt
// wall: where leaps, charges and teleports end.
export function reachable(from, to, max) {
  const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
  const d = Math.min(max, len);
  let best = from.clone();
  if (len < 0.01) return best;
  for (let s = 0.3; s <= d + 1e-6; s += 0.3) {
    const x = from.x + (dx / len) * s, z = from.z + (dz / len) * s;
    if (wallAt(x, z)) break;
    if (isWalkable(x, z, 0.4)) best = new THREE.Vector3(x, heightAt(x, z), z);
  }
  return best;
}

function puff(g, p, hex) {
  g.fx.burst(new THREE.Vector3(p.x, p.y + 1.2, p.z), hex, 26, 3.5);
  g.fx.soft.emit({ pos: { x: p.x, y: p.y + 1, z: p.z }, count: 12, spread: 0.5, velSpread: 1, vel: { x: 0, y: 0.8, z: 0 }, color: new THREE.Color(0x2e2638), alpha: 0.45, size: 1, sizeEnd: 2.2, life: 1, drag: 2 });
}

// Which way a shot from `from` should fly: toward what was aimed at, or straight ahead if nothing was
// (or it's right under our nose). Heroes' shots then glide over the ground (see Projectiles).
export function aimedAt(a, from, point) {
  const ahead10 = new THREE.Vector3(from.x + Math.sin(a.yaw) * 10, from.y, from.z + Math.cos(a.yaw) * 10);
  if (!point || Math.hypot(point.x - from.x, point.z - from.z) < 1.2) return ahead10;
  return new THREE.Vector3(point.x, from.y, point.z);
}

// The weapon hand, for things thrown or cast from it (at least chest high).
function handPos(a) {
  const p = new THREE.Vector3();
  a.h.bones.handslotr.getWorldPosition(p);
  p.y = Math.max(p.y, a.pos.y + 1.2);
  return p;
}

export const SKILLS = {
  // ---------------------------------------------------------------- Knight
  bash: {
    name: 'Shield Bash', level: 1, mp: 8, cd: 4, range: 3,
    desc: 'Slam your shield into the enemies in front of you for 120% weapon damage. They are stunned for 1.5 seconds (bosses only briefly).',
    icon: '<svg viewBox="0 0 32 32"><path d="M4 6h15v9c0 6-4 10-7.5 12C8 25 4 21 4 15z" fill="#9fb6d6" stroke="#3a4a66" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.5 7v19M5 14h13" stroke="#e8eef8" stroke-width="2"/><path d="M23 8l5-3M24 15h6M23 22l5 3" stroke="#ffe08a" stroke-width="2.2" stroke-linecap="round"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      if (at) a.faceToward(at);
      a.h.startSwing(0.5, 'bash');
      play(a, 'swing', 0.6);
      return {
        t: 0, dur: 0.5, canMove: false, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.24) return;
          s.hit = true;
          const p = ahead(a, 1.3);
          g.fx.burst(new THREE.Vector3(p.x, p.y + 1, p.z), 0xfff0c0, 18, 4);
          g.fx.ring(p, 0.3, 2.1, 0xffe2a0, 0.3);
          play(a, 'bash');
          if (real && g.meleeHit({ range: 2.4, arc: 1.7, mult: 1.2, knock: 0.6, eff: { stun: 1.5 } })) g.shake(0.15);
        },
      };
    },
  },

  charge: {
    name: 'Charge', level: 2, mp: 12, cd: 8, range: 7,
    desc: 'Rush up to 7 m forward and crash into the enemies there: 150% weapon damage around you, knocking them back and stunning them for half a second.',
    icon: '<svg viewBox="0 0 32 32"><path d="M3 11h9M2 16h11M3 21h9" stroke="#ffd9a0" stroke-width="2" stroke-linecap="round" opacity=".8"/><path d="M14 8l14 8-14 8 3.5-8z" fill="#e3e9f0" stroke="#5d6875" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    cast(a, at, real) {
      const g = a.game, from = a.pos.clone();
      const aim = at || ahead(a, 7);
      a.faceToward(aim);
      const to = real ? reachable(from, aim, 7) : aim;
      const dash = Math.max(0.12, Math.min(7, from.distanceTo(to)) / 24);
      a.h.anim.play('Running_A', { timeScale: 2.6 });
      play(a, 'charge');
      return {
        t: 0, dur: dash + 0.4, canMove: false, lockFacing: true, dash, struck: false, dest: to,
        tick: (dt, s) => {
          if (s.t < s.dash) {
            if (real) {
              const k = s.t / s.dash;
              a.pos.x = lerp(from.x, to.x, k);
              a.pos.z = lerp(from.z, to.z, k);
              // stop at the first enemy in the way
              if (g.enemies.list.some((e) => e.alive && e.state !== 'spawn' && Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) < e.radius + 0.9)) s.dash = s.t;
            }
            if (Math.random() < 0.7) g.fx.dust(a.pos, 1);
            return;
          }
          if (s.struck) return;
          s.struck = true;
          a.h.anim.stopOne();
          a.h.startSwing(0.4, 'chop');
          g.fx.ring(a.pos, 0.4, 2.8, 0xffd9a0, 0.35);
          g.fx.dust(new THREE.Vector3(a.pos.x, a.pos.y + 0.1, a.pos.z), 16);
          play(a, 'cleave', 0.8);
          if (real) {
            g.areaHit({ at: a.pos, radius: 2.4, mult: 1.5, knock: 1.2, eff: { stun: 0.5 } });
            g.shake(0.25);
          }
        },
        end: () => { if (a.h.anim.oneName === 'Running_A') a.h.anim.stopOne(); },
      };
    },
  },

  warcry: {
    name: 'War Cry', level: 3, mp: 18, cd: 14,
    desc: 'A roar that turns every monster within 9 m on you for 4 seconds (your friends get a breather), and your armor is 50% higher for 8 seconds.',
    icon: '<svg viewBox="0 0 32 32"><path d="M4 13h5l8-6v18l-8-6H4z" fill="#f0c860" stroke="#7a5418" stroke-width="1.3" stroke-linejoin="round"/><path d="M21 11c2 1.5 2 8.5 0 10M24.5 8c3.5 3 3.5 13 0 16" stroke="#ffe7a6" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.5 });
      play(a, 'warcry');
      g.fx.ring(a.pos, 0.6, 9, 0xffd060, 0.6);
      g.fx.ring(a.pos, 0.4, 5, 0xffb040, 0.4, 1.2);
      g.fx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 1.6, a.pos.z), 0xffd060, 30, 3);
      a.aura('warcry', BUFFS.warcry.dur);
      if (real) {
        a.addBuff('warcry');
        for (const e of g.enemies.list) {
          if (e.alive && e.state !== 'spawn' && Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) < 9 + e.radius) g.affectEnemy(e, { taunt: 4 });
        }
      }
      return { t: 0, dur: 0.6, canMove: true, moveMult: 0.5, end: () => a.h.anim.stopOne() };
    },
  },

  heal: {
    name: 'Second Wind', level: 4, mp: 25, cd: 14,
    desc: 'Restore 35% of your maximum Life.',
    icon: '<svg viewBox="0 0 32 32"><path d="M16 28S4 20 4 12a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 16-12 16z" fill="#4fd46b" stroke="#1d6a2c" stroke-width="1.3" stroke-linejoin="round"/><path d="M16 11v10M11 16h10" stroke="#eaffea" stroke-width="3" stroke-linecap="round"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      a.h.anim.play('Use_Item', { timeScale: 2 });
      return {
        t: 0, dur: 0.6, canMove: false, healed: false,
        tick: (dt, s) => {
          if (s.healed || s.t < 0.25) return;
          s.healed = true;
          g.fx.ring(a.pos, 0.3, 2.4, 0x6dff8a, 0.6);
          if (real) a.heal(Math.round(a.stats.maxHp * 0.35));
          else { g.fx.heal(a.pos); play(a, 'heal', 0.7); }
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  // ---------------------------------------------------------------- Barbarian
  cleave: {
    name: 'Cleave', level: 1, mp: 8, cd: 2.5, range: 3.6,
    desc: 'A wide, heavy arc that hits everything in front of you for 170% weapon damage and knocks enemies back.',
    icon: '<svg viewBox="0 0 32 32"><path d="M4 22C6 9 22 4 29 12c-8-3-17 0-21 11z" fill="#ffc46a" stroke="#a8641c" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 20C10 12 19 8 25 10" stroke="#fff6d8" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="8" cy="24" r="2.2" fill="#fff0c0"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      if (at) a.faceToward(at);
      const dur = 0.78;
      a.h.startSwing(dur, 'cleave');
      play(a, 'swing');
      return {
        t: 0, dur, canMove: false, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < dur * 0.5) return;
          s.hit = true;
          g.fx.arc(a.pos, a.yaw, { span: 3.4, rIn: 0.7, rOut: 3.6, color: 0xffc070, dur: 0.3 });
          g.fx.dust(new THREE.Vector3(a.pos.x + Math.sin(a.yaw) * 2, a.pos.y + 0.1, a.pos.z + Math.cos(a.yaw) * 2), 10);
          play(a, 'cleave');
          if (real) {
            g.meleeHit({ range: 3.4, arc: 3.4, mult: 1.7, knock: 1.5 });
            g.shake(0.22);
          }
        },
      };
    },
  },

  leap: {
    name: 'Leap Slam', level: 2, mp: 16, cd: 9, range: 8,
    desc: 'Leap up to 8 m and crash down: 180% weapon damage to everything within 3 m of where you land, and they are slowed by half for 3 seconds.',
    icon: '<svg viewBox="0 0 32 32"><path d="M4 22C7 6 21 5 25 19" stroke="#ffd08a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-dasharray="3 3"/><path d="M20.5 17.5l5 3.5 1.5-5.5" stroke="#ffd08a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 28h13M21 25l-2-3M28 25l2-3" stroke="#c98a4a" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, at, real) {
      const g = a.game, from = a.pos.clone();
      const aim = at || ahead(a, 8);
      const to = real ? reachable(from, aim, 8) : aim;
      a.faceToward(to);
      const dur = 0.85;
      a.h.anim.play('Jump_Full_Short', { timeScale: 1.25 });
      play(a, 'leap');
      return {
        t: 0, dur: dur + 0.2, canMove: false, lockFacing: true, landed: false, dest: to,
        tick: (dt, s) => {
          const k = Math.min(1, s.t / dur);
          if (real) {
            a.pos.x = lerp(from.x, to.x, k);
            a.pos.z = lerp(from.z, to.z, k);
          }
          a.h.model.position.y = Math.sin(Math.PI * k) * 2.4; // the arc (the hero's spot stays on the ground)
          if (s.landed || k < 1) return;
          s.landed = true;
          a.h.model.position.y = 0;
          g.fx.ring(a.pos, 0.5, 3.4, 0xff9a4a, 0.45);
          g.fx.dust(new THREE.Vector3(a.pos.x, a.pos.y + 0.2, a.pos.z), 30);
          g.fx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 0.3, a.pos.z), 0xffb060, 24, 5);
          play(a, 'slam');
          if (real) {
            g.areaHit({ at: a.pos, radius: 3, mult: 1.8, knock: 0.8, eff: { slow: [0.5, 3] } });
            g.shake(0.45);
          }
        },
        end: () => { a.h.model.position.y = 0; a.h.anim.stopOne(); },
      };
    },
  },

  whirlwind: {
    name: 'Whirlwind', level: 3, mp: 22, cd: 7,
    desc: 'Spin for 1.4 s, striking all nearby enemies 5 times for 65% damage. You can move while spinning.',
    icon: '<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round"><path d="M16 4a12 12 0 1 1-11.3 8" stroke="#dfe9ff" stroke-width="2.6"/><path d="M16 9a7 7 0 1 1-6.6 4.7" stroke="#9fc0ff" stroke-width="2.4"/><path d="M16 14a2.5 2.5 0 1 1-2.4 1.8" stroke="#fff" stroke-width="2.2"/><path d="M4.7 12l-1.5-4.5 4.6 1.2" stroke="#dfe9ff" stroke-width="2.2"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      a.h.armsOut = 1;
      play(a, 'whirl');
      return {
        t: 0, dur: 1.4, canMove: true, moveMult: 0.8, lockFacing: true, next: 0.05,
        tick: (dt, s) => {
          a.h.model.rotation.y += dt * 17;
          if (s.t >= s.next) {
            s.next += 0.27;
            g.fx.ring(a.pos, 0.8, 3.1, 0xffd9a0, 0.28, 0.9, 0.7);
            play(a, 'swing', 0.45);
            if (real) g.meleeHit({ range: 3.0, arc: 7, mult: 0.65, knock: 0.3 });
          }
          if (Math.random() < 0.6) {
            const ang = a.h.model.rotation.y + a.yaw;
            g.fx.add.emit({ pos: { x: a.pos.x + Math.sin(ang) * 1.9, y: a.pos.y + 1.0, z: a.pos.z + Math.cos(ang) * 1.9 }, count: 2, spread: 0.1, velSpread: 0.6, color: hdr(0xfff0c0, 2), colorEnd: hdr(0xffa040, 0.3), size: 0.18, sizeEnd: 0.02, life: 0.3 });
          }
        },
        end: () => { a.h.armsOut = 0; a.h.model.rotation.y = 0; },
      };
    },
  },

  rage: {
    name: 'Battle Rage', level: 4, mp: 20, cd: 20,
    desc: 'Let the fury in: for 8 seconds you attack 30% faster and deal 25% more damage.',
    icon: '<svg viewBox="0 0 32 32"><path d="M16 3c2 6-4 8-4 13 0 2 1 3 2 4-3 0-6-3-6-7 0-2 1-4 2-5-4 2-6 6-6 10 0 6 5 11 12 11s12-5 12-11c0-5-3-8-6-10 1 3 0 6-2 7 1-6-2-10-4-12z" fill="#ff4a2a" stroke="#7a1408" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 17c1 2 4 3 4 7a4 4 0 0 1-8 0c0-2 2-3 2-5 1 1 1 2 2 2z" fill="#ffd08a"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.8 });
      play(a, 'enrage');
      g.fx.ring(a.pos, 0.5, 4, 0xff3a2a, 0.5);
      g.fx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 1.4, a.pos.z), 0xff4a2a, 30, 3);
      a.aura('rage', BUFFS.rage.dur);
      if (real) a.addBuff('rage');
      return { t: 0, dur: 0.5, canMove: true, moveMult: 0.6, end: () => a.h.anim.stopOne() };
    },
  },

  // ---------------------------------------------------------------- Mage
  fireball: {
    name: 'Fireball', level: 1, mp: 12, cd: 1.1, range: 14,
    desc: 'Hurl a fireball that explodes for 220% weapon damage in an area. Scales with Spell Power.',
    icon: '<svg viewBox="0 0 32 32"><path d="M20 5c1 5-3 6-2 10 2-1 3-3 3-5 4 3 6 7 5 11-1 5-6 8-11 7S6 23 7 18c1-4 4-5 5-9 1 2 1 4 3 5-1-4 1-7 5-9z" fill="#ff7a2a" stroke="#a32d0a" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 17c2 2 4 3 3 6-1 2-4 3-6 1-2-1-1-4 0-5 0 1 1 2 2 2-1-2 0-3 1-4z" fill="#ffe08a"/></svg>',
    cast(a, at, real) {
      const g = a.game, target = at ? at.clone() : ahead(a, 10);
      a.faceToward(target);
      a.h.anim.play('Throw', { timeScale: 2.1, startAt: 0.2 });
      play(a, 'cast');
      return {
        t: 0, dur: 0.5, canMove: false, fired: false,
        tick: (dt, s) => {
          if (s.fired || s.t < 0.24) return;
          s.fired = true;
          const from = handPos(a), to = aimedAt(a, from, at && target);
          g.projectiles.spawn({ from, to, owner: real ? 'player' : 'remote', mult: 2.2, speed: 19, color: 0xff7a2a, trail: 0xff2a00, radius: 0.45, range: 20, aoe: 2.8, size: 0.32, glide: 0.9 });
          play(a, 'fireball');
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  nova: {
    name: 'Frost Nova', level: 2, mp: 18, cd: 8,
    desc: 'Frost bursts out around you: 120% spell damage to everything within 5 m, slowing them by 60% for 4 seconds.',
    icon: '<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round"><path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13" stroke="#bfeaff" stroke-width="2.6"/><path d="M12.5 6 16 9.5 19.5 6M12.5 26 16 22.5l3.5 3.5" stroke="#7fd0ff" stroke-width="1.8"/><circle cx="16" cy="16" r="3" fill="#e8f8ff"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      return {
        t: 0, dur: 0.45, canMove: false, burst: false,
        tick: (dt, s) => {
          if (s.burst || s.t < 0.18) return;
          s.burst = true;
          const p = a.pos;
          g.fx.ring(p, 0.6, 5.6, 0x9fe4ff, 0.45);
          g.fx.ring(p, 0.3, 4.2, 0xffffff, 0.35, 0.3, 1.2);
          for (let i = 0; i < 28; i++) { // ice shards flying out flat
            const ang = (i / 28) * TAU + rand(-0.1, 0.1), sp = rand(7, 11);
            g.fx.add.emit({ pos: { x: p.x, y: p.y + 0.6, z: p.z }, count: 1, spread: 0.2, velSpread: 0.3, vel: { x: Math.cos(ang) * sp, y: 0.6, z: Math.sin(ang) * sp }, color: hdr(0xcff4ff, 2.2), colorEnd: hdr(0x5ab8ff, 0.3), size: 0.22, sizeEnd: 0.04, life: 0.5, drag: 2.5 });
          }
          g.fx.soft.emit({ pos: { x: p.x, y: p.y + 0.4, z: p.z }, count: 18, spread: 2.5, velSpread: 0.6, vel: { x: 0, y: 0.3, z: 0 }, color: new THREE.Color(0xdff6ff), alpha: 0.35, size: 1.4, sizeEnd: 2.6, life: 1.4, drag: 2, flat: true });
          play(a, 'frost');
          if (real) g.areaHit({ at: a.pos, radius: 5, mult: 1.2, spell: true, knock: 0.3, eff: { slow: [0.4, 4] } });
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  blink: {
    name: 'Blink', level: 3, mp: 12, cd: 6, range: 8,
    desc: 'Vanish and reappear up to 8 m away, toward where you aim: out of trouble, or into position.',
    icon: '<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round"><circle cx="9" cy="16" r="5" stroke="#9fb8ff" stroke-width="2" stroke-dasharray="2.5 2.5"/><circle cx="23" cy="16" r="5" fill="#8a6dff" stroke="#e6dcff" stroke-width="1.6"/><path d="M13 12.5l5-2.5M13 19.5l5 2.5" stroke="#c9b8ff" stroke-width="1.8"/></svg>',
    cast(a, at, real) {
      const g = a.game, from = a.pos.clone();
      const to = real ? reachable(from, at || ahead(a, 8), 8) : at || from;
      puff(g, from, 0x8fb8ff);
      puff(g, to, 0xb79cff);
      play(a, 'blink');
      if (real) {
        a.faceToward(to);
        a.pos.copy(to);
      }
      return { t: 0, dur: 0.15, canMove: true, dest: to };
    },
  },

  meteor: {
    name: 'Meteor', level: 4, mp: 30, cd: 12, range: 14,
    desc: 'Call a meteor down where you aim: a moment later it crashes for 350% spell damage to everything within 3.5 m.',
    icon: '<svg viewBox="0 0 32 32"><path d="M3 3l13 13M7 2l11 11M2 8l11 11" stroke="#ffb060" stroke-width="2" stroke-linecap="round" opacity=".75"/><circle cx="21" cy="21" r="8" fill="#ff6a1a" stroke="#8a2a08" stroke-width="1.3"/><circle cx="19" cy="19" r="3.5" fill="#ffd08a"/></svg>',
    cast(a, at, real) {
      const g = a.game, p = (at || ahead(a, 8)).clone();
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Interact', { timeScale: 1.3 });
      play(a, 'cast');
      g.fx.telegraph(p, 3.5, 1.05, null, 0xff7a2a); // everyone sees where it will land
      return {
        t: 0, dur: 0.6, canMove: false, launched: false,
        tick: (dt, s) => {
          if (s.launched || s.t < 0.35) return;
          s.launched = true;
          const from = new THREE.Vector3(p.x - 4, p.y + 16, p.z + 3);
          g.projectiles.spawn({ from, to: p.clone(), owner: real ? 'player' : 'remote', mult: 3.5, speed: 24, color: 0xff6a1a, trail: 0xff2a00, radius: 0.6, range: 30, aoe: 3.5, size: 0.9, meteor: true });
          play(a, 'fireball');
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  // ---------------------------------------------------------------- Rogue
  twin: {
    name: 'Twin Strike', level: 1, mp: 6, cd: 2, range: 2.6,
    desc: 'Two lightning-fast stabs at what is in front of you, 90% weapon damage each, with a 25% better chance of a critical hit.',
    icon: '<svg viewBox="0 0 32 32" stroke-linecap="round"><path d="M7 5l13 15M25 5L12 20" stroke="#e3e9f0" stroke-width="3"/><path d="M18 21l5 5M14 21l-5 5" stroke="#7a4f2c" stroke-width="3.4"/><path d="M16.5 19l4 1.5M15.5 19l-4 1.5" stroke="#d6aa4a" stroke-width="2.2"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      if (at) a.faceToward(at);
      const strike = () => {
        g.fx.arc(a.pos, a.yaw, { span: 1.2, rIn: 0.5, rOut: 2.2, color: 0xe8f0ff, dur: 0.15 });
        play(a, 'swing', 0.55);
        if (real) g.meleeHit({ range: 2.3, arc: 1.4, mult: 0.9, knock: 0.15, critBonus: 0.25 });
      };
      a.h.startSwing(0.24, 'stab');
      return {
        t: 0, dur: 0.5, canMove: false, n: 0,
        tick: (dt, s) => {
          if (s.n === 0 && s.t >= 0.12) { s.n = 1; strike(); }
          if (s.n === 1 && s.t >= 0.24) { s.n = 2; a.h.startSwing(0.24, 'stab'); }
          if (s.n === 2 && s.t >= 0.36) { s.n = 3; strike(); }
        },
      };
    },
  },

  knives: {
    name: 'Fan of Knives', level: 2, mp: 14, cd: 5, range: 10,
    desc: 'Throw seven knives in a fan in front of you; each deals 80% weapon damage to the first enemy it meets.',
    icon: '<svg viewBox="0 0 32 32" stroke-linecap="round"><path d="M16 27V8M16 27 6.5 11.5M16 27l9.5-15.5" stroke="#dfe7f0" stroke-width="2.4"/><circle cx="16" cy="27" r="2.6" fill="#d6aa4a"/></svg>',
    cast(a, at, real) {
      const g = a.game;
      if (at) a.faceToward(at);
      a.h.anim.play('Throw', { timeScale: 2.2, startAt: 0.2 });
      return {
        t: 0, dur: 0.45, canMove: false, thrown: false,
        tick: (dt, s) => {
          if (s.thrown || s.t < 0.18) return;
          s.thrown = true;
          const from = handPos(a);
          for (let i = 0; i < 7; i++) {
            const dir = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)).applyAxisAngle(UP, (i - 3) * 0.2);
            g.projectiles.spawn({ from: from.clone(), dir, owner: real ? 'player' : 'remote', mult: 0.8, spell: false, speed: 26, color: 0xdfe8f2, trail: 0x8899aa, radius: 0.35, range: 11, size: 0.12, small: true, noLight: true, glide: 0.85 });
          }
          play(a, 'knives');
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  smoke: {
    name: 'Smoke Bomb', level: 3, mp: 16, cd: 12,
    desc: 'Smash a smoke bomb at your feet: monsters within 4 m are stunned for 2 seconds, and for 4 seconds half the blows aimed at you miss.',
    icon: '<svg viewBox="0 0 32 32"><path d="M8 24a5 5 0 0 1-1-9.9A7 7 0 0 1 20 10a6 6 0 0 1 6 6.5A4 4 0 0 1 25 24z" fill="#8e9099" stroke="#3e4048" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="27.5" r="1.6" fill="#6e7078"/><circle cx="20" cy="28" r="1.3" fill="#6e7078"/></svg>',
    cast(a, at, real) {
      const g = a.game, p = a.pos;
      a.h.anim.play('Throw', { timeScale: 2.4, startAt: 0.3 });
      play(a, 'smoke');
      g.fx.soft.emit({ pos: { x: p.x, y: p.y + 0.8, z: p.z }, count: 40, spread: 1.6, velSpread: 1.4, vel: { x: 0, y: 0.6, z: 0 }, color: new THREE.Color(0x6e6a72), colorEnd: new THREE.Color(0x3a383e), alpha: 0.55, size: 1.6, sizeEnd: 3.4, life: 2.4, drag: 1.6 });
      g.fx.burst(new THREE.Vector3(p.x, p.y + 0.4, p.z), 0xc8c0d8, 16, 3, 0.25, 0.5);
      g.fx.ring(p, 0.3, 4.2, 0x9a96a8, 0.4);
      a.aura('smoke', BUFFS.smoke.dur);
      if (real) {
        a.addBuff('smoke');
        for (const e of g.enemies.list) {
          if (e.alive && e.state !== 'spawn' && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 4 + e.radius) g.affectEnemy(e, { stun: 2 });
        }
      }
      return { t: 0, dur: 0.35, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  shadowstep: {
    name: 'Shadow Step', level: 4, mp: 18, cd: 10, range: 12,
    desc: 'Vanish and step out of the shadows behind an enemy up to 12 m away, striking for 250% weapon damage with a 50% better chance of a critical hit.',
    icon: '<svg viewBox="0 0 32 32"><path d="M3 12h7M2 17h8M3 22h7" stroke="#9a6dff" stroke-width="2" stroke-linecap="round" opacity=".8"/><circle cx="19.5" cy="7.5" r="3.5" fill="#2a2238" stroke="#b9a0ff" stroke-width="1.2"/><path d="M14 28l2-9-3-1 4-6h5l3 6-3 1 1 9z" fill="#2a2238" stroke="#b9a0ff" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    cast(a, at, real) {
      const g = a.game, from = a.pos.clone();
      let to = at || from, target = null;
      if (real) {
        target = g.aim(12).target;
        if (target && target.alive) { // behind it, as seen from where we stood (or beside it if that's blocked)
          const base = Math.atan2(target.pos.x - from.x, target.pos.z - from.z), r = target.radius + 0.9;
          to = null;
          for (const off of [0, 0.9, -0.9, 1.8, -1.8, Math.PI]) {
            const x = target.pos.x + Math.sin(base + off) * r, z = target.pos.z + Math.cos(base + off) * r;
            if (isWalkable(x, z, 0.4) && !wallAt(x, z)) { to = new THREE.Vector3(x, heightAt(x, z), z); break; }
          }
          if (!to) to = reachable(from, target.pos, 12);
        } else {
          target = null;
          to = reachable(from, ahead(a, 6), 6);
        }
      }
      puff(g, from, 0x6a4a9a);
      puff(g, to, 0x6a4a9a);
      play(a, 'blink');
      if (real) {
        a.pos.copy(to);
        a.faceToward(target ? target.pos : ahead(a, 1));
      }
      a.h.startSwing(0.35, 'stab');
      return {
        t: 0, dur: 0.45, canMove: false, hit: false, dest: to,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.15) return;
          s.hit = true;
          g.fx.arc(a.pos, a.yaw, { span: 1.4, rIn: 0.5, rOut: 2.4, color: 0xc9a8ff, dur: 0.18 });
          play(a, 'swing', 0.7);
          if (real && target && target.alive) g.damageEnemy(target, a.rollDamage(2.5, false, 0.5), a.pos, 0.3);
        },
      };
    },
  },
};

// Lingering looks while a buff lasts (for any hero): auras = { id: seconds left }.
export function auraTick(a, dt) {
  const g = a.game, p = a.pos;
  for (const id of Object.keys(a.auras)) {
    a.auras[id] -= dt;
    if (a.auras[id] <= 0) { delete a.auras[id]; continue; }
    if (id === 'warcry' && Math.random() < dt * 14) {
      g.fx.add.emit({ pos: { x: p.x + rand(-0.5, 0.5), y: p.y + rand(0.3, 1.6), z: p.z + rand(-0.5, 0.5) }, count: 1, spread: 0.1, velSpread: 0.2, vel: { x: 0, y: 1.2, z: 0 }, color: hdr(0xffd060, 2.2), colorEnd: hdr(0xff9a20, 0.3), size: 0.14, sizeEnd: 0.02, life: 0.8, drag: 1 });
    } else if (id === 'rage' && Math.random() < dt * 22) {
      g.fx.add.emit({ pos: { x: p.x + rand(-0.45, 0.45), y: p.y + rand(0.4, 1.8), z: p.z + rand(-0.45, 0.45) }, count: 1, spread: 0.1, velSpread: 0.3, vel: { x: 0, y: 1.5, z: 0 }, color: hdr(0xff4a2a, 2.4), colorEnd: hdr(0x8a0a00, 0.3), size: 0.16, sizeEnd: 0.02, life: 0.7, drag: 1 });
    } else if (id === 'smoke' && Math.random() < dt * 9) {
      g.fx.soft.emit({ pos: { x: p.x + rand(-0.5, 0.5), y: p.y + rand(0.2, 1.2), z: p.z + rand(-0.5, 0.5) }, count: 1, spread: 0.2, velSpread: 0.3, vel: { x: 0, y: 0.5, z: 0 }, color: new THREE.Color(0x4a4650), alpha: 0.35, size: 0.6, sizeEnd: 1.4, life: 1.2, drag: 1.5 });
    }
  }
}

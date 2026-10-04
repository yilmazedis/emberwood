// Warrior: Arms (heavy blows), Guard (shields and standing firm), Fury (rage and great weapons).
import * as THREE from 'three';
import { heightAt } from '../world.js';
import { hdr } from '../fx.js';
import { lerp } from '../util.js';
import { ahead, play, reachable, pointOf } from './common.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export const WARRIOR = {
  // ---------------------------------------------------------------- Arms
  power_strike: {
    name: 'Power Strike', mp: 0.07, cd: 4, range: 2.6, target: 'enemy', needs: 'melee',
    desc: ({ pw }) => `A heavy blow at your target: ${pct(1.8 * pw)} weapon damage, with a better chance of a critical hit.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M26 4 12 18l2 2L28 6z" fill="#e3e9f0" stroke="#5d6875" stroke-width="1.2"/><path d="M9 17l6 6M11 21l-6 6" stroke="#d6aa4a" stroke-width="3" stroke-linecap="round"/><path d="M20 22l3 6M24 18l6 2M17 26l-1 4" stroke="#ffcf5a" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, t = ctx.target;
      if (t) a.faceToward(t.pos);
      a.h.startSwing(0.55, 'chop');
      play(a, 'swing', 0.8);
      return {
        t: 0, dur: 0.55, canMove: false, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.3) return;
          s.hit = true;
          const p = t ? t.pos : ahead(a, 1.6);
          g.fx.burst(new THREE.Vector3(p.x, p.y + 1, p.z), 0xffd070, 24, 5);
          g.fx.ring(p, 0.3, 1.8, 0xffc060, 0.3);
          play(a, 'bash');
          if (real && t) g.strike(t, 1.8 * ctx.pw, { critBonus: 0.15, knock: 0.6, reach: 2.6 });
        },
      };
    },
  },

  cleave: {
    name: 'Cleave', mp: 0.09, cd: 6,
    desc: ({ pw }) => `A wide, heavy arc that hits everything in front of you for ${pct(1.4 * pw)} weapon damage and knocks them back.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M4 22C6 9 22 4 29 12c-8-3-17 0-21 11z" fill="#ffc46a" stroke="#a8641c" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 20C10 12 19 8 25 10" stroke="#fff6d8" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="8" cy="24" r="2.2" fill="#fff0c0"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      if (ctx.at) a.faceToward(ctx.at);
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
          if (real) { g.meleeHit({ range: 3.4, arc: 3.4, mult: 1.4 * ctx.pw, knock: 1.5 }); g.shake(0.22); }
        },
      };
    },
  },

  charge: {
    name: 'Charge', mp: 0.1, cd: 12, range: 10, target: 'enemy',
    desc: ({ pw }) => `Rush at your target (up to 10 m) and crash into it: ${pct(1.5 * pw)} weapon damage to everything around you, knocking them back and stunning them for a second.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M3 11h9M2 16h11M3 21h9" stroke="#ffd9a0" stroke-width="2" stroke-linecap="round" opacity=".8"/><path d="M14 8l14 8-14 8 3.5-8z" fill="#e3e9f0" stroke="#5d6875" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, from = a.pos.clone();
      const aim = pointOf(a, ctx, 7);
      a.faceToward(aim);
      let to = aim;
      if (real) { // stop just short of the target
        const d = Math.hypot(aim.x - from.x, aim.z - from.z), stop = Math.max(0, d - (ctx.target ? ctx.target.radius + 0.7 : 0));
        to = reachable(from, aim, Math.min(10, stop));
      }
      const dash = Math.max(0.12, Math.min(10, from.distanceTo(to)) / 26);
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
          if (real) { g.areaHit({ at: a.pos, radius: 2.6, mult: 1.5 * ctx.pw, knock: 1.2, eff: { stun: 1 } }); g.shake(0.25); }
        },
        end: () => { if (a.h.anim.oneName === 'Running_A') a.h.anim.stopOne(); },
      };
    },
  },

  execute: {
    name: 'Execute', mp: 0.12, cd: 10, range: 2.8, target: 'enemy', needs: 'melee',
    desc: ({ pw }) => `A killing blow: ${pct(2.4 * pw)} weapon damage to your target, twice that if it has less than a third of its Life left.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M6 26 22 10" stroke="#7a4f2c" stroke-width="3.2" stroke-linecap="round"/><path d="M18 4c6 0 10 4 10 10l-4 2-10-10z" fill="#d8dee6" stroke="#5d6875" stroke-width="1.3" stroke-linejoin="round"/><path d="M4 16l3 2M13 27l2 3M3 22l4 0" stroke="#ff4a3a" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, t = ctx.target;
      if (t) a.faceToward(t.pos);
      a.h.startSwing(0.75, 'chop');
      play(a, 'swing');
      return {
        t: 0, dur: 0.75, canMove: false, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.42) return;
          s.hit = true;
          const p = t ? t.pos : ahead(a, 1.6);
          g.fx.burst(new THREE.Vector3(p.x, p.y + 1, p.z), 0xff4a3a, 34, 6);
          g.fx.pillar(new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z), 0xff5a3a, 0.4);
          play(a, 'slam', 0.7);
          if (real && t) {
            const low = t.maxHp && t.hp / t.maxHp < 0.34;
            g.strike(t, 2.4 * ctx.pw * (low ? 2 : 1), { critBonus: 0.1, knock: 0.8, reach: 2.8 });
            g.shake(low ? 0.4 : 0.2);
          }
        },
      };
    },
  },

  // ---------------------------------------------------------------- Guard
  war_cry: {
    name: 'War Cry', mp: 0.08, cd: 15,
    desc: ({ pw }) => `A roar that turns every monster within 9 m on you for 4 seconds (your friends get a breather), and your armor is ${pct(0.3 * pw)} higher for 12 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M4 13h5l8-6v18l-8-6H4z" fill="#f0c860" stroke="#7a5418" stroke-width="1.3" stroke-linejoin="round"/><path d="M21 11c2 1.5 2 8.5 0 10M24.5 8c3.5 3 3.5 13 0 16" stroke="#ffe7a6" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.5 });
      play(a, 'warcry');
      g.fx.ring(a.pos, 0.6, 9, 0xffd060, 0.6);
      g.fx.ring(a.pos, 0.4, 5, 0xffb040, 0.4, 1.2);
      g.fx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 1.6, a.pos.z), 0xffd060, 30, 3);
      a.aura('warcry', 12);
      if (real) {
        a.addBuff('war_cry', 0.3 * ctx.pw);
        for (const e of g.monstersNear(a.pos, 9)) g.affectEnemy(e, { taunt: 4 });
      }
      return { t: 0, dur: 0.6, canMove: true, moveMult: 0.5, end: () => a.h.anim.stopOne() };
    },
  },

  shield_bash: {
    name: 'Shield Bash', mp: 0.08, cd: 7, range: 2.4, needs: 'shield', target: 'enemy',
    desc: ({ pw }) => `Slam your shield into the enemies in front of you for ${pct(1.3 * pw)} weapon damage. They are stunned for 2 seconds (bosses only briefly).`,
    icon: '<svg viewBox="0 0 32 32"><path d="M4 6h15v9c0 6-4 10-7.5 12C8 25 4 21 4 15z" fill="#9fb6d6" stroke="#3a4a66" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.5 7v19M5 14h13" stroke="#e8eef8" stroke-width="2"/><path d="M23 8l5-3M24 15h6M23 22l5 3" stroke="#ffe08a" stroke-width="2.2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      if (ctx.target || ctx.at) a.faceToward(pointOf(a, ctx));
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
          if (real && g.meleeHit({ range: 2.4, arc: 1.7, mult: 1.3 * ctx.pw, knock: 0.6, eff: { stun: 2 } })) g.shake(0.15);
        },
      };
    },
  },

  shield_wall: {
    name: 'Shield Wall', mp: 0.1, cd: 25, needs: 'shield',
    desc: ({ pw }) => `Raise your shield and brace: you take ${pct(Math.min(0.55, 0.35 * pw))} less damage for 6 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M5 5h22v10c0 7-5 12-11 14C10 27 5 22 5 15z" fill="#7fa6d8" stroke="#2a3a5a" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 9h14v6c0 4-3 8-7 9-4-1-7-5-7-9z" fill="#c8dcf4"/><path d="M16 10v13" stroke="#5a7ab0" stroke-width="2"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.8 });
      play(a, 'bash', 0.6);
      g.fx.ring(a.pos, 0.4, 2.2, 0x8fc0ff, 0.5);
      g.fx.pillar(a.pos, 0x8fc0ff, 0.5);
      a.aura('guard', 6);
      if (real) a.addBuff('shield_wall', 1 - Math.min(0.55, 0.35 * ctx.pw));
      return { t: 0, dur: 0.4, canMove: true, moveMult: 0.6, end: () => a.h.anim.stopOne() };
    },
  },

  last_stand: {
    name: 'Last Stand', mp: 0.1, cd: 60,
    desc: ({ pw }) => `Refuse to fall: restore ${pct(Math.min(0.6, 0.35 * pw))} of your maximum Life at once, and have 25% more Life for 15 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 28S4 20 4 12a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 16-12 16z" fill="#ff5a4a" stroke="#7a1a10" stroke-width="1.3" stroke-linejoin="round"/><path d="M16 9v12M11 15h10" stroke="#fff0d0" stroke-width="3" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.6 });
      play(a, 'warcry');
      g.fx.levelUp(a.pos);
      g.fx.ring(a.pos, 0.5, 3, 0xff5a4a, 0.5);
      a.aura('rage', 15);
      if (real) {
        a.addBuff('last_stand', 1);
        a.heal(Math.round(a.stats.maxHp * Math.min(0.6, 0.35 * ctx.pw)));
      }
      return { t: 0, dur: 0.5, canMove: true, moveMult: 0.5, end: () => a.h.anim.stopOne() };
    },
  },

  // ---------------------------------------------------------------- Fury
  battle_rage: {
    name: 'Battle Rage', mp: 0.1, cd: 25,
    desc: ({ pw }) => `Let the fury in: for 10 seconds you attack 25% faster and deal ${pct(0.12 * pw)} more damage.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 3c2 6-4 8-4 13 0 2 1 3 2 4-3 0-6-3-6-7 0-2 1-4 2-5-4 2-6 6-6 10 0 6 5 11 12 11s12-5 12-11c0-5-3-8-6-10 1 3 0 6-2 7 1-6-2-10-4-12z" fill="#ff4a2a" stroke="#7a1408" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 17c1 2 4 3 4 7a4 4 0 0 1-8 0c0-2 2-3 2-5 1 1 1 2 2 2z" fill="#ffd08a"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.8 });
      play(a, 'enrage');
      g.fx.ring(a.pos, 0.5, 4, 0xff3a2a, 0.5);
      g.fx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 1.4, a.pos.z), 0xff4a2a, 30, 3);
      a.aura('rage', 10);
      if (real) a.addBuff('battle_rage', 0.12 * ctx.pw);
      return { t: 0, dur: 0.5, canMove: true, moveMult: 0.6, end: () => a.h.anim.stopOne() };
    },
  },

  whirlwind: {
    name: 'Whirlwind', mp: 0.12, cd: 9, needs: 'melee',
    desc: ({ pw }) => `Spin for 1.4 s, striking everything around you 5 times for ${pct(0.6 * pw)} weapon damage (a quarter more with two weapons). You can move while spinning.`,
    icon: '<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round"><path d="M16 4a12 12 0 1 1-11.3 8" stroke="#dfe9ff" stroke-width="2.6"/><path d="M16 9a7 7 0 1 1-6.6 4.7" stroke="#9fc0ff" stroke-width="2.4"/><path d="M16 14a2.5 2.5 0 1 1-2.4 1.8" stroke="#fff" stroke-width="2.2"/><path d="M4.7 12l-1.5-4.5 4.6 1.2" stroke="#dfe9ff" stroke-width="2.2"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.armsOut = 1;
      play(a, 'whirl');
      const mult = 0.6 * ctx.pw * (real && a.dualWield ? 1.25 : 1);
      return {
        t: 0, dur: 1.4, canMove: true, moveMult: 0.8, lockFacing: true, next: 0.05,
        tick: (dt, s) => {
          a.h.model.rotation.y += dt * 17;
          if (s.t >= s.next) {
            s.next += 0.27;
            g.fx.ring(a.pos, 0.8, 3.1, 0xffd9a0, 0.28, 0.9, 0.7);
            play(a, 'swing', 0.45);
            if (real) g.meleeHit({ range: 3.0, arc: 7, mult, knock: 0.3 });
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

  leap: {
    name: 'Leap Slam', mp: 0.12, cd: 12, range: 9, target: 'ground',
    desc: ({ pw }) => `Leap up to 9 m and crash down: ${pct(1.8 * pw)} weapon damage to everything within 3 m of where you land, and they are slowed by half for 3 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M4 22C7 6 21 5 25 19" stroke="#ffd08a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-dasharray="3 3"/><path d="M20.5 17.5l5 3.5 1.5-5.5" stroke="#ffd08a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 28h13M21 25l-2-3M28 25l2-3" stroke="#c98a4a" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, from = a.pos.clone();
      const aim = pointOf(a, ctx, 8);
      const to = real ? reachable(from, aim, 9) : aim;
      a.faceToward(to);
      const dur = 0.85;
      a.h.anim.play('Jump_Full_Short', { timeScale: 1.25 });
      play(a, 'leap');
      return {
        t: 0, dur: dur + 0.2, canMove: false, lockFacing: true, landed: false, dest: to,
        tick: (dt, s) => {
          const k = Math.min(1, s.t / dur);
          if (real) { a.pos.x = lerp(from.x, to.x, k); a.pos.z = lerp(from.z, to.z, k); }
          a.h.model.position.y = Math.sin(Math.PI * k) * 2.4;
          if (s.landed || k < 1) return;
          s.landed = true;
          a.h.model.position.y = 0;
          g.fx.ring(a.pos, 0.5, 3.4, 0xff9a4a, 0.45);
          g.fx.dust(new THREE.Vector3(a.pos.x, a.pos.y + 0.2, a.pos.z), 30);
          g.fx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 0.3, a.pos.z), 0xffb060, 24, 5);
          play(a, 'slam');
          if (real) { g.areaHit({ at: a.pos, radius: 3, mult: 1.8 * ctx.pw, knock: 0.8, eff: { slow: [0.5, 3] } }); g.shake(0.45); }
        },
        end: () => { a.h.model.position.y = 0; a.h.anim.stopOne(); },
      };
    },
  },

  earthshatter: {
    name: 'Earthshatter', mp: 0.15, cd: 16, needs: 'twohand', range: 9, target: 'ground',
    desc: ({ pw }) => `Bring your great weapon down so hard the ground splits ahead of you: ${pct(3.2 * pw)} weapon damage to everything in a 9 m wedge, stunning them for 1.2 seconds. Needs a two-handed weapon.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 30 4 6h24z" fill="#8a5a34" opacity=".35"/><path d="M16 29l-2-6 3-4-3-5 2-5-1-6M16 23l-6 3M17 19l6 2M14 14l-5-2M16 9l5-2" stroke="#ff9a4a" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.faceToward(pointOf(a, ctx, 6));
      const dur = 0.9;
      a.h.startSwing(dur, 'chop');
      play(a, 'swing');
      return {
        t: 0, dur, canMove: false, lockFacing: true, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < dur * 0.55) return;
          s.hit = true;
          for (let i = 1; i <= 7; i++) { // the crack runs out ahead
            const d = i * 1.25, spread = d * 0.38;
            for (const side of [-1, 0, 1]) {
              const x = a.pos.x + Math.sin(a.yaw) * d + Math.cos(a.yaw) * side * spread * 0.6;
              const z = a.pos.z + Math.cos(a.yaw) * d - Math.sin(a.yaw) * side * spread * 0.6;
              g.fx.dust(new THREE.Vector3(x, heightAt(x, z) + 0.1, z), 3);
              g.fx.add.emit({ pos: { x, y: heightAt(x, z) + 0.2, z }, count: 2, spread: 0.3, velSpread: 1.5, vel: { x: 0, y: 3.5, z: 0 }, color: hdr(0xffa050, 2), colorEnd: hdr(0x8a3a10, 0.2), size: 0.2, sizeEnd: 0.04, life: 0.6, gravity: 8, drag: 1 });
            }
          }
          g.fx.arc(a.pos, a.yaw, { span: 0.9, rIn: 0.8, rOut: 9, color: 0xff9a4a, dur: 0.4, height: 0.3 });
          play(a, 'slam');
          if (real) { g.meleeHit({ range: 9, arc: 0.9, mult: 3.2 * ctx.pw, knock: 1.0, eff: { stun: 1.2 } }); g.shake(0.55); }
        },
      };
    },
  },
};

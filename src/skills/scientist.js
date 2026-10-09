// Scientist: Pyrology (fire), Cryology (frost), Alchemy (poisons, weakening brews, doors through space). The great
// elemental spells want a long staff; the alchemist's best tricks want a book in the off hand.
import * as THREE from 'three';
import { heightAt } from '../world.js';
import { hdr } from '../fx.js';
import { rand, TAU } from '../util.js';
import { ahead, play, reachable, puff, aimedAt, handPos, pointOf, flat, lingering } from './common.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export const SCIENTIST = {
  // ---------------------------------------------------------------- Pyrology
  fireball: {
    name: 'Fireball', mp: 0.06, cd: 2, range: 15, target: 'enemy',
    desc: ({ pw }) => `Hurl a fireball that explodes for ${pct(1.25 * pw)} spell damage on everything within 2.8 m.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M20 5c1 5-3 6-2 10 2-1 3-3 3-5 4 3 6 7 5 11-1 5-6 8-11 7S6 23 7 18c1-4 4-5 5-9 1 2 1 4 3 5-1-4 1-7 5-9z" fill="#ff7a2a" stroke="#a32d0a" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 17c2 2 4 3 3 6-1 2-4 3-6 1-2-1-1-4 0-5 0 1 1 2 2 2-1-2 0-3 1-4z" fill="#ffe08a"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, target = pointOf(a, ctx, 10);
      a.faceToward(target);
      a.h.anim.play('Throw', { timeScale: 2.1, startAt: 0.2 });
      play(a, 'cast');
      return {
        t: 0, dur: 0.5, canMove: false, fired: false,
        tick: (dt, s) => {
          if (s.fired || s.t < 0.24) return;
          s.fired = true;
          const from = handPos(a);
          g.projectiles.spawn({ from, to: aimedAt(a, from, target), homing: ctx.target, owner: real ? 'player' : 'remote', mult: 1.25 * ctx.pw, speed: 19, color: 0xff7a2a, trail: 0xff2a00, radius: 0.45, range: 22, aoe: 2.8, size: 0.32, glide: 0.9 });
          play(a, 'fireball');
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  flame_wave: {
    name: 'Flame Wave', mp: 0.1, cd: 7, range: 7, target: 'ground',
    desc: ({ pw }) => `A wave of fire rolls out in front of you: ${pct(1.0 * pw)} spell damage to everything within 7 m, and they burn for ${pct(0.2 * pw)} a second for 3 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M4 16c6-9 18-12 26-10-6 3-8 6-8 10s2 7 8 10c-8 2-20-1-26-10z" fill="#ff8a2a" stroke="#a83a10" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 16c4-4 9-5 13-4-3 1-4 2-4 4s1 3 4 4c-4 1-9 0-13-4z" fill="#ffe08a"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.faceToward(pointOf(a, ctx, 5));
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'fireball');
      return {
        t: 0, dur: 0.5, canMove: false, lockFacing: true, burst: false,
        tick: (dt, s) => {
          if (s.burst || s.t < 0.2) return;
          s.burst = true;
          for (let i = 0; i < 46; i++) {
            const ang = a.yaw + rand(-0.62, 0.62), sp = rand(7, 13), hand = handPos(a);
            g.fx.add.emit({ pos: { x: hand.x, y: hand.y - 0.3, z: hand.z }, count: 1, spread: 0.2, velSpread: 0.6, vel: { x: Math.sin(ang) * sp, y: rand(-0.3, 0.6), z: Math.cos(ang) * sp }, color: hdr(0xffb040, 2.4), colorEnd: hdr(0xff3a10, 0.3), size: rand(0.35, 0.6), sizeEnd: 0.1, life: 0.6, drag: 1.8 });
          }
          g.fx.arc(a.pos, a.yaw, { span: 1.25, rIn: 0.8, rOut: 7, color: 0xff7a2a, dur: 0.35, height: 0.5 });
          if (real) g.meleeHit({ range: 7, arc: 1.25, mult: 1.0 * ctx.pw, knock: 0.6, spell: true, eff: { dot: g.dot(0.2 * ctx.pw, 3, 'burn') } });
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  inferno: {
    name: 'Inferno', mp: 0.14, cd: 14, range: 15, target: 'ground', needs: 'staff',
    desc: ({ pw }) => `Set the ground ablaze where you aim: for 5 seconds everything within 3.5 m burns for ${pct(0.36 * pw)} spell damage a second. Needs a long staff.`,
    icon: '<svg viewBox="0 0 32 32"><ellipse cx="16" cy="25" rx="13" ry="4" fill="#ff5a1a" opacity=".6"/><path d="M9 25c-1-5 3-6 2-11 3 2 3 5 3 7 1-4 4-6 3-12 4 4 6 9 5 16zM19 25c0-3 2-4 2-7 2 2 3 4 3 7z" fill="#ff8a2a" stroke="#a32d0a" stroke-width="1"/><path d="M13 25c0-2 1-3 1-5 1 1 2 3 2 5z" fill="#ffe08a"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 8);
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Interact', { timeScale: 1.6 });
      play(a, 'cast');
      g.fx.telegraph(p, 3.5, 0.4, null, 0xff6a1a);
      let acc = 0;
      lingering(g, p, {
        dur: 5, radius: 3.5, color: 0xff7a2a, rate: 70, rise: 1.2,
        tick: (dt, t) => {
          if (Math.random() < dt * 4) g.fx.fire(flat(p.x + rand(-2.5, 2.5), p.z + rand(-2.5, 2.5)), 0.8);
          acc += dt;
          if (!real || acc < 0.5 || t < 0.4) return;
          acc -= 0.5;
          g.areaHit({ at: p, radius: 3.5, mult: 0.18 * ctx.pw, knock: 0, spell: true, quiet: true });
        },
      });
      return { t: 0, dur: 0.45, canMove: false, end: () => a.h.anim.stopOne() };
    },
  },

  meteor: {
    name: 'Meteor', mp: 0.15, cd: 12, range: 15, target: 'ground', needs: 'staff',
    desc: ({ pw }) => `Call a meteor down where you aim: a moment later it crashes for ${pct(2.6 * pw)} spell damage to everything within 3.5 m. Needs a long staff.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M3 3l13 13M7 2l11 11M2 8l11 11" stroke="#ffb060" stroke-width="2" stroke-linecap="round" opacity=".75"/><circle cx="21" cy="21" r="8" fill="#ff6a1a" stroke="#8a2a08" stroke-width="1.3"/><circle cx="19" cy="19" r="3.5" fill="#ffd08a"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 8);
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
          g.projectiles.spawn({ from, to: p.clone(), owner: real ? 'player' : 'remote', mult: 2.6 * ctx.pw, speed: 24, color: 0xff6a1a, trail: 0xff2a00, radius: 0.6, range: 30, aoe: 3.5, size: 0.9, meteor: true });
          play(a, 'fireball');
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  // ---------------------------------------------------------------- Cryology
  ice_bolt: {
    name: 'Ice Bolt', mp: 0.05, cd: 1.2, range: 15, target: 'enemy',
    desc: ({ pw }) => `A shard of ice at your target: ${pct(1.25 * pw)} spell damage, and it is slowed by 30% for 3 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M4 28 22 10" stroke="#bfeaff" stroke-width="2" stroke-linecap="round" opacity=".7"/><path d="M28 4 18 8l-4 6 4 4 6-4z" fill="#cff4ff" stroke="#3a8ac8" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 20l4 4M6 24l2 2" stroke="#8fd8ff" stroke-width="1.6" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, target = pointOf(a, ctx, 10);
      a.faceToward(target);
      a.h.anim.play('Throw', { timeScale: 2.6, startAt: 0.25 });
      play(a, 'bolt');
      return {
        t: 0, dur: 0.4, canMove: false, fired: false,
        tick: (dt, s) => {
          if (s.fired || s.t < 0.16) return;
          s.fired = true;
          const from = handPos(a);
          g.projectiles.spawn({ from, to: aimedAt(a, from, target), homing: ctx.target, owner: real ? 'player' : 'remote', mult: 1.25 * ctx.pw, speed: 26, color: 0x9fe4ff, trail: 0x3a8aff, radius: 0.35, range: 20, size: 0.24, small: true, glide: 0.9, eff: { slow: [0.7, 3] } });
          play(a, 'frost', 0.5);
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  frost_nova: {
    name: 'Frost Nova', mp: 0.1, cd: 9,
    desc: ({ pw }) => `Frost bursts out around you: ${pct(0.9 * pw)} spell damage to everything within 5 m, slowing them by 60% for 4 seconds.`,
    icon: '<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round"><path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13" stroke="#bfeaff" stroke-width="2.6"/><path d="M12.5 6 16 9.5 19.5 6M12.5 26 16 22.5l3.5 3.5" stroke="#7fd0ff" stroke-width="1.8"/><circle cx="16" cy="16" r="3" fill="#e8f8ff"/></svg>',
    cast(a, ctx, real) {
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
          for (let i = 0; i < 28; i++) {
            const ang = (i / 28) * TAU + rand(-0.1, 0.1), sp = rand(7, 11);
            g.fx.add.emit({ pos: { x: p.x, y: p.y + 0.6, z: p.z }, count: 1, spread: 0.2, velSpread: 0.3, vel: { x: Math.cos(ang) * sp, y: 0.6, z: Math.sin(ang) * sp }, color: hdr(0xcff4ff, 2.2), colorEnd: hdr(0x5ab8ff, 0.3), size: 0.22, sizeEnd: 0.04, life: 0.5, drag: 2.5 });
          }
          g.fx.soft.emit({ pos: { x: p.x, y: p.y + 0.4, z: p.z }, count: 18, spread: 2.5, velSpread: 0.6, vel: { x: 0, y: 0.3, z: 0 }, color: new THREE.Color(0xdff6ff), alpha: 0.35, size: 1.4, sizeEnd: 2.6, life: 1.4, drag: 2, flat: true });
          play(a, 'frost');
          if (real) g.areaHit({ at: a.pos, radius: 5, mult: 0.9 * ctx.pw, spell: true, knock: 0.3, eff: { slow: [0.4, 4] } });
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  blizzard: {
    name: 'Blizzard', mp: 0.15, cd: 16, range: 15, target: 'ground', needs: 'staff',
    desc: ({ pw }) => `A storm of ice lashes the ground where you aim for 3 seconds: six waves of ${pct(0.33 * pw)} spell damage to everything within 5 m, slowing them. Needs a long staff.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M8 12a5 5 0 0 1 1-9.8A7 7 0 0 1 22 4a5 5 0 0 1 4 8z" fill="#cfe8ff" stroke="#4a7ab0" stroke-width="1.2"/><path d="M9 16l-2 5M15 15l-2 7M21 16l-2 5M12 23l-1 4M18 22l-1 5M24 21l-1 4" stroke="#8fd8ff" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 8);
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Interact', { timeScale: 1.5 });
      play(a, 'frost');
      let waves = 0, acc = 0.35;
      lingering(g, p, {
        dur: 3.1, radius: 5, color: 0xcff4ff, soft: 0xe8f6ff, rate: 26, rise: -0.4,
        tick: (dt) => {
          for (let i = 0; i < 3; i++) { // shards falling
            const ang = rand(0, TAU), r = Math.sqrt(Math.random()) * 5;
            g.fx.add.emit({ pos: { x: p.x + Math.cos(ang) * r - 1, y: p.y + 7, z: p.z + Math.sin(ang) * r + 0.5 }, count: 1, spread: 0.1, velSpread: 0.3, vel: { x: 2.2, y: -12, z: -1 }, color: hdr(0xdff6ff, 2.2), colorEnd: hdr(0x5ab8ff, 0.4), size: 0.18, sizeEnd: 0.05, life: 0.55, drag: 0 });
          }
          acc += dt;
          if (acc < 0.5 || waves >= 6) return;
          acc -= 0.5;
          waves++;
          if (waves % 2) play(a, 'frost', 0.4);
          if (real) g.areaHit({ at: p, radius: 5, mult: 0.33 * ctx.pw, spell: true, knock: 0, quiet: true, eff: { slow: [0.5, 2] } });
        },
      });
      return { t: 0, dur: 0.5, canMove: false, end: () => a.h.anim.stopOne() };
    },
  },

  glacial_prison: {
    name: 'Glacial Prison', mp: 0.12, cd: 15, range: 14, target: 'enemy', needs: 'staff',
    desc: ({ pw }) => `Freeze your target solid for 3 seconds (bosses only briefly); then the ice shatters for ${pct(2.2 * pw)} spell damage. Needs a long staff.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M8 28 6 12l10-8 10 8-2 16z" fill="#bfeaff" stroke="#3a8ac8" stroke-width="1.4" stroke-linejoin="round" opacity=".9"/><path d="M16 4v24M6 12l20 0M9 22l14 0" stroke="#ffffff" stroke-width="1.2" opacity=".7"/><circle cx="16" cy="16" r="3" fill="#2a4a6a"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, t = ctx.target, p = pointOf(a, ctx, 6);
      a.faceToward(p);
      a.h.anim.play('Use_Item', { timeScale: 1.8 });
      play(a, 'frost');
      return {
        t: 0, dur: 0.5, canMove: false, done: false,
        tick: (dt, s) => {
          if (s.done || s.t < 0.22) return;
          s.done = true;
          const at = t ? t.pos : p;
          g.fx.ring(at, 0.3, 1.8, 0xcff4ff, 0.6);
          g.fx.pillar(new THREE.Vector3(at.x, heightAt(at.x, at.z), at.z), 0x9fe4ff, 3);
          if (real && t) g.affectEnemy(t, { stun: 3, slow: [0.3, 4] });
          let left = 3;
          g.addTicker((dt2) => { // three seconds later the ice shatters
            left -= dt2;
            if (left > 0) return true;
            const q = t ? t.pos : at;
            g.fx.burst(new THREE.Vector3(q.x, q.y + 1, q.z), 0xcff4ff, 40, 6);
            play(a, 'frost', 0.8);
            if (real && t?.alive) g.strike(t, 2.2 * ctx.pw, { spell: true, knock: 0.4 });
            return false;
          });
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  // ---------------------------------------------------------------- Alchemy
  toxic_flask: {
    name: 'Toxic Flask', mp: 0.08, cd: 6, range: 13, target: 'ground',
    desc: ({ pw }) => `Throw a flask that bursts into a poison cloud: everything within 3 m is poisoned for ${pct(0.3 * pw)} spell damage a second for 5 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M12 3h8v4l-1 1v4l6 10a4 4 0 0 1-3.5 6h-11A4 4 0 0 1 7 22l6-10V8l-1-1z" fill="#3a2a1a" stroke="#a8a090" stroke-width="1.2"/><path d="M9 20h14l1.5 3a2 2 0 0 1-2 3h-13a2 2 0 0 1-2-3z" fill="#7dff4a"/><circle cx="14" cy="18" r="1.5" fill="#b8ff9a"/><circle cx="18" cy="15" r="1" fill="#b8ff9a"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 7);
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Throw', { timeScale: 2.2, startAt: 0.2 });
      return {
        t: 0, dur: 0.45, canMove: false, thrown: false,
        tick: (dt, s) => {
          if (s.thrown || s.t < 0.2) return;
          s.thrown = true;
          const from = handPos(a);
          g.projectiles.spawn({ from, to: p.clone(), owner: 'remote', speed: 16, color: 0x7dff4a, trail: 0x2a8a10, radius: 0.2, range: 30, size: 0.2, small: true, lob: 2.2,
            onLand: (at) => {
              play(a, 'nova', 0.6);
              g.fx.burst(new THREE.Vector3(at.x, at.y + 0.4, at.z), 0x7dff4a, 30, 4);
              if (real) g.areaHit({ at, radius: 3, mult: 0.15 * ctx.pw, spell: true, knock: 0, eff: { dot: g.dot(0.3 * ctx.pw, 5, 'poison') } });
              lingering(g, at, { dur: 4, radius: 3, color: 0x7dff4a, soft: 0x5a9a3a, rate: 18, rise: 0.4 });
            } });
          play(a, 'knives', 0.5);
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  blink: {
    name: 'Blink', mp: 0.06, cd: 6, range: 8, target: 'ground',
    desc: () => 'Vanish and reappear up to 8 m away, where you aim: out of trouble, or into position.',
    icon: '<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round"><circle cx="9" cy="16" r="5" stroke="#9fb8ff" stroke-width="2" stroke-dasharray="2.5 2.5"/><circle cx="23" cy="16" r="5" fill="#8a6dff" stroke="#e6dcff" stroke-width="1.6"/><path d="M13 12.5l5-2.5M13 19.5l5 2.5" stroke="#c9b8ff" stroke-width="1.8"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, from = a.pos.clone();
      const to = real ? reachable(from, ctx.at || ahead(a, 8), 8) : ctx.at || from;
      puff(g, from, 0x8fb8ff);
      puff(g, to, 0xb79cff);
      play(a, 'blink');
      if (real) { a.faceToward(to); a.pos.copy(to); }
      return { t: 0, dur: 0.15, canMove: true, dest: to };
    },
  },

  recall: {
    name: 'Teleport Party', mp: 0.2, cd: 120, needs: 'book',
    desc: () => 'Open a door through space: every member of your party, wherever they are, may step through it to your side. Needs a book.',
    icon: '<svg viewBox="0 0 32 32"><ellipse cx="16" cy="16" rx="11" ry="13" fill="#2a1a4a" stroke="#b08aff" stroke-width="2"/><ellipse cx="16" cy="16" rx="6" ry="8" fill="none" stroke="#e0d0ff" stroke-width="1.4" stroke-dasharray="3 2"/><circle cx="16" cy="16" r="2.5" fill="#fff"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.2 });
      play(a, 'portal');
      g.fx.ring(a.pos, 0.5, 4, 0xb08aff, 1.2);
      g.fx.pillar(a.pos, 0xb08aff, 1.6);
      lingering(g, a.pos.clone(), { dur: 3, radius: 2.5, color: 0xb08aff, rate: 40, rise: 1 });
      if (real) g.partyRecall();
      return { t: 0, dur: 1.0, canMove: false, end: () => a.h.anim.stopOne() };
    },
  },

  plague: {
    name: 'Plague', mp: 0.15, cd: 20, range: 14, target: 'ground', needs: 'book',
    desc: ({ pw }) => `A sickness spreads where you aim: monsters within 5 m deal 30% less damage and take ${pct(0.15 * pw)} more from everyone for 10 seconds, and are poisoned for ${pct(0.25 * pw)} spell damage a second. Needs a book.`,
    icon: '<svg viewBox="0 0 32 32"><circle cx="16" cy="13" r="9" fill="#4a7a2a" stroke="#1a3a0a" stroke-width="1.3"/><circle cx="12.5" cy="12" r="2.2" fill="#d8ff9a"/><circle cx="19.5" cy="12" r="2.2" fill="#d8ff9a"/><path d="M11 22h10l-1 6h-8z" fill="#4a7a2a" stroke="#1a3a0a" stroke-width="1.2"/><path d="M14 17h4" stroke="#1a3a0a" stroke-width="1.6"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 8);
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Interact', { timeScale: 1.5 });
      play(a, 'summon', 0.7);
      g.fx.ring(p, 0.5, 5, 0x8aff4a, 0.7);
      lingering(g, p, { dur: 3, radius: 5, color: 0x9aff5a, soft: 0x4a6a2a, rate: 30, rise: 0.5 });
      if (real) {
        for (const e of g.monstersNear(p, 5)) {
          g.affectEnemy(e, { weak: [0.3, 10], vuln: [Math.min(0.3, 0.15 * ctx.pw), 10], dot: g.dot(0.25 * ctx.pw, 6, 'poison') });
        }
      }
      return { t: 0, dur: 0.6, canMove: false, end: () => a.h.anim.stopOne() };
    },
  },
};

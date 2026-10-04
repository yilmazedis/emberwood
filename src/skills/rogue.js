// Rogue: Assassination (daggers), Marksmanship (bows), Shadow (speed, smoke and vanishing, for friends too).
import * as THREE from 'three';
import { heightAt } from '../world.js';
import { hdr } from '../fx.js';
import { angleDiff, yawTo, rand, TAU } from '../util.js';
import { UP, ahead, play, puff, aimedAt, handPos, pointOf, behind, blessFx } from './common.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const arrow = (g, a, real, to, o) => g.projectiles.spawn({ from: handPos(a, true), to, owner: real ? 'player' : 'remote', speed: 34, color: 0xfff0d0, trail: 0xc8a070, radius: 0.32, range: 22, size: 0.14, small: true, noLight: true, glide: 1.0, arrow: true, ...o });

export const ROGUE = {
  // ---------------------------------------------------------------- Assassination
  backstab: {
    name: 'Backstab', mp: 0.07, cd: 4, range: 2.4, target: 'enemy', needs: 'dagger',
    desc: ({ pw }) => `Drive your daggers into your target: ${pct(1.6 * pw)} weapon damage, 40% more if you strike it from behind.`,
    icon: '<svg viewBox="0 0 32 32" stroke-linecap="round"><path d="M7 5l13 15M25 5L12 20" stroke="#e3e9f0" stroke-width="3"/><path d="M18 21l5 5M14 21l-5 5" stroke="#7a4f2c" stroke-width="3.4"/><path d="M16.5 19l4 1.5M15.5 19l-4 1.5" stroke="#d6aa4a" stroke-width="2.2"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, t = ctx.target;
      if (t) a.faceToward(t.pos);
      a.h.startSwing(0.24, 'stab');
      return {
        t: 0, dur: 0.5, canMove: false, n: 0,
        tick: (dt, s) => {
          if (s.n === 0 && s.t >= 0.12) {
            s.n = 1;
            g.fx.arc(a.pos, a.yaw, { span: 1.2, rIn: 0.5, rOut: 2.2, color: 0xe8f0ff, dur: 0.15 });
            play(a, 'swing', 0.6);
            if (real && t) {
              const fromBehind = Math.abs(angleDiff(t.yaw ?? 0, yawTo(t.pos.x - a.pos.x, t.pos.z - a.pos.z))) < Math.PI / 2;
              if (fromBehind) g.ui.floater(t.headPos ?? t.pos.clone().setY(t.pos.y + 2.4), 'Backstab!', 'info small');
              g.strike(t, 1.6 * ctx.pw * (fromBehind ? 1.4 : 1), { critBonus: 0.15, knock: 0.2, reach: 2.4 });
            }
          }
          if (s.n === 1 && s.t >= 0.26) { s.n = 2; a.h.startSwing(0.22, 'stab'); }
        },
      };
    },
  },

  poison_blade: {
    name: 'Poison Blade', mp: 0.1, cd: 25, needs: 'dagger',
    desc: ({ pw }) => `Coat your daggers for 15 seconds: every hit poisons for ${pct(0.18 * pw)} weapon damage a second for 4 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M24 3 10 17l3 3L27 6z" fill="#e3e9f0" stroke="#5d6875" stroke-width="1.2"/><path d="M8 19l5 5M10 23l-5 5" stroke="#7a4f2c" stroke-width="3" stroke-linecap="round"/><path d="M19 12c0 3-3 4-3 7a2 2 0 0 0 4 0c0-3-1-4-1-7z" fill="#7dff4a" stroke="#2a6a10" stroke-width="1"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Use_Item', { timeScale: 2 });
      play(a, 'drink', 0.7);
      g.fx.burst(handPos(a), 0x7dff4a, 20, 2);
      a.aura('poison', 15);
      if (real) a.addBuff('poison_blade', 0.18 * ctx.pw);
      return { t: 0, dur: 0.4, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  shadow_step: {
    name: 'Shadow Step', mp: 0.1, cd: 10, range: 12, target: 'enemy', needs: 'dagger',
    desc: ({ pw }) => `Vanish and step out of the shadows behind your target (up to 12 m away), striking for ${pct(2.0 * pw)} weapon damage with a much better chance of a critical hit.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M3 12h7M2 17h8M3 22h7" stroke="#9a6dff" stroke-width="2" stroke-linecap="round" opacity=".8"/><circle cx="19.5" cy="7.5" r="3.5" fill="#2a2238" stroke="#b9a0ff" stroke-width="1.2"/><path d="M14 28l2-9-3-1 4-6h5l3 6-3 1 1 9z" fill="#2a2238" stroke="#b9a0ff" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, from = a.pos.clone(), t = ctx.target;
      const to = real ? (t ? behind(t, from) : from) : ctx.at || from;
      puff(g, from, 0x6a4a9a);
      puff(g, to, 0x6a4a9a);
      play(a, 'blink');
      if (real) { a.pos.copy(to); a.faceToward(t ? t.pos : ahead(a, 1)); }
      a.h.startSwing(0.35, 'stab');
      return {
        t: 0, dur: 0.45, canMove: false, hit: false, dest: to,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.15) return;
          s.hit = true;
          g.fx.arc(a.pos, a.yaw, { span: 1.4, rIn: 0.5, rOut: 2.4, color: 0xc9a8ff, dur: 0.18 });
          play(a, 'swing', 0.7);
          if (real && t?.alive) g.strike(t, 2.0 * ctx.pw, { critBonus: 0.5, knock: 0.3, reach: 3 });
        },
      };
    },
  },

  eviscerate: {
    name: 'Eviscerate', mp: 0.14, cd: 14, range: 2.4, target: 'enemy', needs: 'dagger',
    desc: ({ pw }) => `A flurry of five cuts at your target, ${pct(0.55 * pw)} weapon damage each.`,
    icon: '<svg viewBox="0 0 32 32" stroke-linecap="round"><path d="M5 8l22 4M5 15l22 0M5 22l22-4" stroke="#ff8aa0" stroke-width="2.4"/><path d="M5 8l22 4M5 15l22 0M5 22l22-4" stroke="#fff" stroke-width="0.8"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, t = ctx.target;
      if (t) a.faceToward(t.pos);
      return {
        t: 0, dur: 1.05, canMove: false, n: 0,
        tick: (dt, s) => {
          if (s.n >= 5 || s.t < 0.08 + s.n * 0.18) return;
          s.n++;
          a.h.startSwing(0.17, s.n % 2 ? 'slash' : 'backslash');
          g.fx.arc(a.pos, a.yaw + rand(-0.3, 0.3), { span: 1.3, rIn: 0.5, rOut: 2.2, color: s.n === 5 ? 0xff8aa0 : 0xe8f0ff, dur: 0.14, reverse: s.n % 2 === 0 });
          play(a, 'swing', 0.5);
          if (real && t?.alive) g.strike(t, 0.55 * ctx.pw, { critBonus: 0.1, knock: 0.05, reach: 2.6 });
        },
      };
    },
  },

  // ---------------------------------------------------------------- Marksmanship
  power_shot: {
    name: 'Power Shot', mp: 0.07, cd: 4, range: 18, target: 'enemy', needs: 'bow',
    desc: ({ pw }) => `Draw to the ear and loose: ${pct(1.8 * pw)} weapon damage to your target, knocking it back.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M6 4c8 4 8 20 0 24" fill="none" stroke="#c8a070" stroke-width="2.4"/><path d="M6 4v24" stroke="#e8e0d0" stroke-width="1"/><path d="M8 16h20" stroke="#e8e0d0" stroke-width="2"/><path d="M28 16l-5-3v6z" fill="#fff"/><path d="M20 10l4 2M20 22l4-2" stroke="#ffd84a" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 12);
      a.faceToward(p);
      a.h.anim.play('Throw', { timeScale: 1.4, startAt: 0.1 });
      play(a, 'swing', 0.4);
      return {
        t: 0, dur: 0.6, canMove: false, fired: false,
        tick: (dt, s) => {
          if (s.fired || s.t < 0.38) return;
          s.fired = true;
          arrow(g, a, real, aimedAt(a, handPos(a, true), p), { homing: ctx.target, mult: 1.8 * ctx.pw, size: 0.2, radius: 0.4, color: 0xffe08a, trail: 0xffa040, knock: 1.4, noLight: false });
          play(a, 'bolt', 0.7);
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  multi_shot: {
    name: 'Multi-Shot', mp: 0.1, cd: 7, range: 14, target: 'ground', needs: 'bow',
    desc: ({ pw }) => `Loose five arrows at once in a fan; each deals ${pct(0.7 * pw)} weapon damage to the first enemy it meets.`,
    icon: '<svg viewBox="0 0 32 32" stroke-linecap="round"><path d="M5 27 27 5M5 27l24-12M5 27 17 3M5 27l24 0M5 27 4 5" stroke="#e8e0d0" stroke-width="1.8" opacity=".9"/><circle cx="5" cy="27" r="2.6" fill="#c8a070"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 10);
      a.faceToward(p);
      a.h.anim.play('Throw', { timeScale: 2, startAt: 0.15 });
      return {
        t: 0, dur: 0.5, canMove: false, fired: false,
        tick: (dt, s) => {
          if (s.fired || s.t < 0.22) return;
          s.fired = true;
          for (let i = 0; i < 5; i++) {
            const dir = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)).applyAxisAngle(UP, (i - 2) * 0.17);
            arrow(g, a, real, null, { dir, mult: 0.7 * ctx.pw, range: 16 });
          }
          play(a, 'knives', 0.8);
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  crippling_arrow: {
    name: 'Crippling Arrow', mp: 0.09, cd: 8, range: 18, target: 'enemy', needs: 'bow',
    desc: ({ pw }) => `An arrow that passes through everything in its path: ${pct(1.3 * pw)} weapon damage to each, slowing them by half for 4 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M3 16h24" stroke="#e8e0d0" stroke-width="2"/><path d="M29 16l-6-4v8z" fill="#bfeaff" stroke="#3a8ac8"/><path d="M3 16l4-4M3 16l4 4" stroke="#c8a070" stroke-width="2"/><circle cx="14" cy="16" r="5" fill="none" stroke="#8fd8ff" stroke-width="1.6" stroke-dasharray="2 2"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 12);
      a.faceToward(p);
      a.h.anim.play('Throw', { timeScale: 1.7, startAt: 0.12 });
      return {
        t: 0, dur: 0.5, canMove: false, fired: false,
        tick: (dt, s) => {
          if (s.fired || s.t < 0.3) return;
          s.fired = true;
          arrow(g, a, real, aimedAt(a, handPos(a, true), p), { mult: 1.3 * ctx.pw, pierce: true, range: 20, color: 0xbfeaff, trail: 0x3a8aff, size: 0.18, eff: { slow: [0.5, 4] } });
          play(a, 'frost', 0.4);
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  arrow_rain: {
    name: 'Arrow Rain', mp: 0.15, cd: 16, range: 16, target: 'ground', needs: 'bow',
    desc: ({ pw }) => `Loose a volley into the sky: for 2.5 seconds arrows rain down where you aim, five waves of ${pct(0.55 * pw)} weapon damage on everything within 5 m.`,
    icon: '<svg viewBox="0 0 32 32" stroke-linecap="round"><path d="M8 3l-3 10M14 2l-3 12M20 3l-3 10M26 2l-3 12M11 15l-3 10M17 16l-3 10M23 15l-3 10" stroke="#e8e0d0" stroke-width="1.8"/><ellipse cx="16" cy="28" rx="12" ry="2.5" fill="#c8a070" opacity=".5"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 10);
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Throw', { timeScale: 1.4 });
      play(a, 'knives');
      g.fx.telegraph(p, 5, 0.5, null, 0xffd08a);
      let waves = 0, acc = 0.3;
      g.addTicker((dt) => {
        acc += dt;
        for (let i = 0; i < 4; i++) {
          const ang = rand(0, TAU), r = Math.sqrt(Math.random()) * 5, x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
          g.fx.add.emit({ pos: { x: x - 1.5, y: heightAt(x, z) + 8, z: z + 1 }, count: 1, spread: 0.05, velSpread: 0.1, vel: { x: 3, y: -16, z: -2 }, color: hdr(0xfff0d0, 1.8), colorEnd: hdr(0xc8a070, 0.6), size: 0.1, sizeEnd: 0.06, life: 0.5, drag: 0 });
        }
        if (acc < 0.5) return true;
        acc -= 0.5;
        waves++;
        play(a, 'knives', 0.35);
        g.fx.dust(new THREE.Vector3(p.x + rand(-2, 2), p.y + 0.1, p.z + rand(-2, 2)), 6);
        if (real) g.areaHit({ at: p, radius: 5, mult: 0.55 * ctx.pw, knock: 0.1, quiet: true });
        return waves < 5;
      });
      return { t: 0, dur: 0.5, canMove: false, end: () => a.h.anim.stopOne() };
    },
  },

  // ---------------------------------------------------------------- Shadow
  swiftness: {
    name: 'Swiftness', mp: 0.08, cd: 2, range: 16, target: 'ally',
    desc: ({ pw }) => `Light feet for 10 minutes: you, or the friendly hero you pick, move ${pct(Math.min(0.3, 0.15 * pw))} faster. Not on enemies.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M18 4l-8 13h6l-3 11 10-15h-6z" fill="#bfe8ff" stroke="#3a7ab0" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 12h6M2 18h6M4 24h5" stroke="#8fd8ff" stroke-width="1.8" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'blink', 0.6);
      blessFx(g, who.pos, 0xbfe8ff, 26);
      if (real) g.buffAlly(who, 'swiftness', Math.min(0.3, 0.15 * ctx.pw));
      return { t: 0, dur: 0.35, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  smoke_bomb: {
    name: 'Smoke Bomb', mp: 0.1, cd: 16,
    desc: () => 'Smash a smoke bomb at your feet: monsters within 4 m are stunned for 2 seconds, and for 4 seconds half the blows aimed at you miss.',
    icon: '<svg viewBox="0 0 32 32"><path d="M8 24a5 5 0 0 1-1-9.9A7 7 0 0 1 20 10a6 6 0 0 1 6 6.5A4 4 0 0 1 25 24z" fill="#8e9099" stroke="#3e4048" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="27.5" r="1.6" fill="#6e7078"/><circle cx="20" cy="28" r="1.3" fill="#6e7078"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = a.pos;
      a.h.anim.play('Throw', { timeScale: 2.4, startAt: 0.3 });
      play(a, 'smoke');
      g.fx.soft.emit({ pos: { x: p.x, y: p.y + 0.8, z: p.z }, count: 40, spread: 1.6, velSpread: 1.4, vel: { x: 0, y: 0.6, z: 0 }, color: new THREE.Color(0x6e6a72), colorEnd: new THREE.Color(0x3a383e), alpha: 0.55, size: 1.6, sizeEnd: 3.4, life: 2.4, drag: 1.6 });
      g.fx.burst(new THREE.Vector3(p.x, p.y + 0.4, p.z), 0xc8c0d8, 16, 3, 0.25, 0.5);
      g.fx.ring(p, 0.3, 4.2, 0x9a96a8, 0.4);
      a.aura('smoke', 4);
      if (real) {
        a.addBuff('smoke', 1);
        for (const e of g.foesNear(p, 4)) g.affectEnemy(e, { stun: 2 });
      }
      return { t: 0, dur: 0.35, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  vanish: {
    name: 'Vanish', mp: 0.12, cd: 30,
    desc: () => 'Melt into the shadows: monsters lose sight of you for 4 seconds (they turn on someone else or go home), and your next blow is sure to be a critical hit.',
    icon: '<svg viewBox="0 0 32 32"><circle cx="16" cy="9" r="4.5" fill="none" stroke="#b9a0ff" stroke-width="1.6" stroke-dasharray="2.5 2"/><path d="M9 29l2-11 5-3 5 3 2 11" fill="none" stroke="#b9a0ff" stroke-width="1.6" stroke-dasharray="2.5 2" stroke-linejoin="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      puff(g, a.pos, 0x6a4a9a);
      play(a, 'blink');
      a.aura('smoke', 4);
      if (real) { a.addBuff('vanish', 1); a.sureCrit = true; g.link.vanish(4); }
      return { t: 0, dur: 0.2, canMove: true };
    },
  },

  shadow_mantle: {
    name: 'Shadow Mantle', mp: 0.15, cd: 90, range: 12,
    desc: ({ pw }) => `Cloak your party (every friendly hero within 12 m, and you) for 60 seconds: ${pct(Math.min(0.2, 0.1 * pw))} more chance of critical hits and 10% faster attacks.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 3c6 4 10 4 12 3-1 12-5 19-12 23C9 25 5 18 4 6c2 1 6 1 12-3z" fill="#3a2a5a" stroke="#a08aff" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 14l5 5 5-5" stroke="#d8c8ff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.5 });
      play(a, 'summon', 0.5);
      g.fx.ring(a.pos, 0.5, 12, 0xa08aff, 0.8);
      const v = Math.min(0.2, 0.1 * ctx.pw);
      for (const who of g.alliesNear(a.pos, 12, a)) {
        blessFx(g, who.pos, 0xa08aff, 18);
        if (real) g.buffAlly(who, 'shadow_mantle', v);
      }
      return { t: 0, dur: 0.6, canMove: true, moveMult: 0.6, end: () => a.h.anim.stopOne() };
    },
  },
};

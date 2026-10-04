// Healer: Restoration (heals and raising the fallen), Blessing (lasting blessings, shields), Retribution
// (holy fire, to fight alone). Heals and blessings go on the friendly hero picked, or on the healer.
import * as THREE from 'three';
import { heightAt } from '../world.js';
import { play, aimedAt, handPos, pointOf, blessFx, lingering } from './common.js';

const pct = (v) => `${Math.round(v * 100)}%`;

// A ray of light from the sky onto a hero (heals, blessings).
function lightFall(g, p, hex) {
  g.fx.pillar(new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z), hex, 0.7);
  blessFx(g, p, hex, 34);
}

export const HEALER = {
  // ---------------------------------------------------------------- Restoration
  heal: {
    name: 'Heal', mp: 0.1, cd: 2.5, range: 16, target: 'ally',
    desc: ({ pw }) => `Restore ${pct(0.22 * pw)} of the maximum Life of the friendly hero you pick, or your own.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 28S4 20 4 12a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 16-12 16z" fill="#4fd46b" stroke="#1d6a2c" stroke-width="1.3" stroke-linejoin="round"/><path d="M16 11v10M11 16h10" stroke="#eaffea" stroke-width="3" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2 });
      play(a, 'cast', 0.5);
      return {
        t: 0, dur: 0.55, canMove: false, healed: false,
        tick: (dt, s) => {
          if (s.healed || s.t < 0.25) return;
          s.healed = true;
          lightFall(g, who.pos, 0x7dff9a);
          play(a, 'heal', 0.8);
          if (real) g.healAlly(who, 0.22 * ctx.pw);
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  renew: {
    name: 'Renew', mp: 0.08, cd: 6, range: 16, target: 'ally',
    desc: ({ pw }) => `Life wells up in the friendly hero you pick (or you): ${pct(0.04 * pw)} of their maximum Life every second for 10 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 4c5 6 9 10 9 15a9 9 0 0 1-18 0c0-5 4-9 9-15z" fill="#6aff8a" stroke="#1d6a2c" stroke-width="1.3"/><path d="M11 19a5 5 0 0 0 5 5M16 13v7M13 16h6" stroke="#eaffea" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'heal', 0.6);
      blessFx(g, who.pos, 0x7dff9a, 22);
      who.aura?.('renew', 10);
      if (real) g.buffAlly(who, 'renew', Math.min(0.08, 0.04 * ctx.pw));
      return { t: 0, dur: 0.4, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  resurrection: {
    name: 'Resurrection', mp: 0.25, cd: 45, range: 14, target: 'dead',
    desc: ({ pw }) => `Call a fallen friendly hero back to life where they lie, with ${pct(Math.min(0.8, 0.4 * pw))} of their Life.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 2v28M6 10h20" stroke="#ffe08a" stroke-width="3.2" stroke-linecap="round"/><circle cx="16" cy="10" r="6" fill="none" stroke="#fff6c8" stroke-width="1.5"/><path d="M5 27h22" stroke="#c8a050" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target;
      if (who) a.faceToward(who.pos);
      a.h.anim.play('Interact', { timeScale: 1.1 });
      play(a, 'quest', 0.7);
      return {
        t: 0, dur: 1.1, canMove: false, done: false,
        tick: (dt, s) => {
          if (s.done || s.t < 0.7) return;
          s.done = true;
          if (!who) return;
          g.fx.pillar(new THREE.Vector3(who.pos.x, heightAt(who.pos.x, who.pos.z), who.pos.z), 0xffe08a, 1.6);
          g.fx.levelUp(who.pos);
          if (real) g.reviveAlly(who, Math.min(0.8, 0.4 * ctx.pw));
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  circle_healing: {
    name: 'Circle of Healing', mp: 0.18, cd: 12, range: 12,
    desc: ({ pw }) => `Light washes over every friendly hero within 12 m (you too): each gets back ${pct(0.2 * pw)} of their maximum Life.`,
    icon: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="#7dff9a" stroke-width="2.2" stroke-dasharray="4 2"/><path d="M16 9v14M9 16h14" stroke="#eaffea" stroke-width="3.2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.4 });
      play(a, 'heal');
      return {
        t: 0, dur: 0.6, canMove: false, done: false,
        tick: (dt, s) => {
          if (s.done || s.t < 0.3) return;
          s.done = true;
          g.fx.ring(a.pos, 0.5, 12, 0x7dff9a, 0.7);
          for (const who of g.alliesNear(a.pos, 12, a)) {
            lightFall(g, who.pos, 0x7dff9a);
            if (real) g.healAlly(who, 0.2 * ctx.pw);
          }
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  // ---------------------------------------------------------------- Blessing
  blessing: {
    name: 'Blessing of Vitality', mp: 0.08, cd: 2, range: 16, target: 'ally',
    desc: ({ pw }) => `A blessing for 10 minutes: you, or the friendly hero you pick, have ${pct(Math.min(0.2, 0.1 * pw))} more maximum Life.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 4l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#ffd84a" stroke="#8a6a10" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 12v8M12 16h8" stroke="#c8281c" stroke-width="2.4" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'heal', 0.5);
      lightFall(g, who.pos, 0xffe08a);
      if (real) g.buffAlly(who, 'blessing', Math.min(0.2, 0.1 * ctx.pw));
      return { t: 0, dur: 0.35, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  holy_armor: {
    name: 'Holy Armor', mp: 0.08, cd: 2, range: 16, target: 'ally',
    desc: ({ pw }) => `A blessing for 10 minutes: you, or the friendly hero you pick, have ${pct(Math.min(0.4, 0.2 * pw))} more armor.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M6 6h20v9c0 7-5 11-10 13C11 26 6 22 6 15z" fill="#fff0c0" stroke="#a8842a" stroke-width="1.5" stroke-linejoin="round"/><path d="M16 9v15M10 14h12" stroke="#d8a830" stroke-width="2.4" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'bash', 0.4);
      lightFall(g, who.pos, 0xfff0c0);
      if (real) g.buffAlly(who, 'holy_armor', Math.min(0.4, 0.2 * ctx.pw));
      return { t: 0, dur: 0.35, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  divine_shield: {
    name: 'Divine Shield', mp: 0.12, cd: 30, range: 16, target: 'ally',
    desc: ({ pw }) => `Wrap the friendly hero you pick (or you) in light that soaks up damage equal to ${pct(Math.min(0.6, 0.3 * pw))} of their maximum Life, for 10 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#fff6c8" opacity=".35" stroke="#ffe08a" stroke-width="2"/><circle cx="16" cy="12" r="3.5" fill="#fff"/><path d="M10 25c0-5 3-8 6-8s6 3 6 8" fill="#fff"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Interact', { timeScale: 1.8 });
      play(a, 'heal', 0.7);
      lightFall(g, who.pos, 0xffe7a0);
      who.aura?.('shield', 10);
      if (real) g.buffAlly(who, 'divine_shield', Math.min(0.6, 0.3 * ctx.pw)); // (the target turns it into Life)
      return { t: 0, dur: 0.4, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  sanctuary: {
    name: 'Sanctuary', mp: 0.15, cd: 60, range: 10,
    desc: () => 'Holy ground: for 10 seconds every friendly hero within 10 m (you too) takes 25% less damage, and stuns and slows on them are lifted.',
    icon: '<svg viewBox="0 0 32 32"><path d="M4 26h24M7 26V14l9-8 9 8v12" fill="#3a2e1a" stroke="#ffe08a" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 12v10M12 16h8" stroke="#fff6c8" stroke-width="2.2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.3 });
      play(a, 'warcry', 0.6);
      g.fx.ring(a.pos, 0.5, 10, 0xffe08a, 0.9);
      lingering(g, a.pos.clone(), { dur: 3, radius: 6, color: 0xffe08a, rate: 30, rise: 1 });
      for (const who of g.alliesNear(a.pos, 10, a)) {
        who.aura?.('shield', 10);
        if (real) g.buffAlly(who, 'sanctuary', 1);
      }
      return { t: 0, dur: 0.6, canMove: true, moveMult: 0.5, end: () => a.h.anim.stopOne() };
    },
  },

  // ---------------------------------------------------------------- Retribution
  smite: {
    name: 'Smite', mp: 0.06, cd: 1.5, range: 15, target: 'enemy',
    desc: ({ pw }) => `A bolt of holy fire at your target: ${pct(1.3 * pw)} spell damage.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M4 28 18 14" stroke="#ffe08a" stroke-width="2" stroke-linecap="round" opacity=".7"/><circle cx="21" cy="11" r="7" fill="#fff0a0" stroke="#c8902a" stroke-width="1.4"/><path d="M21 6v10M16 11h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 10);
      a.faceToward(p);
      a.h.anim.play('Throw', { timeScale: 2.4, startAt: 0.25 });
      play(a, 'bolt');
      return {
        t: 0, dur: 0.45, canMove: false, fired: false,
        tick: (dt, s) => {
          if (s.fired || s.t < 0.16) return;
          s.fired = true;
          const from = handPos(a);
          g.projectiles.spawn({ from, to: aimedAt(a, from, p), homing: ctx.target, owner: real ? 'player' : 'remote', mult: 1.3 * ctx.pw, speed: 24, color: 0xffe08a, trail: 0xffa030, radius: 0.38, range: 20, size: 0.26, small: true, glide: 0.9 });
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  holy_strike: {
    name: 'Holy Strike', mp: 0.08, cd: 5, range: 2.6, target: 'enemy', needs: 'melee',
    desc: ({ pw }) => `Strike your target with a blessed weapon: ${pct(1.5 * pw)} weapon damage, and a quarter of it comes back to you as Life.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M26 4 12 18l2 2L28 6z" fill="#fff6c8" stroke="#a8842a" stroke-width="1.2"/><path d="M9 17l6 6M11 21l-6 6" stroke="#c8a050" stroke-width="3" stroke-linecap="round"/><path d="M22 20c3 0 5 2 5 5M24 16v8M20 20h8" stroke="#7dff9a" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, t = ctx.target;
      if (t) a.faceToward(t.pos);
      a.h.startSwing(0.55, 'chop');
      play(a, 'swing');
      return {
        t: 0, dur: 0.55, canMove: false, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.3) return;
          s.hit = true;
          const p = t ? t.pos : a.pos;
          g.fx.burst(new THREE.Vector3(p.x, p.y + 1, p.z), 0xffe08a, 26, 4);
          play(a, 'bash');
          if (real && t) {
            const dealt = g.strike(t, 1.5 * ctx.pw, { knock: 0.4, reach: 2.6 });
            if (dealt > 0) a.heal(Math.round(dealt * 0.25), true);
          }
        },
      };
    },
  },

  judgement: {
    name: 'Judgement', mp: 0.12, cd: 12, range: 14, target: 'ground',
    desc: ({ pw }) => `A hammer of light falls where you aim: ${pct(1.8 * pw)} spell damage to everything within 3 m, stunning them for 1.5 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><rect x="9" y="4" width="14" height="8" rx="1.5" fill="#fff0a0" stroke="#a8842a" stroke-width="1.3"/><path d="M16 12v10" stroke="#c8a050" stroke-width="3"/><path d="M6 27h20M9 23l-3-3M23 23l3-3" stroke="#ffe08a" stroke-width="2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 7);
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Interact', { timeScale: 1.6 });
      play(a, 'cast');
      g.fx.telegraph(p, 3, 0.55, null, 0xffe08a);
      return {
        t: 0, dur: 0.6, canMove: false, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.55) return;
          s.hit = true;
          g.fx.pillar(p, 0xffe08a, 0.8);
          g.fx.ring(p, 0.4, 3.4, 0xfff0a0, 0.5);
          g.fx.burst(new THREE.Vector3(p.x, p.y + 0.5, p.z), 0xffe08a, 40, 5);
          play(a, 'slam', 0.8);
          if (real) { g.areaHit({ at: p, radius: 3, mult: 1.8 * ctx.pw, spell: true, knock: 0.5, eff: { stun: 1.5 } }); g.shake(0.3); }
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  consecration: {
    name: 'Consecration', mp: 0.15, cd: 20, range: 5,
    desc: ({ pw }) => `Hallow the ground around you for 6 seconds: monsters within 5 m burn for ${pct(0.36 * pw)} spell damage a second, and friendly heroes in it heal 2.5% of their Life a second.`,
    icon: '<svg viewBox="0 0 32 32"><ellipse cx="16" cy="22" rx="13" ry="6" fill="#ffe08a" opacity=".35" stroke="#ffe08a" stroke-width="1.5"/><path d="M16 6v14M11 11h10" stroke="#fff6c8" stroke-width="2.6" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = a.pos.clone();
      a.h.anim.play('Interact', { timeScale: 1.4 });
      play(a, 'heal');
      let acc = 0;
      lingering(g, p, {
        dur: 6, radius: 5, color: 0xffe08a, rate: 45, rise: 1.1,
        tick: (dt, t) => {
          acc += dt;
          if (!real || acc < 0.5) return;
          acc -= 0.5;
          g.areaHit({ at: p, radius: 5, mult: 0.18 * ctx.pw, spell: true, knock: 0, quiet: true });
          for (const who of g.alliesNear(p, 5, a)) g.healAlly(who, 0.0125, true);
        },
      });
      return { t: 0, dur: 0.5, canMove: true, moveMult: 0.6, end: () => a.h.anim.stopOne() };
    },
  },
};


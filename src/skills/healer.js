// The Doctor (the class's key is still 'healer', for saves): Medicine (treating wounds, and bringing round heroes
// who faint), Tonics (tonics and salves that last, painkillers, an aid station), Surgery (a doctor's sharp tools and
// ether, to fight alone). Treatments and tonics go on the friendly hero picked, or on the doctor.
import * as THREE from 'three';
import { heightAt } from '../world.js';
import { hdr } from '../fx.js';
import { play, aimedAt, handPos, pointOf, careFx, lingering } from './common.js';

const pct = (v) => `${Math.round(v * 100)}%`;

// A doctor's care on a hero (treatments, tonics): a ring at their feet, motes rising, and a plus sign floating up
// over them.
function treat(g, p, hex) {
  careFx(g, p, hex, 28);
  plusSign(g, p, hex);
}
const PLUS = {};
function plusSign(g, p, hex) {
  PLUS.h ??= new THREE.BoxGeometry(0.46, 0.13, 0.04);
  PLUS.v ??= new THREE.BoxGeometry(0.13, 0.46, 0.04);
  const mat = new THREE.MeshBasicMaterial({ color: hdr(hex, 2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const sign = new THREE.Group();
  sign.add(new THREE.Mesh(PLUS.h, mat), new THREE.Mesh(PLUS.v, mat));
  sign.position.set(p.x, p.y + 2.3, p.z);
  g.scene.add(sign);
  let t = 0;
  g.addTicker((dt) => {
    t += dt;
    sign.position.y += dt * 0.9;
    sign.quaternion.copy(g.camera.quaternion); // (always facing us)
    mat.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.75);
    if (t < 0.9) return true;
    g.scene.remove(sign);
    mat.dispose();
    return false;
  });
}

export const HEALER = {
  // ---------------------------------------------------------------- Restoration
  heal: {
    name: 'Treat Wounds', mp: 0.1, cd: 2.5, range: 16, target: 'ally',
    desc: ({ pw }) => `Clean and bind the wounds of the friendly hero you pick, or your own: they get back ${pct(0.22 * pw)} of their maximum Life.`,
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
          treat(g, who.pos, 0x7dff9a);
          play(a, 'heal', 0.8);
          if (real) g.healAlly(who, 0.22 * ctx.pw);
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  renew: {
    name: 'Remedy', mp: 0.08, cd: 6, range: 16, target: 'ally',
    desc: ({ pw }) => `A remedy that keeps working: the friendly hero you pick (or you) gets back ${pct(0.04 * pw)} of their maximum Life every second for 10 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 4c5 6 9 10 9 15a9 9 0 0 1-18 0c0-5 4-9 9-15z" fill="#6aff8a" stroke="#1d6a2c" stroke-width="1.3"/><path d="M11 19a5 5 0 0 0 5 5M16 13v7M13 16h6" stroke="#eaffea" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'drink', 0.6);
      treat(g, who.pos, 0x7dff9a);
      who.aura?.('renew', 10);
      if (real) g.buffAlly(who, 'renew', Math.min(0.08, 0.04 * ctx.pw));
      return { t: 0, dur: 0.4, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  resurrection: {
    name: 'Revive', mp: 0.25, cd: 45, range: 14, target: 'dead',
    desc: ({ pw }) => `Bring a fainted friendly hero round where they lie (smelling salts, and a steady hand), with ${pct(Math.min(0.8, 0.4 * pw))} of their Life.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M16 28S4 20 4 12a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 16-12 16z" fill="#1d3a2a" stroke="#4fd46b" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 17h7l2-5 3 10 3-12 2 7h9" fill="none" stroke="#eaffea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target;
      if (who) a.faceToward(who.pos);
      a.h.anim.play('Interact', { timeScale: 1.1 });
      play(a, 'drink', 0.7);
      return {
        t: 0, dur: 1.1, canMove: false, done: false,
        tick: (dt, s) => {
          if (s.done || s.t < 0.7) return;
          s.done = true;
          if (!who) return;
          g.fx.heal(who.pos);
          g.fx.ring(who.pos, 0.3, 2.2, 0x7dff9a, 0.6);
          plusSign(g, who.pos, 0xeaffea);
          play(a, 'heal', 0.8);
          if (real) g.reviveAlly(who, Math.min(0.8, 0.4 * ctx.pw));
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  circle_healing: {
    name: 'Triage', mp: 0.18, cd: 12, range: 12,
    desc: ({ pw }) => `Tend every friendly hero within 12 m at once (you too): each gets back ${pct(0.2 * pw)} of their maximum Life.`,
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
            treat(g, who.pos, 0x7dff9a);
            if (real) g.healAlly(who, 0.2 * ctx.pw);
          }
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  // ---------------------------------------------------------------- Tonics
  blessing: {
    name: 'Vitality Tonic', mp: 0.08, cd: 2, range: 16, target: 'ally',
    desc: ({ pw }) => `A tonic that lasts 10 minutes: you, or the friendly hero you pick, have ${pct(Math.min(0.2, 0.1 * pw))} more maximum Life.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M12.5 4h7M14 4v7L7 24a3 3 0 0 0 3 4h12a3 3 0 0 0 3-4l-7-13V4" fill="#fff0ec" stroke="#8a3a2a" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.6 19h12.8l2.4 5a2 2 0 0 1-1.9 2.6H9.1a2 2 0 0 1-1.9-2.6z" fill="#e8483a"/><path d="M16 16.5v7M12.5 20h7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'drink', 0.5);
      treat(g, who.pos, 0xff8a7a);
      if (real) g.buffAlly(who, 'blessing', Math.min(0.2, 0.1 * ctx.pw));
      return { t: 0, dur: 0.35, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  holy_armor: {
    name: 'Toughening Salve', mp: 0.08, cd: 2, range: 16, target: 'ally',
    desc: ({ pw }) => `A salve that toughens the skin for 10 minutes: you, or the friendly hero you pick, have ${pct(Math.min(0.4, 0.2 * pw))} more armor.`,
    icon: '<svg viewBox="0 0 32 32"><rect x="7" y="7" width="18" height="5" rx="1.5" fill="#8fa8c8" stroke="#3a4a6a" stroke-width="1.2"/><rect x="6" y="12" width="20" height="15" rx="3" fill="#dfe8f4" stroke="#3a4a6a" stroke-width="1.3"/><path d="M16 15.5v8M12 19.5h8" stroke="#3a7ad8" stroke-width="2.6" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Use_Item', { timeScale: 2.2 });
      play(a, 'bash', 0.4);
      treat(g, who.pos, 0xa8d0ff);
      if (real) g.buffAlly(who, 'holy_armor', Math.min(0.4, 0.2 * ctx.pw));
      return { t: 0, dur: 0.35, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  divine_shield: {
    name: 'Painkiller', mp: 0.12, cd: 30, range: 16, target: 'ally',
    desc: ({ pw }) => `A painkiller for the friendly hero you pick (or you): for 10 seconds they don't feel damage, up to ${pct(Math.min(0.6, 0.3 * pw))} of their maximum Life.`,
    icon: '<svg viewBox="0 0 32 32"><g transform="rotate(45 16 16)"><rect x="12" y="8" width="8" height="14" rx="1.5" fill="#e4f4ff" stroke="#2a5a8a" stroke-width="1.3"/><rect x="13.4" y="14" width="5.2" height="6.6" fill="#6ac8ff"/><path d="M16 22v7M11 8h10M16 8V3.5M13 3.5h6" stroke="#2a5a8a" stroke-width="1.6" stroke-linecap="round"/></g></svg>',
    cast(a, ctx, real) {
      const g = a.game, who = ctx.target || a;
      if (who !== a) a.faceToward(who.pos);
      a.h.anim.play('Interact', { timeScale: 1.8 });
      play(a, 'heal', 0.7);
      treat(g, who.pos, 0xbfe8ff);
      who.aura?.('shield', 10);
      if (real) g.buffAlly(who, 'divine_shield', Math.min(0.6, 0.3 * ctx.pw)); // (the target turns it into Life)
      return { t: 0, dur: 0.4, canMove: true, end: () => a.h.anim.stopOne() };
    },
  },

  sanctuary: {
    name: 'Aid Station', mp: 0.15, cd: 60, range: 10,
    desc: () => 'Set up an aid station: for 10 seconds every friendly hero within 10 m (you too) takes 25% less damage, and stuns and slows on them are lifted.',
    icon: '<svg viewBox="0 0 32 32"><path d="M3 26 16 6l13 20z" fill="#e8eef4" stroke="#4a6a8a" stroke-width="1.5" stroke-linejoin="round"/><path d="M12.5 26l3.5-7 3.5 7z" fill="#4a6a8a"/><path d="M16 10.5v6.5M12.8 13.75h6.4" stroke="#2aa84a" stroke-width="2.4" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game;
      a.h.anim.play('Interact', { timeScale: 1.3 });
      play(a, 'warcry', 0.6);
      g.fx.ring(a.pos, 0.5, 10, 0x9affc8, 0.9);
      plusSign(g, a.pos, 0x9affc8);
      lingering(g, a.pos.clone(), { dur: 3, radius: 6, color: 0x9affc8, rate: 30, rise: 1 });
      for (const who of g.alliesNear(a.pos, 10, a)) {
        who.aura?.('shield', 10);
        if (real) g.buffAlly(who, 'sanctuary', 1);
      }
      return { t: 0, dur: 0.6, canMove: true, moveMult: 0.5, end: () => a.h.anim.stopOne() };
    },
  },

  // ---------------------------------------------------------------- Surgery
  smite: {
    name: 'Lancet', mp: 0.06, cd: 1.5, range: 15, target: 'enemy',
    desc: ({ pw }) => `Throw a lancet at your target, true to the vein: ${pct(1.3 * pw)} spell damage.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M5 27l9-9" stroke="#8a6a4a" stroke-width="3.4" stroke-linecap="round"/><path d="M13 19 26 6c1.2 4.5-1.5 9.5-9 13.5z" fill="#e8f4ff" stroke="#5a7a9a" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 18l5-5M8 23l3-3" stroke="#7dffb0" stroke-width="1.4" stroke-linecap="round" opacity=".8"/></svg>',
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
          g.projectiles.spawn({ from, to: aimedAt(a, from, p), homing: ctx.target, owner: real ? 'player' : 'remote', mult: 1.3 * ctx.pw, speed: 26, color: 0xe8f4ff, trail: 0x7dffb0, radius: 0.38, range: 20, size: 0.2, small: true, glide: 0.9 });
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  holy_strike: {
    name: 'Vital Strike', mp: 0.08, cd: 5, range: 2.6, target: 'enemy', needs: 'melee',
    desc: ({ pw }) => `Strike where it hurts most (a doctor knows where): ${pct(1.5 * pw)} weapon damage, and a quarter of it comes back to you as Life.`,
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
          g.fx.burst(new THREE.Vector3(p.x, p.y + 1, p.z), 0x7dff9a, 26, 4);
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
    name: 'Ether Flask', mp: 0.12, cd: 12, range: 14, target: 'ground',
    desc: ({ pw }) => `Throw a flask of ether where you aim: it bursts for ${pct(1.8 * pw)} spell damage on everything within 3 m, and its fumes put them to sleep for 1.5 seconds.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M13 4h6M14 4v7a8 8 0 1 0 4 0V4" fill="#e4fff0" stroke="#2a7a4a" stroke-width="1.4" stroke-linejoin="round"/><circle cx="16" cy="19.2" r="6" fill="#9affc8" opacity=".85"/><path d="M23 5c2 1 2 3 0 4s-2 3 0 4M27 8c1.5 1 1.5 2.5 0 3.5" stroke="#9affc8" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = pointOf(a, ctx, 7);
      p.y = heightAt(p.x, p.z);
      a.faceToward(p);
      a.h.anim.play('Interact', { timeScale: 1.6 });
      play(a, 'cast');
      g.fx.telegraph(p, 3, 0.55, null, 0x7dffb0);
      return {
        t: 0, dur: 0.6, canMove: false, hit: false,
        tick: (dt, s) => {
          if (s.hit || s.t < 0.55) return;
          s.hit = true;
          g.fx.ring(p, 0.4, 3.4, 0x9affc8, 0.5);
          g.fx.burst(new THREE.Vector3(p.x, p.y + 0.5, p.z), 0xc8ffe0, 30, 4);
          g.fx.soft.emit({ pos: { x: p.x, y: p.y + 0.4, z: p.z }, count: 22, spread: 1.4, velSpread: 1.2, vel: { x: 0, y: 0.8, z: 0 }, color: new THREE.Color(0xc8ffe0), colorEnd: new THREE.Color(0x8ad8b0), alpha: 0.45, size: 1, sizeEnd: 2.4, life: 1.6, drag: 1.5 });
          play(a, 'smoke', 0.8);
          play(a, 'slam', 0.5);
          if (real) { g.areaHit({ at: p, radius: 3, mult: 1.8 * ctx.pw, spell: true, knock: 0.5, eff: { stun: 1.5 } }); g.shake(0.3); }
        },
        end: () => a.h.anim.stopOne(),
      };
    },
  },

  consecration: {
    name: 'Healing Vapours', mp: 0.15, cd: 20, range: 5,
    desc: ({ pw }) => `Uncork healing vapours around you for 6 seconds: they sting monsters within 5 m for ${pct(0.36 * pw)} spell damage a second, and heal friendly heroes in them 2.5% of their Life a second.`,
    icon: '<svg viewBox="0 0 32 32"><path d="M8 24a5 5 0 0 1 0-10 7 7 0 0 1 13-3 6 6 0 0 1 3 13z" fill="#e4fff0" stroke="#2a7a4a" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 13v8M12 17h8" stroke="#2aa84a" stroke-width="2.4" stroke-linecap="round"/><path d="M6 28h20" stroke="#9affc8" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3 2"/></svg>',
    cast(a, ctx, real) {
      const g = a.game, p = a.pos.clone();
      a.h.anim.play('Interact', { timeScale: 1.4 });
      play(a, 'smoke');
      let acc = 0;
      lingering(g, p, {
        dur: 6, radius: 5, color: 0x9affc8, soft: 0xd8ffe8, rate: 30, rise: 1.1,
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


// The Death Canyon, drawn and alive (maps/canyon.js): a land like the others, and its calamities. The world
// (sim/world.js) picks each one and where it strikes, so every hero there sees the same; each hero's game takes
// its own hurt here (never in the camp, Last Rest):
//   quake: the ground shakes; fissures burst open where the red rings were (a share of Life, and a stagger)
//   meteors: fire falls where the red rings were (a big share of Life)
//   storm: the sky darkens, rain, and lightning where the blue rings were (a share of Life, and a stagger)
//   sandstorm: the sand closes in: hard to see, slow to walk, and it scours a little Life away
import * as THREE from 'three';
import { LandView } from './lands.js';
import { heightAt, zoneAt } from './world.js';
import { hdr } from './fx.js';
import { rand } from './util.js';

// what each does to a hero caught in it: share of max Life, radius (m), stun (s)
export const CALAMITY = {
  quake: { hurt: 0.18, r: 2.6, stun: 0.5, color: 0xff6a1a, warn: 1.4, say: 'The ground shakes! Keep out of the red rings.' },
  meteors: { hurt: 0.28, r: 3.2, stun: 0, color: 0xff3a10, warn: 1.5, say: 'Meteors fall on the canyon! Keep out of the red rings.' },
  storm: { hurt: 0.22, r: 2.2, stun: 0.4, color: 0x7ab8ff, warn: 1.0, say: 'A storm breaks over the canyon! Lightning strikes where the blue rings are.' },
  sandstorm: { hurt: 0.012, say: 'A sandstorm sweeps in: you can hardly see, and it scours you. Shelter in Last Rest.' },
};

export class CanyonView extends LandView {
  constructor(game, map) {
    super(game, map);
    this.storm = 0; // how dark the sky is (0 … 1)
    this.sand = 0; // how thick the sand is
    this.stormUntil = 0;
    this.sandUntil = 0;
    this.quakeUntil = 0;
  }

  show(on) {
    super.show(on);
    if (!on) { this.storm = this.sand = 0; this.stormUntil = this.sandUntil = this.quakeUntil = 0; }
  }

  // Is our hero out in the canyon (where calamities reach), not in its camp?
  exposed() {
    const p = this.game.player;
    return p.alive && !zoneAt(p.pos.x, p.pos.z)?.safe;
  }

  // ['Z', kind, seconds, [x, z, delay, …]] from the world.
  calamity([, kind, dur, spots]) {
    const g = this.game, c = CALAMITY[kind];
    if (!c) return;
    const t = g.time;
    if (this.exposed()) g.ui.centerMsg(c.say);
    if (kind === 'quake') { this.quakeUntil = t + dur; g.sfx.play('rumble'); }
    if (kind === 'storm') this.stormUntil = t + dur;
    if (kind === 'sandstorm') this.sandUntil = t + dur;
    if (kind === 'meteors') this.storm = Math.max(this.storm, 0.3);
    const list = Array.isArray(spots) ? spots : [];
    for (let i = 0; i + 2 < list.length; i += 3) {
      const x = Number(list[i]), z = Number(list[i + 1]), delay = Math.max(0, Number(list[i + 2]) || 0);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      this.strikeAt(kind, new THREE.Vector3(x, heightAt(x, z), z), delay);
    }
  }

  // One strike: a ring on the ground (warn seconds before), then the blow.
  strikeAt(kind, at, delay) {
    const g = this.game, c = CALAMITY[kind];
    let t = 0, warned = false, fell = null;
    g.addTicker((dt) => {
      t += dt;
      if (!warned && t >= delay - c.warn) {
        warned = true;
        g.fx.telegraph(at, c.r, Math.min(c.warn, delay), null, c.color);
        if (kind === 'meteors') fell = this.meteor(at, Math.min(c.warn, delay));
      }
      if (t < delay) return true;
      this.blow(kind, at, fell);
      return false;
    });
  }

  // A meteor falling onto `at`, arriving in `secs`.
  meteor(at, secs) {
    const g = this.game, from = new THREE.Vector3(at.x - 9, at.y + 24, at.z - 7);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshBasicMaterial({ color: hdr(0xff7a2a, 3) }));
    rock.position.copy(from);
    g.scene.add(rock);
    let t = 0;
    g.addTicker((dt) => {
      t += dt;
      const k = Math.min(1, t / secs);
      rock.position.lerpVectors(from, at, k * k);
      rock.rotation.x += dt * 6;
      g.fx.add.emit({ pos: rock.position, count: 2, spread: 0.3, velSpread: 0.6, color: hdr(0xffb040, 2.6), colorEnd: hdr(0xff2a00, 0.3), size: 0.6, sizeEnd: 0.05, life: 0.5, drag: 1 });
      if (k < 1) return true;
      g.scene.remove(rock);
      rock.geometry.dispose();
      rock.material.dispose();
      return false;
    });
  }

  // The blow lands: what it looks like (to everyone) and what it does (to our hero, if caught).
  blow(kind, at, _fell) {
    const g = this.game, c = CALAMITY[kind], vol = g.volAt(at), up = new THREE.Vector3(at.x, at.y + 0.6, at.z);
    if (kind === 'quake') {
      g.fx.dust(up, 24);
      g.fx.burst(up, 0xff6a1a, 30, 4);
      g.fx.ring(at, 0.3, c.r, 0xff6a1a, 0.7);
      if (vol) g.sfx.play('slam', vol);
    } else if (kind === 'meteors') {
      g.fx.burst(up, 0xff6a1a, 70, 7, 0.5, 0.9);
      g.fx.dust(up, 30);
      g.fx.ring(at, 0.5, c.r + 0.6, 0xff4a10, 0.8);
      g.fx.flashLight(up, 0xff6a2a, 26, 0.6, 18);
      g.shake(0.5 * vol);
      if (vol) g.sfx.play('explode', vol);
    } else if (kind === 'storm') {
      this.lightning(at);
      g.fx.burst(up, 0xbfe0ff, 30, 5, 0.3, 0.5);
      g.fx.flashLight(new THREE.Vector3(at.x, at.y + 4, at.z), 0xcfe4ff, 30, 0.35, 22);
      if (vol) g.sfx.play('thunder', Math.max(0.35, vol));
      this.flash = 1;
    }
    // our hero, caught in it
    const p = g.player;
    if (!this.exposed() || Math.hypot(p.pos.x - at.x, p.pos.z - at.z) > c.r + p.radius) return;
    g.takeDamage(Math.max(1, Math.round(p.stats.maxHp * c.hurt)));
    if (c.stun) p.applyStatus({ s: c.stun });
    g.shake(0.4);
  }

  // A jagged bolt from the sky to `at`, for a moment.
  lightning(at) {
    const g = this.game, pts = [];
    let x = at.x + rand(-3, 3), z = at.z + rand(-3, 3);
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      pts.push(new THREE.Vector3(i === 10 ? at.x : x, at.y + 20 * (1 - k), i === 10 ? at.z : z));
      x += (at.x - x) * 0.3 + rand(-0.9, 0.9);
      z += (at.z - z) * 0.3 + rand(-0.9, 0.9);
    }
    const mat = new THREE.MeshBasicMaterial({ color: hdr(0xd8ecff, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const bolt = new THREE.Group(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 4), mat);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      bolt.add(seg);
    }
    g.scene.add(bolt);
    let t = 0;
    g.addTicker((dt) => {
      t += dt;
      mat.opacity = t < 0.08 ? 1 : Math.max(0, 1 - (t - 0.08) / 0.2) * (Math.random() < 0.3 ? 0.4 : 1);
      if (t < 0.3) return true;
      g.scene.remove(bolt);
      for (const s of bolt.children) s.geometry.dispose();
      mat.dispose();
      return false;
    });
  }

  // ---------------------------------------------------------------- per frame: the weather
  update(dt) {
    super.update(dt);
    const g = this.game, t = g.time, p = g.player.pos, L = this.look;
    // the quake: the ground keeps shaking, dust rising around
    if (t < this.quakeUntil) {
      g.shake(0.22);
      if (Math.random() < dt * 8) g.fx.dust(new THREE.Vector3(p.x + rand(-9, 9), p.y + 0.2, p.z + rand(-9, 9)), 6);
      if ((this.rumbleT = (this.rumbleT || 0) - dt) <= 0) { this.rumbleT = 1.6; g.sfx.play('rumble', 0.7); }
    }
    // the storm's dark sky and rain; the sandstorm's wall of sand
    const easing = 1 - Math.exp(-1.5 * dt);
    this.storm += ((t < this.stormUntil ? 1 : 0) - this.storm) * easing;
    this.sand += ((t < this.sandUntil ? 1 : 0) - this.sand) * easing;
    this.flash = Math.max(0, (this.flash || 0) - dt * 4);
    if (this.storm > 0.02 || this.sand > 0.02 || this.weathered) {
      const fog = g.scene.fog, base = new THREE.Color(L.fog);
      fog.color.copy(base).lerp(new THREE.Color(0x1a1c26), this.storm * 0.8).lerp(new THREE.Color(0xc89060), this.sand * 0.85);
      fog.near = L.near * (1 - this.sand * 0.85) * (1 - this.storm * 0.3);
      fog.far = L.far * (1 - this.sand * 0.72) * (1 - this.storm * 0.25);
      g.hemi.intensity = L.hemi * (1 - this.storm * 0.45) + this.flash * 1.5;
      g.sun.intensity = L.sunI * (1 - this.storm * 0.6) * (1 - this.sand * 0.4);
      this.weathered = this.storm > 0.02 || this.sand > 0.02;
      if (!this.weathered) g.places.applyLook(L); // (all clear: the canyon's own light again)
    }
    if (this.storm > 0.3 && Math.random() < dt * this.storm * 90) { // rain
      g.fx.soft.emit({ pos: { x: p.x + rand(-16, 16), y: p.y + rand(8, 14), z: p.z + rand(-18, 10) }, count: 1, spread: 0, velSpread: 0.2, vel: { x: 1.5, y: -18, z: 0.5 }, color: new THREE.Color(0xaabbd0), alpha: 0.5, size: 0.06, sizeEnd: 0.06, life: 0.8, drag: 0 });
    }
    if (this.sand > 0.3 && Math.random() < dt * this.sand * 70) { // sand blowing past
      g.fx.soft.emit({ pos: { x: p.x - 18, y: p.y + rand(0.3, 4), z: p.z + rand(-14, 10) }, count: 1, spread: 1, velSpread: 1, vel: { x: 14, y: rand(-0.5, 0.8), z: rand(-1, 1) }, color: new THREE.Color(0xd8a870), alpha: 0.45, size: rand(0.3, 0.9), sizeEnd: 1.4, life: 2.4, drag: 0.1 });
    }
    // the sandstorm wears on a hero out in it, and slows the walk
    if (this.sand > 0.5 && this.exposed()) {
      this.sandT = (this.sandT || 0) + dt;
      if (this.sandT >= 1) {
        this.sandT = 0;
        const pl = g.player;
        g.takeDamage(Math.max(1, Math.round(pl.stats.maxHp * CALAMITY.sandstorm.hurt)));
        pl.applyStatus({ w: 1.2, f: 0.75 });
      }
    }
  }
}

// The Death Canyon, drawn and alive (maps/canyon.js): a gorge like the lands' ground, and its calamities. The
// world (sim/world.js) picks each one and where it strikes, so every hero there sees the same; each hero's game
// takes its own hurt here (never in the camp, Last Rest). The hurt is the same for everyone, not a share of
// Life: the stronger a hero (and the party around it), the better it stands.
//   quake: the whole canyon shakes (and wears on everyone out in it); fissures burst open where the red rings
//     were, rocks tumble from the walls (a heavy blow, and a stagger)
//   meteors: fire falls where the red rings were, wide, and the ground burns a while after
//   storm: the sky darkens, rain, and lightning where the blue rings were (a blow and a stagger)
//   sandstorm: the sand closes in: hard to see, slow to walk, and it scours Life away
import * as THREE from 'three';
import { LandView } from './lands.js';
import { heightAt, zoneAt } from './world.js';
import { hdr } from './fx.js';
import { rand } from './util.js';

// what each does to a hero caught in it: damage, radius (m), stun (s); tremor / burn / scour: damage a second. Light
// for now (players wanted to see them, not be worn down by them): a strike takes about a tenth of a level-70 hero.
export const CALAMITY = {
  quake: { dmg: 120, r: 4.5, stun: 0.8, tremor: 8, color: 0xff6a1a, warn: 1.5, say: 'Earthquake! The canyon shakes: keep out of the red rings.' },
  meteors: { dmg: 160, r: 5.5, stun: 0.3, burn: 20, burnR: 3.5, color: 0xff3a10, warn: 1.6, say: 'Meteors! Fire falls on the canyon: keep out of the red rings.' },
  storm: { dmg: 130, r: 3.5, stun: 0.6, color: 0x7ab8ff, warn: 1.1, say: 'A storm breaks! Lightning strikes where the blue rings are.' },
  sandstorm: { scour: 10, slow: 0.65, say: 'Sandstorm! You can hardly see, it slows you and scours you. Shelter in Last Rest.' },
};

// The scars' pictures, drawn once each: a crater (black at its heart, scorched around, a few embers) and a
// fissure (jagged cracks out from the middle, hot at their bottom).
const scars = {};
function scarTexture(kind) {
  if (scars[kind]) return scars[kind];
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d'), c = S / 2;
  if (kind === 'crater') {
    const grad = x.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(16,10,8,0.95)');
    grad.addColorStop(0.45, 'rgba(34,20,14,0.85)');
    grad.addColorStop(0.8, 'rgba(50,30,20,0.35)');
    grad.addColorStop(1, 'rgba(50,30,20,0)');
    x.fillStyle = grad;
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * c * 0.55;
      x.fillStyle = Math.random() < 0.5 ? 'rgba(255,110,30,0.9)' : 'rgba(255,170,60,0.8)';
      x.beginPath();
      x.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
      x.fill();
    }
  } else {
    const cracks = [];
    for (let i = 0; i < 6; i++) {
      const pts = [[c, c]];
      let a = (i / 6) * Math.PI * 2 + Math.random() * 0.6, px = c, pz = c;
      for (let j = 0; j < 7; j++) {
        a += (Math.random() - 0.5) * 0.9;
        px += Math.cos(a) * (6 + Math.random() * 4);
        pz += Math.sin(a) * (6 + Math.random() * 4);
        pts.push([px, pz]);
      }
      cracks.push(pts);
    }
    x.lineCap = x.lineJoin = 'round';
    for (const [w, col] of [[9, 'rgba(40,22,14,0.55)'], [5, 'rgba(18,10,6,0.95)'], [1.6, 'rgba(255,110,30,1)']]) {
      x.strokeStyle = col;
      for (const pts of cracks) {
        for (let j = 1; j < pts.length; j++) { // (narrowing as it goes)
          x.lineWidth = w * (1 - j / 9);
          x.beginPath();
          x.moveTo(...pts[j - 1]);
          x.lineTo(...pts[j]);
          x.stroke();
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return (scars[kind] = t);
}

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
        if (kind === 'quake') this.meteor(at, Math.min(c.warn, delay), true); // (a rock off the walls)
      }
      if (t < delay) return true;
      this.blow(kind, at, fell);
      return false;
    });
  }

  // A meteor (or, stone: a rock off the canyon's walls) falling onto `at`, arriving in `secs`: a meteor is a
  // black rock glowing through its cracks, in a shell of fire, trailing flame and smoke.
  meteor(at, secs, stone = false) {
    const g = this.game, from = stone ? new THREE.Vector3(at.x + (Math.random() < 0.5 ? -14 : 14), at.y + 16, at.z - 4) : new THREE.Vector3(at.x - 9, at.y + 26, at.z - 7);
    const rock = new THREE.Mesh(stone ? new THREE.DodecahedronGeometry(0.9, 0) : new THREE.IcosahedronGeometry(0.9, 0), stone
      ? new THREE.MeshStandardMaterial({ color: 0x7a4a38, flatShading: true, roughness: 0.9 })
      : new THREE.MeshStandardMaterial({ color: 0x2a1a14, emissive: 0xff4a10, emissiveIntensity: 0.9, flatShading: true, roughness: 0.8 }));
    if (!stone) {
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), new THREE.MeshBasicMaterial({ color: hdr(0xff6a1a, 1.3), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      rock.add(shell);
    }
    rock.position.copy(from);
    g.scene.add(rock);
    let t = 0;
    g.addTicker((dt) => {
      t += dt;
      const k = Math.min(1, t / secs);
      rock.position.lerpVectors(from, at, k * k);
      rock.rotation.x += dt * 6;
      rock.rotation.z += dt * 3;
      if (stone) g.fx.soft.emit({ pos: rock.position, count: 1, spread: 0.3, velSpread: 0.4, color: new THREE.Color(0xa88a6a), alpha: 0.4, size: 0.6, sizeEnd: 1.2, life: 0.6, drag: 1 });
      else {
        g.fx.add.emit({ pos: rock.position, count: 2, spread: 0.4, velSpread: 0.6, color: hdr(0xffa040, 1.8), colorEnd: hdr(0xff2a00, 0.2), size: 0.8, sizeEnd: 0.05, life: 0.45, drag: 1 });
        g.fx.soft.emit({ pos: rock.position, count: 1, spread: 0.3, velSpread: 0.3, color: new THREE.Color(0x3a302c), colorEnd: new THREE.Color(0x6a5e56), alpha: 0.5, size: 0.7, sizeEnd: 1.8, life: 1.4, drag: 1.5 });
      }
      if (k < 1) return true;
      g.scene.remove(rock);
      rock.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      return false;
    });
  }

  // The blow lands: what it looks like (to everyone) and what it does (to our hero, if caught).
  blow(kind, at, _fell) {
    const g = this.game, c = CALAMITY[kind], vol = g.volAt(at), up = new THREE.Vector3(at.x, at.y + 0.6, at.z);
    if (kind === 'quake') { // the ground splits: dust, flung rock, and a glowing fissure left behind
      g.fx.dust(up, 50);
      g.fx.soft.emit({ pos: up, count: 26, spread: 0.6, velSpread: 4, vel: { x: 0, y: 6, z: 0 }, color: new THREE.Color(0x6a4030), colorEnd: new THREE.Color(0x4a2a20), size: 0.32, sizeEnd: 0.2, life: 1.0, gravity: 16, drag: 0.4 });
      g.fx.burst(up, 0xff5a10, 18, 3, 0.3, 0.5);
      g.fx.ring(at, 0.3, c.r, 0xff6a1a, 0.6, 0.15, 1.2);
      this.scar(at, c.r * 0.9, 'fissure');
      g.shake(0.7 * vol);
      if (vol) g.sfx.play('slam', vol);
    } else if (kind === 'meteors') { // the impact: fire, rock and smoke, and a crater burning a while
      g.fx.burst(up, 0xff6a1a, 60, 8, 0.55, 0.8);
      g.fx.dust(up, 50);
      g.fx.soft.emit({ pos: up, count: 30, spread: 0.6, velSpread: 5, vel: { x: 0, y: 7, z: 0 }, color: new THREE.Color(0x3a2620), colorEnd: new THREE.Color(0x1e1410), size: 0.3, sizeEnd: 0.18, life: 1.1, gravity: 16, drag: 0.4 });
      g.fx.soft.emit({ pos: up, count: 14, spread: 1.2, velSpread: 1, vel: { x: 0.4, y: 2.6, z: 0 }, color: new THREE.Color(0x4a3e38), colorEnd: new THREE.Color(0x2a2420), alpha: 0.55, size: 1.4, sizeEnd: 3.4, life: 2.6, drag: 0.8 });
      g.fx.ring(at, 0.5, c.r + 0.8, 0xff4a10, 0.7, 0.15, 1.4);
      g.fx.flashLight(up, 0xff6a2a, 20, 0.6, 22);
      this.scar(at, c.burnR * 1.1, 'crater');
      g.shake(0.8 * vol);
      if (vol) g.sfx.play('explode', vol);
      this.burnAt(at, c.burnR, 3);
    } else if (kind === 'storm') {
      this.lightning(at);
      g.fx.burst(up, 0xbfe0ff, 30, 5, 0.3, 0.5);
      g.fx.flashLight(new THREE.Vector3(at.x, at.y + 4, at.z), 0xcfe4ff, 30, 0.35, 22);
      this.scar(at, 1.4, 'crater');
      if (vol) g.sfx.play('thunder', Math.max(0.35, vol));
      this.flash = 1;
    }
    // our hero, caught in it
    const p = g.player;
    if (!this.exposed() || Math.hypot(p.pos.x - at.x, p.pos.z - at.z) > c.r + p.radius) return;
    g.takeDamage(c.dmg);
    if (c.stun) p.applyStatus({ s: c.stun });
    g.shake(0.6);
  }

  // Burning ground where a meteor fell: flames a while, and they burn a hero standing in them.
  burnAt(at, r, secs) {
    const g = this.game, c = CALAMITY.meteors;
    let t = 0, tick = 0;
    g.addTicker((dt) => {
      t += dt;
      tick += dt;
      if (Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        g.fx.fire(new THREE.Vector3(at.x + Math.cos(a) * d, heightAt(at.x + Math.cos(a) * d, at.z + Math.sin(a) * d) + 0.1, at.z + Math.sin(a) * d), 0.7);
      }
      if (tick >= 0.5) {
        tick = 0;
        const p = g.player;
        if (this.exposed() && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < r + p.radius) g.takeDamage(Math.round(c.burn * 0.5));
      }
      return t < secs;
    });
  }

  // A mark left on the ground where a blow fell, fading in a few seconds: a scorched crater (a meteor, lightning)
  // or a fissure glowing at its bottom (the quake). It lies on the ground's own shape.
  scar(at, r, kind) {
    const g = this.game, n = 10, geo = new THREE.PlaneGeometry(r * 2, r * 2, n, n);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(at.x + pos.getX(i), at.z + pos.getZ(i)) - at.y + 0.06);
    const mat = new THREE.MeshBasicMaterial({ map: scarTexture(kind), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.renderOrder = 1;
    g.scene.add(mesh);
    const life = kind === 'fissure' ? 5 : 7;
    let t = 0;
    g.addTicker((dt) => {
      t += dt;
      mat.opacity = Math.min(1, (life - t) / 2);
      if (t < life) return true;
      g.scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      return false;
    });
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
    // the quake: the whole canyon keeps shaking (hard), dust and grit falling everywhere, and it wears on a hero
    // out in it
    if (t < this.quakeUntil) {
      g.shake(0.5 + 0.25 * Math.sin(t * 9));
      if (Math.random() < dt * 14) g.fx.dust(new THREE.Vector3(p.x + rand(-12, 12), p.y + 0.2, p.z + rand(-12, 12)), 8);
      if (Math.random() < dt * 10) g.fx.soft.emit({ pos: { x: p.x + rand(-10, 10), y: p.y + rand(6, 10), z: p.z + rand(-12, 6) }, count: 1, spread: 0.2, velSpread: 0.3, vel: { x: 0, y: -9, z: 0 }, color: new THREE.Color(0x8a6a50), alpha: 0.7, size: 0.18, sizeEnd: 0.14, life: 1.0, drag: 0 });
      if ((this.rumbleT = (this.rumbleT || 0) - dt) <= 0) { this.rumbleT = 1.4; g.sfx.play('rumble', 0.9); }
      if ((this.tremorT = (this.tremorT || 0) + dt) >= 1) {
        this.tremorT = 0;
        if (this.exposed()) g.takeDamage(CALAMITY.quake.tremor);
      }
    }
    // the storm's dark sky and rain; the sandstorm's wall of sand
    const easing = 1 - Math.exp(-1.5 * dt);
    this.storm += ((t < this.stormUntil ? 1 : 0) - this.storm) * easing;
    this.sand += ((t < this.sandUntil ? 1 : 0) - this.sand) * easing;
    this.flash = Math.max(0, (this.flash || 0) - dt * 4);
    if (this.storm > 0.02 || this.sand > 0.02 || this.weathered) {
      const fog = g.scene.fog, base = new THREE.Color(L.fog);
      fog.color.copy(base).lerp(new THREE.Color(0x1a1c26), this.storm * 0.8).lerp(new THREE.Color(0xc89060), this.sand * 0.85);
      fog.near = L.near * (1 - this.sand * 0.9) * (1 - this.storm * 0.3); // (one's own hero still shows)
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
        g.takeDamage(CALAMITY.sandstorm.scour);
        g.player.applyStatus({ w: 1.2, f: CALAMITY.sandstorm.slow });
      }
    }
  }
}

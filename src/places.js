// Where our hero is (maps.js): the place shown (Emberwood, a land beyond the waystones, a dungeon), its
// light, fog and sky, its flames and the few real point lights that go to the nearest of them, and its ways
// out: the waystones (a travel menu), dungeon doors and stairs, as labels with a button when in reach.
// Each place is drawn the first time a hero goes there (lands.js, dungeon.js) and hidden while away.
import * as THREE from 'three';
import { MAPS, LANDS, START } from './maps.js';
import { heightAt, ZONES } from './world.js';
import { LandView } from './lands.js';
import { DungeonView, fetchPack } from './dungeon.js';
import { FLOOR_Y } from './dungeon-map.js';

const REACH = 2.4; // how close the hero must stand to use something
const EMBER_LOOK = { fog: 0xcfe2ea, near: 60, far: 150, hemiSky: 0xcfe6ff, hemiGround: 0x5d7a3a, hemi: 1.25, sun: 0xfff0d6, sunI: 2.6, sky: [0x3f8fe0, 0xa6d2f2, 0xd4e6ec] };
const $ = (id) => document.getElementById(id);

// Emberwood itself (world.js built it at startup): its campfires, torches, crystal and spirit fire.
class EmberwoodView {
  constructor(game) {
    const w = game.world;
    this.game = game;
    this.map = MAPS.emberwood;
    this.look = EMBER_LOOK;
    this.group = w.root;
    this.minimap = w.minimap;
    this.waystones = w.waystones;
    this.fires = [
      ...w.fires.map((f) => ({ pos: f, scale: f.y > heightAt(f.x, f.z) + 1 ? 0.55 : 1 })),
      ...w.spiritFires.map((f) => ({ pos: f, scale: 0.6, spirit: true })),
    ];
    this.spots = [];
    this.ownLights = true; // its point lights stay put (game.js set them up)
  }

  load() { return Promise.resolve(); }

  show(on) {
    this.group.visible = on;
    if (!on) return;
    for (const s of this.game.staticLights) { // back where they belong
      s.light.position.copy(s.pos);
      s.light.color.copy(s.color);
      s.light.distance = s.distance;
      s.light.decay = s.decay;
      s.light.intensity = s.intensity;
    }
  }

  update(dt) {
    const g = this.game, t = g.time;
    g.fireLights.forEach((l, i) => { l.intensity = 11 + Math.sin(t * 13 + i) * 1.5 + Math.sin(t * 7.3 + i * 2) * 1.5; });
    g.spiritLight.intensity = 9 + Math.sin(t * 3.1) * 2 + Math.sin(t * 8.7) * 0.8;
    const cr = g.world.crystal;
    cr.rotation.y += dt * 0.9;
    cr.position.y = heightAt(cr.position.x, cr.position.z) + 2.3 + Math.sin(t * 1.6) * 0.18;
    if (Math.random() < dt * 8) {
      g.fx.add.emit({ pos: cr.position, count: 1, spread: 0.6, velSpread: 0.4, vel: { x: 0, y: 0.8, z: 0 }, color: new THREE.Color(0xb080ff).multiplyScalar(2.5), size: 0.14, sizeEnd: 0.02, life: 1.6, drag: 0.8 });
    }
    for (const ws of this.waystones) {
      ws.crystal.rotation.y += dt * 0.9;
      ws.crystal.position.y = 3.8 + Math.sin(t * 1.6) * 0.15;
    }
  }
}

export class Places {
  constructor(game) {
    this.game = game;
    this.id = START;
    this.views = { [START]: new EmberwoodView(game) };
    this.near = null;
    this.fireAcc = 0;
    // the real point lights, handed to the nearest light sources away from Emberwood
    this.slots = game.staticLights.map((s) => ({ light: s.light, src: null, fade: 0 }));
    // every place's ways out, labelled (a label only shows near the hero; only this place's can be used)
    const ui = game.ui;
    this.portals = [];
    for (const m of Object.values(MAPS)) {
      for (const p of m.portals) {
        const y = m.kind === 'dungeon' ? FLOOR_Y + 3.4 : heightAt(p.x, p.z) + (p.id === 'waystone' ? 4.7 : 3.9);
        const top = p.id === 'crypt' ? new THREE.Vector3(p.x + 1, heightAt(p.x + 1, p.z) + 3.5, p.z) : new THREE.Vector3(p.x, y, p.z);
        const spot = { ...p, map: m.id, use: () => this.usePortal(spot) };
        spot.label = ui.createNpcLabel(p.name, p.title, p.action, () => this.use(spot), (o) => o.copy(top));
        this.portals.push(spot);
      }
    }
    this.travelEl = $('travel');
    $('travel-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-to]');
      if (b && !b.disabled) { this.closeTravel(); game.travel(b.dataset.to); }
    });
  }

  get map() { return MAPS[this.id]; }
  get view() { return this.views[this.id]; }

  viewOf(id) {
    if (!this.views[id]) {
      const m = MAPS[id];
      this.views[id] = m.kind === 'dungeon' ? new DungeonView(this.game, m) : new LandView(this.game, m);
    }
    return this.views[id];
  }

  // Draw it (the first time; a dungeon downloads its pieces) before going there.
  load(id) {
    return this.viewOf(id).load();
  }

  // Show place `id` (the world has put us there).
  enter(id) {
    if (id === this.id && this.view.group.visible) return;
    this.view.show(false);
    this.id = id;
    const v = this.viewOf(id);
    v.show(true);
    this.applyLook(v.look);
    for (const sl of this.slots) { sl.src = null; sl.fade = 0; if (!v.ownLights) sl.light.intensity = 0; }
    this.near = null;
  }

  applyLook(L) {
    const g = this.game, dungeon = this.map.kind === 'dungeon';
    g.scene.fog.color.setHex(L.fog);
    g.scene.fog.near = L.near;
    g.scene.fog.far = L.far;
    g.hemi.color.setHex(L.hemiSky);
    g.hemi.groundColor.setHex(L.hemiGround);
    g.hemi.intensity = L.hemi;
    g.sun.color.setHex(L.sun);
    g.sun.intensity = L.sunI;
    const sky = g.world.sky;
    sky.visible = !dungeon;
    g.scene.background = dungeon ? new THREE.Color(L.fog) : null;
    if (L.sky) {
      const u = sky.material.uniforms;
      u.top.value.setHex(L.sky[0]);
      u.mid.value.setHex(L.sky[1]);
      u.bottom.value.setHex(L.sky[2]);
    }
  }

  // ---------------------------------------------------------------- using things
  use(spot) {
    if (this.near === spot) spot.use();
  }

  interact() {
    if (this.near) this.near.use();
  }

  usePortal(p) {
    if (p.id === 'waystone') this.openTravel();
    else this.game.travel(p.to);
  }

  // The world says a boss fell here (a dungeon's hoard opens).
  bossDown(type) {
    this.view.bossDown?.(type);
  }

  pulse(amount) {
    this.view.pulse?.(amount);
  }

  // ---------------------------------------------------------------- the waystones' travel menu
  openTravel() {
    const g = this.game, lvl = g.player.level;
    g.ui.closeInventory();
    $('travel-list').innerHTML = LANDS.map((id) => {
      const m = MAPS[id], here = id === this.id, locked = lvl < m.minLevel;
      const note = here ? 'You are here' : locked ? `From level ${m.minLevel}` : 'Travel';
      return `<button data-to="${id}" class="land l-${id}${here ? ' here' : ''}"${here || locked ? ' disabled' : ''}>
        <b>${m.name}</b><small>${m.sub}</small><span>${note}</span></button>`;
    }).join('');
    this.travelEl.classList.remove('hidden');
    g.sfx.play('portal', 0.35);
  }

  closeTravel() {
    this.travelEl.classList.add('hidden');
  }

  get travelOpen() {
    return !this.travelEl.classList.contains('hidden');
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, p = g.player, v = this.view;
    v.update(dt);
    g.world.sky.position.copy(g.camera.position);
    // what's in reach: this place's ways out and its chests
    let best = null, bd = REACH;
    if (p.alive && !g.traveling) {
      for (const s of this.portals) {
        if (s.map !== this.id) continue;
        const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        if (d < bd + (s.id === 'waystone' ? 0.6 : 0)) { bd = d; best = s; }
      }
      for (const s of v.spots) {
        if (!s.can()) continue;
        const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        if (d < bd) { bd = d; best = s; }
      }
    }
    this.near = best;
    for (const s of this.portals) s.label.el.classList.toggle('near', s === best);
    for (const s of v.spots) s.label.el.classList.toggle('near', s === best);
    if (this.travelOpen && best?.id !== 'waystone') this.closeTravel(); // walked away

    // walking toward a dungeon: start downloading its pieces so the door opens without a wait
    if (!this.packAsked && performance.now() > (this.retryAt || 0)) {
      for (const s of this.portals) {
        if (s.map !== this.id || MAPS[s.to]?.kind !== 'dungeon' || Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > 32) continue;
        this.retryAt = performance.now() + 15000; // offline or a failed download: try again later, not every frame
        fetchPack().then(() => { this.packAsked = true; }, () => {});
        break;
      }
    }

    // flames
    this.fireAcc += dt * 34;
    const pp = p.pos;
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      for (const f of v.fires) {
        if (f.pos.distanceTo(pp) > 45) continue;
        if (f.smoke) {
          if (Math.random() < 0.15) g.fx.soft.emit({ pos: f.pos, count: 1, spread: 0.4, velSpread: 0.2, vel: { x: 0.4, y: 1.6, z: 0 }, color: new THREE.Color(0x3a3430), alpha: 0.35, size: 1.2, sizeEnd: 3.5, life: 4, drag: 0.3 });
        } else g.fx.fire(f.pos, f.scale, !!f.spirit, f.color ?? null);
      }
    }
    if (!v.ownLights) this.updateLights(dt, v);
  }

  // The nearest light sources get the real point lights; a light fades out before it moves. In a
  // dungeon one follows the hero from the camera side (a Diablo-style light radius).
  updateLights(dt, v) {
    const p = this.game.player.pos, t = this.game.time;
    let slots = this.slots;
    if (v.followLight) {
      const own = slots[0].light;
      own.position.set(p.x, p.y + 3.4, p.z + 2.6);
      own.color.setHex(0xffd6a8);
      own.distance = 12;
      own.decay = 1.3;
      own.intensity = 7;
      slots = slots.slice(1);
    }
    const want = v.lights
      .map((s) => [s, (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 - (s.gain && s.gain() <= 0 ? 1e9 : 0)])
      .sort((a, b) => a[1] - b[1]).slice(0, slots.length).map((a) => a[0]);
    const lit = new Set(slots.map((sl) => sl.src));
    const spare = want.filter((s) => !lit.has(s));
    for (const sl of slots) {
      if (!sl.src || !want.includes(sl.src)) {
        sl.fade -= dt * 6;
        if (sl.fade <= 0) {
          sl.fade = 0;
          sl.src = spare.shift() || null;
          if (sl.src) {
            sl.light.position.copy(sl.src.pos);
            sl.light.color.setHex(sl.src.color);
            sl.light.distance = sl.src.dist;
            sl.light.decay = 1.6;
          }
        }
      } else {
        sl.fade = Math.min(1, sl.fade + dt * 4);
      }
      const s = sl.src;
      if (!s) { sl.light.intensity = 0; continue; }
      const flick = s.flicker !== undefined ? 1 + Math.sin(t * 13 + s.flicker) * 0.09 + Math.sin(t * 7.3 + s.flicker * 2) * 0.08 : 1;
      sl.light.intensity = s.power * sl.fade * flick * (s.gain ? s.gain() : 1);
    }
  }

  // Where a quest's dashed ring goes on this place's map: a zone here; a dungeon's boss room inside it,
  // or its door from the land outside.
  questRing(zoneId) {
    const here = this.map;
    const dungeonOf = Object.values(MAPS).find((m) => m.kind === 'dungeon' && m.dungeon.zone.id === zoneId);
    if (dungeonOf) {
      if (here === dungeonOf) { const B = here.dungeon.rooms.B; return { x: B.cx, z: B.cz, r: 11 }; }
      const door = here.portals.find((p) => p.to === dungeonOf.id);
      return door ? { x: door.x, z: door.z, r: 3.5 } : null;
    }
    if (here.kind === 'dungeon') return null;
    const zones = here.outdoor ? here.outdoor.zones : ZONES;
    return zones?.find((z) => z.id === zoneId) || null;
  }
}


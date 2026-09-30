// Game orchestration: renderer, camera, input, combat resolution, rewards, saving.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadAssets, buildIcons } from './assets.js';
import { buildWorld, heightAt, zoneAt, worldUniforms } from './world.js';
import { FX } from './fx.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Projectiles, LootManager } from './combat.js';
import { UI } from './ui.js';
import { Doll } from './doll.js';
import { Sfx } from './audio.js';
import { randomItem } from './items.js';
import { Input } from './input.js';
import { angleDiff, yawTo, randInt, rand, chance, clamp } from './util.js';

const SAVE_KEY = 'emberwood-save-v1';

export class Game {
  constructor() {
    const container = document.getElementById('game');
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    // phones and tablets: fewer pixels, smaller shadow map, less grass
    this.lowSpec = window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowSpec ? 1.5 : 1.75));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe2ea, 60, 150);
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.5, 800);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5d7a3a, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(this.lowSpec ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.lowSpec ? 2 : 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.55, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.input = new Input();
    this.raycaster = new THREE.Raycaster();
    this.aimPoint = new THREE.Vector3();
    this.hover = null;
    this.camFocus = new THREE.Vector3();
    this.zoom = 1;
    this.zoomTarget = 1;
    this.shakeAmt = 0;
    this.hitstop = 0;
    this.time = 0;
    this.currentZone = null;
    this.sfx = new Sfx();
    this.started = false;
    window.addEventListener('resize', () => this.onResize());
  }

  async init(onProgress) {
    await loadAssets((f) => onProgress(f * 0.8, 'Loading models'));
    onProgress(0.85, 'Growing the forest');
    await new Promise((r) => setTimeout(r, 20));
    this.world = buildWorld(this.scene, { lowSpec: this.lowSpec });
    onProgress(0.92, 'Painting icons');
    await new Promise((r) => setTimeout(r, 20));
    buildIcons();

    this.fx = new FX(this.scene);
    this.fx.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.camera.fov);
    this.projectiles = new Projectiles(this);
    this.loot = new LootManager(this);
    this.player = new Player(this);
    this.scene.add(this.player.group);
    this.ui = new UI(this);
    this.doll = new Doll(document.getElementById('doll-canvas'));
    this.enemies = new EnemyManager(this);

    const save = this.loadSave();
    if (save) this.player.load(save);
    else this.player.starterKit();
    this.player.onGearChanged(false);
    this.player.pos.set(0, heightAt(0, 3.5), 3.5);
    this.camFocus.copy(this.player.pos);

    // static fire lights (camp + bandit hideout) and the crystal glow
    this.fireLights = this.world.fires.slice(0, 2).map((f) => {
      const l = new THREE.PointLight(0xff8a3a, 12, 14, 1.6);
      l.position.copy(f).setY(f.y + 0.8);
      this.scene.add(l);
      return l;
    });
    const cl = new THREE.PointLight(0xa070ff, 10, 12, 1.6);
    cl.position.copy(this.world.crystal.position);
    this.scene.add(cl);
    this.spiritLight = new THREE.PointLight(0x4dff8a, 10, 14, 1.6);
    this.spiritLight.position.copy(this.world.spiritLight);
    this.scene.add(this.spiritLight);
    this.fireAcc = 0;

    this.bindInput();
    onProgress(1, 'Ready');
    // warm up shaders so the first frame doesn't hitch
    this.updateCamera(0);
    this.renderer.compile(this.scene, this.camera);
    this.composer.render();
  }

  start() {
    this.started = true;
    this.sfx.init();
    this.player.h.anim.play('Spawn_Ground', { timeScale: 1.1 });
    this.ui.log('Welcome to <b>Emberwood</b>. Slimes roam the meadow to the north.');
    this.ui.log(this.input.touchMode
      ? 'Left thumb moves · hold the sword to attack · skills aim for you'
      : 'WASD to move · Click to attack · 1–4 skills · Q ale · I bag');
    this.last = performance.now();
    this.ui.zoneToast({ name: 'Emberwood', sub: 'A tiny action RPG' });
    setInterval(() => this.save(), 10000);
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    loop();
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const input = this.input;
    input.onKey = (code, e) => {
      if (!this.started || e.repeat) return;
      const p = this.player;
      switch (code) {
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
          p.useSkill(Number(code.slice(-1)) - 1);
          break;
        case 'KeyQ': p.drinkAle(); break;
        case 'KeyI': case 'KeyB': case 'Tab': this.ui.toggleInventory(); e.preventDefault(); break;
        case 'KeyH': this.ui.togglePanel('help'); break;
        case 'KeyM': this.ui.toggleSound(); break;
        case 'Escape': this.ui.togglePanel('inventory', false); this.ui.togglePanel('help', false); break;
        default: break;
      }
    };
    input.bindCanvas(this.renderer.domElement, (dir) => {
      this.zoomTarget = clamp(this.zoomTarget + dir * 0.1, 0.6, 1.5);
    });
    input.bindStick(document.getElementById('stick-zone'), document.getElementById('stick'), document.getElementById('stick-knob'));
    input.onModeChange = (touch) => this.ui.setTouchMode(touch);
    window.addEventListener('pointerdown', () => this.sfx.init(), { once: true });
    this.ui.setTouchMode(input.touchMode);
  }

  updateAim() {
    if (this.input.touchMode) {
      // no cursor on touch screens: attacks and skills aim themselves (see aim())
      if (this.hover) this.hover.hover = false;
      this.hover = null;
      return;
    }
    this.raycaster.setFromCamera(this.input.mouse, this.camera);
    const ray = this.raycaster.ray;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.player.pos.y);
    if (!ray.intersectPlane(plane, this.aimPoint)) this.aimPoint.copy(this.player.pos);
    let best = null, bestT = Infinity;
    for (const e of this.enemies.list) {
      e.hover = false;
      if (!e.alive || e.state === 'spawn') continue;
      const c = e.center;
      const r = Math.max(0.75, e.height * 0.45);
      if (ray.distanceSqToPoint(c) < r * r) {
        const t = ray.origin.distanceTo(c);
        if (t < bestT) { bestT = t; best = e; }
      }
    }
    this.hover = best;
    if (best) best.hover = true;
    this.renderer.domElement.style.cursor = best ? 'crosshair' : 'default';
  }

  // Resolve where an attack should go: hovered enemy, else nearest enemy roughly toward the cursor.
  // On touch screens: the closest enemy in reach (favouring the one you face), else straight ahead.
  aim(assist) {
    const p = this.player.pos;
    if (this.input.touchMode) return this.autoAim(assist + 1.5);
    if (this.hover && this.hover.alive) return { target: this.hover, point: this.hover.pos.clone() };
    const dirYaw = yawTo(this.aimPoint.x - p.x, this.aimPoint.z - p.z);
    let best = null, bd = Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > assist + e.radius) continue;
      if (Math.abs(angleDiff(dirYaw, yawTo(dx, dz))) > 0.85) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return { target: best, point: best ? best.pos.clone() : this.aimPoint.clone() };
  }

  autoAim(range) {
    const pl = this.player, p = pl.pos;
    const stick = this.input.stick;
    const facing = stick.lengthSq() > 0.04 ? yawTo(stick.x, stick.y) : pl.yaw;
    let best = null, bestScore = Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz) - e.radius;
      if (d > range) continue;
      const score = d + Math.abs(angleDiff(facing, yawTo(dx, dz))) * 1.5;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) return { target: best, point: best.pos.clone() };
    return { target: null, point: new THREE.Vector3(p.x + Math.sin(facing) * 4, p.y, p.z + Math.cos(facing) * 4) };
  }

  // ---------------------------------------------------------------- combat
  meleeHit({ range, arc, mult, knock }) {
    const p = this.player;
    let n = 0;
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      if (arc < 6.2 && Math.abs(angleDiff(p.yaw, yawTo(dx, dz))) > arc / 2 && d > e.radius + 0.5) continue;
      this.damageEnemy(e, p.rollDamage(mult), p.pos, knock);
      n++;
    }
    if (n) {
      this.hitstop = 0.05;
      this.shake(0.1);
    }
    return n;
  }

  damageEnemy(e, { amount, crit }, fromPos, knock = 0.4) {
    if (!e.alive) return;
    e.takeDamage(amount, fromPos, knock);
    const c = e.center;
    const top = new THREE.Vector3(e.pos.x, e.pos.y + e.height + 0.1, e.pos.z);
    this.ui.floater(top, String(amount), crit ? 'crit' : '');
    this.fx.sparks(c, crit ? 0xffe070 : 0xfff0c0, crit ? 22 : 10, crit ? 7 : 5);
    if (e.slime) this.fx.goo(c, e.def.color, 6);
    this.sfx.play(crit ? 'crit' : 'hit');
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    const p = this.player, d = e.def;
    e.die();
    if (e.slime) this.sfx.play('slime');
    const levelGap = p.level - e.level;
    const xp = Math.max(1, Math.round(d.xp * (1 + 0.25 * (e.level - 1)) * clamp(1 - (levelGap - 2) * 0.2, 0.2, 1.2)));
    p.gainXp(xp);
    this.ui.floater(new THREE.Vector3(e.pos.x, e.pos.y + e.height + 0.6, e.pos.z), `+${xp} XP`, 'xp');
    const at = e.pos.clone();
    if (chance(0.75)) this.loot.dropGold(Math.round(randInt(d.gold[0], d.gold[1]) * (1 + 0.2 * (e.level - 1))), at);
    if (chance(d.boss ? 1 : 0.07)) this.loot.dropPotion(at);
    if (d.boss) {
      this.loot.dropItem(randomItem(e.level + 1, { boost: 3, minRarity: 'rare' }), at);
      this.loot.dropItem(randomItem(e.level, { boost: 2, minRarity: 'magic' }), at);
      this.loot.dropPotion(at);
      this.ui.log(`<b>${d.name}</b> has been slain!`, 'lvl');
      this.shake(0.5);
    } else if (chance(d.drop)) {
      this.loot.dropItem(randomItem(e.level, { boost: e.level * 0.1, table: d.loot }), at);
    }
  }

  damagePlayer(amount, src) {
    const p = this.player;
    if (!p.alive) return;
    const dmg = Math.max(1, Math.round(amount * (1 - p.stats.dr) * rand(0.9, 1.1)));
    p.hp -= dmg;
    this.ui.floater(p.headPos(), String(dmg), 'hurt');
    p.h.hitFlash(0xff2a1a, 0.9);
    this.ui.hurt();
    this.sfx.play('hurt');
    this.shake(0.15);
    if (p.hp <= 0) {
      p.hp = 0;
      p.die();
    }
  }

  addGold(n, pos) {
    this.player.gold += n;
    this.ui.floater(new THREE.Vector3(pos.x, pos.y + 1, pos.z), `+${n}g`, 'gold');
    this.sfx.play('gold');
    this.ui.refreshInventory();
  }

  addPotion(pos) {
    this.player.potions++;
    this.ui.floater(new THREE.Vector3(pos.x, pos.y + 1, pos.z), '+1 Ale', 'heal');
    this.sfx.play('pickup');
  }

  shake(a) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  // ---------------------------------------------------------------- persistence
  save() {
    if (!this.player) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.player.serialize())); } catch { /* storage unavailable */ }
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- frame
  updateCamera(dt) {
    const p = this.player.pos;
    const k = dt ? 1 - Math.exp(-9 * dt) : 1;
    this.camFocus.lerp(p, k);
    this.zoom += (this.zoomTarget - this.zoom) * (dt ? 1 - Math.exp(-8 * dt) : 1);
    // tall (portrait) screens see very little sideways: pull the camera back
    const aspectZoom = this.camera.aspect < 1 ? Math.min(1.7, 1 / Math.sqrt(this.camera.aspect)) : 1;
    const z = this.zoom * aspectZoom;
    this.camera.position.set(this.camFocus.x, this.camFocus.y + 12.5 * z, this.camFocus.z + 13 * z);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
    this.camera.lookAt(this.camFocus.x, this.camFocus.y + 1.2, this.camFocus.z);
    // keep the shadow frustum centered on the player
    this.sun.position.set(this.camFocus.x - 24, this.camFocus.y + 42, this.camFocus.z + 20);
    this.sun.target.position.copy(this.camFocus);
  }

  frame(rawDt) {
    rawDt *= this.timeScale ?? 1;
    let dt = rawDt;
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt *= 0.15;
    }
    this.time += dt;
    worldUniforms.uTime.value = this.time;

    this.updateAim();
    this.player.update(dt);
    this.enemies.update(dt);
    this.projectiles.update(dt);
    this.loot.update(dt);

    // ambience: campfires, torches, crystal
    this.fireAcc += dt * 34;
    const pp = this.player.pos;
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      for (const f of this.world.fires) if (f.distanceTo(pp) < 45) this.fx.fire(f, f.y > heightAt(f.x, f.z) + 1 ? 0.55 : 1);
      for (const f of this.world.spiritFires) if (f.distanceTo(pp) < 45) this.fx.fire(f, 0.6, true);
    }
    this.fireLights.forEach((l, i) => { l.intensity = 11 + Math.sin(this.time * 13 + i) * 1.5 + Math.sin(this.time * 7.3 + i * 2) * 1.5; });
    this.spiritLight.intensity = 9 + Math.sin(this.time * 3.1) * 2 + Math.sin(this.time * 8.7) * 0.8;
    const cr = this.world.crystal;
    cr.rotation.y += dt * 0.9;
    cr.position.y = heightAt(cr.position.x, cr.position.z) + 2.3 + Math.sin(this.time * 1.6) * 0.18;
    if (Math.random() < dt * 8) {
      this.fx.add.emit({ pos: cr.position, count: 1, spread: 0.6, velSpread: 0.4, vel: { x: 0, y: 0.8, z: 0 }, color: new THREE.Color(0xb080ff).multiplyScalar(2.5), size: 0.14, sizeEnd: 0.02, life: 1.6, drag: 0.8 });
    }

    const zone = zoneAt(pp.x, pp.z);
    if (zone !== this.currentZone) {
      if (zone) this.ui.zoneToast(zone);
      this.currentZone = zone;
      this.ui.el.zoneName.textContent = zone ? zone.name : 'The Wilds';
    }
    this.ui.setBoss(this.enemies.boss);

    this.fx.update(dt);
    this.updateCamera(rawDt);
    this.ui.update(rawDt);
    this.doll.update(rawDt);
    this.composer.render();
  }

  onResize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    if (this.fx) this.fx.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }
}

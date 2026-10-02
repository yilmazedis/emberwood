// Game orchestration: renderer, camera, input, combat resolution, rewards, saving, travel. The monsters
// and the other heroes live in the shared world (link.js talks to it); our own hero is played right here,
// in one place at a time (places.js: Emberwood, the lands beyond the waystones, the dungeons).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadAssets, buildIcons } from './assets.js';
import { buildWorld, heightAt, zoneAt, worldUniforms, POND } from './world.js';
import { MAPS } from './maps.js';
import { FX } from './fx.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Projectiles, LootManager } from './combat.js';
import { UI } from './ui.js';
import { Doll } from './doll.js';
import { Sfx } from './audio.js';
import { randomItem } from './items.js';
import { monsterXp } from './monsters.js';
import { Input } from './input.js';
import { Town } from './town.js';
import { Quests } from './quests.js';
import { Places } from './places.js';
import { WorldLink } from './link.js';
import { RemotePlayers } from './others.js';
import { Chat } from './chat.js';
import { loadSettings, saveSettings } from './settings.js';
import { angleDiff, yawTo, randInt, rand, chance, clamp } from './util.js';

const SAVE_KEY = 'emberwood-save-v1'; // the local save (offline play: ?autostart)

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
    this.renderer.localClippingEnabled = true; // the crypt's camera-side walls are clipped (dungeon.js)
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
    this.settings = loadSettings();

    this.input = new Input();
    this.raycaster = new THREE.Raycaster();
    this.aimPoint = new THREE.Vector3();
    this.hover = null;
    this.camFocus = new THREE.Vector3();
    this.zoom = this.settings.zoom;
    this.zoomTarget = this.settings.zoom;
    this.shakeAmt = 0;
    this.hitstop = 0;
    this.time = 0;
    this.currentZone = null;
    this.sfx = new Sfx();
    this.sfx.vol = { music: this.settings.music, sfx: this.settings.sfx, ambience: this.settings.ambience };
    this.sfx.muted = this.settings.muted;
    this.started = false;
    this.link = new WorldLink(this); // the shared world (attached to the server, or a local one: main.js)
    this.offline = false; // playing on our own (?autostart): the world runs in this page and can pause
    this.paused = false; // settings open (offline, the world holds still too)
    this.onTitle = false; // left the game (back on the title screen)
    this.applyQuality(this.settings.quality);
    window.addEventListener('resize', () => this.onResize());
    // app in the background: save, and let the music and ambience rest
    document.addEventListener('visibilitychange', () => {
      if (!this.started) return;
      if (document.hidden) { this.save(true); this.sfx.sleep(); } else if (!this.onTitle) this.sfx.wake();
      this.link.sendNow(); // away (monsters leave an absent hero alone) or back
    });
    window.addEventListener('pagehide', () => this.save(true));
  }

  // ---------------------------------------------------------------- settings
  setSetting(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
    if (key === 'music' || key === 'sfx' || key === 'ambience') this.sfx.setVolume(key, value);
    else if (key === 'muted') this.sfx.setMuted(value);
    else if (key === 'quality') this.applyQuality(value);
    else if (key === 'zoom') this.zoomTarget = value;
  }

  // High: sharp, shadows and glow. Low: fewer pixels, no shadows, no bloom (older phones).
  applyQuality(q) {
    const low = q === 'low';
    const ratio = Math.min(window.devicePixelRatio, low ? 1 : this.lowSpec ? 1.5 : 1.75);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.bloom.enabled = !low;
    this.sun.castShadow = !low;
    this.onResize();
  }

  // The hero to play: { id, name, cls, save } from the server (or the local one when offline).
  setCharacter(char) {
    this.character = { id: char.id, name: char.name, cls: char.cls };
    const p = this.player;
    p.setClass(char.cls);
    p.reset();
    if (char.save) p.load(char.save); else p.starterKit();
    // nothing of the previous hero's world stays behind: a hero starts in Emberwood's camp
    this.places.enter('emberwood');
    this.loot.clear();
    this.projectiles.clear();
    this.town.buyback = [];
    p.alive = true;
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    p.pos.set(0, heightAt(0, 3.5), 3.5);
    p.yaw = p.targetYaw = Math.PI;
    p.group.rotation.y = p.yaw;
    this.camFocus.copy(p.pos);
    this.ui.showDeath(false);
    this.quests.ensure();
    this.ui.setCharacter(char);
    this.renderer.compile(this.scene, this.camera); // the new model's shaders, before the first frame
  }

  // Signed in from another device: back to the title screen (main.js shows why).
  kicked(msg) {
    this.character = null; // nothing more to save from here
    this.leave(msg);
  }

  // "Leave game": save, step out of the world and show the title screen (main.js); resume() comes back.
  leave(msg = '') {
    if (this.onTitle) return;
    this.save(true);
    this.link.exit();
    this.chat.close();
    this.ui.closeSettings(true);
    this.ui.closeInventory();
    this.ui.togglePanel('help', false);
    this.onTitle = true;
    this.paused = true;
    this.sfx.music?.play(null);
    this.sfx.sleep();
    this.onLeave?.(msg);
  }

  resume() {
    this.onTitle = false;
    this.paused = false;
    this.sfx.wake();
    this.last = performance.now();
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
    this.player = new Player(this); // a stand-in until a hero is picked (setCharacter)
    this.scene.add(this.player.group);
    this.ui = new UI(this);
    this.doll = new Doll(document.getElementById('doll-canvas'));
    this.enemies = new EnemyManager(this); // the monsters the world tells us about
    this.others = new RemotePlayers(this); // … and the other heroes
    this.chat = new Chat(this);

    this.player.starterKit();
    this.player.pos.set(0, heightAt(0, 3.5), 3.5);
    this.camFocus.copy(this.player.pos);
    this.quests = new Quests(this); // story + bounties (reads the saved quest state)
    this.town = new Town(this); // merchant, stash and notice board in camp (after loading: it reads the saved shop)

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
    // away from Emberwood these four go to the nearest torches and fires; remember how they were set up
    this.staticLights = [...this.fireLights, cl, this.spiritLight].map((light) => ({
      light, pos: light.position.clone(), color: light.color.clone(), distance: light.distance, decay: light.decay, intensity: light.intensity,
    }));
    this.places = new Places(this); // where we are, and the ways to the other places
    this.traveling = false;

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
    this.ui.log('Wren the merchant, your stash and the quest notice board are at the north end of camp.');
    this.ui.log(this.input.touchMode
      ? 'Left thumb moves · hold the sword to attack · skills aim for you'
      : 'WASD to move · Click to attack · 1–4 skills · Q ale · I bag');
    this.last = performance.now();
    this.ui.zoneToast({ name: 'Emberwood', sub: 'A tiny action RPG' });
    this.ui.refreshTracker();
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
      if (!this.started || e.repeat || this.onTitle) return;
      if (this.paused && code !== 'Escape' && code !== 'KeyM') return; // settings open: keys go there
      const p = this.player;
      switch (code) {
        case 'Enter': case 'NumpadEnter': this.chat.open(); e.preventDefault(); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
          p.useSkill(Number(code.slice(-1)) - 1);
          break;
        case 'KeyQ': p.drinkAle(); break;
        case 'KeyI': case 'KeyB': case 'Tab': this.ui.toggleInventory(); e.preventDefault(); break;
        case 'KeyH': this.ui.togglePanel('help'); break;
        case 'KeyE': this.interact(); break;
        case 'KeyM': this.ui.toggleSound(); break;
        case 'Escape': this.ui.escape(); break;
        default: break;
      }
    };
    input.bindCanvas(this.renderer.domElement, (dir) => {
      this.zoomTarget = clamp(this.zoomTarget + dir * 0.1, 0.6, 1.5);
      this.settings.zoom = this.zoomTarget;
      saveSettings(this.settings);
    });
    input.bindStick(document.getElementById('stick-zone'), document.getElementById('stick'), document.getElementById('stick-knob'));
    input.onModeChange = (touch) => this.ui.setTouchMode(touch);
    // audio may only start (or restart, e.g. on iPhone after the app was in the background) on a tap
    window.addEventListener('pointerdown', () => {
      this.sfx.init();
      if (!this.onTitle && this.started && this.sfx.ctx?.state !== 'running') this.sfx.wake();
    });
    this.ui.setTouchMode(input.touchMode);
  }

  // E / the action button: whatever is in reach (camp stalls, waystones, dungeon doors and stairs, chests)
  interact() {
    if (this.town.near) this.town.interact();
    else this.places.interact();
  }

  // To another place (maps.js) behind a quick fade: through a waystone, a dungeon's door or its stairs, or
  // (respawn) from where we fell to where heroes rise. The world decides; we draw the place first.
  async travel(to, { respawn = false } = {}) {
    const map = MAPS[to], ui = this.ui, p = this.player;
    if (this.traveling || !map || (!respawn && !p.alive)) return false;
    if (!respawn && p.level < map.minLevel) { ui.centerMsg(`${map.name} is for heroes of level ${map.minLevel} and up`); return false; }
    this.traveling = true;
    ui.closeInventory();
    this.places.closeTravel();
    const from = this.places.map;
    ui.fade(true, respawn ? 'You rise again…' : map.kind === 'dungeon' ? `Descending into ${map.name}…`
      : from.kind === 'dungeon' ? 'Climbing back up…' : `Traveling to ${map.name}…`);
    if (!respawn) this.sfx.play('portal');
    let r;
    try {
      await Promise.all([this.places.load(to), new Promise((res) => setTimeout(res, 420))]);
      r = await this.link.travel(to, respawn);
    } catch (err) {
      console.warn('travel failed', err);
      ui.fade(false);
      ui.centerMsg(/load|fetch|network|\.glb/i.test(err.message) ? `Could not load ${map.name}: try again` : err.message);
      this.traveling = false;
      return false;
    }
    await this.arrive(r);
    ui.fade(false);
    this.traveling = false;
    return true;
  }

  // Show the place the world put us in ({ map, x, z, yaw }), with our hero there.
  async arrive(r) {
    const p = this.player;
    await this.places.load(r.map);
    this.places.enter(r.map);
    p.pos.set(r.x, heightAt(r.x, r.z), r.z);
    p.yaw = p.targetYaw = r.yaw ?? 0;
    p.group.position.copy(p.pos);
    p.group.rotation.y = p.yaw;
    this.camFocus.copy(p.pos);
    this.projectiles.clear();
    this.currentZone = undefined; // (announce where we are)
    this.updateCamera(0);
    // warm up new shaders while the screen is black (in parallel where the GPU driver allows it)
    try {
      if (this.renderer.extensions.has('KHR_parallel_shader_compile')) await this.renderer.compileAsync(this.scene, this.camera);
      else this.renderer.compile(this.scene, this.camera);
    } catch { /* they compile on first draw instead */ }
  }

  // "Rise again": where heroes who fall here rise (the camp, or outside the dungeon), full of life.
  async rise() {
    const p = this.player, to = this.places.map.respawn;
    if (!(await this.travel(to.map, { respawn: true }))) {
      if (to.map !== this.places.id) return; // (can't reach the world: stay down and try again)
      p.pos.set(to.x, heightAt(to.x, to.z), to.z); // the same place: rise here anyway
      p.yaw = p.targetYaw = to.yaw;
      this.camFocus.copy(p.pos);
    }
    p.revive();
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

  // Keys and buttons don't move the hero while a menu has them (the world doesn't wait online).
  get inputBlocked() {
    return this.paused || this.chat.isOpen;
  }

  // How loud something at pos sounds for us: full up close, nothing from 28 m.
  volAt(pos) {
    const p = this.player.pos;
    return clamp(1 - Math.hypot(p.x - pos.x, p.z - pos.z) / 28, 0, 1);
  }

  // ---------------------------------------------------------------- combat
  // Our hero's blow: everything within range in an arc in front. eff: stun / slow / taunt (see link.hit);
  // critBonus: extra chance of a critical hit.
  meleeHit({ range, arc, mult, knock, eff = null, critBonus = 0 }) {
    const p = this.player;
    let n = 0;
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      if (arc < 6.2 && Math.abs(angleDiff(p.yaw, yawTo(dx, dz))) > arc / 2 && d > e.radius + 0.5) continue;
      this.damageEnemy(e, p.rollDamage(mult, false, critBonus), p.pos, knock, eff);
      n++;
    }
    if (n) {
      this.hitstop = 0.05;
      this.shake(0.1);
    }
    return n;
  }

  // Everything within radius of a spot (leaps, novas, charges): spell: scaled by Spell Power.
  areaHit({ at, radius, mult, knock = 0.4, eff = null, spell = false }) {
    const p = this.player, from = at.clone();
    let n = 0;
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'spawn' || Math.hypot(e.pos.x - at.x, e.pos.z - at.z) > radius + e.radius) continue;
      this.damageEnemy(e, p.rollDamage(mult, spell), from, knock, eff);
      n++;
    }
    return n;
  }

  // A skill that only stuns or taunts (no damage): shown now, and the world applies it.
  affectEnemy(e, eff) {
    if (!e.alive) return;
    this.link.hit(e, 0, false, 0, this.player.pos, eff);
    e.applyStatus(eff);
  }

  // Our hit lands: shown now, and sent to the world, which keeps the monster's score (eff: see link.hit).
  damageEnemy(e, { amount, crit }, fromPos, knock = 0.4, eff = null) {
    if (!e.alive) return;
    this.link.hit(e, amount, crit, knock, fromPos, eff);
    if (eff) e.applyStatus(eff);
    e.hurt(amount);
    const c = e.center;
    const top = new THREE.Vector3(e.pos.x, e.pos.y + e.height + 0.1, e.pos.z);
    this.ui.floater(top, String(amount), crit ? 'crit' : '');
    this.fx.sparks(c, crit ? 0xffe070 : 0xfff0c0, crit ? 22 : 10, crit ? 7 : 5);
    if (e.slime) this.fx.goo(c, e.def.color, 6);
    this.sfx.play(crit ? 'crit' : 'hit');
  }

  // The world says a monster we hit has fallen: everyone who helped gets this — XP, quest progress and
  // their own loot (nobody else sees it).
  rewardKill({ type, level, def: d, pos, height }) {
    const p = this.player;
    const levelGap = p.level - level;
    const xp = Math.max(1, Math.round(monsterXp(d, level) * clamp(1 - (levelGap - 2) * 0.2, 0.2, 1.2)));
    p.gainXp(xp);
    this.ui.floater(new THREE.Vector3(pos.x, pos.y + height + 0.6, pos.z), `+${xp} XP`, 'xp');
    this.quests.onEvent('kill', { type });
    const at = pos.clone();
    if (chance(0.75)) this.loot.dropGold(Math.round(randInt(d.gold[0], d.gold[1]) * (1 + 0.2 * (level - 1))), at);
    if (chance(d.boss ? 1 : 0.07)) this.loot.dropPotion(at);
    if (d.boss) {
      this.loot.dropItem(randomItem(level + 1, { boost: 3, minRarity: 'rare' }), at);
      this.loot.dropItem(randomItem(level, { boost: 2, minRarity: 'magic' }), at);
      this.loot.dropPotion(at);
      this.ui.log(`<b>${d.name}</b> has been slain!`, 'lvl');
      this.shake(0.5 * this.volAt(at));
    } else if (chance(d.drop)) {
      this.loot.dropItem(randomItem(level, { boost: level * 0.1, table: d.loot }), at);
    }
  }

  damagePlayer(amount, src) {
    const p = this.player;
    if (!p.alive) return;
    if (p.stats.evade && Math.random() < p.stats.evade) { // in the smoke: it misses
      this.ui.floater(p.headPos(), 'Dodged', 'info small');
      return;
    }
    const dmg = Math.max(1, Math.round(amount * (1 - p.stats.dr) * rand(0.9, 1.1)));
    p.hp -= dmg;
    this.ui.floater(p.headPos(), String(dmg), 'hurt');
    p.h.hitFlash(0xff2a1a, 0.9);
    if (this.time - (this.hurtSent || -1) > 0.25) { this.hurtSent = this.time; this.link.act({ k: 'hu' }); } // the others see it flinch
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
    this.quests.onEvent('gold', { amount: n });
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
  // Saves go to the game server (at most every 1.5 s; `now` sends straight away), or to this browser
  // when playing offline.
  save(now = false) {
    if (!this.player || !this.character) return;
    this.saveDirty = true;
    if (now) this.flushSave();
    else if (!this.saveTimer) this.saveTimer = setTimeout(() => this.flushSave(), 1500);
  }

  flushSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.saveDirty || !this.character) return;
    this.saveDirty = false;
    const data = this.player.serialize();
    if (this.character.id === 'local') {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
    } else {
      this.net?.send('save', { save: data });
    }
  }

  // Save now and wait until the server has it (before a reload).
  async saveAndWait() {
    if (!this.player || !this.character) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saveDirty = false;
    const data = this.player.serialize();
    if (this.character.id === 'local') {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
    } else if (this.net?.online) {
      await this.net.request('save', { save: data }, 4000);
    }
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
    if (this.onTitle) return; // the title screen covers everything
    if (this.paused && this.offline) { // settings open: hold still, but keep the camera (zoom slider) and picture alive
      this.updateCamera(rawDt);
      this.composer.render();
      return;
    }
    rawDt *= this.timeScale ?? 1;
    this.net?.update?.(rawDt); // offline: the world moves on right here
    this.link.update(rawDt); // what the world said (a moment ago) happens now; we report back
    let dt = rawDt;
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt *= 0.15;
    }
    this.time += dt;
    worldUniforms.uTime.value = this.time;

    this.updateAim();
    this.player.update(dt);
    this.town.update(dt);
    this.places.update(dt);
    this.enemies.update(dt);
    this.others.update(dt);
    this.projectiles.update(dt);
    this.loot.update(dt);

    const pp = this.player.pos, map = this.places.map;
    const zone = zoneAt(pp.x, pp.z);
    if (zone !== this.currentZone) {
      if (zone) this.ui.zoneToast(zone);
      else if (this.currentZone === undefined) this.ui.zoneToast({ name: map.name, sub: map.sub }); // (just arrived)
      this.currentZone = zone;
      this.ui.el.zoneName.textContent = zone ? zone.name : map.id === 'emberwood' ? 'The Wilds' : map.name;
    }
    this.ui.setBoss(this.enemies.boss);
    this.updateSound(rawDt, zone);

    this.fx.update(dt);
    this.updateCamera(rawDt);
    this.ui.update(rawDt);
    this.doll.update(rawDt);
    this.composer.render();
  }

  // Music follows where you are (and boss fights); ambience follows what's around you.
  updateSound(dt, zone) {
    const sfx = this.sfx, map = this.places.map, inside = map.kind === 'dungeon';
    if (!sfx.music) return;
    sfx.music.play(this.enemies.boss ? 'boss' : map.music || 'world');
    const p = this.player.pos;
    let fire = Infinity;
    for (const f of this.places.view.fires) fire = Math.min(fire, f.pos.distanceTo(p));
    const pond = map.id === 'emberwood' ? Math.hypot(p.x - POND.x, p.z - POND.z) : Infinity;
    sfx.ambience.update(dt, { inside, zone: zone?.id, fire, pond, land: map.kind === 'outdoor' ? map.id : null });
    if (inside !== this.soundInside) { // the crypt echoes
      this.soundInside = inside;
      sfx.setReverb('ambience', inside ? 0.45 : 0.06);
    }
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

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
import { ITEMS, rollDrop, rollPotion, rollUnique, rollRare, makeItem, itemName, itemColor, tierAt } from './items.js';
import { CAVES, CAVE_LANDS, KEY_RANGE, KEY_CHANCE, caveLandFor, caveRules, dayNumber, untilTomorrow } from './caves.js';
import { monsterXp } from './monsters.js';
import { Input } from './input.js';
import { Npcs } from './npcs.js';
import { Bank } from './bank.js';
import { Quests } from './quests.js';
import { BUFFS, ALLY_BUFF_RANGE } from './skills.js';
import { Places } from './places.js';
import { WorldLink } from './link.js';
import { RemotePlayers } from './others.js';
import { Chat } from './chat.js';
import { Party, MAX_PARTY } from './party.js';
import { Trade } from './trade.js';
import { CLASSES } from './classes.js';
import { loadSettings, saveSettings } from './settings.js';
import { angleDiff, yawTo, randInt, rand, chance, clamp } from './util.js';

const SAVE_KEY = 'emberwood-save-v1'; // the local save (offline play: ?autostart)
const CAVE_OPEN_FOR = 45 * 60000; // ms a party's open cave shows its mouth to the members (the server decides)
const RARE_CHANCE = 0.001; // a Death Canyon monster's chance of a rare item with each kill (and, apart, of a rare recipe)
const escHtml = (t) => String(t).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
// Graphics, from Settings: how many of the screen's pixels to draw (a multiple of its size, never more than it
// has), smoothed edges (MSAA samples), the sun's shadow map (0: no shadows; phones get half, at least 1024) and
// soft shadow edges, and the glow (its size, a share of the screen's; 0: none).
const QUALITY = {
  low: { ratio: 1, msaa: 0, shadow: 0, glow: 0 },
  mid: { ratio: 1.25, msaa: 2, shadow: 1024, glow: 0.35 },
  high: { ratio: 1.5, msaa: 2, shadow: 2048, glow: 0.5 },
  ultra: { ratio: 2, msaa: 4, shadow: 4096, glow: 1, soft: true },
};

// A monster with armor (the world bosses) takes less of poison and burning on it too.
const throughArmor = (e, eff) => (e.def.armor && eff?.dot ? { ...eff, dot: [eff.dot[0] * (1 - e.def.armor), eff.dot[1], eff.dot[2]] } : eff);
const ITEM_DROP = 0.2; // a monster's chance of an item is this share of its drop value (a slime ~2%, a knight ~7%)

export class Game {
  constructor() {
    const container = document.getElementById('game');
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    // phones and tablets: fewer pixels, smaller shadow map, less grass
    this.lowSpec = window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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

    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.55, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.settings = loadSettings();
    // smooth play without burning the battery: at most the chosen frame rate (a 120 Hz screen would draw
    // twice as many frames for nothing), and fewer pixels for a while when frames come late (keepSmooth)
    this.frameGap = 1000 / (this.settings.fps || 60);
    this.smooth = { scale: 1, at: 0, frames: 0, calm: 0, tried: null, stuckUntil: 0 };

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
    // (a phone reports its new size a little after it turns, and the page's own box says it best)
    window.addEventListener('orientationchange', () => { for (const ms of [80, 350, 900]) setTimeout(() => this.onResize(), ms); });
    if (window.ResizeObserver) new ResizeObserver(() => this.onResize()).observe(container);
    // app in the background: save, and let the music and ambience rest
    document.addEventListener('visibilitychange', () => {
      this.smooth.frames = 0; // (frames stop while away: no judging the picture by that)
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
    else if (key === 'quality') { Object.assign(this.smooth, { scale: 1, tried: null, stuckUntil: 0 }); this.applyQuality(value); }
    else if (key === 'fps') { this.frameGap = 1000 / value; this.smooth.frames = 0; }
    else if (key === 'zoom') this.zoomTarget = value;
  }

  // The graphics setting (QUALITY), with fewer pixels while frames come late (smooth.scale, keepSmooth).
  applyQuality(q = this.settings.quality) {
    const Q = QUALITY[q] || QUALITY.high;
    const best = Math.min(window.devicePixelRatio, Q.ratio);
    const ratio = Math.min(best, Math.max(0.75, Math.round(best * this.smooth.scale * 100) / 100));
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== Q.msaa) { rt.samples = Q.msaa; rt.dispose(); }
    }
    const shadow = Q.shadow && (this.lowSpec ? Math.max(1024, Q.shadow / 2) : Q.shadow);
    this.sun.castShadow = shadow > 0;
    if (shadow && this.sun.shadow.mapSize.x !== shadow) {
      this.sun.shadow.mapSize.setScalar(shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null; // (made again at the new size)
    }
    const type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== type) {
      this.renderer.shadowMap.type = type;
      this.scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
    }
    this.glow = Q.glow;
    this.bloom.enabled = Q.glow > 0;
    this.onResize(true);
  }

  // Frames coming late for a few seconds (an old phone, a busy moment): draw fewer pixels, but only as long as
  // that helps: a phone saving power (or a slow script) holds the frame rate down whatever the picture, and
  // then it goes back to sharp and leaves it a while. On time for half a minute: a little more again.
  keepSmooth(now) {
    const sm = this.smooth;
    if (!sm.frames++) { sm.at = now; return; }
    const secs = (now - sm.at) / 1000;
    if (secs < 3) return;
    const fps = (sm.frames - 1) / secs, want = this.settings.fps || 60;
    sm.frames = 0;
    if (secs > 6) return; // (the app was away: that says nothing about the picture)
    if (sm.tried) { // the last step down: did it help?
      if (fps < sm.tried.fps * 1.08) { sm.scale = sm.tried.scale; sm.stuckUntil = now + 600000; this.applyQuality(); }
      sm.tried = null;
      return;
    }
    if (fps < want * 0.8 && sm.scale > 0.6 && now > (sm.stuckUntil || 0)) {
      sm.tried = { scale: sm.scale, fps };
      sm.scale = Math.max(0.6, sm.scale - 0.15);
      sm.calm = 0;
      this.applyQuality();
    } else if (fps > want * 0.95 && sm.scale < 1 && (sm.calm += secs) >= 30) {
      sm.scale = Math.min(1, sm.scale + 0.1);
      sm.calm = 0;
      this.applyQuality();
    }
  }

  // The hero to play: { id, name, cls, look, save, bank, rev } from the server (or the local one when offline).
  setCharacter(char) {
    this.character = { id: char.id, name: char.name, cls: char.cls, look: char.look || 0 };
    this.lastCharId = char.id;
    this.rev = char.rev || 0; // (saves older than a trade are refused: see server)
    this.caveOpen = null; // a cave open to our hero: { land, until, mine } (see caveFound)
    const p = this.player;
    p.setClass(char.cls, char.look || 0);
    p.reset();
    if (char.save) p.load(char.save); else p.starterKit();
    p.cave.day = Math.max(p.cave.day, char.caveDay || 0); // (the server keeps the day of the last cave run)
    if (char.id === 'local') this.bank.loadLocal(); else this.bank.load(char.bank);
    // nothing of the previous hero's world stays behind: a hero starts in Emberwood's camp
    this.places.enter('emberwood');
    this.loot.clear();
    this.projectiles.clear();
    this.tickers = [];
    this.npcs.buyback = [];
    this.worldBoss = null;
    p.alive = true;
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    p.pos.set(0, heightAt(0, 3.5), 3.5);
    p.yaw = p.targetYaw = Math.PI;
    p.group.rotation.y = p.yaw;
    this.camFocus.copy(p.pos);
    this.ui.showDeath(false);
    this.party.reset(); // (the server tells us if this hero is in one)
    this.quests.ensure();
    this.ui.setCharacter(char);
    if (p.migrated !== undefined) { // a hero from before the four classes
      setTimeout(() => this.ui.prompt(`<b>Emberwood has changed!</b><br>You are a <b>${CLASSES[p.cls].name}</b> now. Every item has a fixed name and strength, so ${p.migrated ? 'your old items were sold for you (your gold went up) and ' : ''}you have your class's gear for your level. You have <b>${p.freePoints}</b> skill points to spend.`, [
        ['Open skills', () => this.ui.skills.open(), 'go'], ['Later', () => {}],
      ], 60000), 1500);
      delete p.migrated;
      this.save();
    }
    if (p.newAttrs) { // a hero from before attributes (or from the four of the first days): every point is free
      const prim = { str: 'Strength', agi: 'Agility', int: 'Intelligence' }[CLASSES[p.cls].primary];
      setTimeout(() => this.ui.prompt(`<b>Attributes${p.newAttrs === 'changed' ? ' have changed' : ' are here'}!</b><br>Strength (Life), Agility (attack speed, armor) and Intelligence (spells, healing, Mana), as in Dota 2. Your class's primary attribute, <b>${prim}</b>, powers your weapon too. 5 points a level, and your gear gives more. You have <b>${p.freeAttr}</b> points to spend.`, [
        ['Spend them the usual way', () => { p.suggestAttrs(); this.ui.centerMsg(`Spent the ${CLASSES[p.cls].name}'s way: change it any time in your character window`); }, 'go'],
        ['Choose myself', () => this.ui.openInventory('character')], ['Later', () => {}],
      ], 120000), 1800);
      delete p.newAttrs;
    }
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
    this.party.reset();
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
    this.party = new Party(this);
    this.trade = new Trade(this);

    this.bank = new Bank(this); // the account's shared bank
    this.quests = new Quests(this); // every land's quests (the state lives on the hero)
    this.player.starterKit();
    this.player.pos.set(0, heightAt(0, 3.5), 3.5);
    this.camFocus.copy(this.player.pos);
    this.npcs = new Npcs(this); // merchants, bankers, the boards and the anvil in every land's camp
    this.tickers = []; // things that run a while every frame (burning ground, arrow rain…): fn(dt) → keep going?

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
    this.ui.log('Welcome to <b>Emberwood</b>. The notice board in camp has quests; the merchants, the banker and Brom\'s anvil are around the fire.');
    this.ui.log(this.input.touchMode
      ? 'Left thumb moves · tap a foe to target it · tap the sword to attack (again as each blow lands: combo) · Skills: your points'
      : 'Click to move and attack · Z nearest foe · R attack (press as each blow lands: combo) · 1–8 skills · K skill points · T auto');
    this.last = performance.now();
    this.ui.zoneToast({ name: 'Emberwood', sub: 'A tiny action RPG' });
    this.ui.refreshTracker();
    setInterval(() => this.save(), 10000);
    let tick = this.last, owed = 0;
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      // at most the chosen frame rate, whatever the screen's: time is counted up and a frame drawn per
      // frameGap of it (so a 144 Hz screen still gets 60, not every third frame)
      owed += now - tick;
      tick = now;
      if (owed < this.frameGap - 1) return;
      owed = Math.min(owed - this.frameGap, this.frameGap);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      if (!this.onTitle) this.keepSmooth(now);
    };
    loop();
    this.tickInBackground();
  }

  // Hunting on its own (auto) while the game is in another tab or hidden, if Settings say so: the browser
  // stops a hidden page's frames and slows its timers, so a little worker ticks ten times a second instead
  // and the game moves on without drawing. Not hunting, the hero waits, and monsters leave it alone (link.js).
  huntsInBackground() {
    return this.settings.background !== 'pause' && !!this.player?.control?.auto && this.player.alive;
  }

  tickInBackground() {
    let worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 100);'], { type: 'text/javascript' })));
    } catch { return; } // (no workers: it waits, as it did)
    let last = performance.now();
    worker.onmessage = () => {
      const now = performance.now();
      let left = Math.min(2, (now - last) / 1000); // (ticks that came late are caught up, within reason)
      last = now;
      if (!document.hidden || !this.started || this.onTitle || !this.huntsInBackground()) return;
      while (left > 0.001) {
        const dt = Math.min(0.1, left);
        this.frame(dt, false);
        left -= dt;
      }
      this.last = now; // (the drawn frames go on from here when it's back on screen)
    };
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const input = this.input;
    input.onKey = (code, e) => {
      if (!this.started || this.onTitle) return;
      if (e.repeat && code !== 'KeyR') return;
      if (this.paused && code !== 'Escape' && code !== 'KeyM') return; // settings open: keys go there
      const p = this.player;
      switch (code) {
        case 'Enter': case 'NumpadEnter': this.chat.open(); e.preventDefault(); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8':
          p.useSkill(Number(code.slice(-1)) - 1);
          break;
        case 'KeyR': if (e.repeat) p.control.holdAttack(true); else p.control.pressAttack(); break;
        case 'KeyZ': p.control.cycleTarget(); break;
        case 'KeyT': p.control.toggleAuto(); break;
        case 'KeyQ': p.drink('hp'); break;
        case 'KeyX': p.drink('mp'); break;
        case 'KeyK': this.ui.skills.toggle(); break;
        case 'KeyI': case 'KeyB': case 'Tab': this.ui.toggleInventory(); e.preventDefault(); break;
        case 'KeyH': this.ui.togglePanel('help'); break;
        case 'KeyF': this.ui.toggleFullscreen(); break;
        case 'KeyE': this.interact(); break;
        case 'KeyM': this.ui.toggleSound(); break;
        case 'Escape': this.ui.escape(); break;
        default: break;
      }
    };
    input.onKeyUp = (code) => { if (code === 'KeyR') this.player.control.holdAttack(false); };
    this.bindPointer();
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

  // The mouse and fingers on the world. Mouse: a click on a monster targets it and attacks (held: keeps
  // attacking), on a hero targets them, on the ground walks there (held: keeps walking toward the cursor);
  // a right-click on a hero opens what you can do with them. Touch: a tap on a monster or hero targets it (a
  // hero's menu opens), elsewhere does nothing (the joystick moves).
  bindPointer() {
    const canvas = this.renderer.domElement, input = this.input;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.started || this.onTitle || this.paused || this.chat.isOpen) return;
      const ctl = this.player.control;
      if (e.pointerType !== 'mouse') { this.tapAt = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
      this.updateAim(true);
      const hit = this.hover;
      if (e.button === 2) {
        if (hit?.isHero) this.playerMenu(hit, e.clientX, e.clientY);
        else if (hit) ctl.clickEntity(hit);
        return;
      }
      if (e.button !== 0) return;
      if (hit) { ctl.clickEntity(hit, true); this.holdingFoe = !!ctl.isFoe(hit); }
      else { ctl.clickGround(this.aimPoint); this.walkHold = true; }
    });
    const up = (e) => {
      if (e.pointerType !== 'mouse') {
        const t = this.tapAt;
        this.tapAt = null;
        if (t && performance.now() - t.t < 400 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 14) this.tap(e.clientX, e.clientY);
        return;
      }
      if (e.button !== 0) return;
      this.walkHold = false;
      if (this.holdingFoe) { this.holdingFoe = false; this.player.control.holdAttack(false); }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', () => { this.walkHold = false; this.holdingFoe = false; this.player.control.holdAttack(false); });
    void input;
  }

  // A tap on the world (touch screens): target what's under the finger.
  tap(x, y) {
    const ctl = this.player.control, e = this.pick(x, y);
    if (!e) return;
    if (e.isHero) { ctl.setTarget(e); this.playerMenu(e, x, y); }
    else ctl.clickEntity(e);
  }

  // The monster or hero under a point on the screen (or the mouse).
  pick(x, y) {
    const v = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    return this.under(this.raycaster.ray, this.input.touchMode ? 1.4 : 1);
  }

  under(ray, slack = 1) {
    let best = null, bestT = Infinity;
    for (const e of [...this.enemies.list, ...this.others.list]) {
      if (e.isHero ? false : !e.alive || e.state === 'spawn') continue;
      const c = e.center;
      const r = Math.max(0.75, e.height * 0.45) * slack;
      if (ray.distanceSqToPoint(c) < r * r) {
        const t = ray.origin.distanceTo(c);
        if (t < bestT) { bestT = t; best = e; }
      }
    }
    return best;
  }

  // E / the action button: whatever is in reach (people in camp, waystones, dungeon doors and stairs, chests)
  interact() {
    if (this.npcs.near) this.npcs.interact();
    else this.places.interact();
  }

  // A camp scroll was read: to the camp of this land (from a dungeon, of the land above it).
  async toCamp() {
    const to = this.places.map.respawn;
    if (!to || this.places.map.kind === 'arena') return;
    await this.travel(to.map, { camp: true });
  }

  // To another place (maps.js) behind a quick fade: through a waystone, a dungeon's door or its stairs, or
  // (respawn) from where we fell to where heroes rise. The world decides; we draw the place first.
  async travel(to, { respawn = false, camp = false, summon = null } = {}) {
    const map = MAPS[to], ui = this.ui, p = this.player;
    if (this.traveling || !map || (!respawn && !p.alive)) return false;
    if (!respawn && !summon && p.level < map.minLevel) { ui.centerMsg(`${map.name} is for heroes of level ${map.minLevel} and up`); return false; }
    this.traveling = true;
    ui.closeInventory();
    this.places.closeTravel();
    p.control.stopAuto(true);
    const from = this.places.map;
    ui.fade(true, respawn ? 'You come round…' : camp ? 'Back to camp…' : summon ? 'Through the door in space…' : map.kind === 'dungeon' ? `Descending into ${map.name}…`
      : from.kind === 'dungeon' ? 'Climbing back up…' : `Traveling to ${map.name}…`);
    if (!respawn) this.sfx.play('portal');
    let r;
    try {
      await Promise.all([this.places.load(to), new Promise((res) => setTimeout(res, 420))]);
      r = await this.link.travel(to, { respawn, camp, summon });
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
    this.quests.onEvent('visit', { map: r.map });
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

  // "Wake up": where heroes who faint here wake (the camp, or outside the dungeon), full of life.
  async rise() {
    const p = this.player, to = this.places.map.respawn;
    if (!(await this.travel(to.map, { respawn: true }))) {
      if (to.map !== this.places.id) return; // (can't reach the world: stay down and try again)
      p.pos.set(to.x, heightAt(to.x, to.z), to.z); // the same place: wake here anyway
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
    for (const o of this.others.list) o.hover = false;
    for (const e of this.enemies.list) e.hover = false;
    const best = this.under(ray);
    this.hover = best;
    if (best) best.hover = true;
    this.renderer.domElement.style.cursor = best ? (best.isHero && !best.hostile ? 'pointer' : 'crosshair') : 'default';
    // the left button held on the ground: keep walking toward the cursor
    if (this.walkHold && this.input.mouseDown && this.player.alive) {
      const c = this.player.control;
      if (!c.moveTo) c.moveTo = this.aimPoint.clone(); else c.moveTo.copy(this.aimPoint);
    }
  }

  // Resolve where an attack should go: hovered enemy, else nearest enemy roughly toward the cursor.
  // On touch screens: the closest enemy in reach (favouring the one you face), else straight ahead.
  aim(assist) {
    const p = this.player.pos;
    if (this.input.touchMode) return this.autoAim(assist + 1.5);
    if (this.hover && this.hover.alive) return { target: this.hover, point: this.hover.pos.clone() };
    const dirYaw = yawTo(this.aimPoint.x - p.x, this.aimPoint.z - p.z);
    let best = null, bd = Infinity;
    for (const e of this.foes) {
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
    for (const e of this.foes) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz) - e.radius;
      if (d > range) continue;
      const score = d + Math.abs(angleDiff(facing, yawTo(dx, dz))) * 1.5;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) return { target: best, point: best.pos.clone() };
    return { target: null, point: new THREE.Vector3(p.x + Math.sin(facing) * 4, p.y, p.z + Math.cos(facing) * 4) };
  }

  // Another hero, right-clicked (or their name clicked, or tapped): target them, invite them, trade with them.
  playerMenu(rp, x = null, y = null) {
    const party = this.party, esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const actions = [['Target', () => this.player.control.setTarget(rp)]];
    if (!party.has(rp.id) && party.leading && party.members.length < MAX_PARTY && !this.offline) actions.push(['Invite to party', () => party.invite(rp.name)]);
    if (!this.offline && !rp.hostile) actions.push(['Trade', () => this.trade?.request(rp)]);
    const note = party.has(rp.id) ? ' · in your party' : rp.hostile ? ' · your foe here' : '';
    const html = `<div class="tt-name">${esc(rp.name)}</div><div class="tt-type">Level ${rp.level} ${CLASSES[rp.cls].name}${note}</div>`;
    if (x !== null) this.ui.openMenuAt(x, y, html, actions);
    else this.ui.openMenu(rp.plate.el, html, actions);
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
  // Our hero's blow: everything within range in an arc in front. eff: stun / slow / taunt / dot / weak / vuln
  // (see link.hit); critBonus: extra chance of a critical hit; target: always counts (if in reach).
  meleeHit({ range, arc, mult, knock, eff = null, critBonus = 0, target = null, spell = false }) {
    const p = this.player;
    let n = 0;
    for (const e of this.foes) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > range + e.radius + (e === target ? 0.35 : 0)) continue; // (the foe aimed at: a little leeway)
      if (e !== target && arc < 6.2 && Math.abs(angleDiff(p.yaw, yawTo(dx, dz))) > arc / 2 && d > e.radius + 0.5) continue;
      this.damageEnemy(e, p.rollDamage(mult, spell, critBonus), p.pos, knock, eff);
      n++;
    }
    if (n) {
      this.hitstop = 0.05;
      this.shake(0.1);
    }
    return n;
  }

  // Everything within radius of a spot (leaps, novas, rains of arrows): spell: spell damage (Intelligence);
  // quiet: no hitstop (things that tick, like burning ground).
  areaHit({ at, radius, mult, knock = 0.4, eff = null, spell = false, critBonus = 0, quiet = false }) {
    const p = this.player, from = at.clone();
    let n = 0;
    for (const e of this.foes) {
      if (!e.alive || e.state === 'spawn' || Math.hypot(e.pos.x - at.x, e.pos.z - at.z) > radius + e.radius) continue;
      this.damageEnemy(e, p.rollDamage(mult, spell, critBonus), from, knock, eff, quiet);
      n++;
    }
    return n;
  }

  // One blow at one foe (a targeted skill), if it's still within reach (reach: m beyond its radius; none for
  // spells that need no reach). Returns the damage it did (0 if it couldn't).
  strike(e, mult, { spell = false, critBonus = 0, knock = 0.4, eff = null, reach = null } = {}) {
    const p = this.player;
    if (!e?.alive) return 0;
    if (reach !== null && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) > reach + e.radius + p.stats.reach + 0.6) return 0;
    const roll = p.rollDamage(mult, spell, critBonus);
    return this.damageEnemy(e, roll, p.pos, knock, eff);
  }

  // What our attacks can hit: the monsters, and in the arena's pit the heroes there who aren't in our party.
  get foes() {
    if (!this.pvp) return this.enemies.list;
    return [...this.enemies.list, ...this.others.list.filter((o) => o.hostile)];
  }

  // Foes (or only monsters) within r of a spot.
  foesNear(at, r) {
    return this.foes.filter((e) => e.alive && e.state !== 'spawn' && Math.hypot(e.pos.x - at.x, e.pos.z - at.z) < r + e.radius);
  }

  monstersNear(at, r) {
    return this.enemies.list.filter((e) => e.alive && e.state !== 'spawn' && Math.hypot(e.pos.x - at.x, e.pos.z - at.z) < r + e.radius);
  }

  // Friendly heroes within r of a spot: ourselves and the others who aren't our foes (for skills cast by
  // another hero, as they'd see it: everyone near who isn't hostile to us).
  alliesNear(at, r, caster = this.player) {
    const near = (o) => Math.hypot(o.pos.x - at.x, o.pos.z - at.z) <= r;
    const list = [];
    if (this.player.alive && near(this.player) && (caster === this.player || !caster.hostile)) list.push(this.player);
    for (const o of this.others.list) if (o.alive && !o.away && near(o) && !(caster === this.player && o.hostile) && o !== caster) list.push(o);
    if (caster !== this.player && caster.alive && near(caster) && !list.includes(caster)) list.push(caster);
    return list;
  }

  // Poison or burning for a share of an average blow a second (our hero's numbers): [dps, seconds, kind].
  dot(mult, secs, kind = 'poison') {
    return [this.player.dotDps(mult), secs, kind];
  }

  // A skill that only stuns, slows, taunts, poisons, weakens or exposes: shown now, and the world applies it.
  affectEnemy(e, eff) {
    if (!e.alive) return;
    if (e.isHero) { if (eff.stun || eff.slow || eff.dot) this.link.hitHero(e, eff.dot ? 1 : 0, false, eff); return; }
    eff = throughArmor(e, eff);
    this.link.hit(e, 0, false, 0, this.player.pos, eff);
    e.applyStatus(eff);
  }

  // Our hit lands: shown now, and sent to the world, which keeps the monster's score (eff: see link.hit).
  // A foe that's exposed (a plague) takes more. On another hero (the arena), the world works out what it
  // really does against their armor and tells everyone, us too (heroHit shows that number).
  damageEnemy(e, { amount, crit }, fromPos, knock = 0.4, eff = null, quiet = false) {
    if (!e.alive) return 0;
    if (e.isHero) {
      this.link.hitHero(e, amount, crit, eff);
      e.hurt();
      this.fx.sparks(e.center, crit ? 0xffe070 : 0xfff0c0, crit ? 22 : 10, crit ? 7 : 5);
      this.sfx.play(crit ? 'crit' : 'hit');
      return amount;
    }
    if (e.def.armor) amount = Math.max(1, Math.round(amount * (1 - e.def.armor)));
    if (e.vulnT > 0) amount = Math.round(amount * (1 + (e.vulnBy || 0.2)));
    eff = throughArmor(e, eff);
    this.link.hit(e, amount, crit, knock, fromPos, eff);
    if (eff) e.applyStatus(eff);
    e.hurt(amount);
    const c = e.center;
    const top = new THREE.Vector3(e.pos.x, e.pos.y + e.height + 0.1, e.pos.z);
    this.ui.floater(top, String(amount), crit ? 'crit' : quiet ? 'small' : '');
    if (!quiet || crit) this.fx.sparks(c, crit ? 0xffe070 : 0xfff0c0, crit ? 22 : 10, crit ? 7 : 5);
    if (e.slime && !quiet) this.fx.goo(c, e.def.color, 6);
    if (!quiet || Math.random() < 0.3) this.sfx.play(crit ? 'crit' : 'hit', quiet ? 0.5 : 1);
    return amount;
  }

  // ---------------------------------------------------------------- helping other heroes
  // A heal on a friendly hero (us, or another: their game heals them): a share of their maximum Life, more
  // with the healer's healing (the Restoration tree, Intelligence).
  healAlly(who, share, quiet = false) {
    const p = this.player, amount = share * p.stats.heal;
    if (who === p) { p.heal(Math.round(p.stats.maxHp * amount), quiet); return; }
    if (!who.isHero || who.hostile || !who.alive) return;
    this.link.help(who, 'heal', Math.round(amount * 1000) / 1000);
    if (!quiet) this.fx.heal(who.pos);
  }

  // A buff on a friendly hero (us, or another: their game takes it).
  buffAlly(who, id, v) {
    const p = this.player;
    if (BUFFS[id]?.ally && id !== 'swiftness' && id !== 'shadow_mantle' && id !== 'sanctuary' && id !== 'divine_shield') v *= 1 + (p.stats.heal - 1) * 0.5;
    if (who === p) { p.addBuff(id, v); return; }
    if (!who.isHero || who.hostile) return;
    this.link.help(who, 'buff', [id, Math.round(v * 1000) / 1000]);
  }

  reviveAlly(who, share) {
    if (!who.isHero || who.hostile || who.alive) return;
    this.link.help(who, 'rez', Math.round(share * 100) / 100);
  }

  // A party member's scientist opened a door through space: { from, map }. Step through?
  recalled(m) {
    const map = MAPS[m.map];
    if (!map) return;
    this.ui.prompt(`<b>${String(m.from).replace(/[&<>"']/g, '')}</b> opened a door through space${map ? ` in <b>${map.name}</b>` : ''}. Step through to their side?`, [
      ['Step through', () => this.travel(map.id, { summon: true }), 'go'],
      ['Stay', () => {}],
    ], 28000);
  }

  // A scientist opened a door through space: the server asks every party member to step through.
  partyRecall() {
    if (this.offline) { this.ui.centerMsg('Teleport Party needs other heroes: play online'); return; }
    if (!this.party.id) { this.ui.centerMsg('You are not in a party'); return; }
    this.net.request('recall').then((r) => this.ui.log(`The door is open: ${r.n} party member${r.n === 1 ? '' : 's'} may step through.`, 'xp')).catch((err) => this.ui.centerMsg(err.message));
  }

  // Another hero helped ours (the world passes it on): [B, us, kind, value, by]. Their game worked out the
  // value; we keep it within reason.
  helped([, , kind, value, by]) {
    const p = this.player, o = this.others.byId.get(by), name = o ? o.name : 'A friend';
    if (kind === 'heal' && p.alive) {
      const share = Math.min(1, Math.max(0, Number(value) || 0));
      p.heal(Math.round(p.stats.maxHp * share));
    } else if (kind === 'buff' && Array.isArray(value) && p.alive) {
      const [id, v] = value, range = ALLY_BUFF_RANGE[id];
      if (!range || !BUFFS[id]) return;
      const strength = Math.min(range[1], Math.max(range[0], Number(v) || 0));
      p.addBuff(id, strength);
      this.fx.heal(p.pos);
      if (BUFFS[id].long) this.ui.log(`${name} gave you <b>${BUFFS[id].name}</b>.`, 'xp');
    } else if (kind === 'rez' && !p.alive) {
      const share = Math.min(0.8, Math.max(0.1, Number(value) || 0.4));
      this.ui.log(`${name} brought you round!`, 'lvl');
      p.revive(share);
      this.fx.heal(p.pos);
    }
  }

  // The world says a monster has fallen and we get a share (sim/world.js credits): XP (share: of the
  // whole), quest progress, and, if it's our turn (loot), the loot, which only we see.
  rewardKill({ type, level, def: d, pos, height, share = 1, loot = true }) {
    const p = this.player;
    const levelGap = p.level - level;
    const xp = Math.max(1, Math.round(monsterXp(d, level) * clamp(1 - (levelGap - 2) * 0.2, 0.2, 1.2) * share));
    p.gainXp(xp);
    this.ui.floater(new THREE.Vector3(pos.x, pos.y + height + 0.6, pos.z), `+${xp} XP`, 'xp');
    this.quests.onEvent('kill', { type, pos: new THREE.Vector3(pos.x, pos.y + height + 1.2, pos.z) });
    this.rollKey(pos);
    if (!loot) return;
    const at = pos.clone();
    const gold = () => Math.round(randInt(d.gold[0], d.gold[1]) * (1 + 0.2 * (level - 1)));
    const recipe = () => makeItem(`recipe_${tierAt(level)}`);
    if (chance(0.75)) this.loot.dropGold(gold(), at);
    if (!d.boss && chance(0.05)) this.loot.dropItem(rollPotion(level), at);
    if (d.canyon) { // the Death Canyon's monsters: now and then a rare item, or a rare recipe (only they carry them)
      if (chance(d.rare ?? RARE_CHANCE)) {
        const r = rollRare(p.cls);
        this.loot.dropItem(r, at);
        this.ui.log(`<b style="color:${itemColor(r)}">${itemName(r)}</b>! A rare item drops.`, 'lvl');
        this.ui.centerMsg(`A rare item: ${itemName(r)}!`);
      }
      if (chance(d.rare ?? RARE_CHANCE)) {
        this.loot.dropItem(makeItem('recipe_rare'), at);
        this.ui.log(`<b style="color:#e05cff">A Rare Upgrade Recipe</b> drops!`, 'lvl');
      }
    }
    if (d.worldBoss) { // the roaming ones: a unique one time in five, and one thing more
      for (let i = 0; i < 4; i++) this.loot.dropGold(gold(), at);
      if (chance(0.2)) {
        const u = rollUnique(d.worldBoss);
        this.loot.dropItem(u, at);
        this.ui.log(`<b style="color:${itemColor(u)}">${itemName(u)}</b>! A unique item drops.`, 'lvl');
      }
      const it = chance(0.5) ? makeItem(`recipe_${d.worldBoss}`) : rollDrop(level, p.cls);
      if (it) this.loot.dropItem(it, at);
      this.ui.log(`<b>${d.name}</b> has been slain!`, 'lvl');
      this.shake(0.6 * this.volAt(at));
    } else if (d.boss) { // one thing, now and then a recipe too
      const it = rollDrop(level + 1, p.cls);
      if (it) this.loot.dropItem(it, at);
      if (chance(0.25)) this.loot.dropItem(recipe(), at);
      this.ui.log(`<b>${d.name}</b> has been slain!`, 'lvl');
      this.shake(0.5 * this.volAt(at));
    } else if (chance(d.drop * ITEM_DROP)) {
      const it = rollDrop(level, p.cls);
      if (it) this.loot.dropItem(it, at);
    }
  }

  // ---------------------------------------------------------------- the hidden caves (caves.js)
  // A kill near a land's hidden cave may bring its key: to a hero whose cave that is, carrying no key yet.
  // Each hero credited with the kill rolls for their own.
  rollKey(pos) {
    const land = this.places.id, cave = MAPS[land]?.hiddenCave, p = this.player;
    if (!cave || caveLandFor(p.level) !== land || Math.hypot(pos.x - cave.mouth.x, pos.z - cave.mouth.z) > KEY_RANGE) return;
    if (this.hasCaveKey() || !chance(KEY_CHANCE)) return;
    const key = makeItem(cave.key);
    if (p.addItem(key)) {
      this.ui.log(`Something glints where it fell: <b style="color:#ffd84a">${ITEMS[cave.key].name}</b>! The cave's mouth shows itself near ${cave.near}.`, 'lvl');
      this.ui.centerMsg(`You found the ${ITEMS[cave.key].name}!`);
      this.sfx.play('quest');
      this.fx.levelUp(pos);
      this.save();
    } else this.loot.dropItem(key, pos.clone());
  }

  // Where a key's cave is, and whether our hero may go in today.
  keyHint(d) {
    const c = CAVES[d.land], [title, ...rules] = caveRules(c);
    const today = this.player.cave.day === dayNumber() ? `<b>You have been in a cave today:</b> again in ${untilTomorrow()}.` : 'You can go in today.';
    this.ui.prompt(`${title}<br>It hides near ${c.near} in ${MAPS[d.land].name}: while you carry the key, its mouth glows among the bushes (a pulsing ring on your minimap too).<ul class="rules">${rules.map((x) => `<li>${x}</li>`).join('')}</ul>${today}`, [['OK', () => {}]], 60000);
  }

  hasCaveKey() {
    return CAVE_LANDS.some((l) => this.player.count(CAVES[l].key) > 0);
  }

  // May our hero see (and go into) land's cave? With its key, or while its party's copy is open to it and the
  // hero hasn't been in a cave today.
  caveFound(land) {
    const p = this.player, c = CAVES[land];
    if (!c || !p.alive || caveLandFor(p.level) !== land) return false;
    if (p.count(c.key) > 0) return true;
    const o = this.caveOpen;
    return !!o && o.land === land && Date.now() < o.until && p.cave.day !== dayNumber();
  }

  // At the mouth: what the cave is and its rules first, then in (or not).
  askCave(land) {
    const c = CAVES[land], p = this.player, list = (l) => `<ul class="rules">${l.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    const [title, ...rules] = caveRules(c);
    if (p.cave.day === dayNumber()) { this.ui.prompt(`${title}${list(rules)}<b>You have been in a cave today:</b> they open to you again in ${untilTomorrow()}.`, [['OK', () => {}]]); return; }
    const how = p.count(c.key) ? `Your <b>${ITEMS[c.key].name}</b> opens it${this.party.id ? ' for your party' : ''} (and crumbles).` : 'Your party has opened it: you can go in with them.';
    this.ui.prompt(`${title}${list(rules)}${how}`, [['Go in', () => this.enterCave(land), 'go'], ['Not now', () => {}]], 60000);
  }

  // Into land's hidden cave: through its mouth (with the key, or into the copy our party opened), or
  // answering a party member's call (join). The world decides, and the server takes the key.
  async enterCave(land, { join = false } = {}) {
    const c = CAVES[land], ui = this.ui, p = this.player;
    if (this.traveling || !c || !p.alive) return false;
    this.traveling = true;
    ui.closeInventory();
    this.places.closeTravel();
    p.control.stopAuto(true);
    ui.fade(true, `Into ${c.name}…`);
    this.sfx.play('portal');
    let r;
    try {
      await Promise.all([this.places.load(c.id), new Promise((res) => setTimeout(res, 420))]);
      r = await this.link.cave(land, { join, save: join ? null : p.serialize() });
    } catch (err) {
      ui.fade(false);
      ui.centerMsg(err.message);
      this.traveling = false;
      return false;
    }
    if (r.key) {
      p.takeOut(r.key);
      ui.log(`The key turns in the rock and crumbles: <b>${c.name}</b> opens${this.party.id ? ' for your party' : ''}. Ten chambers, and its keeper at the bottom.`, 'lvl');
    }
    if (r.rev) this.rev = r.rev; // (the server wrote our save without the key: older ones are refused)
    p.cave.day = r.day;
    this.caveOpen = null; // (once in, never again today)
    await this.arrive(r);
    ui.fade(false);
    this.traveling = false;
    this.save();
    return true;
  }

  // A party member opened a cave: go in with them? (The server only asks those who may.)
  caveOpened(m) {
    const c = CAVES[m.land], p = this.player;
    if (!c) return;
    const who = escHtml(m.from);
    if (m.done || p.cave.day === dayNumber()) { this.ui.log(`${who} opened <b>${c.name}</b>. You have been in a cave today: the caves open to you again in ${untilTomorrow()}.`, 'xp'); return; }
    if (caveLandFor(p.level) !== m.land) { this.ui.log(`${who} opened <b>${c.name}</b>, a cave for heroes of level ${c.heroes[0]} – ${c.heroes[1]}.`, 'xp'); return; }
    this.caveOpen = { land: m.land, until: Date.now() + CAVE_OPEN_FOR };
    const rules = caveRules(c).slice(1).map((x) => `<li>${x}</li>`).join('');
    this.ui.prompt(`<b>${who}</b> opened <b>${c.name}</b>, the hidden cave in ${MAPS[m.land].name}. Go in with your party?<ul class="rules">${rules}</ul>`, [
      ['Go in', () => this.enterCave(m.land, { join: true }), 'go'],
      ['Later', () => this.ui.log(`${c.name} stays open for your party: its mouth glows near ${c.near}.`, 'xp')],
    ], 60000);
  }

  // A key whose land our hero has outgrown crumbles (its cave is for lower levels now).
  checkKeys() {
    const p = this.player, mine = caveLandFor(p.level);
    for (const land of CAVE_LANDS) {
      const k = CAVES[land].key;
      if (land === mine || !p.count(k)) continue;
      p.takeOut(k, p.count(k));
      this.ui.log(`The ${ITEMS[k].name} crumbles to dust: that cave is for lower levels now. Yours is ${CAVES[mine].name}, near ${CAVES[mine].near} in ${MAPS[mine].name}.`, 'xp');
    }
  }

  // A hero's blow on another in the arena, from the world: [H, victim, damage (after the victim's armor),
  // crit, by, { s: stun, w: slow s, f: slow factor } or 0, missed]. Everyone sees the same number.
  heroHit([, victim, dmg, crit, by, looks, miss]) {
    dmg = Math.max(0, Math.round(Number(dmg) || 0));
    if (victim === this.link.pid) {
      if (!this.player.alive || !this.pvp) return;
      if (miss) this.ui.floater(this.player.headPos(), 'Dodged', 'info small');
      else if (dmg > 0) this.takeDamage(dmg, true);
      if (looks) this.player.applyStatus(looks);
      return;
    }
    const o = this.others.byId.get(victim);
    if (!o) return;
    const mine = by === this.link.pid;
    if (miss) this.ui.floater(o.headPos, 'Miss', mine ? 'info small' : 'other');
    else if (dmg > 0) this.ui.floater(o.headPos, String(dmg), mine ? (crit ? 'crit' : '') : crit ? 'crit other' : 'other');
    if (!mine) o.hurt(); // (ours flinched when we struck)
    if (looks) o.applyStatus(looks);
  }

  // [K, winner, loser]: a hero fell to another in the arena.
  heroDown([, winner, loser]) {
    if (winner === this.link.pid) {
      const o = this.others.byId.get(loser);
      this.ui.centerMsg(`You defeated ${o ? o.name : 'your foe'}!`);
      this.sfx.play('quest');
      this.fx.levelUp(this.player.pos);
    } else if (loser === this.link.pid) {
      const o = this.others.byId.get(winner);
      if (o) this.deathNote = this.places.map.kind === 'arena' ? `${o.name} won this one. No gold is lost in the arena.` : `${o.name} knocked you out. The canyon takes a tenth of your gold.`;
    }
  }

  // A monster's blow lands on our hero (src: the monster): our armor takes its share, unless we dodge it.
  // A weakened monster (a plague) hits softer.
  damagePlayer(amount, src) {
    const p = this.player;
    if (!p.alive) return;
    if (p.stats.evade && Math.random() < p.stats.evade) { // in the smoke: it misses
      this.ui.floater(p.headPos(), 'Dodged', 'info small');
      return;
    }
    if (src?.weakT > 0) amount *= 1 - (src.weakBy || 0.3);
    this.takeDamage(Math.max(1, Math.round(amount * (1 - p.stats.dr) * rand(0.9, 1.1))));
  }

  // Life lost, this much (armor already counted; shields and holy ground still help, unless exact: another
  // hero's blow, which the world already reckoned with them). It breaks a scroll's reading.
  takeDamage(dmg, exact = false) {
    const p = this.player;
    if (!p.alive) return;
    if (!exact) dmg = Math.max(1, Math.round(dmg * p.stats.taken));
    if (p.shield > 0) { // a divine shield soaks it up first
      const soak = Math.min(p.shield, dmg);
      p.shield -= soak;
      dmg -= soak;
      if (p.shield <= 0) { delete p.buffs.divine_shield; p.auras.shield = 0; this.ui.refreshBuffs(); }
      if (!dmg) { this.ui.floater(p.headPos(), 'Absorbed', 'info small'); return; }
    }
    p.breakChannel();
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
    this.ui.refreshInventory();
    // in the log: coins picked up close together add up on one line
    const g = this.goldLine, now = performance.now();
    if (g && g.el.isConnected && now - g.at < 6000) {
      g.n += n;
      g.at = now;
      g.el.innerHTML = `Picked up <b>${g.n} gold</b>`;
      g.el.parentNode.appendChild(g.el); // (to the bottom, as the newest)
      this.ui.keepLine(g.el);
    } else {
      this.goldLine = { n, at: now, el: this.ui.log(`Picked up <b>${n} gold</b>`, 'gold') };
    }
  }

  // Something that runs a while every frame (burning ground, a rain of arrows): fn(dt, t) returns true to
  // keep going.
  addTicker(fn) {
    this.tickers.push(fn);
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

  // The hero and the account's bank go together (rev: the server refuses saves from before a trade).
  flushSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.saveDirty || !this.character) return;
    this.saveDirty = false;
    const data = this.player.serialize();
    if (this.character.id === 'local') {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
      this.bank.saveLocal();
    } else {
      this.net?.send('save', { save: data, bank: this.bank.serialize(), rev: this.rev });
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
      this.bank.saveLocal();
    } else if (this.net?.online) {
      await this.net.request('save', { save: data, bank: this.bank.serialize(), rev: this.rev }, 4000);
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

  // A frame of the game: dt seconds on. draw: false while the game is in the background (hunting on).
  frame(rawDt, draw = true) {
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
    this.npcs.update(dt);
    this.places.update(dt);
    for (let i = this.tickers.length - 1; i >= 0; i--) if (!this.tickers[i](dt)) this.tickers.splice(i, 1);
    this.enemies.update(dt);
    this.others.update(dt);
    this.projectiles.update(dt);
    this.loot.update(dt);

    const pp = this.player.pos, map = this.places.map;
    const zone = zoneAt(pp.x, pp.z);
    this.pvp = !!(map.pvp && zone?.pvp && this.player.alive); // in the arena's pit: other heroes are fair game
    if (zone !== this.currentZone) {
      if (zone) this.ui.zoneToast(zone);
      else if (this.currentZone === undefined) this.ui.zoneToast({ name: map.name, sub: map.sub }); // (just arrived)
      this.currentZone = zone;
      this.ui.el.zoneName.textContent = zone ? zone.name : map.id === 'emberwood' ? 'The Wilds' : map.name;
      if (zone) this.quests.onEvent('visit', { zone: zone.id, map: map.id });
    }
    this.ui.setBoss(this.enemies.boss);
    this.updateSound(rawDt, zone);

    this.fx.update(dt);
    this.updateCamera(rawDt);
    this.ui.update(rawDt);
    this.party.update();
    if (!draw) return;
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

  // The size of the page's box for the game, not of the part of the page on screen (which is smaller while
  // a phone has the page zoomed in: sizing to that left the game in a corner).
  onResize(force = false) {
    const box = this.renderer.domElement.parentElement;
    const w = Math.max(1, box?.clientWidth || window.innerWidth), h = Math.max(1, box?.clientHeight || window.innerHeight);
    if (!force && w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const glow = this.glow || 0.5; // (a soft glow needs few pixels)
    this.bloom.setSize(Math.max(2, Math.round(w * glow)), Math.max(2, Math.round(h * glow)));
    if (this.fx) this.fx.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }
}

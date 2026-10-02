// HTML HUD: bars, action bar, nameplates, floating numbers, minimap, inventory, tooltips.
import * as THREE from 'three';
import { Assets } from './assets.js';
import { RARITY, itemLines, COMPARE_STATS } from './items.js';
import { xpForLevel, STASH_SIZE, MAX_LEVEL } from './player.js';
import { ALE_PRICE } from './town.js';
import { TOWN } from './world.js';
import { CLASSES } from './classes.js';
import { rand } from './util.js';

const $ = (id) => document.getElementById(id);

// The attack button (the skills' icons are in skills.js).
const ATTACK_SVG = {
  sword: `<svg viewBox="0 0 32 32"><path d="M27.5 4.5 26 10.5 12.5 24 8 19.5 21.5 6z" fill="#e3e9f0" stroke="#5d6875" stroke-width="1.2" stroke-linejoin="round"/><path d="M21.5 6 26 10.5" stroke="#fff" stroke-width="1" opacity=".7"/><path d="M6 17.5l8.5 8.5" stroke="#d6aa4a" stroke-width="3.2" stroke-linecap="round"/><path d="M9.2 22.8 4.5 27.5" stroke="#7a4f2c" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  bolt: `<svg viewBox="0 0 32 32"><path d="M4 26l9-9M6 29l8-8M2 21l8-8" stroke="#b99cff" stroke-width="1.8" stroke-linecap="round" opacity=".7"/><circle cx="20" cy="12" r="7.5" fill="#8a6dff" stroke="#3a2a7a" stroke-width="1.3"/><circle cx="18" cy="10" r="3" fill="#e6dcff"/></svg>`,
};

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hpFill: $('hp-fill'), hpText: $('hp-text'), mpFill: $('mp-fill'), mpText: $('mp-text'), mpBar: $('mp-fill').parentElement,
      xpFill: $('xp-fill'), xpText: $('xp-text'), lvl: $('lvl'), portrait: $('portrait'), slots: $('slots'),
      plates: $('plates'), floaters: $('floaters'), log: $('log'), zoneToast: $('zone-toast'), centerMsg: $('center-msg'),
      boss: $('boss'), bossName: $('boss-name'), bossFill: $('boss-fill'), minimap: $('minimap'), zoneName: $('zone-name'),
      inventory: $('inventory'), bag: $('bag'), stats: $('stats'), gold: $('gold'), tooltip: $('tooltip'),
      death: $('death'), vignette: $('vignette'), help: $('help'),
      shop: $('shop'), buyback: $('buyback'), stash: $('stash'), stashCount: $('stash-count'),
      restock: $('restock'), sellCommons: $('sell-commons'), bagHint: $('bag-hint'),
      questList: $('quest-list'), tracker: $('tracker'), fade: $('fade'), settings: $('settings'),
    };
    this.plates = [];
    this.floaters = [];
    this.v = new THREE.Vector3();
    this.mm = this.el.minimap.getContext('2d');
    this.invOpen = false;
    this.invMode = 'character'; // character | vendor | stash | board — which panel sits next to the bag
    this.tipTarget = null;
    this.mouse = { x: 0, y: 0 };
    this.el.portrait.src = Assets.icons.portrait;

    // Item grids. Mouse: hover shows the tooltip, click acts (equip / buy / store / take), right-click sells.
    // Touch: tap selects an item and opens a small menu with the choices, so nothing happens by accident.
    const p = () => this.game.player;
    this.bagSlots = this.makeSlots(this.el.bag, 20, {
      click: (i, d) => this.bagClick(i, d),
      tip: (i) => p().bag[i] && this.itemTip(p().bag[i], { compare: true, hint: this.bagHint(p().bag[i]) }),
      sell: (i) => p().sell(i),
    });
    this.shopSlots = this.makeSlots(this.el.shop, 10, { cls: 'shop-slot', click: (i, d) => this.shopClick(i, d), tip: (i) => this.shopTip(i) });
    this.buybackSlots = this.makeSlots(this.el.buyback, 5, { cls: 'shop-slot', click: (i, d) => this.buybackClick(i, d), tip: (i) => this.buybackTip(i) });
    this.stashSlots = this.makeSlots(this.el.stash, STASH_SIZE, {
      click: (i, d) => this.stashClick(i, d),
      tip: (i) => p().stash[i] && this.itemTip(p().stash[i], { compare: true, hint: 'Click to take' }),
    });
    for (const d of document.querySelectorAll('.eq-slot')) {
      const slot = d.dataset.slot;
      d.addEventListener('click', () => this.equipClick(slot, d));
      d.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(d, () => p().equipment[slot] && this.itemTip(p().equipment[slot], { hint: 'Click to unequip' })); });
      d.addEventListener('mouseleave', () => { if (!this.touch) this.hideTip(); });
    }
    this.el.sellCommons.addEventListener('click', () => this.game.town.sellCommons());
    // quest card buttons: Accept / Skip / Abandon / Claim
    this.el.questList.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      this.game.quests[b.dataset.act](b.dataset.slot === 'main' ? 'main' : Number(b.dataset.slot));
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.menuAnchor && !this.el.tooltip.contains(e.target) && !this.menuAnchor.contains(e.target)) this.closeMenu();
    }, true);
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.tipTarget) this.placeTip();
    });
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.togglePanel(b.dataset.close, false));
    $('btn-bag').addEventListener('click', () => this.toggleInventory());
    $('btn-help').addEventListener('click', () => this.togglePanel('help'));
    $('btn-settings').addEventListener('click', () => this.toggleSettings());
    this.bindSettings();
    $('respawn').addEventListener('click', () => this.game.player.respawn());
    this.buildActionBar();
  }

  // The hero in play: portrait and name on the HUD, refreshed bar, bag and quests.
  setCharacter(char) {
    this.el.portrait.src = Assets.icons[`portrait_${char.cls}`] || Assets.icons.portrait;
    const name = String(char.name).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    $('pname').innerHTML = `${name} <small>${CLASSES[char.cls].name}</small>`;
    this.buildActionBar();
    this.refreshInventory();
    this.refreshTracker();
  }

  // Lost (or got back) the game server mid-game.
  connection(online) {
    $('net-banner').classList.toggle('hidden', online);
  }

  setTouchMode(on) {
    this.touch = on;
    document.body.classList.toggle('touch', on);
    this.closeMenu();
  }

  // A grid of item slots with mouse tooltips; `sell` enables right-click selling.
  makeSlots(parent, n, { click, tip, sell = null, cls = '' }) {
    return Array.from({ length: n }, (_, i) => {
      const d = document.createElement('div');
      d.dataset.cls = cls;
      d.className = `bag-slot ${cls}`;
      d.addEventListener('click', () => click(i, d));
      d.addEventListener('contextmenu', (e) => { e.preventDefault(); if (sell && !this.touch) { sell(i); this.hideTip(); } });
      d.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(d, () => tip(i)); });
      d.addEventListener('mouseleave', () => { if (!this.touch) this.hideTip(); });
      parent.appendChild(d);
      return d;
    });
  }

  atStash() {
    return this.invOpen && this.invMode === 'stash';
  }

  bagHint(item) {
    return `Click to ${this.atStash() ? 'store' : 'equip'} · Right-click to sell for ${item.value}g`;
  }

  bagClick(i, d) {
    const p = this.game.player, item = p.bag[i];
    if (!this.touch) {
      if (this.atStash()) this.game.town.store(i);
      else p.equipFromBag(i);
      this.hideTip();
      this.maybeTip(d);
      return;
    }
    if (!item) return this.closeMenu();
    const eq = p.equipment;
    const equip = item.slot === 'ring' && eq.ring1 && eq.ring2 && !this.atStash()
      ? [['Left ring', () => p.equipFromBag(i, 'ring1')], ['Right ring', () => p.equipFromBag(i, 'ring2')]]
      : [['Equip', () => p.equipFromBag(i)]];
    const store = this.atStash() ? [['Store', () => this.game.town.store(i)]] : [];
    this.openMenu(d, this.itemTip(item, { compare: true }), [...store, ...equip, [`Sell · ${item.value}g`, () => p.sell(i)]]);
  }

  equipClick(slot, d) {
    const p = this.game.player, item = p.equipment[slot];
    if (!this.touch) {
      p.unequip(slot);
      this.hideTip();
      return;
    }
    if (!item) return this.closeMenu();
    this.openMenu(d, this.itemTip(item), [['Unequip', () => p.unequip(slot)]]);
  }

  // Merchant grid: slot 0 is ale (always in stock), then the rotating gear.
  shopClick(i, d) {
    const town = this.game.town, p = this.game.player;
    if (i === 0) {
      if (!this.touch) { town.buyAle(); this.maybeTip(d); return; }
      return this.openMenu(d, this.aleTip(), [
        [`Buy 1 · ${ALE_PRICE}g`, () => town.buyAle()],
        [`Buy 5 · ${ALE_PRICE * 5}g`, () => { for (let k = 0; k < 5 && p.gold >= ALE_PRICE; k++) town.buyAle(); }],
      ]);
    }
    const entry = p.shop.stock[i - 1];
    if (!entry) return this.closeMenu();
    if (!this.touch) { town.buy(i - 1); this.hideTip(); return; }
    this.openMenu(d, this.itemTip(entry.item, { compare: true }), [[`Buy · ${entry.price}g`, () => town.buy(i - 1)]]);
  }

  buybackClick(i, d) {
    const town = this.game.town, entry = town.buyback[i];
    if (!entry) return this.closeMenu();
    if (!this.touch) { town.buyBack(i); this.hideTip(); return; }
    this.openMenu(d, this.itemTip(entry.item, { compare: true }), [[`Buy back · ${entry.price}g`, () => town.buyBack(i)]]);
  }

  stashClick(i, d) {
    const town = this.game.town, item = this.game.player.stash[i];
    if (!item) return this.closeMenu();
    if (!this.touch) { town.take(i); this.hideTip(); return; }
    this.openMenu(d, this.itemTip(item, { compare: true }), [['Take', () => town.take(i)]]);
  }

  aleTip() {
    const p = this.game.player;
    return `<div class="tt-name">Hearty Ale</div><div class="tt-type">Potion · you have ${p.potions}</div>Restores 40% of your maximum Life.
      ${this.touch ? '' : `<div class="tt-hint">Click to buy for ${ALE_PRICE}g</div>`}`;
  }

  shopTip(i) {
    if (i === 0) return this.aleTip();
    const p = this.game.player, entry = p.shop.stock[i - 1];
    if (!entry) return null;
    const hint = p.gold >= entry.price ? `Click to buy for ${entry.price}g` : `Costs ${entry.price}g · not enough gold`;
    return this.itemTip(entry.item, { compare: true, hint });
  }

  buybackTip(i) {
    const entry = this.game.town.buyback[i];
    return entry && this.itemTip(entry.item, { compare: true, hint: `Click to buy back for ${entry.price}g` });
  }

  // Tooltip with action buttons, anchored under (or above) a slot. Used on touch screens.
  openMenu(anchor, html, actions) {
    this.closeMenu();
    const t = this.el.tooltip;
    t.innerHTML = `${html}<div class="tt-actions"></div>`;
    const row = t.querySelector('.tt-actions');
    for (const [label, fn] of actions) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => { fn(); this.closeMenu(); });
      row.appendChild(b);
    }
    t.classList.remove('hidden');
    t.classList.add('menu');
    this.menuAnchor = anchor;
    anchor.classList.add('selected');
    const r = anchor.getBoundingClientRect();
    const w = t.offsetWidth, h = t.offsetHeight;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  }

  closeMenu() {
    if (!this.menuAnchor) return;
    this.menuAnchor.classList.remove('selected');
    this.menuAnchor = null;
    this.el.tooltip.classList.remove('menu');
    this.hideTip();
  }

  // ---------------------------------------------------------------- action bar
  buildActionBar() {
    const p = this.game.player, mage = p.cls === 'mage';
    const attackTip = mage
      ? `<div class="tt-name">Arcane Bolt</div><div class="tt-type">Left mouse · hold to keep casting</div>A bolt of force from your staff at the cursor: weapon damage, scaled by Spell Power.`
      : `<div class="tt-name">Attack</div><div class="tt-type">Left mouse · hold to keep swinging</div>Swing your weapon at the cursor. Hits everything in a short arc.`;
    const defs = [
      { key: 'LMB', attack: true, cls: 'slot-attack', icon: mage ? ATTACK_SVG.bolt : ATTACK_SVG.sword, tip: () => attackTip },
      ...p.skills.map((s, i) => ({
        key: s.key, skill: s, cls: `slot-s${i + 1}`, icon: s.icon, sep: i === 0,
        tip: () => `<div class="tt-name">${s.name}</div><div class="tt-type">${s.mp} mana · ${s.cd}s cooldown${p.level < s.level ? ` · unlocks at level ${s.level}` : ''}</div>${s.desc}`,
      })),
      { key: 'Q', potion: true, cls: 'slot-potion', icon: `<img src="${Assets.icons.mug_full}" alt="">`, sep: true, tip: () => `<div class="tt-name">Hearty Ale</div><div class="tt-type">Q · ${p.potions} left</div>Restores 40% of your maximum Life. Buy more from Wren, the merchant in camp, or find them on monsters.` },
    ];
    this.el.slots.innerHTML = '';
    this.slotEls = defs.map((d) => {
      const el = document.createElement('div');
      el.className = `slot ${d.cls}${d.sep ? ' sep' : ''}`;
      el.innerHTML = `<div class="icon">${d.icon}</div><div class="cd"></div><div class="cdnum"></div><span class="key">${d.key}</span><span class="count"></span><span class="lock"></span>`;
      el.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(el, d.tip); });
      el.addEventListener('mouseleave', () => this.hideTip());
      if (d.attack) {
        this.game.input.bindAttackButton(el);
      } else {
        // pointerdown, not click: buttons react the instant a thumb lands
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (d.skill) p.useSkill(p.skills.indexOf(d.skill));
          else if (d.potion) p.drinkAle();
        });
      }
      this.el.slots.appendChild(el);
      return { el, d, cd: el.querySelector('.cd'), cdnum: el.querySelector('.cdnum'), count: el.querySelector('.count'), lock: el.querySelector('.lock'), wasCd: false };
    });
  }

  updateActionBar() {
    const p = this.game.player;
    for (const s of this.slotEls) {
      let cd = 0, max = 1;
      if (s.d.skill) {
        const sk = s.d.skill;
        cd = p.cd[sk.id];
        max = sk.cd;
        const locked = p.level < sk.level;
        s.el.classList.toggle('locked', locked);
        s.lock.textContent = locked ? `Lv ${sk.level}` : '';
        s.el.classList.toggle('nomana', !locked && p.mp < sk.mp);
      } else if (s.d.potion) {
        cd = p.cd.potion;
        max = 1.5;
        s.count.textContent = p.potions;
        s.el.classList.toggle('locked', p.potions <= 0);
      } else {
        cd = p.cd.attack;
        max = Math.max(0.01, 0.62 / p.stats.atkSpeed);
        cd = 0; // attack cooldown is too short to be worth showing
      }
      const frac = cd > 0 ? cd / max : 0;
      s.cd.style.setProperty('--p', `${(frac * 100).toFixed(1)}%`);
      s.cdnum.textContent = cd > 0.9 ? Math.ceil(cd) : '';
      if (s.wasCd && cd <= 0) {
        s.el.classList.remove('ready-flash');
        void s.el.offsetWidth;
        s.el.classList.add('ready-flash');
      }
      s.wasCd = cd > 0;
    }
  }

  // ---------------------------------------------------------------- plates & labels
  createPlate(enemy) {
    const el = document.createElement('div');
    el.className = `plate${enemy.def.boss ? ' boss' : ''}`;
    el.innerHTML = `<div class="nm">${enemy.def.name}<i>Lv ${enemy.level}</i></div><div class="hpb"><b></b></div>`;
    this.el.plates.appendChild(el);
    const p = { el, ent: enemy, bar: el.querySelector('b'), kind: 'enemy', max: 30 };
    this.plates.push(p);
    return p;
  }

  // Name + role above a friendly character, with an action button that shows when you're in reach.
  createNpcLabel(name, title, action, onAction, getPos) {
    const el = document.createElement('div');
    el.className = 'plate npc';
    el.innerHTML = `<div class="npc-name">${name}</div><div class="npc-title">${title}</div><button class="npc-act">${action} <kbd>E</kbd></button>`;
    el.querySelector('button').addEventListener('click', () => onAction());
    this.el.plates.appendChild(el);
    const p = { el, getPos, kind: 'label', max: 26 };
    this.plates.push(p);
    return p;
  }

  createLabel(text, color, getPos) {
    const el = document.createElement('div');
    el.className = 'plate loot';
    el.style.color = color;
    el.textContent = text;
    this.el.plates.appendChild(el);
    const p = { el, getPos, kind: 'label', max: 20 };
    this.plates.push(p);
    return p;
  }

  // Name, level and life over another hero, and a speech bubble when they chat.
  createPlayerPlate(rp) {
    const el = document.createElement('div');
    el.className = `plate player c-${rp.cls}`;
    el.innerHTML = '<div class="bubble"></div><div class="pn"><span></span><i></i></div><div class="hpb"><b></b></div>';
    this.el.plates.appendChild(el);
    const p = { el, ent: rp, kind: 'player', bar: el.querySelector('.hpb b'), bubble: el.querySelector('.bubble'), max: 46 };
    this.plates.push(p);
    rp.plate = p;
    this.refreshPlayerPlate(rp);
    return p;
  }

  refreshPlayerPlate(rp) {
    const el = rp.plate.el;
    el.querySelector('.pn span').textContent = rp.name; // (text, never HTML: names come from other players)
    el.querySelector('.pn i').textContent = `Lv ${rp.level}`;
  }

  // A chat bubble over a hero's head for a few seconds (our own hero gets an empty plate for it).
  say(who, text) {
    let p = who.plate;
    if (who === this.game.player) {
      if (!this.selfPlate) {
        const el = document.createElement('div');
        el.className = 'plate player self';
        el.innerHTML = '<div class="bubble"></div>';
        this.el.plates.appendChild(el);
        this.selfPlate = { el, ent: who, kind: 'player', bubble: el.querySelector('.bubble'), max: 46 };
        this.plates.push(this.selfPlate);
      }
      p = this.selfPlate;
    }
    if (!p?.bubble) return;
    p.bubble.textContent = text.length > 90 ? `${text.slice(0, 88)}…` : text;
    p.el.classList.add('talking');
    clearTimeout(p.bubbleT);
    p.bubbleT = setTimeout(() => p.el.classList.remove('talking'), 2500 + Math.min(text.length, 90) * 60);
  }

  removePlate(p) {
    if (!p) return;
    p.el.remove();
    p.dead = true;
  }

  project(pos) {
    this.v.copy(pos).project(this.game.camera);
    if (this.v.z > 1) return null;
    return [(this.v.x * 0.5 + 0.5) * window.innerWidth, (-this.v.y * 0.5 + 0.5) * window.innerHeight];
  }

  updatePlates() {
    const pp = this.game.player.pos;
    const tmp = new THREE.Vector3();
    this.plates = this.plates.filter((p) => !p.dead);
    for (const p of this.plates) {
      if (p.kind === 'enemy') p.ent.platePos(tmp);
      else if (p.kind === 'player') tmp.set(p.ent.pos.x, p.ent.pos.y + 2.75, p.ent.pos.z);
      else p.getPos(tmp);
      const far = tmp.distanceTo(pp) > p.max;
      const sc = far ? null : this.project(tmp);
      if (!sc) {
        if (p.shown !== false) { p.el.style.display = 'none'; p.shown = false; }
        continue;
      }
      if (p.shown !== true) { p.el.style.display = ''; p.shown = true; }
      p.el.style.transform = `translate(${sc[0].toFixed(1)}px, ${sc[1].toFixed(1)}px) translate(-50%, -100%)`;
      if (p.kind === 'enemy') {
        const e = p.ent;
        const f = Math.max(0, e.hp / e.maxHp);
        p.bar.style.transform = `scaleX(${f.toFixed(3)})`;
        p.el.classList.toggle('hurt', f < 0.999);
        p.el.classList.toggle('hover', !!e.hover);
      } else if (p.kind === 'player' && p.bar) {
        const o = p.ent;
        p.bar.style.transform = `scaleX(${o.hp.toFixed(3)})`;
        p.el.classList.toggle('hurt', o.hp < 0.999 && o.alive);
        p.el.classList.toggle('down', !o.alive || o.away);
      }
    }
  }

  // ---------------------------------------------------------------- floaters
  floater(pos, text, cls = '') {
    if (this.floaters.length > 50) this.floaters.shift().el.remove();
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.el.floaters.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0, dx: cls === 'say' ? 0 : rand(-18, 18), life: cls === 'info' ? 1.8 : cls === 'say' ? 2.6 : 1.0 });
  }

  updateFloaters(dt) {
    for (const f of this.floaters) {
      f.t += dt;
      f.pos.y += dt * Math.max(0.2, 1.8 - f.t * 1.5);
      const sc = this.project(f.pos);
      const k = f.t / f.life;
      if (!sc || k >= 1) { f.el.remove(); f.dead = true; continue; }
      const pop = f.t < 0.1 ? 0.6 + (f.t / 0.1) * 0.6 : Math.max(1, 1.2 - (f.t - 0.1) * 1.2);
      f.el.style.opacity = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
      f.el.style.transform = `translate(${(sc[0] + f.dx * k).toFixed(1)}px, ${sc[1].toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
    }
    this.floaters = this.floaters.filter((f) => !f.dead);
  }

  // ---------------------------------------------------------------- messages
  log(html, cls = '') {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    this.el.log.appendChild(d);
    while (this.el.log.children.length > 6) this.el.log.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 7000);
    setTimeout(() => d.remove(), 8200);
  }

  centerMsg(text) {
    const el = this.el.centerMsg;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._cm);
    this._cm = setTimeout(() => el.classList.remove('show'), 1600);
  }

  noMana() {
    const b = this.el.mpBar;
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
    this.centerMsg('Not enough mana');
  }

  zoneToast(zone) {
    const el = this.el.zoneToast;
    el.innerHTML = `${zone.name}<small>${zone.sub}</small>`;
    el.classList.add('show');
    clearTimeout(this._zt);
    this._zt = setTimeout(() => el.classList.remove('show'), 2600);
  }

  hurt() {
    this.el.vignette.style.opacity = 1;
    clearTimeout(this._hv);
    this._hv = setTimeout(() => { this.el.vignette.style.opacity = 0; }, 140);
  }

  setBoss(e) {
    this.el.boss.classList.toggle('hidden', !e);
    if (e) {
      this.el.bossName.textContent = `${e.def.name} · Lv ${e.level}`;
      this.el.bossFill.style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp).toFixed(3)})`;
    }
  }

  showDeath(show) {
    this.el.death.classList.toggle('hidden', !show);
  }

  togglePanel(id, force) {
    if (id === 'settings') return (force ?? this.el.settings.classList.contains('hidden')) ? this.openSettings() : this.closeSettings();
    if (id === 'inventory') {
      const open = force ?? !(this.invOpen && this.invMode === 'character');
      return open ? this.openInventory('character') : this.closeInventory();
    }
    const el = $(id);
    el.classList.toggle('hidden', !(force ?? el.classList.contains('hidden')));
  }

  // mode: 'character' (I key), 'vendor' (at the merchant), 'stash' (at the chest), 'board' (quests).
  // The bag is always shown.
  openInventory(mode = 'character') {
    this.closeMenu();
    this.hideTip();
    this.invMode = mode;
    this.el.inventory.dataset.mode = mode;
    this.el.inventory.classList.remove('hidden');
    this.invOpen = true;
    this.game.doll.visible = mode === 'character';
    this.refreshInventory();
  }

  closeInventory() {
    if (!this.invOpen) return;
    this.el.inventory.classList.add('hidden');
    this.invOpen = false;
    this.game.doll.visible = false;
    this.closeMenu();
    this.hideTip();
  }

  toggleInventory() {
    if (this.invOpen && this.invMode === 'character') this.closeInventory();
    else this.openInventory('character');
  }

  // M: mute / unmute everything
  toggleSound() {
    const muted = !this.game.settings.muted;
    this.game.setSetting('muted', muted);
    $('set-muted').checked = muted;
    this.centerMsg(muted ? 'Sound off' : 'Sound on');
  }

  // Esc: close whatever is open, otherwise open the settings
  escape() {
    if (this.settingsOpen) return this.closeSettings();
    if (this.game.places?.travelOpen) return this.game.places.closeTravel();
    if (this.invOpen || !this.el.help.classList.contains('hidden')) {
      this.closeInventory();
      this.togglePanel('help', false);
      return;
    }
    this.openSettings();
  }

  // ---------------------------------------------------------------- settings (the game pauses while open)
  bindSettings() {
    const g = this.game;
    for (const key of ['music', 'sfx', 'ambience']) {
      const input = $(`set-${key}`);
      input.addEventListener('input', () => {
        g.setSetting(key, input.value / 100);
        input.nextElementSibling.textContent = input.value;
        if (key === 'sfx') g.sfx.play('pickup'); // hear the new level
      });
    }
    const zoom = $('set-zoom');
    zoom.addEventListener('input', () => { g.setSetting('zoom', zoom.value / 100); zoom.nextElementSibling.textContent = `${zoom.value}%`; });
    $('set-muted').addEventListener('change', (e) => g.setSetting('muted', e.target.checked));
    for (const b of document.querySelectorAll('#set-quality button')) {
      b.addEventListener('click', () => { g.setSetting('quality', b.dataset.v); this.syncSettings(); });
    }
    $('leave-game').addEventListener('click', () => g.leave());
  }

  syncSettings() {
    const s = this.game.settings;
    for (const key of ['music', 'sfx', 'ambience']) {
      const input = $(`set-${key}`);
      input.value = Math.round(s[key] * 100);
      input.nextElementSibling.textContent = input.value;
    }
    const zoom = $('set-zoom');
    zoom.value = Math.round(this.game.zoomTarget * 100);
    zoom.nextElementSibling.textContent = `${zoom.value}%`;
    $('set-muted').checked = s.muted;
    for (const b of document.querySelectorAll('#set-quality button')) b.classList.toggle('on', b.dataset.v === s.quality);
  }

  openSettings() {
    this.closeInventory();
    this.togglePanel('help', false);
    this.syncSettings();
    $('settings-note').textContent = this.game.offline ? 'game paused' : 'the world goes on';
    this.el.settings.classList.remove('hidden');
    this.settingsOpen = true;
    this.game.paused = true;
  }

  // keepPaused: leaving the game (it stays paused on the title screen)
  closeSettings(keepPaused = false) {
    this.el.settings.classList.add('hidden');
    this.settingsOpen = false;
    if (!keepPaused) this.game.paused = false;
  }

  toggleSettings() {
    if (this.settingsOpen) this.closeSettings();
    else this.openSettings();
  }

  // ---------------------------------------------------------------- inventory
  slotHtml(item) {
    return item ? `<img src="${Assets.icons[item.icon]}" alt="">` : '';
  }

  paintSlot(d, item, extra = '') {
    d.className = `bag-slot ${d.dataset.cls || ''}${item ? ` r-${item.rarity}` : ''}`;
    d.innerHTML = this.slotHtml(item) + extra;
  }

  priceTag(price) {
    return `<span class="price${this.game.player.gold < price ? ' short' : ''}">${price}</span>`;
  }

  refreshInventory() {
    const p = this.game.player;
    this.el.gold.textContent = p.gold;
    if (!this.invOpen) return;
    p.bag.forEach((it, i) => this.paintSlot(this.bagSlots[i], it));
    this.el.bagHint.textContent = this.touch ? 'tap an item for options'
      : `click to ${this.atStash() ? 'store' : 'equip'} · right-click to sell`;
    if (this.invMode === 'vendor') this.refreshVendor();
    else if (this.invMode === 'stash') this.refreshStash();
    else if (this.invMode === 'board') this.refreshBoard();
    else this.refreshCharacter();
  }

  // ---------------------------------------------------------------- quests
  refreshBoard() {
    const s = this.game.quests.state;
    this.el.questList.innerHTML = [
      '<div class="sec-title">Main quest</div>',
      s.main ? this.questCard('main', s.main) : '<div class="quest-card all-done">The story is done for now. Bounties keep coming.</div>',
      '<div class="sec-title">Bounties <small>new ones after you claim or skip</small></div>',
      ...s.bounties.map((q, i) => this.questCard(i, q)),
    ].join('');
  }

  questCard(slot, q) {
    const d = q.def, goal = d.goal, r = d.reward, main = slot === 'main';
    const rewards = [r.gold && `${r.gold}g`, r.xp && `${r.xp} XP`, r.potions && `${r.potions} ale`,
      r.item && `${RARITY[r.item.minRarity].label}${r.item.minRarity === 'legendary' ? '' : '+'} item`].filter(Boolean).join(' · ');
    const progress = q.state === 'offer' ? '' : `
      <div class="q-goal"><span>${this.game.quests.goalLabel(q)}</span><b>${q.progress} / ${goal.count}</b></div>
      <div class="q-bar"><i style="width:${Math.round((q.progress / goal.count) * 100)}%"></i></div>`;
    const actions = q.state === 'offer'
      ? `<button data-act="accept" data-slot="${slot}">Accept</button>${main ? '' : `<button class="ghost" data-act="skip" data-slot="${slot}">Skip</button>`}`
      : q.state === 'done'
        ? `<button class="claim" data-act="claim" data-slot="${slot}">Claim reward</button>`
        : `<button class="ghost" data-act="abandon" data-slot="${slot}">Abandon</button>`;
    return `<div class="quest-card ${q.state}${main ? ' main' : ''}">
      <div class="q-head"><span class="q-title">${main ? '◆ ' : ''}${d.title}</span>${d.level ? `<span class="q-lvl">Lv ${d.level}</span>` : ''}</div>
      <div class="q-text">${d.text}</div>${progress}
      <div class="q-foot"><span class="q-reward">${rewards}</span><span class="q-actions">${actions}</span></div>
    </div>`;
  }

  // Accepted quests, shown on screen while you play.
  refreshTracker() {
    const quests = this.game.quests, items = quests.tracked();
    this.el.tracker.classList.toggle('hidden', !items.length);
    this.el.tracker.innerHTML = items.map(({ slot, q }) => {
      const title = `<div class="trk-title">${slot === 'main' ? '◆ ' : ''}${q.def.title}</div>`;
      if (q.state === 'done') return `<div class="trk done">${title}<div class="trk-goal ok">✓<span> Claim at the notice board</span></div></div>`;
      const count = q.def.goal.count;
      return `<div class="trk">${title}<div class="trk-goal"><span>${quests.goalLabel(q)}</span><b>${q.progress} / ${count}</b></div>
        <div class="trk-bar"><i style="width:${Math.round((q.progress / count) * 100)}%"></i></div></div>`;
    }).join('');
  }

  refreshVendor() {
    const p = this.game.player, town = this.game.town;
    this.paintSlot(this.shopSlots[0], null, `<img src="${Assets.icons.mug_full}" alt="">${this.priceTag(ALE_PRICE)}`);
    for (let i = 0; i < 9; i++) {
      const entry = p.shop.stock[i];
      this.paintSlot(this.shopSlots[i + 1], entry?.item, entry ? this.priceTag(entry.price) : '');
    }
    for (let i = 0; i < 5; i++) {
      const entry = town.buyback[i];
      this.paintSlot(this.buybackSlots[i], entry?.item, entry ? this.priceTag(entry.price) : '');
    }
    const v = town.commonsValue();
    this.el.sellCommons.textContent = v ? `Sell all common items · +${v}g` : 'No common items to sell';
    this.el.sellCommons.disabled = !v;
    this.updateRestock();
  }

  updateRestock() {
    const s = this.game.town.secondsToRestock();
    this.el.restock.textContent = `new stock in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  refreshStash() {
    const p = this.game.player;
    p.stash.forEach((it, i) => this.paintSlot(this.stashSlots[i], it));
    this.el.stashCount.textContent = `${p.stash.filter(Boolean).length} / ${p.stash.length}`;
  }

  refreshCharacter() {
    const p = this.game.player;
    const labels = { head: 'Head', back: 'Back', weapon: 'Weapon', offhand: 'Off-hand', hands: 'Hands', feet: 'Feet', ring1: 'Ring', ring2: 'Ring' };
    for (const d of document.querySelectorAll('.eq-slot')) {
      const it = p.equipment[d.dataset.slot];
      d.className = `eq-slot${it ? ` r-${it.rarity}` : ''}`;
      d.innerHTML = it ? this.slotHtml(it) : `<span>${labels[d.dataset.slot]}</span>`;
    }
    const s = p.stats;
    const rows = [
      ['Level', p.level], ['Damage', `${s.dmgLo}–${s.dmgHi}`],
      ['Life', Math.round(s.maxHp)], ['Attack speed', s.atkSpeed.toFixed(2)],
      ['Mana', Math.round(s.maxMp)], ['Critical', `${Math.round(s.crit * 100)}%`],
      ['Armor', `${s.armor} (${Math.round(s.dr * 100)}%)`], ['Spell power', `${Math.round(s.spell * 100)}%`],
      ['Life regen', `${s.regen.toFixed(1)}/s`], ['Move speed', `${Math.round((s.moveSpeed / 5.6) * 100)}%`],
    ];
    this.el.stats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  // compare: show ▲/▼ against the equipped item it would replace; hint: grey line at the bottom.
  itemTip(item, { compare = false, hint = null } = {}) {
    const r = RARITY[item.rarity];
    const { main, implicit, aff } = itemLines(item);
    let cmp = '';
    if (compare) {
      // compare against what it would replace (for rings: the ring that would come off)
      const p = this.game.player;
      const cur = p.equipment[p.slotFor(item)];
      const line = (d, text) => `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${text}</span>`;
      const parts = [];
      if (item.slot === 'ring' && p.equipment.ring1 && p.equipment.ring2) {
        parts.push(`<span class="tt-replaces">Replaces ${cur.name}</span>`);
      }
      if (item.stats.dmgMin) {
        const dps = (st) => (st?.dmgMin ? ((st.dmgMin + st.dmgMax) / 2) * st.speed : 3.9);
        const d = dps(item.stats) - dps(cur?.stats);
        if (Math.abs(d) >= 0.05) parts.push(line(d, `${Math.abs(d).toFixed(1)} damage per second`));
      }
      for (const [k, label, kind] of COMPARE_STATS) {
        const d = (item.stats[k] || 0) - (cur?.stats[k] || 0);
        const v = kind === 'pct' ? `${Math.round(Math.abs(d) * 100)}%` : kind === 'dec' ? Math.abs(d).toFixed(1) : String(Math.round(Math.abs(d)));
        if (/^0(\.0)?%?$/.test(v)) continue;
        parts.push(line(d, `${v} ${label}`));
      }
      if (parts.length) cmp = `<div class="tt-cmp">${parts.join('<br>')}</div>`;
    }
    return `<div class="tt-name" style="color:${r.color}">${item.name}</div>
      <div class="tt-type">${item.rarity === 'common' ? '' : `${r.label} `}${item.type} · item level ${item.ilvl}</div>
      ${main.map((l) => `<div class="tt-main">${l}</div>`).join('')}
      ${implicit.map((l) => `<div>${l}</div>`).join('')}
      ${aff.map((l) => `<div class="tt-aff">${l}</div>`).join('')}
      ${cmp}${hint ? `<div class="tt-hint">${hint}</div>` : ''}`;
  }

  showTip(target, htmlFn) {
    const html = htmlFn();
    if (!html) return;
    this.tipTarget = target;
    this.tipFn = htmlFn;
    this.el.tooltip.innerHTML = html;
    this.el.tooltip.classList.remove('hidden');
    this.placeTip();
  }

  maybeTip(target) {
    if (this.tipFn && target.matches(':hover')) this.showTip(target, this.tipFn);
  }

  hideTip() {
    this.tipTarget = null;
    this.el.tooltip.classList.add('hidden');
  }

  placeTip() {
    const t = this.el.tooltip;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = this.mouse.x + 16, y = this.mouse.y + 16;
    if (x + w > window.innerWidth - 8) x = this.mouse.x - w - 16;
    if (y + h > window.innerHeight - 8) y = this.mouse.y - h - 16;
    t.style.left = `${Math.max(8, x)}px`;
    t.style.top = `${Math.max(8, y)}px`;
  }

  // ---------------------------------------------------------------- minimap
  drawMinimap() {
    const g = this.game, ctx = this.mm, S = 180, places = g.places, map = places.map, inside = map.kind === 'dungeon';
    const base = places.view.minimap, R = base.range, ox = base.cx || 0, oz = base.cz || 0;
    const m = (x, z) => [((x - ox + R) / (2 * R)) * S, ((z - oz + R) / (2 * R)) * S];
    const onMap = ([x, y]) => x > -8 && x < S + 8 && y > -8 && y < S + 8;
    const diamond = ([x, y], r, fill, stroke) => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
    };
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(base.canvas, 0, 0, S, S);
    if (!inside) { // the camp, its waystone and the dungeon doors
      diamond(m(map.camp.x, map.camp.z), 5, '#ffcf6a', '#3a2a14');
      diamond(m(map.waystone.x, map.waystone.z), 3.5, '#7fe0ff', '#0a2a3a');
      for (const p of map.portals) if (p.id !== 'waystone') diamond(m(p.x, p.z), 3.5, '#c79aff', '#1a0a2a');
    }
    // quest targets: a dashed gold ring on the zone; a gold "!" on the board when it has news
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255, 210, 90, 0.95)';
    ctx.lineWidth = 1.6;
    for (const { q } of g.quests.tracked()) {
      const zone = q.state === 'active' && places.questRing(q.def.zone);
      if (!zone) continue;
      const [zx, zy] = m(zone.x, zone.z);
      ctx.beginPath();
      ctx.arc(zx, zy, (zone.r / (2 * R)) * S + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (g.quests.markerVisible() && map.id === 'emberwood') {
      const [bx, by] = m(TOWN.board.x, TOWN.board.z);
      ctx.font = '900 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2a1a06';
      ctx.strokeText('!', bx + 5, by - 3);
      ctx.fillStyle = '#ffd24a';
      ctx.fillText('!', bx + 5, by - 3);
    }
    for (const l of g.loot.list) {
      if (l.kind !== 'item') continue;
      const pt = m(l.group.position.x, l.group.position.z);
      if (!onMap(pt)) continue;
      ctx.fillStyle = RARITY[l.data.rarity].color;
      ctx.fillRect(pt[0] - 2, pt[1] - 2, 4, 4);
    }
    for (const o of g.others.list) { // other heroes
      const [x, y] = m(o.pos.x, o.pos.z);
      if (!onMap([x, y])) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = o.alive ? '#5fd4ff' : '#4a6a78';
      ctx.fill();
      ctx.strokeStyle = '#06222c';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const [x, y] = m(e.pos.x, e.pos.z);
      if (!onMap([x, y])) continue;
      ctx.beginPath();
      ctx.arc(x, y, e.def.boss ? 4.5 : 2.3, 0, Math.PI * 2);
      ctx.fillStyle = e.def.boss ? '#ff8a2b' : '#ff4a3a';
      ctx.fill();
      if (e.def.boss) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    const p = g.player;
    const [px, py] = m(p.pos.x, p.pos.z);
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    ctx.beginPath();
    ctx.moveTo(px + fx * 6, py + fz * 6);
    ctx.lineTo(px - fx * 4 + fz * 4, py - fz * 4 - fx * 4);
    ctx.lineTo(px - fx * 2, py - fz * 2);
    ctx.lineTo(px - fx * 4 - fz * 4, py - fz * 4 + fx * 4);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  // Black screen with a line of text while going down to (or up from) the crypt.
  fade(on, text = '') {
    if (text) this.el.fade.querySelector('span').textContent = text;
    this.el.fade.classList.toggle('on', on);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const p = this.game.player, s = p.stats;
    this.el.hpFill.style.transform = `scaleX(${Math.max(0, p.hp / s.maxHp).toFixed(3)})`;
    this.el.mpFill.style.transform = `scaleX(${Math.max(0, p.mp / s.maxMp).toFixed(3)})`;
    this.el.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(s.maxHp)}`;
    this.el.mpText.textContent = `${Math.floor(p.mp)} / ${Math.round(s.maxMp)}`;
    if (p.level >= MAX_LEVEL) {
      this.el.xpFill.style.transform = 'scaleX(1)';
      this.el.xpText.textContent = `Level ${p.level} · the highest level for now`;
    } else {
      const need = xpForLevel(p.level);
      this.el.xpFill.style.transform = `scaleX(${Math.min(1, p.xp / need).toFixed(3)})`;
      this.el.xpText.textContent = `Level ${p.level} · ${p.xp} / ${need} XP`;
    }
    this.el.lvl.textContent = p.level;
    this.updateActionBar();
    this.updatePlates();
    this.updateFloaters(dt);
    if (this.invOpen && this.invMode === 'vendor') {
      this._rsT = (this._rsT || 0) + dt;
      if (this._rsT > 0.5) { this._rsT = 0; this.updateRestock(); }
    }
    this._mmT = (this._mmT || 0) + dt;
    if (this._mmT > 0.05) { this._mmT = 0; this.drawMinimap(); }
    if (this.tipTarget && this.tipFn && this.tipTarget.classList.contains('slot')) {
      this.el.tooltip.innerHTML = this.tipFn();
    }
  }
}

// HTML HUD: bars, the action bar, the target frame and combo counter, nameplates, floating numbers, the
// minimap, and the panels beside the bag: character, merchants, bank, notice board, anvil (the skill window
// is skillui.js).
import * as THREE from 'three';
import { Assets, iconFor } from './assets.js';
import {
  ITEMS, SLOT_LABEL, itemDef, itemStats, itemLines, itemName, itemColor, typeLine, cannotUse, sellPrice, upgradeCost,
  MAX_PLUS, UNIQUE_COLOR, STAT_LINES,
} from './items.js';
import { xpForLevel, MAX_LEVEL, BAG_SIZE, BAR_SIZE, POTION_CD } from './player.js';
import { BANK_SIZE } from './bank.js';
import { CLASSES } from './classes.js';
import { CAMPS } from './camps.js';
import { MAPS } from './maps.js';
import { SKILLS, BUFFS, manaCost } from './skills.js';
import { questReward } from './quests.js';
import { SkillWindow } from './skillui.js';
import { rand } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// The attack button: a sword, a bolt or a bow (the skills' icons are in skills/).
const HOLD = 300; // ms a finger rests on a bag item before it can be dragged
const ATTACK_SVG = {
  sword: `<svg viewBox="0 0 32 32"><path d="M27.5 4.5 26 10.5 12.5 24 8 19.5 21.5 6z" fill="#e3e9f0" stroke="#5d6875" stroke-width="1.2" stroke-linejoin="round"/><path d="M21.5 6 26 10.5" stroke="#fff" stroke-width="1" opacity=".7"/><path d="M6 17.5l8.5 8.5" stroke="#d6aa4a" stroke-width="3.2" stroke-linecap="round"/><path d="M9.2 22.8 4.5 27.5" stroke="#7a4f2c" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  bolt: `<svg viewBox="0 0 32 32"><path d="M4 26l9-9M6 29l8-8M2 21l8-8" stroke="#b99cff" stroke-width="1.8" stroke-linecap="round" opacity=".7"/><circle cx="20" cy="12" r="7.5" fill="#8a6dff" stroke="#3a2a7a" stroke-width="1.3"/><circle cx="18" cy="10" r="3" fill="#e6dcff"/></svg>`,
  arrow: `<svg viewBox="0 0 32 32"><path d="M7 3c9 5 9 21 0 26" fill="none" stroke="#c8a070" stroke-width="2.4"/><path d="M7 3v26" stroke="#e8e0d0" stroke-width="1"/><path d="M9 16h19" stroke="#e8e0d0" stroke-width="2"/><path d="M29 16l-5-3v6z" fill="#fff"/></svg>`,
  auto: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="#9be06a" stroke-width="2.4" stroke-dasharray="5 3"/><path d="M13 10l9 6-9 6z" fill="#d8ffc0"/></svg>`,
};
const BUFF_COLOR = { war_cry: '#ffd060', shield_wall: '#8fc0ff', last_stand: '#ff5a4a', battle_rage: '#ff4a2a', poison_blade: '#7dff4a', smoke: '#9a96a8', vanish: '#9a6dff', swiftness: '#bfe8ff', shadow_mantle: '#a08aff', blessing: '#ffe08a', holy_armor: '#fff0c0', divine_shield: '#ffe7a0', sanctuary: '#ffe08a', renew: '#7dff9a', elixir_might: '#ff6a2a', elixir_iron: '#a8b4c4', elixir_vigor: '#4ad46a' };

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hpFill: $('hp-fill'), hpText: $('hp-text'), mpFill: $('mp-fill'), mpText: $('mp-text'), mpBar: $('mp-fill').parentElement,
      xpFill: $('xp-fill'), xpText: $('xp-text'), lvl: $('lvl'), portrait: $('portrait'), slots: $('slots'),
      plates: $('plates'), floaters: $('floaters'), log: $('log'), zoneToast: $('zone-toast'), centerMsg: $('center-msg'),
      boss: $('boss'), bossName: $('boss-name'), bossFill: $('boss-fill'), minimap: $('minimap'), zoneName: $('zone-name'),
      inventory: $('inventory'), bag: $('bag'), stats: $('stats'), gold: $('gold'), tooltip: $('tooltip'),
      death: $('death'), vignette: $('vignette'), help: $('help'), bagHint: $('bag-hint'),
      questList: $('quest-list'), tracker: $('tracker'), fade: $('fade'), settings: $('settings'),
      target: $('target'), targetName: $('target-name'), targetFill: $('target-fill'), targetText: $('target-text'), targetFx: $('target-fx'),
      combo: $('combo'), comboN: $('combo-n'), comboWord: $('combo-word'), channel: $('channel'), buffs: $('buffs'),
    };
    this.plates = [];
    this.floaters = [];
    this.v = new THREE.Vector3();
    this.mm = this.el.minimap.getContext('2d');
    this.invOpen = false;
    this.invMode = 'character'; // character | shop | bank | board | anvil: which panel sits next to the bag
    this.npc = null; // the merchant, banker, board or anvil the panel is for
    this.anvilSel = null; // { where: 'eq' | 'bag', index }
    this.tipTarget = null;
    this.mouse = { x: 0, y: 0 };
    this.el.portrait.src = Assets.icons.portrait;

    // Item grids. Mouse: hover shows the tooltip, a click does the obvious thing (equip, sell at a merchant,
    // store at the bank, pick at the anvil), a right-click opens a menu. Touch: a tap opens the menu.
    const p = () => this.game.player;
    this.bagSlots = this.makeSlots(this.el.bag, BAG_SIZE, {
      click: (i, d) => this.bagClick(i, d), menu: (i, d) => this.bagMenu(i, d),
      tip: (i) => p().bag[i] && this.itemTip(p().bag[i], { compare: true, hint: this.bagHint(p().bag[i]) }),
    });
    this.dragBag();
    this.bankSlots = this.makeSlots($('bank'), BANK_SIZE, {
      click: (i) => this.game.bank.take(i), menu: (i, d) => this.bankMenu(i, d),
      tip: (i) => this.game.bank.items[i] && this.itemTip(this.game.bank.items[i], { compare: true, hint: this.touch ? null : 'Click to take' }),
    });
    this.buybackSlots = this.makeSlots($('buyback'), 6, {
      cls: 'shop-slot', click: (i) => this.game.npcs.buyBack(i), menu: (i, d) => this.buybackMenu(i, d),
      tip: (i) => { const e = this.game.npcs.buyback[i]; return e && this.itemTip(e.item, { compare: true, hint: `Buy back for ${e.price}g` }); },
    });
    for (const d of document.querySelectorAll('.eq-slot')) {
      const slot = d.dataset.slot;
      d.addEventListener('click', () => this.equipClick(slot, d));
      d.addEventListener('contextmenu', (e) => { e.preventDefault(); this.equipMenu(slot, d); });
      d.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(d, () => { const it = p().equipment[slot]; return it ? this.itemTip(it, { hint: this.invMode === 'anvil' ? 'Click to pick it for the anvil' : 'Click to take it off' }) : `<div class="tt-type">${SLOT_LABEL[slot]}</div>`; }); });
      d.addEventListener('mouseleave', () => { if (!this.touch) this.hideTip(); });
    }
    // merchants: a buy button on each row
    $('shop').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-buy]');
      if (b) { this.game.npcs.buy(b.dataset.buy, Number(b.dataset.n) || 1); this.game.quests.onEvent('buy', { role: this.npc?.n.role }); }
    });
    $('recipes').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-buy]');
      if (b) this.game.npcs.buy(b.dataset.buy, Number(b.dataset.n) || 1);
    });
    for (const list of [$('shop'), $('recipes')]) {
      list.addEventListener('mouseover', (e) => {
        const row = e.target.closest('.shop-row');
        if (!row || this.touch) return;
        this.showTip(row, () => this.itemTip({ k: row.dataset.key, p: ITEMS[row.dataset.key].unique ? 0 : 1, n: 1 }, { compare: true }));
      });
      list.addEventListener('mouseleave', () => { if (!this.touch) this.hideTip(); });
      list.addEventListener('click', (e) => {
        if (!this.touch || e.target.closest('button')) return;
        const row = e.target.closest('.shop-row');
        if (row) this.openMenu(row, this.itemTip({ k: row.dataset.key, p: 1, n: 1 }, { compare: true }), []);
      });
    }
    $('sell-junk').addEventListener('click', () => this.sellJunk());
    // selling: pick items, then confirm (a click never sells by itself: nothing goes by mistake)
    this.selling = null; // ids of the bag items picked, while picking
    $('sell-mode').addEventListener('click', () => (this.selling ? this.stopSelling() : this.startSelling()));
    $('sell-go').addEventListener('click', () => this.sellPicked());
    $('sell-cancel').addEventListener('click', () => this.stopSelling());
    // the bank's gold
    $('gold-in').addEventListener('click', () => this.game.bank.deposit(Number($('gold-amount').value) || this.game.player.gold));
    $('gold-out').addEventListener('click', () => this.game.bank.withdraw(Number($('gold-amount').value) || this.game.bank.gold));
    // quest cards: Accept / Abandon / Claim
    this.el.questList.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) this.game.quests[b.dataset.act](b.dataset.id);
    });
    // the anvil
    $('anvil-pick').addEventListener('click', (e) => {
      const d = e.target.closest('[data-where]');
      if (d) { this.anvilSel = { where: d.dataset.where, index: d.dataset.where === 'eq' ? d.dataset.index : Number(d.dataset.index) }; this.refreshAnvil(); }
    });
    $('anvil-detail').addEventListener('click', (e) => {
      if (e.target.closest('#anvil-go') && this.anvilSel) this.game.npcs.upgrade(this.anvilSel.where, this.anvilSel.index);
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
    $('btn-skills').addEventListener('click', () => this.skills.toggle());
    $('btn-full').addEventListener('click', () => this.toggleFullscreen());
    this.bindSettings();
    $('respawn').addEventListener('click', () => this.game.player.respawn());
    this.skills = new SkillWindow(game, this);
    this.buildActionBar();
  }

  // The hero in play: portrait and name on the HUD, refreshed bar, bag and quests.
  setCharacter(char) {
    this.el.portrait.src = Assets.icons[`portrait_${char.cls}_${char.look || 0}`] || Assets.icons.portrait;
    $('pname').innerHTML = `${esc(char.name)} <small>${CLASSES[char.cls].name}</small>`;
    this.setTarget(null);
    this.buildActionBar();
    this.refreshInventory();
    this.refreshTracker();
    this.refreshBuffs();
    this.skills.refresh();
  }

  refreshSkills() {
    this.skills.refresh();
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

  // A grid of item slots: click (the obvious action), menu (right-click; a tap on touch screens), tooltips.
  makeSlots(parent, n, { click, tip, menu = null, cls = '' }) {
    return Array.from({ length: n }, (_, i) => {
      const d = document.createElement('div');
      d.dataset.cls = cls;
      d.className = `bag-slot ${cls}`;
      d.addEventListener('click', () => {
        if (performance.now() - (this.dragEndedAt || 0) < 150) return; // (the click that ends a drag)
        if (this.touch && menu) menu(i, d); else { click(i, d); this.hideTip(); this.maybeTip(d); }
      });
      d.addEventListener('contextmenu', (e) => { e.preventDefault(); if (menu && !this.touch) menu(i, d); });
      d.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(d, () => tip(i)); });
      d.addEventListener('mouseleave', () => { if (!this.touch) this.hideTip(); });
      parent.appendChild(d);
      return d;
    });
  }

  atMerchant() {
    return this.invOpen && (this.invMode === 'shop' || this.invMode === 'anvil');
  }

  bagHint(it) {
    const d = itemDef(it);
    if (this.selling) return `Click to ${this.selling.has(it.id) ? 'leave it' : `sell it (${sellPrice(it)}g)`}`;
    if (this.invMode === 'bank' && this.invOpen) return 'Click to put it in the bank · drag to move it';
    if (this.invMode === 'anvil' && this.invOpen && !d.stack) return 'Click to pick it for the anvil · right-click for more';
    return `${d.stack ? 'Click to use' : 'Click to equip'} · drag to move it · right-click for more`;
  }

  // the obvious action for a bag item, by the panel open next to the bag (while trading: offer it)
  bagClick(i) {
    const p = this.game.player, it = p.bag[i];
    if (!it) return;
    if (this.selling) return this.pickToSell(i);
    if (this.game.trade?.isOpen) return this.game.trade.offerFromBag(i);
    if (this.invOpen && this.invMode === 'bank') return this.game.bank.store(i), this.game.quests.onEvent('bank');
    if (this.invOpen && this.invMode === 'anvil' && !itemDef(it).stack) { this.anvilSel = { where: 'bag', index: i }; return this.refreshAnvil(); }
    if (itemDef(it).stack) return p.useItem(i);
    p.equipFromBag(i);
  }

  // every action for a bag item
  bagMenu(i, d) {
    const p = this.game.player, it = p.bag[i];
    if (!it) return this.closeMenu();
    if (this.selling) { this.closeMenu(); return this.pickToSell(i); } // (a tap picks, while selling)
    const def = itemDef(it), acts = [];
    if (this.game.trade?.isOpen) return this.openMenu(d, this.itemTip(it), [[this.game.trade.isOffered(it) ? 'Take back' : 'Offer', () => this.game.trade.offerFromBag(i)]]);
    if (def.stack) { if (def.kind !== 'recipe') acts.push(['Use', () => p.useItem(i)]); }
    else {
      const slots = (def.slot === 'ring' ? ['ring1', 'ring2'] : def.slot === 'ear' ? ['ear1', 'ear2'] : null);
      if (slots && p.equipment[slots[0]] && p.equipment[slots[1]]) acts.push(['Left', () => p.equipFromBag(i, slots[0])], ['Right', () => p.equipFromBag(i, slots[1])]);
      else acts.push(['Equip', () => p.equipFromBag(i)]);
    }
    if (this.invOpen && this.invMode === 'bank') acts.unshift(['Bank it', () => { this.game.bank.store(i); this.game.quests.onEvent('bank'); }]);
    if (this.invOpen && this.invMode === 'anvil' && !def.stack) acts.unshift(['Anvil', () => { this.anvilSel = { where: 'bag', index: i }; this.refreshAnvil(); }]);
    if (!acts.length) acts.push(['Close', () => {}]);
    this.openMenu(d, this.itemTip(it, { compare: true }), acts);
  }

  bankMenu(i, d) {
    const it = this.game.bank.items[i];
    if (!it) return this.closeMenu();
    this.openMenu(d, this.itemTip(it, { compare: true }), [['Take', () => this.game.bank.take(i)]]);
  }

  buybackMenu(i, d) {
    const e = this.game.npcs.buyback[i];
    if (!e) return this.closeMenu();
    this.openMenu(d, this.itemTip(e.item, { compare: true }), [[`Buy back · ${e.price}g`, () => this.game.npcs.buyBack(i)]]);
  }

  equipClick(slot, d) {
    const p = this.game.player, it = p.equipment[slot];
    if (this.touch) return this.equipMenu(slot, d);
    if (this.invOpen && this.invMode === 'anvil' && it) { this.anvilSel = { where: 'eq', index: slot }; this.refreshAnvil(); return; }
    p.unequip(slot);
    this.hideTip();
  }

  equipMenu(slot, d) {
    const p = this.game.player, it = p.equipment[slot];
    if (!it) return this.closeMenu();
    const acts = [['Take off', () => p.unequip(slot)]];
    if (this.invOpen && this.invMode === 'anvil') acts.unshift(['Anvil', () => { this.anvilSel = { where: 'eq', index: slot }; this.refreshAnvil(); }]);
    this.openMenu(d, this.itemTip(it), acts);
  }

  // The items in the bag the hero can't use, picked to sell (at a merchant): still to be confirmed.
  sellJunk() {
    const ids = this.game.player.bag.filter((it) => it && this.isJunk(it)).map((it) => it.id);
    if (!ids.length) { this.centerMsg('Nothing to sell'); return; }
    this.startSelling(ids);
  }

  // ---------------------------------------------------------------- selling: pick, then confirm
  startSelling(ids = []) {
    this.closeMenu();
    this.hideTip();
    this.selling = new Set(ids);
    this.refreshInventory();
  }

  stopSelling() {
    if (!this.selling) return;
    this.selling = null;
    this.refreshInventory();
  }

  pickToSell(i) {
    const it = this.game.player.bag[i];
    if (!it) return;
    if (this.selling.has(it.id)) this.selling.delete(it.id); else this.selling.add(it.id);
    this.refreshInventory();
  }

  sellPicked() {
    const p = this.game.player, g = this.game;
    let n = 0, gold = 0;
    p.bag.forEach((it, i) => { if (it && this.selling?.has(it.id)) { gold += p.sell(i, true); n++; } });
    this.selling = null;
    if (n) {
      g.sfx.play('gold');
      this.log(`Sold <b>${n} item${n > 1 ? 's' : ''}</b> for <b>${gold}g</b>${this.atMerchant() ? ' (the merchant sells them back for that, until you leave)' : ''}`, 'gold');
      g.save();
    }
    this.refreshInventory();
  }

  refreshSellBar() {
    const p = this.game.player, on = !!this.selling;
    $('sell-bar').classList.toggle('hidden', !on);
    $('sell-mode').textContent = on ? 'Stop selling' : 'Sell…';
    $('sell-mode').classList.toggle('on', on);
    if (!on) return;
    const picked = p.bag.filter((it) => it && this.selling.has(it.id));
    const gold = picked.reduce((sum, it) => sum + sellPrice(it), 0);
    $('sell-sum').innerHTML = picked.length ? `<b>${picked.length}</b> picked · <b>${gold}g</b>` : `${this.touch ? 'Tap' : 'Click'} the items to sell`;
    $('sell-go').disabled = !picked.length;
  }

  // ---------------------------------------------------------------- moving items in the bag
  // Drag one slot onto another: with a mouse, press and move; on a touch screen, hold a moment, then move (a
  // tap is still the item's menu, and a swipe still scrolls). The hold is timed by the touches' own times, so
  // a busy phone can't turn a tap into a drag.
  dragBag() {
    const ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    ghost.className = 'hidden';
    document.body.appendChild(ghost);
    let drag = null; // { from, el, x, y, on }
    const slotAt = (x, y) => {
      const el = document.elementFromPoint(x, y)?.closest('.bag-slot');
      const i = el ? this.bagSlots.indexOf(el) : -1;
      return i >= 0 ? i : null;
    };
    this.el.bag.addEventListener('dragstart', (e) => e.preventDefault()); // (not the browser's own image dragging)
    const begin = () => {
      drag.on = true;
      this.dragging = true;
      drag.el.classList.remove('hold-ready');
      this.closeMenu();
      this.hideTip();
      ghost.innerHTML = this.slotHtml(this.game.player.bag[drag.from]);
      ghost.classList.remove('hidden');
      drag.el.classList.add('dragging');
      navigator.vibrate?.(12);
    };
    const move = (x, y) => {
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
      const over = slotAt(x, y);
      for (const [i, el] of this.bagSlots.entries()) el.classList.toggle('drop-here', i === over && i !== drag.from);
    };
    const end = (x, y) => {
      const d = drag;
      drag = null;
      clearTimeout(d.timer);
      if (!d.on) return;
      this.dragging = false;
      ghost.classList.add('hidden');
      d.el.classList.remove('dragging');
      for (const el of this.bagSlots) el.classList.remove('drop-here');
      this.dragEndedAt = performance.now(); // (the click that follows a drop isn't a click)
      const to = x === null ? null : slotAt(x, y);
      if (to !== null && to !== d.from && this.game.player.moveItem(d.from, to) && this.anvilSel?.where === 'bag') {
        const sel = this.anvilSel.index;
        if (sel === d.from || sel === to) this.anvilSel.index = sel === d.from ? to : d.from;
      }
    };
    this.bagSlots.forEach((el, i) => {
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || !this.game.player.bag[i]) return;
        drag = { from: i, el, x: e.clientX, y: e.clientY, on: false };
      });
      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1 || !this.game.player.bag[i]) return;
        const t = e.touches[0];
        drag = { from: i, el, x: t.clientX, y: t.clientY, at: e.timeStamp, on: false, touch: true };
        drag.timer = setTimeout(() => { if (drag?.from === i && !drag.on) el.classList.add('hold-ready'); }, HOLD); // (it can go now)
      }, { passive: true });
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag || drag.touch) return;
      if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) begin();
      if (drag.on) move(e.clientX, e.clientY);
    });
    window.addEventListener('pointerup', (e) => { if (drag && !drag.touch) end(e.clientX, e.clientY); });
    window.addEventListener('touchmove', (e) => {
      if (!drag?.touch) return;
      const t = e.touches[0];
      if (!drag.on) {
        if (Math.hypot(t.clientX - drag.x, t.clientY - drag.y) <= 10) return;
        if (e.timeStamp - drag.at < HOLD) { clearTimeout(drag.timer); drag.el.classList.remove('hold-ready'); drag = null; return; } // (a swipe: it scrolls)
        begin();
      }
      e.preventDefault(); // (no scrolling while dragging)
      move(t.clientX, t.clientY);
    }, { passive: false });
    window.addEventListener('touchend', (e) => {
      if (!drag?.touch) return;
      const t = e.changedTouches[0];
      e.preventDefault(); // (no click from the browser: right after a drag it may not send one at all)
      if (!drag.on) { // a tap (or a hold let go without moving): the item's menu, from here
        const d = drag;
        drag = null;
        clearTimeout(d.timer);
        d.el.classList.remove('hold-ready');
        this.bagMenu(d.from, d.el);
        return;
      }
      end(t ? t.clientX : null, t ? t.clientY : null);
    }, { passive: false });
    window.addEventListener('touchcancel', () => { if (drag?.touch) end(null, null); });
  }

  isJunk(it) {
    const d = itemDef(it), p = this.game.player;
    return d && !d.stack && !d.unique && d.kind !== 'acc' && (it.p ?? 1) <= 1 && d.classes && !d.classes.includes(p.cls);
  }

  // Tooltip with action buttons, anchored under (or above) a slot. Used on touch screens and right-clicks.
  openMenu(anchor, html, actions) {
    this.closeMenu();
    const t = this.el.tooltip;
    t.innerHTML = `${html}${actions.length ? '<div class="tt-actions"></div>' : ''}`;
    const row = t.querySelector('.tt-actions');
    for (const [label, fn] of actions) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => { fn(); this.closeMenu(); });
      row.appendChild(b);
    }
    t.classList.remove('hidden');
    t.classList.add('menu');
    this.tipTarget = null; // (a menu stays where it opened: it doesn't follow the mouse like a tooltip)
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

  // A menu at a point on screen (another hero, right-clicked in the world).
  openMenuAt(x, y, html, actions) {
    const anchor = document.createElement('div');
    anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px;`;
    document.body.appendChild(anchor);
    this.openMenu(anchor, html, actions);
    this.menuTemp = anchor;
  }

  closeMenu() {
    if (!this.menuAnchor) return;
    this.menuAnchor.classList.remove('selected');
    this.menuAnchor = null;
    this.menuTemp?.remove();
    this.menuTemp = null;
    this.el.tooltip.classList.remove('menu', 'slots-menu');
    this.hideTip();
  }

  // ---------------------------------------------------------------- action bar
  // The attack, eight skill slots (keys 1–8; six on phones), potions (Q, X) and auto (T).
  buildActionBar() {
    const p = this.game.player, s = p.stats || {};
    const ranged = s.ranged === 'arrow' ? 'arrow' : s.ranged ? 'bolt' : 'sword';
    const attackTip = () => `<div class="tt-name">Attack</div><div class="tt-type">R · or click your target</div>Hit your target (the nearest foe if you have none). <b>Combo:</b> press again just as a blow lands for a faster, stronger chain: up to four. Hold to keep attacking (no combo).`;
    const defs = [
      { key: 'R', attack: true, cls: 'slot-attack', icon: ATTACK_SVG[ranged], tip: attackTip },
      ...Array.from({ length: BAR_SIZE }, (_, i) => ({ key: String(i + 1), bar: i, cls: `slot-s${i + 1}${i >= 6 ? ' desk-only' : ''}`, sep: i === 0 })),
      { key: 'Q', potion: 'hp', cls: 'slot-hp', sep: true, icon: `<img src="${iconFor('hp_potion_1')}" alt="">`, tip: () => `<div class="tt-name">Healing potion</div><div class="tt-type">Q · ${this.potionCount('hp')} left</div>Drinks your strongest healing potion. The provisioner in camp sells them.` },
      { key: 'X', potion: 'mp', cls: 'slot-mp', icon: `<img src="${iconFor('mp_potion_1')}" alt="">`, tip: () => `<div class="tt-name">Mana potion</div><div class="tt-type">X · ${this.potionCount('mp')} left</div>Drinks your strongest mana potion.` },
      { key: 'T', auto: true, cls: 'slot-auto', icon: ATTACK_SVG.auto, tip: () => '<div class="tt-name">Auto-hunt</div><div class="tt-type">T</div>Your hero fights the monsters around where you switch it on, picks up the loot and drinks potions when hurt. Any move switches it off.' },
    ];
    this.el.slots.innerHTML = '';
    this.slotEls = defs.map((d) => {
      const el = document.createElement('div');
      el.className = `slot ${d.cls}${d.sep ? ' sep' : ''}`;
      el.innerHTML = `<div class="icon">${d.icon || ''}</div><div class="cd"></div><div class="cdnum"></div><span class="key">${d.key}</span><span class="count"></span><span class="lock"></span>`;
      const tip = d.bar !== undefined ? () => this.skillSlotTip(d.bar) : d.tip;
      el.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(el, tip); });
      el.addEventListener('mouseleave', () => this.hideTip());
      if (d.attack) this.bindAttackSlot(el);
      else {
        // pointerdown, not click: buttons react the instant a thumb lands
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (d.bar !== undefined) { if (p.sk.bar[d.bar]) p.useSkill(d.bar); else this.skills.open(); }
          else if (d.potion) p.drink(d.potion);
          else if (d.auto) p.control.toggleAuto();
        });
      }
      this.el.slots.appendChild(el);
      return { el, d, icon: el.querySelector('.icon'), cd: el.querySelector('.cd'), cdnum: el.querySelector('.cdnum'), count: el.querySelector('.count'), lock: el.querySelector('.lock'), wasCd: false, shown: undefined };
    });
  }

  // The attack slot: a tap or click is a press (combos), holding it keeps attacking.
  bindAttackSlot(el) {
    let id = null, holdT = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch { /* fine */ }
      el.classList.add('pressed');
      this.game.player.control.pressAttack();
      holdT = setTimeout(() => this.game.player.control.holdAttack(true), 350);
    });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      clearTimeout(holdT);
      this.game.player.control.holdAttack(false);
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  potionCount(use) {
    const p = this.game.player;
    return [1, 2, 3].reduce((n, g) => n + p.count(`${use}_potion_${g}`), 0);
  }

  skillSlotTip(i) {
    const p = this.game.player, id = p.sk.bar[i];
    if (!id) return `<div class="tt-name">Empty slot</div><div class="tt-type">Key ${i + 1}</div>Open your skills (K) and pick one for this slot.`;
    return this.skills.tip(id);
  }

  updateActionBar() {
    const p = this.game.player, g = this.game;
    for (const s of this.slotEls) {
      let cd = 0, max = 1;
      if (s.d.bar !== undefined) {
        const id = p.sk.bar[s.d.bar], sk = SKILLS[id];
        if (s.shown !== id) { // (the slot's skill changed)
          s.shown = id;
          s.icon.innerHTML = sk ? sk.icon : '';
          s.el.classList.toggle('empty', !sk);
        }
        if (!sk) continue;
        cd = p.cd[id] || 0;
        max = sk.cd;
        const blocked = !p.skillOpen(id) ? 'locked' : p.skillBlocked(id) ? 'gear' : null;
        s.el.classList.toggle('locked', !!blocked);
        s.lock.textContent = blocked === 'gear' ? '✕' : '';
        s.el.classList.toggle('nomana', !blocked && p.mp < manaCost(sk, p.level));
      } else if (s.d.potion) {
        cd = p.cd.potion;
        max = POTION_CD;
        const n = this.potionCount(s.d.potion);
        s.count.textContent = n;
        s.el.classList.toggle('locked', n <= 0);
      } else if (s.d.auto) {
        s.el.classList.toggle('on', !!p.control.auto);
      } else if (s.d.attack) {
        // the combo window glows on the attack slot
        const c = p.combo, now = g.time;
        s.el.classList.toggle('window', !!p.action?.swing && now >= c.open && now <= c.until);
        s.el.classList.toggle('perfect', !!p.action?.swing && now >= c.open && now <= c.perfectUntil);
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

  setAuto(on) {
    document.body.classList.toggle('auto-on', on);
  }

  // A question in the middle of the screen with buttons: [[label, fn, 'go'?]]; it goes away by itself after ms.
  prompt(html, buttons, ms = 30000) {
    const el = $('prompt'), row = $('prompt-buttons');
    $('prompt-text').innerHTML = html;
    row.innerHTML = '';
    for (const [label, fn, kind] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      if (kind) b.className = kind;
      b.addEventListener('click', () => { el.classList.add('hidden'); clearTimeout(this._prompt); fn(); });
      row.appendChild(b);
    }
    el.classList.remove('hidden');
    clearTimeout(this._prompt);
    this._prompt = setTimeout(() => el.classList.add('hidden'), ms);
    this.game.sfx.play('page');
  }

  // ---------------------------------------------------------------- the target frame, combos, channels
  setTarget(e) {
    this.targetEnt = e;
    this.el.target.classList.toggle('hidden', !e);
    if (!e) return;
    const hero = e.isHero;
    this.el.target.className = `panel${hero ? (e.hostile ? ' foe' : ' friend') : e.def?.boss ? ' boss' : ''}${e.def?.worldBoss ? ' world' : ''}`;
    this.el.targetName.innerHTML = hero ? `${esc(e.name)} <i>Lv ${e.level} ${CLASSES[e.cls]?.name || ''}</i>` : `${esc(e.def.name)} <i>Lv ${e.level}</i>`;
  }

  updateTarget() {
    const e = this.targetEnt;
    if (!e) return;
    const frac = e.isHero ? e.hp : Math.max(0, e.hp / e.maxHp);
    this.el.targetFill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
    this.el.targetText.textContent = e.isHero ? (e.alive ? `${Math.round(frac * 100)}%` : 'Fallen') : `${Math.max(0, Math.ceil(e.hp))} / ${e.maxHp}`;
    const fx = [];
    if (e.stunT > 0) fx.push('<b class="fx-stun">Stunned</b>');
    if (e.slowT > 0) fx.push('<b class="fx-slow">Slowed</b>');
    if (e.dotT > 0) fx.push('<b class="fx-dot">Poisoned</b>');
    if (e.weakT > 0) fx.push('<b class="fx-weak">Weakened</b>');
    if (e.vulnT > 0) fx.push('<b class="fx-vuln">Exposed</b>');
    if (e.def?.worldBoss && e.state !== 'chase') fx.push('<b class="fx-calm">Calm · strike first to fight</b>');
    const html = fx.join('');
    if (html !== this.lastFx) { this.el.targetFx.innerHTML = html; this.lastFx = html; }
  }

  // The combo counter: step 1–3 ('good' or 'perfect'), a skill fired in the window ('skill'), or broken ('early').
  combo(step, kind) {
    const el = this.el.combo;
    if (kind === 'early') { this.el.comboN.textContent = ''; this.el.comboWord.textContent = 'Too early'; }
    else {
      this.el.comboN.textContent = `×${step + 1}`;
      this.el.comboWord.textContent = kind === 'perfect' ? 'Perfect!' : kind === 'skill' ? 'Combo skill!' : step >= 3 ? 'Finisher!' : 'Combo';
    }
    el.className = `show ${kind}`;
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this._combo);
    this._combo = setTimeout(() => { el.className = ''; }, 1100);
    if (kind === 'perfect' || step >= 3) this.game.sfx.play('pickup', 0.6);
  }

  // A bar that fills while something takes a while (reading a camp scroll); null hides it.
  channel(text, dur) {
    const el = this.el.channel;
    if (!text) { el.classList.add('hidden'); this.channelT = null; return; }
    $('channel-text').textContent = text;
    el.classList.remove('hidden');
    this.channelT = { t: 0, dur };
  }

  // Little badges under the hero's frame for what's on it now.
  refreshBuffs() {
    const p = this.game.player, list = Object.entries(p.buffs || {});
    this.el.buffs.innerHTML = list.map(([id, b]) => `<i class="buff" style="--c:${BUFF_COLOR[id] || '#ccc'}" title="${esc(BUFFS[id]?.name || id)}" data-id="${id}"><b>${(BUFFS[id]?.name || id).split(' ').map((w) => w[0]).join('').slice(0, 2)}</b><span></span></i>`).join('');
    this.buffEls = [...this.el.buffs.querySelectorAll('.buff')];
  }

  updateBuffs() {
    const p = this.game.player;
    for (const el of this.buffEls || []) {
      const b = p.buffs[el.dataset.id];
      if (!b) continue;
      const t = Math.ceil(b.t);
      el.lastChild.textContent = t >= 60 ? `${Math.ceil(t / 60)}m` : `${t}`;
    }
  }

  // ---------------------------------------------------------------- plates & labels
  createPlate(enemy) {
    const el = document.createElement('div');
    el.className = `plate${enemy.def.boss ? ' boss' : ''}${enemy.def.worldBoss ? ' world' : ''}`;
    el.innerHTML = `<div class="nm">${enemy.def.name}<i>Lv ${enemy.level}</i></div><div class="hpb"><b></b></div>`;
    this.el.plates.appendChild(el);
    const p = { el, ent: enemy, bar: el.querySelector('b'), kind: 'enemy', max: enemy.def.worldBoss ? 60 : 30 };
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
    el.querySelector('.pn').addEventListener('click', (e) => { e.stopPropagation(); this.game.playerMenu(rp, e.clientX, e.clientY); });
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
    el.classList.toggle('party', !!this.game.party?.has(rp.id));
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
        p.el.classList.toggle('hover', !!e.hover || !!e.selected);
        p.el.classList.toggle('selected', !!e.selected);
      } else if (p.kind === 'player' && p.bar) {
        const o = p.ent;
        p.bar.style.transform = `scaleX(${o.hp.toFixed(3)})`;
        p.el.classList.toggle('hurt', o.hp < 0.999 && o.alive);
        p.el.classList.toggle('down', !o.alive || o.away);
        p.el.classList.toggle('selected', !!o.selected);
      }
    }
  }

  // ---------------------------------------------------------------- floaters
  floater(pos, text, cls = '') {
    if (this.floaters.length > 60) this.floaters.shift().el.remove();
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.el.floaters.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0, dx: cls === 'say' ? 0 : rand(-18, 18), life: cls.startsWith('info') ? 1.8 : cls === 'say' ? 2.6 : 1.0 });
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
  // A line in the log (desktop; the last 12 stay 20 s). Returns it, so it can be added to (gold pickups).
  log(html, cls = '') {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    this.el.log.appendChild(d);
    while (this.el.log.children.length > 12) this.el.log.firstChild.remove();
    this.keepLine(d);
    return d;
  }

  keepLine(d, ms = 20000) {
    clearTimeout(d._fade);
    clearTimeout(d._gone);
    d.classList.remove('fade');
    d._fade = setTimeout(() => d.classList.add('fade'), ms - 1200);
    d._gone = setTimeout(() => d.remove(), ms);
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
    if (show) { // what falling costs here, and where you rise
      const map = this.game.places.map, arena = map.kind === 'arena';
      $('death-title').textContent = arena ? 'Defeated' : 'You have fallen';
      $('death-text').textContent = this.game.deathNote || (arena ? 'No gold is lost in the arena.' : 'Your gold pouch feels lighter…');
      $('respawn').textContent = arena ? 'Back to the yard' : map.kind === 'dungeon' ? 'Rise again outside' : 'Rise again at camp';
      this.game.deathNote = null;
    }
    this.el.death.classList.toggle('hidden', !show);
  }

  togglePanel(id, force) {
    if (id === 'settings') return (force ?? this.el.settings.classList.contains('hidden')) ? this.openSettings() : this.closeSettings();
    if (id === 'inventory') {
      const open = force ?? !(this.invOpen && this.invMode === 'character');
      return open ? this.openInventory('character') : this.closeInventory();
    }
    if (id === 'skills') return (force ?? !this.skills.isOpen) ? this.skills.open() : this.skills.close();
    const el = $(id);
    el.classList.toggle('hidden', !(force ?? el.classList.contains('hidden')));
  }

  // mode: 'character' (I), 'shop', 'bank', 'board' or 'anvil' (at someone in camp: npc). The bag is always shown.
  openInventory(mode = 'character', npc = null) {
    if (this.game.trade?.isOpen && mode !== 'trade') return; // (the bag stays beside the trade until it ends)
    this.closeMenu();
    this.hideTip();
    this.skills.close();
    if (mode !== this.invMode) this.selling = null;
    this.invMode = mode;
    this.npc = npc;
    if (mode === 'anvil') this.anvilSel = null;
    this.el.inventory.dataset.mode = mode;
    this.el.inventory.classList.remove('hidden');
    this.invOpen = true;
    this.game.doll.visible = mode === 'character';
    if (npc && mode !== 'board') this.game.quests.onEvent('talk', { land: npc.land, role: npc.n.role });
    this.refreshInventory();
  }

  closeInventory() {
    if (!this.invOpen) return;
    if (this.invMode === 'trade' && this.game.trade?.isOpen) { this.game.trade.cancel(); return; } // (closing the bag ends the trade)
    this.el.inventory.classList.add('hidden');
    this.invOpen = false;
    this.selling = null;
    this.npc = null;
    this.game.doll.visible = false;
    this.game.npcs?.close();
    this.closeMenu();
    this.hideTip();
  }

  // Desktop: the whole screen for the game (F, or the button); F again (or Esc) to leave it.
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => this.centerMsg('Full screen is not available here'));
    else this.centerMsg('Full screen is not available here');
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

  // Esc: close whatever is open, let go of the target, otherwise open the settings
  escape() {
    if (this.settingsOpen) return this.closeSettings();
    if (this.menuAnchor) return this.closeMenu();
    if (this.selling) return this.stopSelling();
    if (this.game.places?.travelOpen) return this.game.places.closeTravel();
    if (this.game.trade?.isOpen) return this.game.trade.cancel();
    if (this.invOpen || this.skills.isOpen || !this.el.help.classList.contains('hidden')) {
      this.closeInventory();
      this.skills.close();
      this.togglePanel('help', false);
      return;
    }
    if (this.game.player.control.target) return this.game.player.control.clearTarget();
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
    for (const b of document.querySelectorAll('#set-fps button')) {
      b.addEventListener('click', () => { g.setSetting('fps', Number(b.dataset.v)); this.syncSettings(); });
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
    for (const b of document.querySelectorAll('#set-fps button')) b.classList.toggle('on', Number(b.dataset.v) === (s.fps || 60));
  }

  openSettings() {
    this.closeInventory();
    this.skills.close();
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
  slotHtml(it) {
    if (!it) return '';
    const d = itemDef(it);
    const tag = d?.stack ? (it.n > 1 ? `<span class="n">${it.n}</span>` : '') : `<span class="plus">+${it.p ?? 0}</span>`;
    return `<img src="${iconFor(it)}" alt="">${tag}`;
  }

  // rarity border: tier colours, uniques orange; a red tint for what the hero can't use
  paintSlot(d, it, extra = '') {
    const def = itemDef(it), p = this.game.player;
    const r = !def ? '' : def.unique ? ' r-unique' : def.stack ? '' : ` r-${def.tier}`;
    const no = def && !def.stack && cannotUse(it, p.cls, p.level) ? ' cant' : '';
    const offered = this.game.trade?.isOffered(it) ? ' offered' : '';
    const picked = it && this.selling?.has(it.id) ? ' sell-pick' : '';
    d.className = `bag-slot ${d.dataset.cls || ''}${r}${no}${offered}${picked}`;
    d.innerHTML = this.slotHtml(it) + extra;
  }

  priceTag(price) {
    return `<span class="price${this.game.player.gold < price ? ' short' : ''}">${price}</span>`;
  }

  refreshInventory() {
    const p = this.game.player;
    this.el.gold.textContent = p.gold;
    $('btn-bag').classList.toggle('full', p.freeSlot() < 0); // (a full bag: nothing new fits)
    if (!this.invOpen) return;
    this.refreshSellBar();
    p.bag.forEach((it, i) => this.paintSlot(this.bagSlots[i], it));
    const tap = this.touch ? 'tap' : 'click', drag = this.touch ? 'hold to drag' : 'drag to move';
    this.el.bagHint.textContent = this.selling ? `${tap} the items to sell`
      : this.invMode === 'trade' ? `${tap} an item to offer it`
      : this.invMode === 'bank' && !this.touch ? `click to bank it · ${drag}`
      : this.touch ? `tap for options · ${drag}` : `click to equip or use · ${drag} · right-click for more`;
    const junk = this.atMerchant() && p.bag.some((it) => it && this.isJunk(it));
    $('sell-junk').classList.toggle('hidden', !junk);
    if (junk) $('sell-junk').textContent = 'Sell what you can\'t use';
    if (this.invMode === 'shop') this.refreshShop();
    else if (this.invMode === 'bank') this.refreshBank();
    else if (this.invMode === 'board') this.refreshBoard();
    else if (this.invMode === 'anvil') this.refreshAnvil();
    else this.refreshCharacter();
  }

  // ---------------------------------------------------------------- merchants
  shopRows(entries) {
    const p = this.game.player;
    return entries.map(({ item, price }) => {
      const d = itemDef(item), why = d.stack ? (p.level < d.level ? `Needs level ${d.level}` : null) : cannotUse(item, p.cls, p.level);
      const buys = d.stack
        ? `<button data-buy="${d.key}" data-n="1">${price}g</button><button data-buy="${d.key}" data-n="10">×10</button>`
        : `<button data-buy="${d.key}" data-n="1"${p.gold < price ? ' class="short"' : ''}>${price}g</button>`;
      return `<div class="shop-row${why ? ' cant' : ''}" data-key="${d.key}">
        <div class="bag-slot r-${d.unique ? 'unique' : d.stack ? 'common' : d.tier}"><img src="${iconFor(item)}" alt=""></div>
        <div class="sr-text"><b style="color:${itemColor(item)}">${d.name}</b><small>${typeLine(item)}${why ? ` · <em>${why}</em>` : d.level > 1 ? ` · level ${d.level}` : ''}</small></div>
        <div class="sr-buy">${buys}</div></div>`;
    }).join('');
  }

  refreshShop() {
    const npcs = this.game.npcs, e = this.npc;
    if (!e) return;
    $('shop-title').innerHTML = `${esc(e.n.name)} <small>${esc(e.n.title)}</small>`;
    const role = e.n.role, cls = CLASSES[this.game.player.cls].name.toLowerCase();
    $('shop-note').textContent = role === 'goods' ? 'Potions (Q and X drink the strongest you have), elixirs that last ten minutes, and camp scrolls home.'
      : `${role === 'weapons' ? 'Weapons' : 'Clothes'} for a ${cls}, up to level ${npcs.capOf(e)}. Merchants in later lands sell stronger ones.`;
    $('shop').innerHTML = this.shopRows(npcs.stock(e));
    for (let i = 0; i < 6; i++) {
      const entry = npcs.buyback[i];
      this.paintSlot(this.buybackSlots[i], entry?.item, entry ? this.priceTag(entry.price) : '');
    }
  }

  refreshBank() {
    const bank = this.game.bank;
    bank.items.forEach((it, i) => this.paintSlot(this.bankSlots[i], it));
    $('bank-count').textContent = `${bank.used} / ${bank.items.length}`;
    $('bank-gold').textContent = bank.gold;
  }

  // ---------------------------------------------------------------- the notice board
  refreshBoard() {
    const quests = this.game.quests, land = this.npc?.land || this.game.places.id, b = quests.board(land);
    $('board-land').textContent = MAPS[land]?.name || '';
    const sec = (title, list, card) => (list.length ? `<div class="sec-title">${title}</div>${list.map(card).join('')}` : '');
    const active = quests.state.active.length;
    this.el.questList.innerHTML = [
      sec('Rewards waiting', b.claim, (q) => this.questCard(q, 'claim')),
      sec(`Under way <small>${active} / 6</small>`, b.active, (q) => this.questCard(q, 'active')),
      sec('On offer', b.open, (q) => this.questCard(q, 'offer')),
      sec('Later', b.later.slice(0, 4), ({ q, why }) => this.questCard(q, 'later', why)),
      !b.claim.length && !b.active.length && !b.open.length && !b.later.length ? '<div class="quest-card all-done">Every quest of this land is done. Monsters, world bosses and the next land wait.</div>' : '',
    ].join('');
  }

  questCard(q, state, why = '') {
    const quests = this.game.quests, r = questReward(q), a = quests.activeEntry(q.id), goal = q.goal;
    const things = [...r.items, ...r.recipes].map(([k, n]) => `${n > 1 ? `${n} × ` : ''}${ITEMS[k].name}`);
    if (r.gear) things.push(`a ${r.gear.kind === 'weapon' ? 'weapon' : SLOT_LABEL[r.gear.kind].toLowerCase()} for your class`);
    const rewards = [`${r.gold}g`, `${r.xp} XP`, ...things].join(' · ');
    const progress = state === 'active' || state === 'claim' ? `
      <div class="q-goal"><span>${quests.goalLabel(q)}</span><b>${a?.progress ?? 0} / ${goal.count}</b></div>
      <div class="q-bar"><i style="width:${Math.round(((a?.progress ?? 0) / goal.count) * 100)}%"></i></div>` : '';
    const actions = state === 'offer' ? `<button data-act="accept" data-id="${q.id}">Accept</button>`
      : state === 'claim' ? `<button class="claim" data-act="claim" data-id="${q.id}">Claim reward</button>`
        : state === 'active' ? `<button class="ghost" data-act="abandon" data-id="${q.id}">Abandon</button>` : `<span class="q-why">${esc(why)}</span>`;
    return `<div class="quest-card ${state === 'claim' ? 'done' : state}">
      <div class="q-head"><span class="q-title">${q.title}</span><span class="q-lvl">Lv ${q.level}</span></div>
      ${state === 'later' ? '' : `<div class="q-text">${q.text}</div>`}${progress}
      <div class="q-foot"><span class="q-reward">${state === 'later' ? '' : rewards}</span><span class="q-actions">${actions}</span></div>
    </div>`;
  }

  // Accepted quests, shown on screen while you play.
  refreshTracker() {
    const quests = this.game.quests, items = quests.tracked();
    this.el.tracker.classList.toggle('hidden', !items.length);
    this.el.tracker.innerHTML = items.map(({ q, progress }) => {
      const title = `<div class="trk-title">${q.title}</div>`, count = q.goal.count;
      if (progress >= count) return `<div class="trk done">${title}<div class="trk-goal ok">✓<span> Claim at a notice board</span></div></div>`;
      return `<div class="trk">${title}<div class="trk-goal"><span>${quests.goalLabel(q)}</span><b>${progress} / ${count}</b></div>
        <div class="trk-bar"><i style="width:${Math.round((progress / count) * 100)}%"></i></div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- the anvil
  refreshAnvil() {
    const p = this.game.player, picks = [];
    for (const [slot, it] of Object.entries(p.equipment)) if (it) picks.push({ where: 'eq', index: slot, it });
    p.bag.forEach((it, i) => { if (it && !itemDef(it).stack) picks.push({ where: 'bag', index: i, it }); });
    const sel = this.anvilSel;
    $('anvil-pick').innerHTML = picks.map(({ where, index, it }) => {
      const d = itemDef(it), on = sel && sel.where === where && String(sel.index) === String(index);
      return `<div class="bag-slot r-${d.unique ? 'unique' : d.tier}${on ? ' selected' : ''}${(it.p ?? 0) >= MAX_PLUS ? ' maxed' : ''}" data-where="${where}" data-index="${index}" title="${esc(itemName(it))}">${this.slotHtml(it)}${where === 'eq' ? '<i class="worn">worn</i>' : ''}</div>`;
    }).join('') || '<div class="sec-note">Nothing to upgrade.</div>';
    const it = sel ? (sel.where === 'eq' ? p.equipment[sel.index] : p.bag[sel.index]) : null;
    if (!it || itemDef(it).stack) { $('anvil-detail').innerHTML = '<div class="anvil-empty">Pick an item above.</div>'; }
    else {
      const d = itemDef(it), cost = upgradeCost(it);
      if (!cost) $('anvil-detail').innerHTML = `<div class="anvil-item"><b style="color:${itemColor(it)}">${itemName(it)}</b><div class="sec-note">As good as it gets: +${MAX_PLUS}.</div></div>`;
      else {
        const next = { ...it, p: (it.p ?? 0) + 1 }, a = itemStats(it), b = itemStats(next);
        const rows = [];
        if (a.dmgMin) rows.push(`<div>Damage <b>${a.dmgMin}–${a.dmgMax}</b> → <b class="up">${b.dmgMin}–${b.dmgMax}</b></div>`);
        for (const [k, fmt] of STAT_LINES) if (a[k] !== undefined && a[k] !== b[k]) rows.push(`<div>${fmt(a[k]).replace(/^\+/, '')} → <b class="up">${fmt(b[k]).replace(/^\+/, '')}</b></div>`);
        const have = p.count(cost.recipe), okR = have >= cost.recipes, okG = p.gold >= cost.gold;
        $('anvil-detail').innerHTML = `<div class="anvil-item"><b style="color:${itemColor(it)}">${itemName(it)}</b> → <b style="color:${itemColor(next)}">+${next.p}</b>
          <div class="anvil-stats">${rows.join('')}</div>
          <div class="anvil-cost"><span class="${okR ? '' : 'short'}">${cost.recipes} × ${ITEMS[cost.recipe].name} (you have ${have})</span><span class="${okG ? '' : 'short'}">${cost.gold}g fee</span></div>
          <button id="anvil-go" class="wide"${okR && okG ? '' : ' disabled'}>Upgrade to +${next.p}</button></div>`;
        void d;
      }
    }
    $('recipes').innerHTML = this.shopRows(this.game.npcs.stock(this.npc || { n: { role: 'anvil' }, land: 'emberwood' }));
  }

  refreshCharacter() {
    const p = this.game.player;
    for (const d of document.querySelectorAll('.eq-slot')) {
      const it = p.equipment[d.dataset.slot], def = itemDef(it);
      d.className = `eq-slot${d.classList.contains('acc') ? ' acc' : ''}${it ? def.unique ? ' r-unique' : ` r-${def.tier}` : ''}`;
      d.innerHTML = it ? this.slotHtml(it) : `<span>${SLOT_LABEL[d.dataset.slot]}</span>`;
    }
    $('char-style').textContent = `${CLASSES[p.cls].name} · ${p.stats.style}`;
    const s = p.stats;
    const rows = [
      ['Level', p.level], ['Damage', `${s.dmgLo}–${s.dmgHi}`],
      ['Life', Math.round(s.maxHp)], ['Attack speed', s.atkSpeed.toFixed(2)],
      ['Mana', Math.round(s.maxMp)], ['Critical', `${Math.round(s.crit * 100)}%`],
      ['Armor', `${s.armor} (${Math.round(s.dr * 100)}%)`], ['Spell power', `${Math.round(s.spell * 100)}%`],
      ['Life regen', `${s.regen.toFixed(1)}/s`], ['Move speed', `${Math.round((s.moveSpeed / 5.6) * 100)}%`],
    ];
    if (s.evade) rows.push(['Dodge', `${Math.round(s.evade * 100)}%`]);
    this.el.stats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  // compare: show ▲/▼ against the equipped item it would replace; hint: grey line at the bottom.
  itemTip(it, { compare = false, hint = null } = {}) {
    const d = itemDef(it), p = this.game.player;
    if (!d) return null;
    const { main, stats } = itemLines(it);
    const why = d.stack ? (p.level < d.level ? `Needs level ${d.level}` : null) : cannotUse(it, p.cls, p.level);
    const req = d.stack ? '' : `<div class="tt-req${why ? ' bad' : ''}">${why || `Level ${d.level}${d.classes ? ` · ${d.classes.map((c) => CLASSES[c].name).join(', ')}` : ' · any class'}`}</div>`;
    let cmp = '';
    if (compare && !d.stack) {
      const slot = p.slotFor(it), cur = slot ? p.equipment[slot] : null;
      if (cur && cur !== it) {
        const a = itemStats(it), b = itemStats(cur);
        const line = (v, text) => `<span class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '▲' : '▼'} ${text}</span>`;
        const parts = [`<span class="tt-replaces">Instead of ${itemName(cur)}</span>`];
        if (a.dmgMin || b.dmgMin) {
          const dps = (st) => (st.dmgMin ? ((st.dmgMin + st.dmgMax) / 2) * st.speed : 0);
          const dd = dps(a) - dps(b);
          if (Math.abs(dd) >= 0.05) parts.push(line(dd, `${Math.abs(dd).toFixed(1)} damage per second`));
        }
        for (const [k, fmt] of STAT_LINES) {
          const dv = (a[k] || 0) - (b[k] || 0);
          if (Math.abs(dv) < 1e-4) continue;
          parts.push(line(dv, fmt(Math.abs(dv)).replace(/^\+/, '')));
        }
        cmp = `<div class="tt-cmp">${parts.join('<br>')}</div>`;
      }
    }
    const upg = d.stack ? '' : `<div class="tt-plus">${(it.p ?? 0) >= MAX_PLUS ? 'Fully upgraded' : `Upgrade at the anvil: +${(it.p ?? 0) + 1} next`}</div>`;
    const color = d.unique ? UNIQUE_COLOR : itemColor(it);
    return `<div class="tt-name" style="color:${color}">${itemName(it)}${d.stack && it.n > 1 ? ` <small>×${it.n}</small>` : ''}</div>
      <div class="tt-type">${typeLine(it)}</div>${req}
      ${main.map((l) => `<div class="tt-main">${l}</div>`).join('')}
      ${stats.map((l) => `<div class="tt-aff">${l}</div>`).join('')}
      ${d.desc ? `<div>${d.desc}</div>` : ''}
      ${d.unique ? '<div class="tt-unique">Unique: only world bosses carry it.</div>' : ''}${upg}
      ${cmp}${hint ? `<div class="tt-hint">${hint}</div>` : ''}`;
  }

  // Tooltips share their box with menus: while a menu is open, hovering things doesn't touch it.
  showTip(target, htmlFn) {
    if (this.menuAnchor || this.dragging) return;
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
    if (this.menuAnchor) return;
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
    if (!inside && map.camp) { // the camp, its waystone and the dungeon doors
      diamond(m(map.camp.x, map.camp.z), 5, '#ffcf6a', '#3a2a14');
      diamond(m(map.waystone.x, map.waystone.z), 3.5, '#7fe0ff', '#0a2a3a');
      for (const p of map.portals) if (p.id !== 'waystone') diamond(m(p.x, p.z), 3.5, '#c79aff', '#1a0a2a');
    }
    for (const p of map.portals || []) if (inside && p.id === 'down') diamond(m(p.x, p.z), 3.5, '#c79aff', '#1a0a2a');
    // quest targets: a dashed gold ring on their zone; a gold "!" on the board when it has news
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255, 210, 90, 0.95)';
    ctx.lineWidth = 1.6;
    for (const { q, progress } of g.quests.tracked()) {
      const zone = progress < q.goal.count && q.zone && places.questRing(q.zone);
      if (!zone) continue;
      const [zx, zy] = m(zone.x, zone.z);
      ctx.beginPath();
      ctx.arc(zx, zy, (zone.r / (2 * R)) * S + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    const board = CAMPS[map.id]?.find((n) => n.role === 'board');
    if (board && g.quests.markerVisible(map.id)) {
      const [bx, by] = m(board.x, board.z);
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
      ctx.fillStyle = itemColor(l.data);
      ctx.fillRect(pt[0] - 2, pt[1] - 2, 4, 4);
    }
    for (const o of g.others.list) { // other heroes (party members green)
      const [x, y] = m(o.pos.x, o.pos.z);
      if (!onMap([x, y])) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = !o.alive ? '#4a6a78' : g.party.has(o.id) ? '#7dff9a' : '#5fd4ff';
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
      ctx.arc(x, y, e.def.boss ? 4.5 : e.selected ? 3.2 : 2.3, 0, Math.PI * 2);
      ctx.fillStyle = e.def.boss ? '#ff8a2b' : e.selected ? '#ffe070' : '#ff4a3a';
      ctx.fill();
      if (e.def.boss) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    // a world boss roaming this land (the world tells everyone here where it is)
    const wb = g.worldBoss;
    if (wb && wb.map === map.id) {
      const pt = m(wb.x, wb.z);
      if (onMap(pt)) {
        const pulse = 5 + Math.sin(g.time * 5) * 1.2;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], pulse + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 120, 40, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '900 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff8a2b';
        ctx.fillText('☠', pt[0], pt[1] + 4);
      }
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

  // Black screen with a line of text while going down to (or up from) a dungeon, or travelling.
  fade(on, text = '') {
    if (text) this.el.fade.querySelector('span').textContent = text;
    this.el.fade.classList.toggle('on', on);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const p = this.game.player, s = p.stats;
    this.el.hpFill.style.transform = `scaleX(${Math.max(0, p.hp / s.maxHp).toFixed(3)})`;
    this.el.mpFill.style.transform = `scaleX(${Math.max(0, p.mp / s.maxMp).toFixed(3)})`;
    this.el.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(s.maxHp)}${p.shield > 0 ? ` (+${Math.round(p.shield)})` : ''}`;
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
    $('skill-dot').classList.toggle('hidden', !p.freePoints);
    this.updateActionBar();
    this.updatePlates();
    this.updateFloaters(dt);
    this.updateTarget();
    this._bt = (this._bt || 0) + dt;
    if (this._bt > 0.5) { this._bt = 0; this.updateBuffs(); }
    if (this.channelT) {
      this.channelT.t += dt;
      $('channel-fill').style.transform = `scaleX(${Math.min(1, this.channelT.t / this.channelT.dur).toFixed(3)})`;
    }
    this._mmT = (this._mmT || 0) + dt;
    if (this._mmT > 0.05) { this._mmT = 0; this.drawMinimap(); }
    if (this.tipTarget && this.tipFn && this.tipTarget.classList.contains('slot')) {
      const html = this.tipFn();
      if (html !== this._lastTip) { this.el.tooltip.innerHTML = html; this._lastTip = html; }
    }
  }
}

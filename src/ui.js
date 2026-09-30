// HTML HUD: bars, action bar, nameplates, floating numbers, minimap, inventory, tooltips.
import * as THREE from 'three';
import { Assets } from './assets.js';
import { RARITY, itemLines, COMPARE_STATS } from './items.js';
import { SKILLS, xpForLevel } from './player.js';
import { rand } from './util.js';

const $ = (id) => document.getElementById(id);

const SKILL_SVG = {
  attack: `<svg viewBox="0 0 32 32"><path d="M27.5 4.5 26 10.5 12.5 24 8 19.5 21.5 6z" fill="#e3e9f0" stroke="#5d6875" stroke-width="1.2" stroke-linejoin="round"/><path d="M21.5 6 26 10.5" stroke="#fff" stroke-width="1" opacity=".7"/><path d="M6 17.5l8.5 8.5" stroke="#d6aa4a" stroke-width="3.2" stroke-linecap="round"/><path d="M9.2 22.8 4.5 27.5" stroke="#7a4f2c" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  cleave: `<svg viewBox="0 0 32 32"><path d="M4 22C6 9 22 4 29 12c-8-3-17 0-21 11z" fill="#ffc46a" stroke="#a8641c" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 20C10 12 19 8 25 10" stroke="#fff6d8" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="8" cy="24" r="2.2" fill="#fff0c0"/></svg>`,
  fireball: `<svg viewBox="0 0 32 32"><path d="M20 5c1 5-3 6-2 10 2-1 3-3 3-5 4 3 6 7 5 11-1 5-6 8-11 7S6 23 7 18c1-4 4-5 5-9 1 2 1 4 3 5-1-4 1-7 5-9z" fill="#ff7a2a" stroke="#a32d0a" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 17c2 2 4 3 3 6-1 2-4 3-6 1-2-1-1-4 0-5 0 1 1 2 2 2-1-2 0-3 1-4z" fill="#ffe08a"/></svg>`,
  whirlwind: `<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round"><path d="M16 4a12 12 0 1 1-11.3 8" stroke="#dfe9ff" stroke-width="2.6"/><path d="M16 9a7 7 0 1 1-6.6 4.7" stroke="#9fc0ff" stroke-width="2.4"/><path d="M16 14a2.5 2.5 0 1 1-2.4 1.8" stroke="#fff" stroke-width="2.2"/><path d="M4.7 12l-1.5-4.5 4.6 1.2" stroke="#dfe9ff" stroke-width="2.2"/></svg>`,
  heal: `<svg viewBox="0 0 32 32"><path d="M16 28S4 20 4 12a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 16-12 16z" fill="#4fd46b" stroke="#1d6a2c" stroke-width="1.3" stroke-linejoin="round"/><path d="M16 11v10M11 16h10" stroke="#eaffea" stroke-width="3" stroke-linecap="round"/></svg>`,
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
    };
    this.plates = [];
    this.floaters = [];
    this.v = new THREE.Vector3();
    this.mm = this.el.minimap.getContext('2d');
    this.invOpen = false;
    this.tipTarget = null;
    this.mouse = { x: 0, y: 0 };
    this.el.portrait.src = Assets.icons.portrait;

    // bag slots
    this.bagSlots = [];
    // Mouse: hover shows the tooltip, click equips, right-click sells.
    // Touch: tap selects an item and opens a small menu (Equip / Sell), so nothing happens by accident.
    for (let i = 0; i < 20; i++) {
      const d = document.createElement('div');
      d.className = 'bag-slot';
      d.addEventListener('click', () => this.bagClick(i, d));
      d.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this.touch) { this.game.player.sell(i); this.hideTip(); } });
      d.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(d, () => this.game.player.bag[i] && this.itemTip(this.game.player.bag[i], true)); });
      d.addEventListener('mouseleave', () => { if (!this.touch) this.hideTip(); });
      this.el.bag.appendChild(d);
      this.bagSlots.push(d);
    }
    for (const d of document.querySelectorAll('.eq-slot')) {
      const slot = d.dataset.slot;
      d.addEventListener('click', () => this.equipClick(slot, d));
      d.addEventListener('mouseenter', () => { if (!this.touch) this.showTip(d, () => this.game.player.equipment[slot] && this.itemTip(this.game.player.equipment[slot], false)); });
      d.addEventListener('mouseleave', () => { if (!this.touch) this.hideTip(); });
    }
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
    $('btn-sound').addEventListener('click', () => this.toggleSound());
    $('buy-ale').addEventListener('click', () => this.game.player.buyAle());
    $('respawn').addEventListener('click', () => this.game.player.respawn());
    this.buildActionBar();
  }

  setTouchMode(on) {
    this.touch = on;
    document.body.classList.toggle('touch', on);
    this.closeMenu();
  }

  bagClick(i, d) {
    const p = this.game.player, item = p.bag[i];
    if (!this.touch) {
      p.equipFromBag(i);
      this.hideTip();
      this.maybeTip(d);
      return;
    }
    if (!item) return this.closeMenu();
    const eq = p.equipment;
    const equip = item.slot === 'ring' && eq.ring1 && eq.ring2
      ? [['Left ring', () => p.equipFromBag(i, 'ring1')], ['Right ring', () => p.equipFromBag(i, 'ring2')]]
      : [['Equip', () => p.equipFromBag(i)]];
    this.openMenu(d, this.itemTip(item, true, true), [...equip, [`Sell · ${item.value}g`, () => p.sell(i)]]);
  }

  equipClick(slot, d) {
    const p = this.game.player, item = p.equipment[slot];
    if (!this.touch) {
      p.unequip(slot);
      this.hideTip();
      return;
    }
    if (!item) return this.closeMenu();
    this.openMenu(d, this.itemTip(item, false, true), [['Unequip', () => p.unequip(slot)]]);
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
    const p = this.game.player;
    const defs = [
      { key: 'LMB', attack: true, cls: 'slot-attack', icon: SKILL_SVG.attack, tip: () => `<div class="tt-name">Attack</div><div class="tt-type">Left mouse · hold to keep swinging</div>Swing your weapon at the cursor. Hits everything in a short arc.` },
      ...SKILLS.map((s, i) => ({
        key: s.key, skill: s, cls: `slot-s${i + 1}`, icon: SKILL_SVG[s.id], sep: i === 0,
        tip: () => `<div class="tt-name">${s.name}</div><div class="tt-type">${s.mp} mana · ${s.cd}s cooldown${p.level < s.level ? ` · unlocks at level ${s.level}` : ''}</div>${s.desc}`,
      })),
      { key: 'Q', potion: true, cls: 'slot-potion', icon: `<img src="${Assets.icons.mug_full}" alt="">`, sep: true, tip: () => `<div class="tt-name">Hearty Ale</div><div class="tt-type">Q · ${p.potions} left</div>Restores 40% of your maximum Life. Buy more in your bag for 25 gold, or find them on monsters.` },
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
          if (d.skill) p.useSkill(SKILLS.indexOf(d.skill));
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
    this.floaters.push({ el, pos: pos.clone(), t: 0, dx: rand(-18, 18), life: cls === 'info' ? 1.8 : 1.0 });
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
    const el = $(id);
    const open = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !open);
    if (id === 'inventory') {
      this.invOpen = open;
      this.game.doll.visible = open;
      if (open) this.refreshInventory();
      else { this.closeMenu(); this.hideTip(); }
    }
  }

  toggleInventory() {
    this.togglePanel('inventory');
  }

  toggleSound() {
    const on = this.game.sfx.toggle();
    $('btn-sound').classList.toggle('off', !on);
    this.centerMsg(on ? 'Sound on' : 'Sound off');
  }

  // ---------------------------------------------------------------- inventory
  slotHtml(item) {
    return item ? `<img src="${Assets.icons[item.icon]}" alt="">` : '';
  }

  refreshInventory() {
    const p = this.game.player;
    this.el.gold.textContent = p.gold;
    if (!this.invOpen) return;
    const labels = { head: 'Head', back: 'Back', weapon: 'Weapon', offhand: 'Off-hand', hands: 'Hands', feet: 'Feet', ring1: 'Ring', ring2: 'Ring' };
    for (const d of document.querySelectorAll('.eq-slot')) {
      const it = p.equipment[d.dataset.slot];
      d.className = `eq-slot${it ? ` r-${it.rarity}` : ''}`;
      d.innerHTML = it ? this.slotHtml(it) : `<span>${labels[d.dataset.slot]}</span>`;
    }
    p.bag.forEach((it, i) => {
      const d = this.bagSlots[i];
      d.className = `bag-slot${it ? ` r-${it.rarity}` : ''}`;
      d.innerHTML = this.slotHtml(it);
    });
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

  itemTip(item, fromBag, noHint = false) {
    const r = RARITY[item.rarity];
    const { main, implicit, aff } = itemLines(item);
    let cmp = '';
    if (fromBag) {
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
    const hint = fromBag ? `Click to equip · Right-click to sell for ${item.value}g` : 'Click to unequip';
    return `<div class="tt-name" style="color:${r.color}">${item.name}</div>
      <div class="tt-type">${item.rarity === 'common' ? '' : `${r.label} `}${item.type} · item level ${item.ilvl}</div>
      ${main.map((l) => `<div class="tt-main">${l}</div>`).join('')}
      ${implicit.map((l) => `<div>${l}</div>`).join('')}
      ${aff.map((l) => `<div class="tt-aff">${l}</div>`).join('')}
      ${cmp}${noHint ? '' : `<div class="tt-hint">${hint}</div>`}`;
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
    const g = this.game, ctx = this.mm, S = 180;
    const base = g.world.minimap, R = base.range;
    const m = (x, z) => [((x + R) / (2 * R)) * S, ((z + R) / (2 * R)) * S];
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(base.canvas, 0, 0, S, S);
    // camp marker
    const [cx, cy] = m(0, 0);
    ctx.fillStyle = '#ffcf6a';
    ctx.strokeStyle = '#3a2a14';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy); ctx.closePath();
    ctx.fill(); ctx.stroke();
    for (const l of g.loot.list) {
      if (l.kind !== 'item') continue;
      const [x, y] = m(l.group.position.x, l.group.position.z);
      ctx.fillStyle = RARITY[l.data.rarity].color;
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const [x, y] = m(e.pos.x, e.pos.z);
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

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const p = this.game.player, s = p.stats;
    this.el.hpFill.style.transform = `scaleX(${Math.max(0, p.hp / s.maxHp).toFixed(3)})`;
    this.el.mpFill.style.transform = `scaleX(${Math.max(0, p.mp / s.maxMp).toFixed(3)})`;
    this.el.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(s.maxHp)}`;
    this.el.mpText.textContent = `${Math.floor(p.mp)} / ${Math.round(s.maxMp)}`;
    const need = xpForLevel(p.level);
    this.el.xpFill.style.transform = `scaleX(${(p.xp / need).toFixed(3)})`;
    this.el.xpText.textContent = `Level ${p.level} · ${p.xp} / ${need} XP`;
    this.el.lvl.textContent = p.level;
    this.updateActionBar();
    this.updatePlates();
    this.updateFloaters(dt);
    this._mmT = (this._mmT || 0) + dt;
    if (this._mmT > 0.05) { this._mmT = 0; this.drawMinimap(); }
    if (this.tipTarget && this.tipFn && this.tipTarget.classList.contains('slot')) {
      this.el.tooltip.innerHTML = this.tipFn();
    }
  }
}

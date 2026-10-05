// The skill window (K): the class's three trees side by side. A point a level goes into a tree (+); its skills
// open at 1, 6, 15 and 30 points, and every point makes them stronger. Click an open skill to put it on the
// action bar (it asks which slot). Points can all be taken back, for a fee that grows with the hero's level.
import { SKILLS, TREES, UNLOCK, power, manaCost, passiveText } from './skills.js';
import { BAR_SIZE } from './player.js';

const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)}%`;

export class SkillWindow {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.el = $('skills');
    this.isOpen = false;
    $('skill-trees').addEventListener('click', (e) => {
      const plus = e.target.closest('button[data-tree]');
      if (plus) { if (this.game.player.learn(plus.dataset.tree)) { this.game.sfx.play('levelup', 0.4); this.game.quests.onEvent('learn'); } this.refresh(); return; }
      const sk = e.target.closest('.sk[data-id]');
      if (sk && this.game.player.skillOpen(sk.dataset.id)) this.pickSlot(sk);
    });
    $('skill-trees').addEventListener('mouseover', (e) => {
      const sk = e.target.closest('.sk[data-id]');
      if (sk && !this.ui.touch) this.ui.showTip(sk, () => this.tip(sk.dataset.id));
    });
    $('skill-trees').addEventListener('mouseout', (e) => { if (e.target.closest('.sk[data-id]') && !this.ui.touch && !this.ui.menuAnchor) this.ui.hideTip(); });
    $('skill-reset').addEventListener('click', () => {
      const p = this.game.player, fee = p.respecFee();
      if (!p.spentPoints()) return;
      // (the game's own question: a browser's pop-up takes a phone out of full screen)
      this.ui.prompt(`Take back all <b>${p.spentPoints()}</b> skill points${fee ? ` for <b>${fee} gold</b>` : ''}? You can spend them again at once.`, [
        ['Take them back', () => { if (p.resetSkills()) this.refresh(); }, 'go'],
        ['Keep them', () => {}],
      ]);
    });
  }

  open() {
    this.ui.closeInventory();
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.refresh();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.ui.closeMenu();
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  refresh() {
    const p = this.game.player;
    if (!this.isOpen || !p) return;
    const free = p.freePoints;
    $('skill-points').textContent = free ? `${free} point${free > 1 ? 's' : ''} to spend` : `${p.spentPoints()} points spent`;
    $('skill-trees').innerHTML = TREES[p.cls].map((tree) => {
      const pts = p.treePoints(tree.id);
      const rows = tree.skills.map((id, i) => {
        const sk = SKILLS[id], open = pts >= UNLOCK[i], blocked = open && p.skillBlocked(id), slot = p.sk.bar.indexOf(id);
        return `<div class="sk${open ? ' open' : ''}${blocked ? ' blocked' : ''}" data-id="${id}">
          <div class="sk-icon">${sk.icon}${slot >= 0 ? `<i>${slot + 1}</i>` : ''}</div>
          <div class="sk-text"><b>${sk.name}</b><small>${open ? (blocked || `Power ${pct(power(pts))}`) : `Opens at ${UNLOCK[i]} point${UNLOCK[i] === 1 ? "" : "s"}`}</small></div></div>`;
      }).join('');
      return `<div class="tree" style="--tc:${tree.color}">
        <div class="tree-head"><b>${tree.name}</b><span class="tree-pts">${pts}</span>${free ? `<button data-tree="${tree.id}" title="Put a point into ${tree.name}">+</button>` : ''}</div>
        <div class="tree-about">${tree.about}</div>
        <div class="tree-passive">${pts ? passiveText(tree, pts) : `Each point: ${passiveText(tree, 1)}`}</div>
        ${rows}</div>`;
    }).join('');
    $('skill-hint').textContent = this.ui.touch ? 'Tap an open skill to put it on a button.' : 'Click an open skill to put it on your bar (keys 1–8).';
    const fee = p.respecFee();
    $('skill-reset').textContent = p.spentPoints() ? `Take back all points${fee ? ` · ${fee}g` : ''}` : '';
    $('skill-reset').classList.toggle('hidden', !p.spentPoints());
  }

  // Which slot an open skill goes in: a little menu of the bar's slots.
  pickSlot(el) {
    const p = this.game.player, id = el.dataset.id;
    const n = this.ui.touch ? 6 : BAR_SIZE;
    const acts = Array.from({ length: n }, (_, i) => [`${i + 1}${p.sk.bar[i] ? '' : ' ·'}`, () => { p.setBar(i, id); this.refresh(); }]);
    this.ui.openMenu(el, `${this.tip(id)}<div class="tt-hint">Put it in slot…</div>`, acts);
    this.ui.el.tooltip.classList.add('slots-menu');
  }

  // A skill's tooltip: what it costs and does now, and what one more point would make of it.
  tip(id) {
    const p = this.game.player, sk = SKILLS[id], tree = TREES[p.cls].find((t) => t.id === sk.tree);
    const pts = p.treePoints(sk.tree), pw = power(Math.max(pts, sk.unlock));
    const now = sk.desc({ pw, lvl: p.level });
    const open = pts >= sk.unlock, blocked = open && p.skillBlocked(id);
    const next = open && p.freePoints ? `<div class="tt-hint">One more point in ${tree.name}: power ${pct(power(pts + 1))}</div>` : '';
    const range = sk.range ? ` · ${sk.range} m` : '';
    return `<div class="tt-name" style="color:${tree.color}">${sk.name}</div>
      <div class="tt-type">${tree.name} · ${manaCost(sk, p.level)} mana · ${sk.cd}s cooldown${range}</div>
      ${open ? '' : `<div class="tt-req bad">Opens with ${sk.unlock} points in ${tree.name} (you have ${pts})</div>`}
      ${blocked ? `<div class="tt-req bad">${blocked}</div>` : ''}
      <div>${now}</div>${next}`;
  }
}

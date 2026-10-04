// Keyboard, mouse and touch input in one place.
//
// Keys are tracked by physical code (KeyW works on any layout). Browsers don't always
// deliver `keyup` — macOS drops it for keys released while ⌘ is held, and menus, dialogs
// or tab switches swallow it — so held keys are cleared whenever that can happen.
import * as THREE from 'three';

const MOVE = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};
const STICK_RADIUS = 56;
// capture can fail if the finger already lifted; the control still works without it
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* ignore */ } };
const DEAD_ZONE = 0.12;

export class Input {
  constructor() {
    this.held = new Set();
    this.mouse = new THREE.Vector2();
    this.mouseDown = false;
    this.touchAttack = false;
    this.stick = new THREE.Vector2(); // virtual joystick: x right, y down, length 0..1
    this.touchMode = window.matchMedia('(pointer: coarse)').matches;
    this.onKey = null; // (code, event) => void, for one-shot actions (skills, bag…)
    this.onModeChange = null;

    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    const releaseAll = () => this.releaseAll();
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    window.addEventListener('contextmenu', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    // any touch anywhere switches to the touch layout
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.setTouchMode(true); }, true);
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 0) this.mouseDown = false; });
    window.addEventListener('pointercancel', (e) => { if (e.pointerType === 'mouse') this.mouseDown = false; });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    // iOS Safari pinch-zoom
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  get attacking() {
    return this.mouseDown || this.touchAttack;
  }

  releaseAll() {
    this.held.clear();
    this.mouseDown = false;
  }

  setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    if (!on) { this.stick.set(0, 0); this.touchAttack = false; }
    if (this.onModeChange) this.onModeChange(on);
  }

  keyDown(e) {
    if (e.key === 'Meta' || e.metaKey) {
      // keyups for anything released while ⌘ is down never arrive on macOS
      this.held.clear();
      return;
    }
    if (e.ctrlKey || e.altKey) return; // browser / OS shortcuts, not game input
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    this.held.add(e.code);
    if (Object.values(MOVE).some((codes) => codes.includes(e.code))) this.setTouchMode(false);
    if (this.onKey) this.onKey(e.code, e);
  }

  keyUp(e) {
    this.held.delete(e.code);
    if (e.key === 'Meta') this.held.clear();
    this.onKeyUp?.(e.code);
  }

  isHeld(dir) {
    return MOVE[dir].some((c) => this.held.has(c));
  }

  // Movement intent in screen space: x right, y down (= world +Z). Length 0..1.
  axis(out) {
    if (this.stick.lengthSq() > 0) return out.copy(this.stick);
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const y = (this.isHeld('down') ? 1 : 0) - (this.isHeld('up') ? 1 : 0);
    out.set(x, y);
    if (x && y) out.multiplyScalar(Math.SQRT1_2);
    return out;
  }

  bindCanvas(canvas, onZoom) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return; // touches on the open world do nothing
      this.setTouchMode(false);
      if (e.button === 0) this.mouseDown = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { onZoom(Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false });
  }

  // Floating joystick: appears where the thumb lands inside `zone`.
  bindStick(zone, base, knob) {
    let id = null, cx = 0, cy = 0;
    const place = (x, y) => { base.style.left = `${x}px`; base.style.top = `${y}px`; };
    const knobAt = (dx, dy) => { knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`; };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick.set(0, 0);
      base.classList.remove('on');
      base.style.left = base.style.top = '';
      knobAt(0, 0);
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      capture(zone, id);
      cx = e.clientX;
      cy = e.clientY;
      place(cx, cy);
      base.classList.add('on');
      knobAt(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        // drag the base along so the stick never runs out of travel
        cx += dx * (1 - STICK_RADIUS / d);
        cy += dy * (1 - STICK_RADIUS / d);
        place(cx, cy);
        dx = e.clientX - cx;
        dy = e.clientY - cy;
      }
      knobAt(dx, dy);
      const m = Math.min(1, Math.hypot(dx, dy) / STICK_RADIUS);
      if (m < DEAD_ZONE) this.stick.set(0, 0);
      else this.stick.set(dx, dy).normalize().multiplyScalar((m - DEAD_ZONE) / (1 - DEAD_ZONE));
    });
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  // Hold-to-attack button.
  bindAttackButton(el) {
    let id = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      capture(el, id);
      if (e.pointerType === 'mouse') this.mouseDown = true;
      else this.touchAttack = true;
      el.classList.add('pressed');
    });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.touchAttack = false;
      this.mouseDown = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }
}

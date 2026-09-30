// Weight-blended animation state: one looping "base" (idle/walk/run) plus an optional
// one-shot overlay (hit, throw, death...). Blends are done by fading weights each frame.
import * as THREE from 'three';
import { Assets } from './assets.js';

export class Animator {
  constructor(root) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const [name, clip] of Object.entries(Assets.clips)) this.actions[name] = this.mixer.clipAction(clip);
    this.weights = new Map();
    this.base = null;
    this.baseName = '';
    this.one = null;
    this.fade = 0.18;
    this.mixer.addEventListener('finished', (e) => {
      if (this.one && e.action === this.one.action) this.one.done = true;
    });
  }

  _start(a, immediate) {
    if (!this.weights.has(a)) {
      a.reset();
      a.play();
      this.weights.set(a, immediate ? 1 : 0);
      a.setEffectiveWeight(immediate ? 1 : 0);
    }
  }

  setBase(name, timeScale = 1) {
    const a = this.actions[name];
    a.setEffectiveTimeScale(timeScale);
    if (this.base === a) return;
    a.setLoop(THREE.LoopRepeat, Infinity);
    this._start(a, this.weights.size === 0);
    this.base = a;
    this.baseName = name;
  }

  play(name, { timeScale = 1, hold = false, fade = 0.1, onDone = null, startAt = 0 } = {}) {
    const a = this.actions[name];
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.setEffectiveTimeScale(timeScale);
    a.time = startAt;
    a.play();
    if (!this.weights.has(a)) {
      this.weights.set(a, 0);
      a.setEffectiveWeight(0);
    }
    this.one = { action: a, name, hold, onDone, done: false, fade };
  }

  stopOne() {
    this.one = null;
  }

  get oneName() {
    return this.one ? this.one.name : null;
  }

  update(dt) {
    if (this.one && this.one.done && !this.one.hold) {
      const cb = this.one.onDone;
      this.one = null;
      if (cb) cb();
    }
    const target = this.one ? this.one.action : this.base;
    const rate = dt / (this.one ? this.one.fade : this.fade);
    for (const [a, w] of this.weights) {
      const goal = a === target ? 1 : 0;
      const nw = goal > w ? Math.min(goal, w + rate) : Math.max(goal, w - rate);
      if (nw <= 0 && a !== target && a !== this.base) {
        a.stop();
        this.weights.delete(a);
        continue;
      }
      this.weights.set(a, nw);
      a.setEffectiveWeight(nw);
    }
    this.mixer.update(dt);
  }
}

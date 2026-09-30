// Tiny synthesized sound effects (WebAudio) — no audio files needed.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  toggle() {
    this.muted = !this.muted;
    return !this.muted;
  }

  _env(node, t0, a, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  _noise(t0, dur, type, f0, f1, peak, q = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    src.connect(f);
    this._env(f, t0, 0.01, peak, dur);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  _tone(t0, dur, type, f0, f1, peak, attack = 0.005) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    this._env(o, t0, attack, peak, dur);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.03) return;
    this.last[name] = now;
    const v = vol;
    switch (name) {
      case 'swing': this._noise(now, 0.16, 'bandpass', 700, 2600, 0.5 * v, 2); break;
      case 'whiff': this._noise(now, 0.1, 'highpass', 2000, 4000, 0.15 * v); break;
      case 'cleave': this._noise(now, 0.3, 'bandpass', 400, 1800, 0.8 * v, 1.5); this._tone(now, 0.25, 'sine', 110, 50, 0.5 * v); break;
      case 'whirl': this._noise(now, 1.3, 'bandpass', 500, 1500, 0.35 * v, 3); break;
      case 'hit': this._tone(now, 0.12, 'sine', 170, 60, 0.6 * v); this._noise(now, 0.07, 'lowpass', 3000, 800, 0.5 * v); break;
      case 'crit': this._tone(now, 0.16, 'sine', 220, 55, 0.8 * v); this._noise(now, 0.1, 'highpass', 3000, 1500, 0.45 * v); this._tone(now, 0.12, 'square', 1400, 900, 0.06 * v); break;
      case 'hurt': this._tone(now, 0.15, 'sawtooth', 220, 110, 0.18 * v); this._noise(now, 0.1, 'lowpass', 1500, 400, 0.35 * v); break;
      case 'cast': this._tone(now, 0.25, 'triangle', 300, 900, 0.18 * v); break;
      case 'fireball': this._noise(now, 0.45, 'lowpass', 1800, 500, 0.45 * v); break;
      case 'explode': this._noise(now, 0.6, 'lowpass', 1400, 90, 1.0 * v); this._tone(now, 0.35, 'sine', 90, 35, 0.8 * v); break;
      case 'zap': this._tone(now, 0.2, 'square', 800, 200, 0.08 * v); this._noise(now, 0.15, 'bandpass', 2000, 600, 0.3 * v, 4); break;
      case 'slam': this._noise(now, 0.7, 'lowpass', 900, 60, 1.1 * v); this._tone(now, 0.5, 'sine', 70, 30, 1.0 * v); break;
      case 'slime': this._tone(now, 0.22, 'sine', 420, 90, 0.35 * v); break;
      case 'death': this._tone(now, 0.9, 'triangle', 300, 60, 0.3 * v); break;
      case 'pickup': this._tone(now, 0.08, 'sine', 880, 880, 0.25 * v); this._tone(now + 0.07, 0.12, 'sine', 1320, 1320, 0.25 * v); break;
      case 'drop': this._tone(now, 0.3, 'triangle', 600 + 400 * v, 1400 + 800 * v, 0.12 * v); break;
      case 'gold': this._tone(now, 0.06, 'triangle', 1800, 1800, 0.15 * v); this._tone(now + 0.05, 0.1, 'triangle', 2400, 2400, 0.15 * v); break;
      case 'equip': this._noise(now, 0.12, 'bandpass', 1500, 3000, 0.3 * v, 5); this._tone(now, 0.1, 'square', 300, 200, 0.05 * v); break;
      case 'drink': this._tone(now, 0.25, 'sine', 300, 500, 0.2 * v); break;
      case 'heal': [523, 659, 784].forEach((f, i) => this._tone(now + i * 0.06, 0.35, 'sine', f, f * 1.01, 0.12 * v, 0.02)); break;
      case 'levelup': [523, 659, 784, 1047].forEach((f, i) => this._tone(now + i * 0.1, 0.5, 'triangle', f, f, 0.2 * v, 0.02)); break;
      default: break;
    }
  }
}

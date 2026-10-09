// Sound, all synthesized with WebAudio (no audio files): the effects in this file, generative music
// (music.js) and ambience (ambience.js). Each has its own volume; mute silences everything.
//   effects ─┐
//   music ───┼─(volume)─ master (mute) ─ fader (sleep/wake) ─ limiter ─ speakers
//   ambience ┘      └─ reverb sends ─ reverb ─┘
import { Music } from './music.js';
import { Ambience } from './ambience.js';

const LEVEL = { sfx: 0.4, music: 1, ambience: 1 }; // each channel's gain at 100%

// A room's echo: decaying stereo noise, used as a convolution reverb.
function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
    this.vol = { sfx: 0.8, music: 0.6, ambience: 0.5 }; // replaced by the saved settings (game.js)
    this.music = null;
    this.ambience = null;
  }

  init() {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.ratio.value = 6;
      limiter.connect(ctx.destination);
      this.fader = ctx.createGain();
      this.fader.connect(limiter);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.fader);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = impulse(ctx, 2.8, 2.4);
      this.reverb.connect(this.master);
      this.bus = {};
      this.sends = {};
      for (const k of Object.keys(LEVEL)) {
        this.bus[k] = ctx.createGain();
        this.bus[k].gain.value = LEVEL[k] * this.vol[k];
        this.bus[k].connect(this.master);
      }
      for (const [k, amount] of [['music', 0.45], ['ambience', 0.06]]) {
        this.sends[k] = ctx.createGain();
        this.sends[k].gain.value = amount;
        this.bus[k].connect(this.sends[k]).connect(this.reverb);
      }
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(ctx, this.bus.music, this.noise);
      this.ambience = new Ambience(ctx, this.bus.ambience, this.noise);
    } catch {
      this.ctx = null;
    }
  }

  setVolume(kind, v) {
    this.vol[kind] = v;
    if (this.ctx) this.bus[kind].gain.setTargetAtTime(LEVEL[kind] * v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  toggle() {
    this.setMuted(!this.muted);
    return !this.muted;
  }

  // How much of a channel goes to the reverb (the crypt echoes more than the woods).
  setReverb(kind, amount) {
    if (this.ctx) this.sends[kind].gain.setTargetAtTime(amount, this.ctx.currentTime, 0.5);
  }

  // Fade out and stop the audio clock (title screen, app in the background); wake brings it back.
  sleep() {
    if (!this.ctx) return;
    this.fader.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    clearTimeout(this.sleepT);
    this.sleepT = setTimeout(() => this.ctx.suspend().catch(() => {}), 400);
  }

  wake() {
    if (!this.ctx) return;
    clearTimeout(this.sleepT);
    this.ctx.resume().catch(() => {});
    this.fader.gain.setTargetAtTime(1, this.ctx.currentTime, 0.15);
  }

  _env(node, t0, a, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);
    g.connect(this.bus.sfx);
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
      case 'bow': // the string lets go: a low twang, a hiss of air
        this._tone(now, 0.22, 'triangle', 330, 110, 0.32 * v, 0.002);
        this._tone(now, 0.12, 'sawtooth', 165, 70, 0.08 * v, 0.002);
        this._noise(now, 0.09, 'bandpass', 3000, 1200, 0.18 * v, 3);
        break;
      case 'rumble': // the ground groans (an earthquake)
        this._noise(now, 1.4, 'lowpass', 180, 60, 0.9 * v, 0.7);
        this._tone(now, 1.2, 'sine', 48, 30, 0.5 * v, 0.08);
        break;
      case 'thunder': // a crack, then the roll
        this._noise(now, 0.14, 'highpass', 3200, 1400, 0.55 * v, 0.6);
        this._noise(now + 0.05, 1.8, 'lowpass', 900, 70, 0.95 * v, 0.5);
        break;
      case 'arrowhit': // the head bites in
        this._noise(now, 0.07, 'lowpass', 1400, 300, 0.42 * v, 1);
        this._tone(now, 0.05, 'square', 220, 90, 0.08 * v, 0.001);
        break;
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
      case 'chest': this._tone(now, 0.35, 'sawtooth', 140, 95, 0.07 * v, 0.03); this._noise(now, 0.3, 'bandpass', 500, 300, 0.25 * v, 3); this._tone(now + 0.28, 0.12, 'sine', 90, 60, 0.3 * v); break;
      case 'equip': this._noise(now, 0.12, 'bandpass', 1500, 3000, 0.3 * v, 5); this._tone(now, 0.1, 'square', 300, 200, 0.05 * v); break;
      case 'drink': this._tone(now, 0.25, 'sine', 300, 500, 0.2 * v); break;
      case 'heal': [523, 659, 784].forEach((f, i) => this._tone(now + i * 0.06, 0.35, 'sine', f, f * 1.01, 0.12 * v, 0.02)); break;
      case 'quest': [392, 523, 659, 784].forEach((f, i) => this._tone(now + i * 0.08, i === 3 ? 0.7 : 0.25, 'triangle', f, f, 0.18 * v, 0.01)); this._tone(now + 0.24, 0.7, 'sine', 1568, 1568, 0.05 * v, 0.02); break;
      case 'page': this._noise(now, 0.14, 'bandpass', 2600, 1200, 0.22 * v, 1.2); this._noise(now + 0.09, 0.1, 'bandpass', 3400, 1800, 0.14 * v, 1.2); break;
      case 'portal': this._noise(now, 0.9, 'lowpass', 1400, 160, 0.5 * v, 2); this._tone(now, 0.9, 'sine', 180, 55, 0.35 * v, 0.05); break;
      case 'nova': this._noise(now, 0.45, 'bandpass', 900, 240, 0.7 * v, 2); this._tone(now, 0.3, 'triangle', 420, 120, 0.18 * v); break;
      case 'summon': this._tone(now, 1.2, 'sawtooth', 70, 140, 0.12 * v, 0.2); this._tone(now + 0.1, 1.1, 'triangle', 220, 440, 0.12 * v, 0.2); this._noise(now, 1.2, 'bandpass', 300, 900, 0.3 * v, 3); break;
      case 'blink': this._tone(now, 0.25, 'sine', 1100, 260, 0.2 * v); this._noise(now, 0.2, 'highpass', 3000, 1200, 0.25 * v); break;
      case 'enrage': this._tone(now, 0.8, 'sawtooth', 130, 65, 0.22 * v, 0.03); this._noise(now, 0.7, 'lowpass', 800, 120, 0.5 * v); break;
      case 'levelup': [523, 659, 784, 1047].forEach((f, i) => this._tone(now + i * 0.1, 0.5, 'triangle', f, f, 0.2 * v, 0.02)); break;
      // the classes' skills (skills.js)
      case 'bash': this._tone(now, 0.18, 'sine', 150, 55, 0.7 * v); this._noise(now, 0.12, 'bandpass', 900, 300, 0.6 * v, 1.5); this._tone(now + 0.01, 0.1, 'square', 520, 300, 0.05 * v); break;
      case 'charge': this._noise(now, 0.35, 'bandpass', 380, 1700, 0.45 * v, 2); this._tone(now, 0.3, 'sine', 90, 140, 0.25 * v, 0.03); break;
      case 'warcry': [196, 247, 294].forEach((f) => this._tone(now, 0.75, 'sawtooth', f, f * 0.96, 0.06 * v, 0.06)); this._noise(now, 0.55, 'lowpass', 900, 250, 0.3 * v); break;
      case 'leap': this._noise(now, 0.55, 'bandpass', 300, 1300, 0.35 * v, 2); break;
      case 'frost': this._noise(now, 0.6, 'highpass', 6000, 2500, 0.28 * v); [1568, 2093, 2637].forEach((f, i) => this._tone(now + i * 0.03, 0.5, 'sine', f, f, 0.05 * v, 0.005)); this._tone(now, 0.3, 'sine', 130, 60, 0.4 * v); break;
      case 'knives': for (let i = 0; i < 4; i++) this._noise(now + i * 0.035, 0.09, 'bandpass', 3000, 5200, 0.25 * v, 3); break;
      case 'smoke': this._tone(now, 0.12, 'sine', 320, 80, 0.5 * v); this._noise(now, 1.2, 'lowpass', 3200, 400, 0.35 * v); break;
      case 'bolt': this._tone(now, 0.18, 'triangle', 820, 1400, 0.1 * v); this._noise(now, 0.12, 'highpass', 4000, 2000, 0.12 * v); break;
      default: break;
    }
  }
}

// Generative music: a few small synth instruments playing seeded, slowly varying patterns, so there
// are no audio files and it never loops exactly. Three themes crossfade (see Game.frame): the woods,
// the crypt, and a battle theme for boss fights. Notes are scheduled a little ahead of the audio clock.
import { mulberry32 } from './util.js';

const hz = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note number → frequency
const pickFrom = (r, list) => list[Math.floor(r() * list.length)];

// The chord tone (in any octave) closest to a note.
function nearestChordTone(chord, note) {
  let best = note, bd = Infinity;
  for (const c of chord) {
    const n = c + 12 * Math.round((note - c) / 12);
    if (Math.abs(n - note) < bd) { bd = Math.abs(n - note); best = n; }
  }
  return best;
}

// A short flute phrase over two bars (16 eighth-note steps): a few steps up and down the scale,
// landing on a chord tone. Returns [{ at, len, note }] in steps.
function phrase(r, chord, scale, from) {
  const starts = pickFrom(r, [[0, 4, 6, 8], [0, 2, 4, 8, 12], [0, 6, 8, 12], [2, 4, 6, 10], [0, 3, 4, 8]]);
  let i = Math.max(0, scale.indexOf(from));
  if (i === 0 && from !== scale[0]) i = Math.floor(scale.length / 2);
  return starts.map((at, n) => {
    const last = n === starts.length - 1;
    i = Math.max(0, Math.min(scale.length - 1, i + pickFrom(r, [-2, -1, -1, 1, 1, 2])));
    const note = last ? nearestChordTone(chord, scale[i]) : scale[i];
    const len = (last ? 16 : starts[n + 1]) - at - (last ? 3 : 0);
    return { at, len: Math.max(1, len), note };
  });
}

// ---------------------------------------------------------------- themes
// Each theme plays one eighth-note step at a time: step(music, state, time, stepSeconds).
const DM = [50, 57, 62, 65], C = [48, 55, 60, 64], G = [43, 55, 59, 62], AM = [45, 57, 60, 64], F = [41, 57, 60, 65];
const WORLD_PROG = [[DM, C, G, DM], [F, C, DM, AM], [DM, C, G, AM], [F, G, AM, DM]];
const WORLD_SCALE = [69, 72, 74, 76, 77, 79, 81, 84, 86]; // D dorian, flute register
const ARP = [0, 1, 2, 3, 4, 3, 2, 1];

const CM = [48, 55, 60, 63], AB = [44, 56, 60, 63], FM = [41, 53, 56, 60], GSUS = [43, 55, 60, 62];
const CRYPT_PROG = [CM, AB, FM, GSUS];
const CRYPT_BELLS = [72, 73, 75, 77, 79, 80, 82, 84, 85, 87]; // C phrygian

const BOSS_CHORDS = [[50, 57, 62, 65], [46, 53, 58, 62], [48, 55, 60, 63], [45, 52, 57, 61]]; // Dm B♭ Cm A
const BOSS_BASS = [38, 38, 41, 38, 39, 38, 36, 38];
const BOSS_LEAD = [[0, 74, 4], [4, 77, 2], [6, 76, 2], [8, 74, 6], [14, 72, 2], [16, 70, 4], [20, 69, 4], [24, 74, 7]];

export const THEMES = {
  // the woods: a harp arpeggio over soft pads in D dorian, and a flute that wanders in every other section
  world: {
    bpm: 74,
    step(m, s, t, d) {
      const k = s.step, bar = Math.floor(k / 8), beat = k % 8, r = s.rng;
      const section = Math.floor(bar / 8);
      const chord = WORLD_PROG[section % WORLD_PROG.length][Math.floor(bar / 2) % 4];
      if (k % 16 === 0) {
        m.pad(s.bus, chord, t, d * 16, { level: 0.03, cutoff: 850 });
        m.bass(s.bus, chord[0] - 12, t, d * 7, 0.1);
        // a phrase for the flute in odd sections (and not every time)
        s.mem.phrase = section % 2 === 1 && r() < 0.85 ? phrase(r, chord, WORLD_SCALE, s.mem.last ?? 74) : null;
      }
      if (k % 16 === 8) m.bass(s.bus, chord[0] - 12, t, d * 7, 0.07);
      const tones = [chord[1], chord[2], chord[3], chord[1] + 12, chord[2] + 12];
      if (r() < (beat % 2 ? 0.66 : 0.92)) m.pluck(s.bus, tones[ARP[beat]], t, beat === 0 ? 1 : 0.65);
      for (const n of s.mem.phrase || []) {
        if (n.at === k % 16) { m.flute(s.bus, n.note, t, n.len * d, 0.06); s.mem.last = n.note; }
      }
    },
  },
  // the crypt: a low drone, dark slow chords, bells ringing far away, now and then a distant boom
  crypt: {
    bpm: 56,
    step(m, s, t, d) {
      const k = s.step, bar = Math.floor(k / 8), beat = k % 8, r = s.rng;
      const chord = CRYPT_PROG[Math.floor(bar / 4) % 4];
      if (k % 32 === 0) {
        m.pad(s.bus, [36, 43], t, d * 32, { level: 0.045, cutoff: 260, attack: 3, release: 4 });
        m.pad(s.bus, chord, t, d * 32, { level: 0.022, cutoff: 520, attack: 2.5, release: 3.5 });
      }
      if (r() < 0.13) m.bell(s.bus, pickFrom(r, CRYPT_BELLS), t, 0.035);
      if (beat === 0 && bar % 8 === 4 && r() < 0.7) m.drum(s.bus, t, 'taiko', 0.2);
      if (beat % 2 === 0 && r() < 0.28) m.pluck(s.bus, chord[1 + Math.floor(r() * 3)] + 12, t, 0.35, 1400);
    },
  },
  // a boss fight: taiko drums, a driving bass line, chord stabs and a brass call
  boss: {
    bpm: 112,
    step(m, s, t, d) {
      const k = s.step, bar = Math.floor(k / 8), beat = k % 8, r = s.rng;
      const chord = BOSS_CHORDS[bar % 4];
      if (beat === 0 || beat === 3 || (beat === 6 && r() < 0.6)) m.drum(s.bus, t, 'taiko', beat === 0 ? 0.4 : 0.28);
      if (beat === 2 || beat === 6) m.drum(s.bus, t, 'snare', 0.2);
      m.drum(s.bus, t, 'hat', beat % 2 ? 0.14 : 0.22);
      m.bass(s.bus, BOSS_BASS[beat] + (chord[0] - 50), t, d * 0.9, 0.1);
      if (beat === 0) m.pad(s.bus, chord, t, d * 2, { level: 0.03, cutoff: 1500, attack: 0.02, release: 0.35 });
      if (bar % 8 >= 4) { // the brass call every other four bars
        const at = (bar % 4) * 8 + beat;
        for (const [st, note, len] of BOSS_LEAD) if (st === at) m.brass(s.bus, note, t, len * d, 0.045);
      }
    },
  },
};

export class Music {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
    this.live = []; // themes playing (and fading out)
    this.theme = null;
    this.seed = 1;
    this.timer = null;
  }

  // 'world' | 'crypt' | 'boss', or null for silence; crossfades over a few seconds.
  play(name) {
    if (name === this.theme) return;
    this.theme = name;
    const t = this.ctx.currentTime;
    for (const s of this.live) {
      if (s.ending) continue;
      s.ending = t + 5;
      s.bus.gain.cancelScheduledValues(t);
      s.bus.gain.setTargetAtTime(0, t, name === 'boss' ? 0.5 : 1.2);
    }
    if (name) {
      const bus = this.ctx.createGain();
      bus.gain.value = 0.0001;
      bus.gain.setTargetAtTime(1, t + 0.2, name === 'boss' ? 0.5 : 1.5);
      bus.connect(this.out);
      this.live.push({ name, def: THEMES[name], bus, step: 0, next: t + 0.3, rng: mulberry32(this.seed++ * 7919 + Date.now() % 1000), mem: {} });
    }
    if (!this.timer) this.timer = setInterval(() => this.tick(), 90);
  }

  tick() {
    const now = this.ctx.currentTime;
    for (const s of this.live) {
      const d = 60 / s.def.bpm / 2;
      while (s.next < now + 0.3 && !(s.ending && s.next > s.ending)) {
        if (s.next > now - 0.05) s.def.step(this, s, s.next, d); // skip steps we're already late for
        s.next += d;
        s.step++;
      }
    }
    this.live = this.live.filter((s) => {
      if (!s.ending || now < s.ending) return true;
      s.bus.disconnect();
      return false;
    });
  }

  // ---------------------------------------------------------------- instruments (t: audio-clock seconds)
  // harp / lute: a plucked triangle with a closing filter
  pluck(dest, note, t, vel = 1, bright = 3000) {
    const c = this.ctx, f = hz(note);
    const o = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2.002; g2.gain.value = 0.3;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(bright, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(dest);
    for (const x of [o, o2]) { x.start(t); x.stop(t + 1.9); }
  }

  // soft strings / choir: detuned saws through a low filter, slow in and out
  pad(dest, notes, t, dur, { level = 0.04, cutoff = 900, attack = 1.2, release = 1.8 } = {}) {
    const c = this.ctx, lp = c.createBiquadFilter(), g = c.createGain();
    const hold = t + Math.max(attack, dur), end = hold + release;
    lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    lp.connect(g).connect(dest);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(end + 0.05);
      }
    }
  }

  // a breathy flute: sine with a little triangle and a vibrato that comes in late
  flute(dest, note, t, dur, level = 0.06) {
    const c = this.ctx, f = hz(note);
    const o = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain(), lfo = c.createOscillator(), depth = c.createGain(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    o2.type = 'triangle'; o2.frequency.value = f; g2.gain.value = 0.22;
    lfo.frequency.value = 5.2;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.45, dur));
    lfo.connect(depth).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.07);
    g.gain.linearRampToValueAtTime(level * 0.8, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    o.connect(g); o2.connect(g2).connect(g); g.connect(dest);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.4); }
  }

  // round bass: triangle plus a sine an octave down
  bass(dest, note, t, dur, level = 0.1) {
    const c = this.ctx, f = hz(note);
    const o = c.createOscillator(), sub = c.createOscillator(), sg = c.createGain(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    sub.type = 'sine'; sub.frequency.value = f / 2; sg.gain.value = 0.6;
    lp.type = 'lowpass'; lp.frequency.value = 420;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(level * 0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    o.connect(lp); sub.connect(sg).connect(lp); lp.connect(g).connect(dest);
    for (const x of [o, sub]) { x.start(t); x.stop(t + dur + 0.3); }
  }

  // a bell: inharmonic partials that die away at different speeds
  bell(dest, note, t, level = 0.04) {
    const c = this.ctx, f = hz(note);
    for (const [ratio, amp, decay] of [[1, 1, 3.2], [2.76, 0.45, 2.0], [5.4, 0.22, 1.1], [8.93, 0.1, 0.6]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + decay + 0.05);
    }
  }

  // brass call: saws with a filter that opens as the note swells
  brass(dest, note, t, dur, level = 0.045) {
    const c = this.ctx, lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
    lp.frequency.exponentialRampToValueAtTime(1100, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.05);
    g.gain.setValueAtTime(level, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    lp.connect(g).connect(dest);
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(note); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.3);
    }
  }

  // drums: 'kick' | 'taiko' | 'snare' | 'hat'
  drum(dest, t, kind, level = 0.3) {
    const c = this.ctx;
    if (kind === 'kick' || kind === 'taiko') {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(kind === 'kick' ? 120 : 90, t);
      o.frequency.exponentialRampToValueAtTime(kind === 'kick' ? 42 : 55, t + 0.18);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'kick' ? 0.35 : 0.7));
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + 0.8);
    }
    if (kind === 'kick') return;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    const dur = kind === 'hat' ? 0.05 : kind === 'snare' ? 0.2 : 0.45;
    src.buffer = this.noise;
    f.type = kind === 'hat' ? 'highpass' : kind === 'snare' ? 'bandpass' : 'lowpass';
    f.frequency.value = kind === 'hat' ? 7000 : kind === 'snare' ? 1900 : 380;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level * (kind === 'hat' ? 0.25 : 0.7), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }
}

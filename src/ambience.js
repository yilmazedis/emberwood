// Ambience: wind and birdsong in the woods, crows over the graveyard, water by the pond, crackling
// near fires; in the crypt a low rumble, a cold draft and dripping water. The steady sounds are looped
// noise through filters, kept low and moving (steady noise reads as a rushing river and tires the
// ear); the rest are little one-off events. Game.frame says what's around you.
export class Ambience {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
    this.beds = null;
    this.timers = { wind: 0, bird: 2, crow: 8, drip: 1.5 };
    this.gust = 1;
  }

  // swell: an optional slow wobble in loudness (hz, depth), e.g. water lapping
  bed(type, freq, q, swell = null) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.2;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = 0;
    let tail = src.connect(f);
    if (swell) {
      const amp = c.createGain(), lfo = c.createOscillator(), depth = c.createGain();
      amp.gain.value = 1 - swell[1];
      lfo.frequency.value = swell[0];
      depth.gain.value = swell[1];
      lfo.connect(depth).connect(amp.gain);
      lfo.start();
      tail = tail.connect(amp);
    }
    tail.connect(g).connect(this.out);
    src.start(0, Math.random() * 1.5);
    return { f, g, level: 0 };
  }

  set(name, level, lag = 0.8) {
    const b = this.beds[name];
    if (Math.abs(b.level - level) < 0.002) return;
    b.level = level;
    b.g.gain.setTargetAtTime(level, this.ctx.currentTime, lag);
  }

  // env: { inside, zone, fire (m to the nearest flame), pond (m to the pond), land: a land beyond the
  // waystones (frostfang: howling wind; cinderfall: a low rumble; shadowmere: crows), or null }
  update(dt, env) {
    if (!this.beds) {
      this.beds = {
        wind: this.bed('lowpass', 400, 0.6),
        rumble: this.bed('lowpass', 120, 0.7),
        water: this.bed('bandpass', 650, 0.7, [0.23, 0.6]),
        fire: this.bed('lowpass', 320, 0.6),
      };
    }
    const { inside, zone, fire, pond, land = null } = env, t = this.ctx.currentTime;
    const spooky = zone === 'graveyard' || zone === 'stones' || land === 'shadowmere';
    if ((this.timers.wind -= dt) <= 0) { // mostly a soft breath; now and then a gust swells and fades
      const gusting = Math.random() < 0.3;
      this.timers.wind = gusting ? 2.5 + Math.random() * 2 : 4 + Math.random() * 6;
      this.gust = gusting ? 0.9 + Math.random() * 0.6 : 0.3 + Math.random() * 0.3;
      this.beds.wind.f.frequency.setTargetAtTime((inside ? 160 : 260) + this.gust * (inside ? 200 : 380), t, 1.8);
    }
    this.set('wind', (inside ? 0.07 : land === 'frostfang' ? 0.19 : spooky ? 0.13 : 0.1) * this.gust, 1.6);
    this.set('rumble', inside ? 0.28 : land === 'cinderfall' ? 0.14 : 0, 1.5);
    this.set('water', !inside && pond < 18 ? 0.1 * (1 - pond / 18) : 0);
    const near = Math.max(0, 1 - fire / 8);
    this.set('fire', 0.05 * near, 0.3); // a faint roar: the crackles carry the fire
    if (near > 0 && Math.random() < dt * 10 * near) this.crackle(near);
    if (!inside && !spooky && !land && (this.timers.bird -= dt) <= 0) { this.timers.bird = 2.5 + Math.random() * 7; this.bird(); }
    if (!inside && (zone === 'graveyard' || land === 'shadowmere') && (this.timers.crow -= dt) <= 0) { this.timers.crow = 9 + Math.random() * 14; this.crow(); }
    if (inside && (this.timers.drip -= dt) <= 0) { this.timers.drip = 1 + Math.random() * 3.5; this.drip(); }
  }

  // somewhere to the left or right
  panner(life) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    p.connect(this.out);
    setTimeout(() => p.disconnect(), life * 1000 + 500);
    return p;
  }

  bird() {
    const c = this.ctx, t = c.currentTime + 0.05, pan = this.panner(1.5);
    const base = 2600 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4);
    let at = t;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), at);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.4), at + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.8, at + 0.08);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.08, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);
      o.connect(g).connect(pan);
      o.start(at); o.stop(at + 0.1);
      at += 0.09 + Math.random() * 0.07;
    }
  }

  crow() {
    const c = this.ctx, t = c.currentTime + 0.05, pan = this.panner(1.5), n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.32, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(540, at);
      o.frequency.linearRampToValueAtTime(420, at + 0.2);
      f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 3;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      o.connect(f).connect(g).connect(pan);
      o.start(at); o.stop(at + 0.25);
    }
  }

  drip() {
    const c = this.ctx, t = c.currentTime + 0.02, pan = this.panner(0.6), f0 = 1300 + Math.random() * 1400;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.05); // a drop's "plip" rises
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(pan);
    o.start(t); o.stop(t + 0.15);
  }

  crackle(near) {
    const c = this.ctx, t = c.currentTime + Math.random() * 0.05;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 2200; f.Q.value = 1.5; // woody, not sharp
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03 + 0.09 * near * Math.random(), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.04);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.8);
    src.stop(t + 0.08);
  }
}

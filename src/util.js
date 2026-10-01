export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
// obj has its own key (not from its prototype); Object.hasOwn needs iOS 15.4, this works everywhere
export const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function dampAngle(cur, target, rate, dt) {
  return cur + angleDiff(cur, target) * (1 - Math.exp(-rate * dt));
}
export const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// yaw so that a model facing +Z looks along (dx, dz)
export const yawTo = (dx, dz) => Math.atan2(dx, dz);

export function weightedPick(entries, weightKey = 'w') {
  entries = entries.filter((e) => e[weightKey] > 0);
  let total = 0;
  for (const e of entries) total += e[weightKey];
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e[weightKey];
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

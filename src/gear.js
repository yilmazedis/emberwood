// Small low-poly models for what the KayKit packs don't have: gloves, boots, helmets and armor (for icons
// and loot lying on the ground; on the hero they colour its own model), rings, earrings, necklaces and belts,
// and the weapons the pack lacks (maces, a glaive, a great maul, a scepter). Built from primitives in the same
// flat-shaded style. A `spec` is { kind, color, trim?, metal?, rough?, gem?, glow?, style? }.
import * as THREE from 'three';

const material = (color, metal = 0.1, rough = 0.7, emissive = 0x000000, emissiveIntensity = 1) =>
  new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, flatShading: true, emissive, emissiveIntensity });

function part(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}
const darker = (hex, k = 0.6) => new THREE.Color(hex).multiplyScalar(k).getHex();

// Upright right-hand glove: cuff at the bottom, four fingers and a thumb, back of the hand facing +Z.
function gloves(spec) {
  const main = material(spec.color, spec.metal, spec.rough);
  const trim = material(spec.trim ?? darker(spec.color), Math.max(0.3, spec.metal ?? 0), 0.4);
  const g = new THREE.Group();
  const flare = spec.plate ? 0.3 : 0.25;
  g.add(
    part(new THREE.CylinderGeometry(0.19, flare, 0.3, 8), main, 0, 0.15, 0),
    part(new THREE.CylinderGeometry(flare + 0.01, flare + 0.01, 0.05, 8), trim, 0, 0.03, 0),
    part(new THREE.BoxGeometry(0.37, 0.3, 0.15), main, 0, 0.44, 0),
  );
  [[-0.135, 0.24], [-0.045, 0.27], [0.045, 0.25], [0.135, 0.2]].forEach(([x, len]) => {
    g.add(part(new THREE.BoxGeometry(0.078, len, 0.12), main, x, 0.59 + len / 2, -0.015, -0.18));
  });
  g.add(part(new THREE.BoxGeometry(0.085, 0.21, 0.11), main, -0.25, 0.46, -0.01, 0, 0, 0.75)); // thumb
  if (spec.plate) {
    g.add(part(new THREE.BoxGeometry(0.4, 0.06, 0.05), trim, 0, 0.6, 0.085), part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 8), trim, 0, 0.29, 0));
  } else {
    g.add(part(new THREE.BoxGeometry(0.2, 0.025, 0.02), trim, 0, 0.45, 0.08));
  }
  return g;
}

// Boot standing on its sole, toe pointing +Z.
function boots(spec) {
  const main = material(spec.color, spec.metal, spec.rough);
  const trim = material(spec.trim ?? darker(spec.color), Math.max(0.3, spec.metal ?? 0), 0.4);
  const sole = material(0x2b2118, 0, 0.9);
  const g = new THREE.Group();
  const toe = new THREE.IcosahedronGeometry(0.18, 1);
  toe.scale(1, 0.62, 1.1);
  g.add(
    part(new THREE.CylinderGeometry(0.19, 0.21, 0.5, 8), main, 0, 0.47, -0.04),
    part(new THREE.BoxGeometry(0.34, 0.22, 0.5), main, 0, 0.14, 0.08),
    part(toe, main, 0, 0.13, 0.32),
    part(new THREE.BoxGeometry(0.36, 0.06, 0.68), sole, 0, 0.03, 0.12),
    part(new THREE.BoxGeometry(0.3, 0.1, 0.16), sole, 0, 0.06, -0.14),
    part(new THREE.CylinderGeometry(0.235, 0.235, 0.1, 8), trim, 0, 0.73, -0.04),
  );
  if (spec.plate) g.add(part(new THREE.BoxGeometry(0.22, 0.42, 0.06), trim, 0, 0.48, 0.17), part(new THREE.BoxGeometry(0.3, 0.12, 0.2), trim, 0, 0.2, 0.34));
  return g;
}

// A helmet: a plate helm with a visor, a mail coif, a leather hood or a cloth cap.
function helm(spec) {
  const main = material(spec.color, spec.metal, spec.rough);
  const trim = material(spec.trim ?? darker(spec.color), Math.max(0.3, spec.metal ?? 0), 0.4);
  const g = new THREE.Group();
  const dome = new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  if (spec.style === 'cap') { // a scholar's hat
    g.add(part(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 14), main, 0, 0.28, 0), part(new THREE.ConeGeometry(0.36, 0.9, 12), main, 0, 0.72, 0, -0.18), part(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 12), trim, 0, 0.34, 0));
    return g;
  }
  if (spec.style === 'hood') {
    g.add(part(new THREE.SphereGeometry(0.44, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.68), main, 0, 0.3, 0), part(new THREE.ConeGeometry(0.2, 0.4, 8), main, 0, 0.62, -0.22, -0.9));
    g.add(part(new THREE.CircleGeometry(0.28, 12), material(0x141016, 0, 1), 0, 0.3, 0.33));
    return g;
  }
  g.add(part(dome, main, 0, 0.3, 0), part(new THREE.CylinderGeometry(0.43, 0.43, 0.32, 12, 1, true), main, 0, 0.22, 0));
  g.add(part(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 12), trim, 0, 0.36, 0));
  if (spec.style === 'plate') {
    g.add(part(new THREE.BoxGeometry(0.5, 0.06, 0.08), material(0x101014, 0, 1), 0, 0.22, 0.4)); // eye slit
    g.add(part(new THREE.BoxGeometry(0.07, 0.3, 0.42), trim, 0, 0.62, 0)); // crest
  } else { // mail coif: links hanging round the neck
    g.add(part(new THREE.CylinderGeometry(0.46, 0.5, 0.22, 12, 1, true), trim, 0, 0.02, 0));
  }
  return g;
}

// A breastplate or a jerkin or a robe, standing up.
function chest(spec) {
  const main = material(spec.color, spec.metal, spec.rough);
  const trim = material(spec.trim ?? darker(spec.color), Math.max(0.3, spec.metal ?? 0), 0.4);
  const g = new THREE.Group();
  const robe = spec.style === 'cap';
  g.add(part(new THREE.CylinderGeometry(0.42, robe ? 0.58 : 0.36, robe ? 1.0 : 0.72, 8), main, 0, robe ? 0.5 : 0.42, 0));
  for (const s of [-1, 1]) g.add(part(new THREE.SphereGeometry(0.2, 8, 6), spec.style === 'plate' ? trim : main, s * 0.44, robe ? 0.92 : 0.74, 0)); // shoulders
  g.add(part(new THREE.BoxGeometry(0.62, 0.09, 0.5), trim, 0, robe ? 0.55 : 0.26, 0)); // belt line
  if (spec.style === 'plate') g.add(part(new THREE.BoxGeometry(0.1, 0.5, 0.06), trim, 0, 0.52, 0.36));
  return g;
}

// Ring standing upright with its gem on top; the gem glows (bloom picks it up in the world).
function ring(spec) {
  const metal = material(spec.color, 0.45, 0.3, spec.glow ? 0x6a2a00 : 0x000000, 0.6);
  const gem = material(spec.gem, 0.1, 0.15, spec.gem, 0.7);
  const g = new THREE.Group();
  g.add(part(new THREE.TorusGeometry(0.28, 0.065, 8, 22), metal, 0, 0.36, 0), part(new THREE.CylinderGeometry(0.1, 0.13, 0.08, 6), metal, 0, 0.66, 0), part(new THREE.OctahedronGeometry(0.13, 0), gem, 0, 0.77, 0));
  return g;
}

// An earring: a small hoop with a gem hanging from it.
function earring(spec) {
  const metal = material(spec.color, 0.45, 0.3, spec.glow ? 0x6a2a00 : 0x000000, 0.6);
  const gem = material(spec.gem, 0.1, 0.15, spec.gem, 0.8);
  const g = new THREE.Group();
  g.add(part(new THREE.TorusGeometry(0.16, 0.04, 6, 16), metal, 0, 0.72, 0), part(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 5), metal, 0, 0.47, 0));
  const drop = new THREE.OctahedronGeometry(0.16, 0);
  drop.scale(0.8, 1.4, 0.8);
  g.add(part(drop, gem, 0, 0.24, 0));
  return g;
}

// A necklace: a chain in a loop with a pendant.
function necklace(spec) {
  const metal = material(spec.color, 0.45, 0.3, spec.glow ? 0x6a2a00 : 0x000000, 0.6);
  const gem = material(spec.gem, 0.1, 0.15, spec.gem, 0.8);
  const g = new THREE.Group();
  const chain = new THREE.TorusGeometry(0.36, 0.025, 5, 28, Math.PI * 1.15);
  g.add(part(chain, metal, 0, 0.58, 0, 0, 0, Math.PI * 1.07));
  g.add(part(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 8), metal, 0, 0.2, 0, Math.PI / 2), part(new THREE.OctahedronGeometry(0.11, 0), gem, 0, 0.2, 0.04));
  return g;
}

// A belt: a loop of leather and a buckle.
function belt(spec) {
  const leather = material(spec.gem ?? 0x6a4428, 0.05, 0.8);
  const metal = material(spec.color, 0.45, 0.3, spec.glow ? 0x6a2a00 : 0x000000, 0.6);
  const g = new THREE.Group();
  const loop = new THREE.TorusGeometry(0.4, 0.07, 4, 24);
  loop.scale(1, 0.55, 1);
  g.add(part(loop, leather, 0, 0.32, 0, Math.PI / 2.4), part(new THREE.BoxGeometry(0.2, 0.18, 0.05), metal, 0, 0.32, 0.36), part(new THREE.BoxGeometry(0.12, 0.1, 0.06), leather, 0, 0.32, 0.37));
  return g;
}

export function buildGearModel(spec) {
  switch (spec.kind) {
    case 'gloves': case 'hands': return gloves(spec);
    case 'boots': case 'feet': return boots(spec);
    case 'head': return helm(spec);
    case 'body': return chest(spec);
    case 'ear': return earring(spec);
    case 'neck': return necklace(spec);
    case 'belt': return belt(spec);
    default: return ring(spec);
  }
}

// Icon camera angle per kind (see assets.js snapshot).
export const GEAR_ICON_ROT = {
  gloves: [0.15, -0.45, 0.2], hands: [0.15, -0.45, 0.2], boots: [0.2, -1.15, 0], feet: [0.2, -1.15, 0],
  head: [0.25, -0.5, 0], body: [0.15, -0.5, 0], ring: [0.3, 0.35, 0], ear: [0.2, 0.4, 0], neck: [0.3, 0.2, 0], belt: [0.5, 0.3, 0],
};

// ---------------------------------------------------------------- weapons the packs don't have
// Handle at the origin, pointing up +Y, like the pack's own weapons.
function wood(hex = 0x6a4428) { return material(hex, 0, 0.85); }
function steel(hex = 0xc8d0da) { return material(hex, 0.45, 0.35); }

export const PROC_WEAPONS = {
  // a one-handed flanged mace
  proc_mace() {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.05, 0.06, 0.95, 6), wood(), 0, 0.2, 0));
    g.add(part(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 8), steel(0x8a6a3a), 0, -0.22, 0));
    const head = steel();
    g.add(part(new THREE.SphereGeometry(0.17, 8, 6), head, 0, 0.78, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(part(new THREE.BoxGeometry(0.05, 0.3, 0.14), head, Math.cos(a) * 0.15, 0.78, Math.sin(a) * 0.15, 0, -a, 0));
    }
    g.add(part(new THREE.ConeGeometry(0.06, 0.16, 6), head, 0, 1.0, 0));
    return g;
  },
  // a glaive: a long shaft with a curved blade
  proc_glaive() {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.045, 0.05, 2.5, 6), wood(0x5a3a22), 0, 0.55, 0));
    g.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8), steel(0x8a6a3a), 0, 1.78, 0));
    const blade = new THREE.Shape();
    blade.moveTo(0, 0); blade.quadraticCurveTo(0.32, 0.3, 0.1, 0.95); blade.lineTo(-0.02, 0.92); blade.quadraticCurveTo(0.12, 0.35, -0.08, 0.05); blade.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(blade, { depth: 0.04, bevelEnabled: false });
    geo.translate(0, 0, -0.02);
    g.add(part(geo, steel(), 0, 1.8, 0));
    g.add(part(new THREE.ConeGeometry(0.05, 0.14, 6), steel(), 0, -0.76, 0, Math.PI));
    return g;
  },
  // a great maul: a long haft and a heavy iron block
  proc_maul() {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.06, 0.07, 1.9, 6), wood(0x4a3020), 0, 0.35, 0));
    g.add(part(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 8), steel(0x6a6058), 0, -0.45, 0));
    const iron = steel(0x8a929c);
    g.add(part(new THREE.BoxGeometry(0.62, 0.36, 0.36), iron, 0, 1.36, 0));
    for (const s of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.06, 0.44, 0.44), steel(0x6a7078), s * 0.32, 1.36, 0));
    g.add(part(new THREE.ConeGeometry(0.08, 0.2, 4), iron, 0, 1.62, 0));
    return g;
  },
  // a scepter: a slim rod crowned with wings and a glowing orb
  proc_scepter() {
    const g = new THREE.Group();
    const gold = material(0xe8c060, 0.5, 0.3);
    g.add(part(new THREE.CylinderGeometry(0.04, 0.05, 0.95, 8), gold, 0, 0.2, 0));
    g.add(part(new THREE.SphereGeometry(0.06, 8, 6), gold, 0, -0.28, 0));
    g.add(part(new THREE.TorusGeometry(0.16, 0.025, 6, 16), gold, 0, 0.82, 0));
    for (const s of [-1, 1]) g.add(part(new THREE.ConeGeometry(0.07, 0.32, 4), gold, s * 0.17, 0.82, 0, 0, 0, s * 1.1));
    g.add(part(new THREE.IcosahedronGeometry(0.11, 1), material(0xfff6d8, 0.1, 0.2, 0xfff0b0, 1.2), 0, 0.82, 0));
    return g;
  },
};

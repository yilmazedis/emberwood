// Small low-poly models for gloves, boots and rings. The KayKit packs don't include these,
// so they're built from primitives in the same flat-shaded style. Used for inventory icons
// and for loot lying on the ground; `spec` is an item base's `gear` entry (see items.js).
import * as THREE from 'three';

const material = (color, metal, rough, emissive = 0x000000, emissiveIntensity = 1) =>
  new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, flatShading: true, emissive, emissiveIntensity });

function part(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

// Upright right-hand glove: cuff at the bottom, four fingers and a thumb, back of the hand facing +Z.
function gloves(spec) {
  const main = material(spec.color, spec.metal, spec.rough);
  const trim = material(spec.trim, Math.max(0.3, spec.metal), 0.4);
  const g = new THREE.Group();
  const flare = spec.plate ? 0.3 : 0.25;
  g.add(
    part(new THREE.CylinderGeometry(0.19, flare, 0.3, 8), main, 0, 0.15, 0),
    part(new THREE.CylinderGeometry(flare + 0.01, flare + 0.01, 0.05, 8), trim, 0, 0.03, 0),
    part(new THREE.BoxGeometry(0.37, 0.3, 0.15), main, 0, 0.44, 0),
  );
  // fingers: index → pinky, slightly different lengths, curled a little toward the palm
  [[-0.135, 0.24], [-0.045, 0.27], [0.045, 0.25], [0.135, 0.2]].forEach(([x, len]) => {
    g.add(part(new THREE.BoxGeometry(0.078, len, 0.12), main, x, 0.59 + len / 2, -0.015, -0.18));
  });
  g.add(part(new THREE.BoxGeometry(0.085, 0.21, 0.11), main, -0.25, 0.46, -0.01, 0, 0, 0.75)); // thumb
  if (spec.plate) {
    g.add(
      part(new THREE.BoxGeometry(0.4, 0.06, 0.05), trim, 0, 0.6, 0.085), // knuckle guard
      part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 8), trim, 0, 0.29, 0), // cuff rim
    );
  } else {
    g.add(part(new THREE.BoxGeometry(0.2, 0.025, 0.02), trim, 0, 0.45, 0.08)); // stitching
  }
  return g;
}

// Boot standing on its sole, toe pointing +Z.
function boots(spec) {
  const main = material(spec.color, spec.metal, spec.rough);
  const trim = material(spec.trim, Math.max(0.3, spec.metal), 0.4);
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
  if (spec.plate) {
    g.add(
      part(new THREE.BoxGeometry(0.22, 0.42, 0.06), trim, 0, 0.48, 0.17),
      part(new THREE.BoxGeometry(0.3, 0.12, 0.2), trim, 0, 0.2, 0.34),
    );
  }
  return g;
}

// Ring standing upright with its gem on top; the gem glows (bloom picks it up in the world).
function ring(spec) {
  const metal = material(spec.color, 0.45, 0.3);
  const gem = material(spec.gem, 0.1, 0.15, spec.gem, 0.7);
  const g = new THREE.Group();
  g.add(
    part(new THREE.TorusGeometry(0.28, 0.065, 8, 22), metal, 0, 0.36, 0),
    part(new THREE.CylinderGeometry(0.1, 0.13, 0.08, 6), metal, 0, 0.66, 0),
    part(new THREE.OctahedronGeometry(0.13, 0), gem, 0, 0.77, 0),
  );
  return g;
}

export function buildGearModel(spec) {
  if (spec.kind === 'gloves') return gloves(spec);
  if (spec.kind === 'boots') return boots(spec);
  return ring(spec);
}

// Icon camera angle per kind (see assets.js snapshot).
export const GEAR_ICON_ROT = {
  gloves: [0.15, -0.45, 0.2],
  boots: [0.2, -1.15, 0],
  ring: [0.3, 0.35, 0],
};

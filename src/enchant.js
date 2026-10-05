// Upgrade glows on a held weapon, shield or book (Humanoid.equip), the way a well-upgraded weapon glows in Knight
// Online: nothing up to +7; from +8 a pink aura with sparkles around its head (a shield's, a book's or a bow's
// middle); at +9 the item itself shines too, in slow pulses; at +10 it shines all the time.
import * as THREE from 'three';

const AURA = new THREE.Color(0xff2ad0), CORE = new THREE.Color(0xff7ae6), SHINE = new THREE.Color(0xff8ae8);
let glowTex = null, dotTex = null;

// a soft white disc, see-through at the edge (tinted by the material)
function radial(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The glow for item `obj` at +plus, attached to it: { update(dt), dispose() }, or null below +8.
// center: glow around its middle (shields, books, bows) instead of its far end.
export function enchant(obj, plus, { center = false } = {}) {
  if (plus < 8) return null;
  glowTex ||= radial(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [0.6, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]);
  dotTex ||= radial(32, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);

  // where it glows, in the item's own space (measured on its own, out of the hand): the end of its longest
  // side away from the grip
  const parent = obj.parent, keep = { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() };
  parent?.remove(obj);
  obj.position.set(0, 0, 0);
  obj.quaternion.identity();
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.copy(keep.p);
  obj.quaternion.copy(keep.q);
  obj.scale.copy(keep.s);
  parent?.add(obj);
  obj.updateMatrixWorld(true);
  const size = box.getSize(new THREE.Vector3()), head = box.getCenter(new THREE.Vector3());
  const axis = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : (size.y > size.z ? 'y' : 'z');
  const len = Math.max(0.2, size[axis]);
  if (!center) head[axis] = Math.abs(box.max[axis]) >= Math.abs(box.min[axis]) ? box.max[axis] - len * 0.2 : box.min[axis] + len * 0.2;

  const level = plus - 7; // 1 at +8 … 3 at +10
  const group = new THREE.Group();
  group.position.copy(head);
  obj.add(group);
  // a wide magenta halo with a brighter core
  const glow = 0.55 + 0.15 * level;
  const sprite = (color, opacity) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
  const aura = sprite(AURA, glow), core = sprite(CORE, Math.min(1, glow * 1.1));
  const s = Math.max(0.45, len * (center ? 0.85 : 0.45));
  aura.scale.set(s, s, 1);
  core.scale.set(s * 0.5, s * 0.5, 1);
  group.add(aura, core);

  // sparkles drifting around it
  const N = 8 + 4 * level, pos = new Float32Array(N * 3);
  const seeds = Array.from({ length: N }, () => [Math.random() * Math.PI * 2, Math.random(), 0.5 + Math.random() * 0.6]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, color: SHINE, size: 0.09 + 0.015 * level, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.frustumCulled = false;
  group.add(sparks);

  // +9 and +10: the item shines (its own materials, so other items of its kind don't)
  const mats = [];
  if (plus >= 9) {
    obj.traverse((o) => {
      if (!o.isMesh || !o.material?.emissive) return;
      o.material = o.material.clone();
      o.material.emissive = SHINE.clone();
      mats.push(o.material);
    });
  }

  let t = Math.random() * 10;
  const r = s * 0.42;
  return {
    update(dt) {
      t += dt;
      const breathe = 1 + Math.sin(t * 3.1) * 0.07;
      aura.scale.set(s * breathe, s * breathe, 1);
      aura.material.opacity = glow * (0.85 + 0.15 * Math.sin(t * 7.3));
      core.material.opacity = Math.min(1, glow * 1.1) * (0.8 + 0.2 * Math.sin(t * 5.1 + 1));
      for (let i = 0; i < N; i++) {
        const [a, phase, speed] = seeds[i], k = (t * speed * 0.5 + phase) % 1, ang = a + t * speed * 1.3;
        pos[i * 3] = Math.cos(ang) * r * (0.45 + k * 0.6);
        pos[i * 3 + 1] = (k - 0.35) * r * 1.8;
        pos[i * 3 + 2] = Math.sin(ang) * r * (0.45 + k * 0.6);
      }
      geo.attributes.position.needsUpdate = true;
      if (mats.length) { // +9: slow pulses; +10: always
        const shine = plus >= 10 ? 1.15 + Math.sin(t * 4.2) * 0.1 : 0.12 + 0.95 * (0.5 + 0.5 * Math.sin(t * 2.4));
        for (const m of mats) m.emissiveIntensity = shine;
      }
    },
    dispose() {
      obj.remove(group);
      aura.material.dispose();
      core.material.dispose();
      sparks.material.dispose();
      geo.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

// The lands beyond the waystones, drawn: ground, pools (lava, black water, a frozen lake), trees, rocks,
// camps and ruins, the dungeon's door, the weather (snow, embers, motes) and the minimap. Where everything
// stands comes from the land's plan (outdoor-map.js, shared with the server); this only makes it visible,
// in the same generated, flat-shaded style as Emberwood. Built the first time a hero arrives.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, noise2 } from './noise.js';
import { clamp, smoothstep, mulberry32, rand } from './util.js';
import { colored, gradient, jitter, envMaterial, makePine, makeOak, makeRock, scatterInstanced, buildWaystone, worldUniforms } from './world.js';
import { hdr } from './fx.js';

// ---------------------------------------------------------------- palettes
const C = (hex) => new THREE.Color(hex);
const BIOMES = {
  frostfang: {
    a: C(0xeef3f8), b: C(0xd5e0eb), dark: C(0xbfcddb), rock: C(0x8d95a2), path: C(0xb9b2a4), pathEdge: C(0xcfc8bb), camp: C(0xa59680),
    patches: { ff_raiders: [C(0xb8ad9e), 0.55], ff_ridge: [C(0xa3a9b4), 0.6], ff_hold: [C(0x93a2b4), 0.6] },
    pool: { ice: C(0xa9d3ec) }, rocks: [0x9aa4b0, 0x87909c],
  },
  cinderfall: {
    a: C(0x4c4642), b: C(0x3c3734), dark: C(0x2c2826), rock: C(0x5a5350), path: C(0x6e5e4e), pathEdge: C(0x5a4c40), camp: C(0x5e4c3c),
    crack: C(0x8a2e12), patches: { cf_obsidian: [C(0x262226), 0.75], cf_lava: [C(0x4a2a1e), 0.55], cf_throne: [C(0x2e2424), 0.7] },
    pool: { lava: C(0x5a2414) }, rocks: [0x3e3936, 0x4c4542],
  },
  canyon: {
    a: C(0x8a4e36), b: C(0x7a432e), dark: C(0x5a2c1e), rock: C(0x6a3a2a), path: C(0xa8784e), pathEdge: C(0x8a5e40), camp: C(0x6a4a3a),
    crack: C(0xff5a10), patches: { dc_scar: [C(0x2e2222), 0.65], dc_spine: [C(0xb89a7a), 0.45], dc_maw: [C(0x3a1e18), 0.65] },
    pool: { lava: C(0x5a2414) }, rocks: [0x7a4a38, 0x5e3628], lavaHeat: 0.45,
    // the walls in layers of rock, as in a real canyon: bands by height, a little wavy
    strata: [C(0x9a5236), C(0xb8724a), C(0x7a3e2a), C(0xc8946a), C(0x8a4630), C(0x6a3424), C(0xa8603e)],
  },
  shadowmere: {
    a: C(0x3c3a4a), b: C(0x343a38), dark: C(0x2a2834), rock: C(0x56526a), path: C(0x5e5664), pathEdge: C(0x4a4452), camp: C(0x4e4452),
    moss: C(0x3e5a42), patches: { sm_bones: [C(0x8a8478), 0.55], sm_wraith: [C(0x2e2a36), 0.6], sm_spire: [C(0x26222e), 0.7] },
    pool: { tar: C(0x1a1622) }, rocks: [0x4a4656, 0x3e3a48],
  },
};

function groundColor(om, B, out, x, z, h, slope) {
  const lx = x - om.cx, lz = z - om.cz;
  const n = fbm(lx * 0.06 + 40, lz * 0.06 - 12, 3), n2 = noise2(lx * 0.21, lz * 0.21);
  out.copy(B.a).lerp(B.b, clamp(n * 1.5 + 0.5, 0, 1));
  if (n2 > 0.45) out.lerp(B.dark, 0.45);
  if (B.moss && n > 0.15) out.lerp(B.moss, clamp((n - 0.15) * 2.5, 0, 0.6));
  if (B.crack) { // embers glowing through cracks in the ash, here and there
    const k = Math.abs(noise2(lx * 0.22 + 7, lz * 0.22 - 3)), m = fbm(lx * 0.05 - 20, lz * 0.05 + 9, 2);
    if (k < 0.035 && m > 0.05) out.lerp(B.crack, (1 - k / 0.035) * 0.5);
  }
  for (const zn of om.zones) {
    const p = B.patches[zn.id];
    if (!p) continue;
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d < zn.r + 2) out.lerp(p[0], (1 - smoothstep(zn.r * 0.45, zn.r, d + n2 * 2)) * p[1]);
  }
  const dc = Math.hypot(x - om.camp.x, z - om.camp.z);
  if (dc < om.camp.r - 1) out.lerp(B.camp, (1 - smoothstep(om.camp.r - 6, om.camp.r - 1.5, dc + n2 * 1.5)) * 0.85);
  const pd = om.pathDist(x, z) + n2 * 0.7;
  if (pd < 2.3) out.lerp(pd < 1.45 ? B.path : B.pathEdge, pd < 1.45 ? 0.9 : 0.45);
  for (const p of om.pools) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + 2.5) out.lerp(B.pool[p.kind] || B.dark, 1 - smoothstep(p.r - 0.5, p.r + 2.5, d));
  }
  if (slope > 0.5) out.lerp(B.rock, smoothstep(0.5, 0.8, slope));
  if (B.strata && h > 2.2) { // canyon walls: layered rock
    const band = h * 0.42 + noise2(lx * 0.03, lz * 0.03) * 0.8, i = Math.floor(band), L = B.strata;
    const a = L[((i % L.length) + L.length) % L.length], b = L[(((i + 1) % L.length) + L.length) % L.length];
    out.lerp(tmpStrata.copy(a).lerp(b, smoothstep(0.75, 1, band - i)), smoothstep(2.2, 4.5, h) * 0.85);
  }
  return out;
}
const tmpStrata = new THREE.Color();

function buildTerrain(om, B, rng) {
  const SIZE = om.R * 2 + 60, SEG = Math.round(SIZE / 1.5);
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cell = SIZE / SEG;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    if (Math.abs(x) < SIZE / 2 - 1 && Math.abs(z) < SIZE / 2 - 1) {
      x += noise2(x * 0.7 + 3.1, z * 0.7) * cell * 0.3;
      z += noise2(x * 0.7, z * 0.7 + 9.7) * cell * 0.3;
    }
    x += om.cx;
    z += om.cz;
    pos.setXYZ(i, x, om.heightAt(x, z), z);
  }
  const g = geo.toNonIndexed(), p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    e1.subVectors(b, a); e2.subVectors(c, a);
    const ny = Math.abs(e1.cross(e2).normalize().y);
    groundColor(om, B, col, (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, (a.y + b.y + c.y) / 3, 1 - ny);
    col.multiplyScalar(0.93 + rng() * 0.12);
    for (let k = 0; k < 3; k++) { colors[(i + k) * 3] = col.r; colors[(i + k) * 3 + 1] = col.g; colors[(i + k) * 3 + 2] = col.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

// Lava flows (animated, glowing), black water (still and glossy), a frozen lake (pale ice). heat: how bright
// the lava (the canyon's, out in daylight, is a dark crust with glowing veins).
function buildPools(om, group, lights, heat = 1) {
  const lava = new THREE.ShaderMaterial({
    uniforms: { uTime: worldUniforms.uTime, uHeat: { value: heat } },
    vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; uniform float uHeat; varying vec2 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){ vec2 p = vW * 0.35; float v = n(p + vec2(uTime * 0.12, uTime * 0.07)) * 0.6 + n(p * 2.3 - vec2(uTime * 0.2, 0.0)) * 0.4;
        float veins = smoothstep(0.42, 0.62, v);
        vec3 c = mix(vec3(0.55, 0.06, 0.01) * uHeat * uHeat, vec3(3.2, 1.25, 0.25) * uHeat, veins) + vec3(0.6, 0.12, 0.0) * smoothstep(0.7, 0.9, v) * uHeat;
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const tar = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.06, metalness: 0.35, emissive: 0x1a0c2a, emissiveIntensity: 0.6 });
  const ice = new THREE.MeshStandardMaterial({ color: 0xbfe2f5, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x16303f, emissiveIntensity: 0.35 });
  for (const p of om.pools) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r + (p.kind === 'ice' ? 0.6 : 1.6), 40), p.kind === 'lava' ? lava : p.kind === 'tar' ? tar : ice);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x, p.kind === 'ice' ? 0.6 : 0.3, p.z);
    disc.receiveShadow = p.kind !== 'lava';
    group.add(disc);
    if (p.kind === 'lava') lights.push({ pos: new THREE.Vector3(p.x, 1.6, p.z), color: 0xff6a1a, power: 10, dist: p.r * 2.4 + 6, flicker: p.x });
  }
}

// ---------------------------------------------------------------- trees
function makeSnowPine(rng) {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.16, 0.26, 1.3, 6).translate(0, 0.65, 0), 0x5e4630),
    gradient(jitter(new THREE.ConeGeometry(1.55, 1.9, 7).translate(0, 1.9, 0), 0.28, rng), 0x2b5a40, 0xe6eef5, 1.3, 2.9),
    gradient(jitter(new THREE.ConeGeometry(1.2, 1.6, 7).translate(0, 2.75, 0), 0.22, rng), 0x2f6446, 0xf0f5fa, 2.2, 3.6),
    gradient(jitter(new THREE.ConeGeometry(0.8, 1.4, 7).translate(0, 3.55, 0), 0.16, rng), 0x3a7050, 0xf8fbfd, 3.0, 4.3),
  ]);
}

function makeDeadTree(rng, hex = 0x4b3f37, tips = null) {
  const bits = [colored(new THREE.CylinderGeometry(0.12, 0.26, 3.0, 5).translate(0, 1.5, 0), hex)];
  for (let k = 0; k < 5; k++) {
    const br = new THREE.CylinderGeometry(0.03, 0.08, 1.3, 4).translate(0, 0.65, 0);
    br.rotateZ(0.6 + rng() * 0.6);
    br.rotateY(k * 1.3 + rng());
    br.translate(0, 1.4 + k * 0.3, 0);
    bits.push(colored(br, hex));
    if (tips) bits.push(colored(new THREE.IcosahedronGeometry(0.12, 0).translate(Math.cos(k * 1.3) * 0.7, 2.3 + k * 0.3, -Math.sin(k * 1.3) * 0.7), tips));
  }
  return mergeGeometries(bits);
}

function makeTwisted(rng) {
  const bits = [];
  let x = 0, z = 0;
  for (let i = 0; i < 4; i++) { // a trunk that leans this way and that
    const seg = new THREE.CylinderGeometry(0.16 - i * 0.025, 0.24 - i * 0.03, 1.0, 5).translate(0, 0.5, 0);
    seg.rotateZ((rng() - 0.5) * 0.5);
    seg.translate(x, i * 0.92, z);
    x += (rng() - 0.5) * 0.3;
    z += (rng() - 0.5) * 0.3;
    bits.push(colored(seg, 0x2e2630));
  }
  for (let k = 0; k < 3; k++) {
    const blob = jitter(new THREE.IcosahedronGeometry(0.9 - k * 0.15, 0), 0.3, rng);
    blob.scale(1, 0.7, 1);
    blob.translate(x + Math.cos(k * 2.1) * 0.6, 3.5 + k * 0.35, z + Math.sin(k * 2.1) * 0.6);
    bits.push(colored(blob, [0x3a2a4e, 0x45305a, 0x2f2a40][k]));
  }
  return mergeGeometries(bits);
}

function makeGlowcap(rng) {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.16, 0.26, 2.4, 6).translate(0, 1.2, 0), 0xd8cce8),
    colored(jitter(new THREE.SphereGeometry(1.25, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0.12, rng).scale(1, 0.6, 1).translate(0, 2.35, 0), 0x9a5aff),
    colored(new THREE.CylinderGeometry(1.15, 1.15, 0.08, 9).translate(0, 2.36, 0), 0x5a2a8a),
  ]);
}

const TREES = {
  pine: (rng) => makePine(rng),
  snowpine: (rng) => makeSnowPine(rng),
  deadtree: (rng) => makeDeadTree(rng),
  charred: (rng) => makeDeadTree(rng, 0x221c1a, 0xff7a2a),
  emberwood: (rng) => makeOak(rng, 0xe07a2c, 0xf0a13c, 0xc8582a),
  twisted: (rng) => makeTwisted(rng),
  glowcap: (rng) => makeGlowcap(rng),
};

// ---------------------------------------------------------------- props
function buildProps(om, group, rng, out) {
  const parts = [];
  const add = (geo, x, z, { y = 0, rotY = 0 } = {}) => {
    geo.rotateY(rotY);
    geo.translate(x, om.heightAt(x, z) + y, z);
    parts.push(geo);
  };
  const glowMat = (hex, k = 2.2) => new THREE.MeshBasicMaterial({ color: hdr(hex, k) });
  const fire = (x, z, y, color = 0xff8a3a, scale = 1) => {
    const pos = new THREE.Vector3(x, om.heightAt(x, z) + y, z);
    out.fires.push({ pos, scale, color });
    out.lights.push({ pos: pos.clone().setY(pos.y + 0.6), color, power: 11, dist: 13, flicker: x + z });
  };
  const build = {
    campfire({ x, z, color }) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        add(colored(jitter(new THREE.DodecahedronGeometry(0.27, 0), 0.12, rng), 0x77736c), x + Math.cos(a) * 0.95, z + Math.sin(a) * 0.95, { y: 0.1 });
      }
      for (let i = 0; i < 3; i++) {
        const log = colored(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6), 0x4a3220);
        log.rotateZ(Math.PI / 2 - 0.35);
        log.translate(0.3, 0.3, 0);
        add(log, x, z, { rotY: (i / 3) * Math.PI * 2 });
      }
      fire(x, z, 0.35, color || 0xff8a3a);
    },
    waystone({ x, z }) {
      const w = buildWaystone(x, z, rng);
      group.add(w.group);
      out.waystones.push(w);
      out.lights.push({ pos: w.glow, color: 0x5ad0ff, power: 6, dist: 9 });
    },
    tent({ x, z, rotY, color, s = 1 }) {
      const t = colored(jitter(new THREE.ConeGeometry(1.9 * s, 2.5 * s, 4, 1), 0.08, rng), color);
      t.rotateY(Math.PI / 4);
      t.translate(0, 1.2 * s, 0);
      add(t, x, z, { rotY });
      const door = colored(new THREE.ConeGeometry(0.55 * s, 1.5 * s, 3, 1, true, 0, Math.PI * 0.66), 0x22160e);
      door.translate(0, 0.72 * s, 1.18 * s);
      add(door, x, z, { rotY });
    },
    crate({ x, z, rotY, s = 0.85 }) {
      add(colored(new THREE.BoxGeometry(s, s, s).translate(0, s / 2, 0), 0x8f6a3a), x, z, { rotY });
      add(colored(new THREE.BoxGeometry(s * 1.02, s * 0.12, s * 1.02).translate(0, s * 0.8, 0), 0x6d5028), x, z, { rotY });
    },
    barrel({ x, z }) {
      add(colored(new THREE.CylinderGeometry(0.38, 0.34, 0.95, 9).translate(0, 0.48, 0), 0x7a4e26), x, z);
      add(colored(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 9).translate(0, 0.72, 0), 0x55504a), x, z);
    },
    stake({ x, z, snow }) {
      const h = 1.3 + rng() * 0.35;
      add(colored(new THREE.CylinderGeometry(0.15, 0.17, h, 5).translate(0, h / 2, 0), 0x6a4a30), x, z);
      add(colored(new THREE.ConeGeometry(0.15, 0.35, 5).translate(0, h + 0.17, 0), snow ? 0xeef4fa : 0x7a5838), x, z);
    },
    watchtower({ x: tx, z: tz }) {
      for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) add(colored(new THREE.CylinderGeometry(0.12, 0.14, 3.6, 5).translate(0, 1.8, 0), 0x5e4630), tx + ox, tz + oz);
      add(colored(new THREE.BoxGeometry(2.3, 0.2, 2.3).translate(0, 3.5, 0), 0x7a5838), tx, tz);
      add(colored(new THREE.ConeGeometry(1.8, 1.2, 4).rotateY(Math.PI / 4).translate(0, 4.9, 0), 0xdde6ee), tx, tz);
    },
    banner({ x, z, color }) {
      add(colored(new THREE.CylinderGeometry(0.06, 0.07, 3.2, 5).translate(0, 1.6, 0), 0x4a3a2a), x, z);
      add(colored(new THREE.BoxGeometry(0.9, 1.4, 0.04).translate(0.45, 2.3, 0), color), x, z);
    },
    icespike({ x, z, s, rotY }) {
      for (let k = 0; k < 3; k++) {
        const h = (1.4 + rng() * 1.6) * s;
        const sp = colored(new THREE.ConeGeometry(0.28 * s, h, 5).translate(0, h / 2, 0), k ? 0xbfe6fa : 0x9fd6f2);
        sp.rotateZ((rng() - 0.5) * 0.6);
        sp.rotateX((rng() - 0.5) * 0.5);
        add(sp, x + (rng() - 0.5) * 0.7 * s, z + (rng() - 0.5) * 0.7 * s, { rotY });
      }
    },
    boulder({ x, z, s, dark }) {
      add(colored(jitter(new THREE.DodecahedronGeometry(s, 0), 0.5, rng).scale(1, 0.8, 1), dark ? 0x2c2828 : 0x7c7f86), x, z, { y: s * 0.35 });
    },
    standing({ x, z, a, dark }) {
      const h = 2.6 + rng() * 1.1;
      const st = colored(jitter(new THREE.BoxGeometry(1.0, h, 0.75, 1, 2, 1), 0.18, rng).translate(0, h / 2 - 0.2, 0), dark ? 0x3e3a4a : 0x8a909c);
      st.rotateZ((rng() - 0.5) * 0.15);
      add(st, x, z, { rotY: -a });
    },
    throne({ x, z, color }) {
      add(colored(new THREE.BoxGeometry(4.2, 0.4, 3.0).translate(0, 0.2, 0), color), x, z);
      add(colored(new THREE.BoxGeometry(3.2, 0.4, 2.2).translate(0, 0.6, 0.1), color), x, z);
      add(colored(new THREE.BoxGeometry(1.6, 0.9, 1.2).translate(0, 1.25, 0), color), x, z);
      add(colored(new THREE.BoxGeometry(1.8, 3.4, 0.4).translate(0, 2.4, -0.55), color), x, z);
      for (const s of [-1, 1]) add(colored(new THREE.ConeGeometry(0.22, 1.0, 4).translate(s * 0.75, 4.5, -0.55), color), x, z);
    },
    brazier({ x, z, color }) {
      add(colored(new THREE.CylinderGeometry(0.1, 0.14, 1.1, 6).translate(0, 0.55, 0), 0x2e2e34), x, z);
      add(colored(new THREE.CylinderGeometry(0.38, 0.2, 0.3, 8).translate(0, 1.2, 0), 0x2e2e34), x, z);
      fire(x, z, 1.35, color || 0xff8a3a, 0.6);
    },
    bones({ x: lx, z: lz }) {
      for (let i = 0; i < 7; i++) {
        const a = rng() * Math.PI * 2, d = 2 + rng() * 5, x = lx + Math.cos(a) * d, z = lz + Math.sin(a) * d;
        for (let k = 0; k < 3; k++) {
          const b = colored(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4), 0xece3cc);
          b.rotateZ(Math.PI / 2);
          add(b, x + (rng() - 0.5) * 0.4, z + (rng() - 0.5) * 0.4, { y: 0.06, rotY: rng() * 6.28 });
        }
        if (rng() < 0.6) add(colored(new THREE.IcosahedronGeometry(0.18, 0), 0xf2ead6), x, z, { y: 0.15 });
      }
    },
    headstone({ x, z, rotY, variant }) {
      const g = variant === 'cross'
        ? mergeGeometries([colored(new THREE.BoxGeometry(0.22, 1.35, 0.2).translate(0, 0.62, 0), 0x6e6a7a), colored(new THREE.BoxGeometry(0.8, 0.2, 0.2).translate(0, 0.95, 0), 0x6e6a7a)])
        : variant === 'broken'
          ? colored(jitter(new THREE.BoxGeometry(0.8, 0.55, 0.24, 1, 2, 1), 0.12, rng).translate(0, 0.22, 0), 0x5e5a6a)
          : mergeGeometries([colored(new THREE.BoxGeometry(0.8, 0.85, 0.22).translate(0, 0.38, 0), 0x726e80), colored(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12).rotateX(Math.PI / 2).translate(0, 0.8, 0), 0x726e80)]);
      g.rotateZ((rng() - 0.5) * 0.25);
      add(g, x, z, { rotY, y: -0.05 });
    },
    ribcage({ x, z, rotY, s }) {
      add(colored(new THREE.CylinderGeometry(0.12 * s, 0.1 * s, 4.2 * s, 6).rotateX(Math.PI / 2).translate(0, 0.3 * s, 0), 0xe8dfc8), x, z, { rotY });
      for (let k = 0; k < 6; k++) {
        const rib = colored(new THREE.TorusGeometry(1.1 * s * (1 - Math.abs(k - 2.5) * 0.08), 0.07 * s, 4, 10, Math.PI).rotateY(Math.PI / 2).translate(0, 0.3 * s, (k - 2.5) * 0.65 * s), 0xe0d6be);
        add(rib, x, z, { rotY });
      }
      add(colored(jitter(new THREE.IcosahedronGeometry(0.55 * s, 0), 0.1, rng).translate(0, 0.45 * s, 2.5 * s), 0xece3cc), x, z, { rotY });
    },
    cave({ x, z, rotY, color, glow }) { // a mound of ice-crusted rock around a dark mouth
      for (let i = 0; i < 9; i++) { // around the back and sides; the front (+z, toward the camera) stays open
        const a = (i / 8 - 0.5) * Math.PI * 1.3, r = 3.2 + rng() * 0.6, s = 1.6 + rng() * 1.1;
        const rock = colored(jitter(new THREE.DodecahedronGeometry(s, 0), 0.4, rng).scale(1, 1.2, 1), i % 2 ? color : 0x8a96a6);
        rock.translate(Math.sin(a) * r * 0.85, s * 0.7, -Math.cos(a) * r * 0.6 - 1.2);
        add(rock, x, z, { rotY });
      }
      add(colored(jitter(new THREE.DodecahedronGeometry(2.6, 0), 0.4, rng).scale(1.4, 0.8, 1).translate(0, 3.6, -1.6), color), x, z, { rotY });
      add(colored(new THREE.BoxGeometry(2.6, 3.0, 0.3).translate(0, 1.5, -0.6), 0x05080c), x, z, { rotY }); // the dark beyond
      for (let k = 0; k < 6; k++) add(colored(new THREE.ConeGeometry(0.12, 0.7, 4).rotateX(Math.PI).translate(-1.1 + k * 0.44, 2.95, 0.1), 0xd8f0ff), x, z, { rotY });
      out.lights.push({ pos: new THREE.Vector3(x + Math.sin(rotY) * 1.4, om.heightAt(x, z) + 1.6, z + Math.cos(rotY) * 1.4), color: glow, power: 8, dist: 10 });
      out.doorGlow.push({ pos: new THREE.Vector3(x, om.heightAt(x, z) + 1.4, z), color: glow });
    },
    obsidian({ x, z, s, rotY }) {
      for (let k = 0; k < 3; k++) {
        const h = (1.6 + rng() * 2.2) * s;
        const sh = colored(new THREE.ConeGeometry(0.4 * s, h, 4).translate(0, h / 2, 0), k ? 0x1e1a22 : 0x2a2230);
        sh.rotateZ((rng() - 0.5) * 0.4);
        add(sh, x + (rng() - 0.5) * s, z + (rng() - 0.5) * s, { rotY: rotY + k });
      }
    },
    ruin({ x, z, rotY }) {
      add(colored(jitter(new THREE.BoxGeometry(3.6, 1.6 + rng() * 1.6, 0.7, 3, 2, 1), 0.2, rng).translate(0, 1.0, 0), 0x4a4240), x, z, { rotY });
      const col = colored(new THREE.CylinderGeometry(0.4, 0.45, 3.2, 7), 0x5a504c);
      col.rotateZ(Math.PI / 2 - 0.1);
      col.translate(0.5, 0.4, 1.6);
      add(col, x, z, { rotY });
    },
    forge({ x, z, rotY }) { // a squat stone forge with a glowing mouth and a chimney
      add(colored(new THREE.BoxGeometry(7.0, 4.2, 5.0).translate(0, 2.1, -2.6), 0x3a3230), x, z, { rotY });
      add(colored(new THREE.BoxGeometry(7.6, 0.5, 5.6).translate(0, 4.35, -2.6), 0x2a2422), x, z, { rotY });
      add(colored(new THREE.CylinderGeometry(0.7, 0.9, 4.2, 7).translate(2.2, 6.4, -3.6), 0x2e2826), x, z, { rotY });
      for (const s of [-1, 1]) add(colored(new THREE.BoxGeometry(0.8, 3.6, 0.8).translate(s * 1.9, 1.8, -0.1), 0x4a403c), x, z, { rotY });
      add(colored(new THREE.BoxGeometry(4.6, 0.7, 0.9).translate(0, 3.6, -0.1), 0x4a403c), x, z, { rotY });
      add(colored(new THREE.BoxGeometry(1.0, 0.7, 0.6).translate(-3.4, 0.35, 1.2), 0x26262a), x, z, { rotY }); // an anvil out front
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.2), glowMat(0xff5a10, 1.6));
      mouth.position.set(x + Math.sin(rotY) * -0.12, om.heightAt(x, z) + 1.6, z + Math.cos(rotY) * -0.12);
      mouth.rotation.y = rotY;
      group.add(mouth);
      const gp = new THREE.Vector3(x + Math.sin(rotY) * 1.5, om.heightAt(x, z) + 1.6, z + Math.cos(rotY) * 1.5);
      out.lights.push({ pos: gp, color: 0xff6a1a, power: 12, dist: 12, flicker: 3 });
      out.fires.push({ pos: new THREE.Vector3(x + Math.sin(rotY) * 2.2 - Math.cos(rotY) * 2.2, om.heightAt(x, z) + 10.2, z + Math.cos(rotY) * 2.2), scale: 0.8, color: 0x3a3430, smoke: true });
    },
    canyongate({ x, z, rotY, glow }) { // two pillars of red rock and a lintel; between them a glow, the way through
      for (const s of [-1, 1]) {
        add(colored(jitter(new THREE.CylinderGeometry(0.7, 0.95, 5.6, 6, 3), 0.12, rng).translate(s * 1.9, 2.8, 0), 0x6a3a2a), x, z, { rotY });
        add(colored(jitter(new THREE.DodecahedronGeometry(1.0, 0), 0.3, rng).translate(s * 1.9, 0.5, 0), 0x5a3022), x, z, { rotY });
      }
      add(colored(jitter(new THREE.BoxGeometry(5.6, 1.0, 1.4, 3, 1, 1), 0.15, rng).translate(0, 5.9, 0), 0x6a3a2a), x, z, { rotY });
      for (const s of [-1, 1]) add(colored(new THREE.ConeGeometry(0.35, 1.3, 5).translate(s * 2.3, 7.0, 0), 0xe8dcc8), x, z, { rotY }); // (horns)
      const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 4.8), glowMat(glow, 1.4));
      glowPlane.material.transparent = true;
      glowPlane.material.opacity = 0.75;
      glowPlane.material.blending = THREE.AdditiveBlending;
      glowPlane.material.depthWrite = false;
      glowPlane.material.side = THREE.DoubleSide;
      glowPlane.position.set(x, om.heightAt(x, z) + 2.6, z);
      glowPlane.rotation.y = rotY;
      group.add(glowPlane);
      out.lights.push({ pos: new THREE.Vector3(x + Math.sin(rotY) * 1.4, om.heightAt(x, z) + 2.2, z + Math.cos(rotY) * 1.4), color: glow, power: 10, dist: 12 });
      out.doorGlow.push({ pos: new THREE.Vector3(x, om.heightAt(x, z) + 2.0, z), color: glow });
    },
    obelisk({ x, z, color, glow }) {
      add(colored(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 6).translate(0, 0.2, 0), color), x, z);
      add(colored(jitter(new THREE.CylinderGeometry(0.45, 0.9, 7.5, 4, 3), 0.1, rng).rotateY(Math.PI / 4).translate(0, 4.1, 0), color), x, z);
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), glowMat(glow, 2.6));
      orb.position.set(x, om.heightAt(x, z) + 8.6, z);
      group.add(orb);
      out.spinners.push(orb);
      out.lights.push({ pos: orb.position.clone(), color: glow, power: 10, dist: 16 });
    },
    vault({ x, z, rotY }) { // a black stone archway sunk into a mound, violet light below
      for (let i = 0; i < 7; i++) { // around the back and sides
        const a = (i / 6 - 0.5) * Math.PI * 1.3, s = 1.7 + rng();
        const rock = colored(jitter(new THREE.DodecahedronGeometry(s, 0), 0.35, rng).scale(1, 0.9, 1), 0x2a2632);
        rock.translate(Math.sin(a) * 3.4 * 0.9, s * 0.45, -Math.cos(a) * 3.0 - 1.4);
        add(rock, x, z, { rotY });
      }
      for (const s of [-1, 1]) add(colored(new THREE.BoxGeometry(0.7, 4.0, 0.7).translate(s * 1.7, 2.0, 0), 0x3e3848), x, z, { rotY });
      add(colored(new THREE.BoxGeometry(4.4, 0.8, 0.9).translate(0, 4.3, 0), 0x3e3848), x, z, { rotY });
      add(colored(new THREE.ConeGeometry(0.5, 0.9, 4).translate(0, 5.1, 0), 0x3e3848), x, z, { rotY });
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.8), glowMat(0x5a1aa8, 0.9));
      dark.position.set(x - Math.sin(rotY) * 0.2, om.heightAt(x, z) + 1.9, z - Math.cos(rotY) * 0.2);
      dark.rotation.y = rotY;
      group.add(dark);
      out.lights.push({ pos: new THREE.Vector3(x + Math.sin(rotY) * 1.5, om.heightAt(x, z) + 1.8, z + Math.cos(rotY) * 1.5), color: 0xa05aff, power: 9, dist: 11 });
      out.doorGlow.push({ pos: new THREE.Vector3(x, om.heightAt(x, z) + 1.6, z), color: 0xb07aff });
    },
  };
  for (const p of om.plan.props) build[p.kind]?.(p);
  if (parts.length) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), envMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function buildMinimap(om, B) {
  const S = 360, R = om.R + 6;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S), col = new THREE.Color();
  const POOL = { lava: C(0xff6a1a), tar: C(0x141020), ice: C(0xbfe2f5) };
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = om.cx + (px / S) * 2 * R - R, z = om.cz + (py / S) * 2 * R - R;
      const h = om.heightAt(x, z);
      groundColor(om, B, col, x, z, h, 0);
      for (const p of om.pools) if (Math.hypot(x - p.x, z - p.z) < p.r) col.copy(POOL[p.kind]);
      let shade = clamp(0.85 + (h - 1.2) * 0.06, 0.6, 1.2);
      if (om.corridor && om.gorge(x, z).out > 0) shade *= 0.45; // (the mountains around a gorge: dark)
      const o = (py * S + px) * 4;
      col.convertLinearToSRGB();
      img.data[o] = clamp(col.r * 255 * shade, 0, 255);
      img.data[o + 1] = clamp(col.g * 255 * shade, 0, 255);
      img.data[o + 2] = clamp(col.b * 255 * shade, 0, 255);
      img.data[o + 3] = Math.hypot(x - om.cx, z - om.cz) > om.R + 3 ? 90 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const [x, z, color] of om.plan.mapDots) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(((x - om.cx + R) / (2 * R)) * S, ((z - om.cz + R) / (2 * R)) * S, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas: c, range: R, cx: om.cx, cz: om.cz };
}

// ---------------------------------------------------------------- a land, drawn and alive
export class LandView {
  constructor(game, map) {
    this.game = game;
    this.map = map;
    this.om = map.outdoor;
    this.look = map.look;
    this.group = new THREE.Group();
    this.group.visible = false;
    game.scene.add(this.group);
    this.fires = []; // { pos, scale, color }: flames (particles)
    this.lights = []; // light sources the point lights go to (see Places)
    this.waystones = [];
    this.spinners = [];
    this.doorGlow = [];
    this.spots = []; // (nothing to open out here: the ways out are portals, see places.js)
    this.built = false;
  }

  load() {
    if (this.built) return Promise.resolve();
    this.built = true;
    const om = this.om, B = BIOMES[this.map.id], rng = mulberry32(om.def.seed * 7 + 1);
    this.group.add(buildTerrain(om, B, rng));
    buildPools(om, this.group, this.lights, B.lavaHeat);
    const mat = envMaterial();
    for (const [kind, items] of Object.entries(om.plan.trees)) {
      if (items.length) scatterInstanced(this.group, TREES[kind](rng), kind === 'glowcap' ? glowcapMaterial() : mat, items);
    }
    const [ra, rb] = B.rocks;
    const rocks = [makeRock(rng, ra), makeRock(rng, rb)];
    for (const k of [0, 1]) {
      const items = om.plan.rocks.filter((r) => (k ? r.b : !r.b));
      if (items.length) scatterInstanced(this.group, rocks[k], mat, items);
    }
    buildProps(om, this.group, rng, this);
    this.minimap = buildMinimap(om, B);
    return Promise.resolve();
  }

  show(on) {
    this.group.visible = on;
  }

  update(dt) {
    const g = this.game, p = g.player.pos, t = g.time;
    for (const w of this.waystones) {
      w.crystal.rotation.y += dt * 0.9;
      w.crystal.position.y = 3.8 + Math.sin(t * 1.6) * 0.15;
    }
    for (const s of this.spinners) s.rotation.y += dt * 0.6;
    for (const d of this.doorGlow) {
      if (Math.random() < dt * 6 && d.pos.distanceTo(p) < 30) {
        g.fx.add.emit({ pos: d.pos, count: 1, spread: 0.9, velSpread: 0.3, vel: { x: 0, y: 0.6, z: 0 }, color: hdr(d.color, 2), size: 0.16, sizeEnd: 0.02, life: 1.6, drag: 0.8 });
      }
    }
    this.weather(dt, p);
  }

  // Snow drifting down in Frostfang, embers rising in Cinderfall, motes floating in Shadowmere.
  weather(dt, p) {
    const fx = this.game.fx, L = this.look;
    this.wAcc = (this.wAcc || 0) + dt * (L.snow ? 40 : L.embers ? 14 : L.motes ? 10 : 0);
    while (this.wAcc >= 1) {
      this.wAcc -= 1;
      const x = p.x + rand(-22, 22), z = p.z + rand(-26, 14);
      if (L.snow) fx.soft.emit({ pos: { x, y: p.y + rand(6, 14), z }, count: 1, spread: 0, velSpread: 0.25, vel: { x: 0.7, y: -1.6, z: 0.2 }, color: new THREE.Color(0xffffff), alpha: 0.85, size: 0.13, sizeEnd: 0.13, life: 7, drag: 0 });
      else if (L.embers) fx.add.emit({ pos: { x, y: this.om.heightAt(x, z) + rand(0.2, 3), z }, count: 1, spread: 0, velSpread: 0.3, vel: { x: 0.3, y: 0.9, z: 0 }, color: hdr(0xff8a3a, 2.4), colorEnd: hdr(0xff3a10, 0.2), size: 0.1, sizeEnd: 0.02, life: 3.5, drag: 0.3 });
      else if (L.motes) fx.add.emit({ pos: { x, y: this.om.heightAt(x, z) + rand(0.5, 3.5), z }, count: 1, spread: 0, velSpread: 0.25, vel: { x: 0, y: 0.15, z: 0 }, color: hdr(Math.random() < 0.6 ? 0xb07aff : 0x6aff9a, 1.8), size: 0.12, sizeEnd: 0.04, life: 4.5, drag: 0.4 });
    }
  }
}

function glowcapMaterial() {
  const m = envMaterial();
  m.emissive = new THREE.Color(0x5a2aa8);
  m.emissiveIntensity = 0.55;
  return m;
}

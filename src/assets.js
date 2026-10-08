// Loads the KayKit models/animations and renders inventory icons from the same 3D models.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ITEMS, itemDef } from './items.js';
import { buildGearModel, GEAR_ICON_ROT, PROC_WEAPONS } from './gear.js';
import { CLASSES } from './classes.js';

export const Assets = { chars: {}, clips: {}, items: {}, icons: {} };

const CHARACTERS = [
  'Knight', 'Barbarian', 'Mage', 'Rogue', // KayKit Adventurers: the playable classes
  'Rogue_Hooded', 'Ranger', // bandits, and Wren the merchant
  'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage', // KayKit Skeletons
];
const ANIMATIONS = ['Rig_Medium_General', 'Rig_Medium_MovementBasic'];
export const ITEM_MODELS = [
  'sword_1handed', 'sword_2handed', 'sword_2handed_color', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand',
  'shield_round', 'shield_round_color', 'shield_square', 'shield_square_color', 'shield_spikes', 'shield_spikes_color',
  'shield_badge', 'shield_badge_color', 'spellbook_open', 'spellbook_closed', 'mug_full',
  'Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A',
  'Skeleton_Shield_Small_B', 'Skeleton_Shield_Large_B', 'shield_round_barbarian', 'bow_withString',
];

// The game's files sit next to its code: on the live site that's jsDelivr's CDN (index.html loads the code
// from there, because the host is slow to serve files), elsewhere the site itself, which is also the
// fallback if the CDN fails.
export const BASE = new URL('../', import.meta.url).href;
const SITE = new URL('./', document.baseURI).href;

// Downloads are patient with slow connections but not with stuck ones: a download that gets no data
// for STALL ms is dropped and asked for again, up to TRIES times, and then once from the site if the
// CDN was failing. (Phones drop requests; one stuck request used to leave the game on "Loading models".)
// path: relative to the game's root, e.g. 'assets/items/items.glb'.
const STALL = 20000, TRIES = 3;

export async function download(path, onProgress = () => {}) {
  try {
    return await downloadFrom(BASE + path, onProgress);
  } catch (err) {
    if (BASE === SITE) throw err;
    console.warn(`${path}: the CDN failed, trying the site`, err);
    return downloadFrom(SITE + path, onProgress);
  }
}

async function downloadFrom(url, onProgress) {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), STALL);
    try {
      // a retry gets its own address, so it doesn't queue behind the stuck one
      const res = await fetch(attempt === 1 ? url : `${url}${url.includes('?') ? '&' : '?'}try=${attempt}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(timer);
        timer = setTimeout(() => ctrl.abort(), STALL);
        parts.push(value);
        got += value.length;
        if (total) onProgress(Math.min(1, got / total));
      }
      clearTimeout(timer);
      const buf = new Uint8Array(got);
      let at = 0;
      for (const part of parts) { buf.set(part, at); at += part.length; }
      return buf.buffer;
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= TRIES) throw new Error(`Could not download ${url} (${err.name === 'AbortError' ? 'it stalled' : err.message})`);
    }
  }
}

// The mage's hat (the Scientist's looks, and the Healer's Cleric) was nearly as wide as the hero and hid its
// weapon and clothes: its brim comes in toward the head and its bent tip comes down and in, while the part
// around the head stays as it was (so the head doesn't show through). Done once, to the model every hero of
// that look is cloned from (its vertices are where the hat sits on the head, in the head bone's space).
function trimMageHat(root) {
  const hat = root.getObjectByName('Mage_Hat'), g = hat?.geometry, pos = g?.attributes.position;
  if (!pos) return;
  const HEAD_R = 0.66, BRIM = 0.3, TIP_UP = 0.6, TIP_IN = 0.25;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
  const top = 2.16, tall = Math.max(0.01, max.y - top); // (the top of the head; what's above is the tip)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - cx, z = pos.getZ(i) - cz, r = Math.hypot(x, z);
    let y = pos.getY(i), k = r > HEAD_R ? (HEAD_R + (r - HEAD_R) * BRIM) / r : 1;
    if (y > top) {
      k *= 1 - TIP_IN * Math.min(1, (y - top) / tall);
      y = top + (y - top) * TIP_UP;
    }
    pos.setXYZ(i, cx + x * k, y, cz + z * k);
  }
  pos.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

// The characters, their animations, and every item model (packed into one file: tools/pack-items.mjs).
export async function loadAssets(onProgress) {
  const files = [
    ...CHARACTERS.map((c) => [`assets/characters/${c}.glb`, (g) => { if (c === 'Mage') trimMageHat(g.scene); Assets.chars[c] = g; }]),
    ...ANIMATIONS.map((a) => [`assets/animations/${a}.glb`, (g) => { for (const clip of g.animations) Assets.clips[clip.name] = clip; }]),
    ['assets/items/items.glb?v=3', (g) => { // (?v=: a new pack is a new address on the site too, so no stale copy is used)
      for (const root of [...g.scene.children]) {
        root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        Assets.items[root.userData.model] = root;
      }
    }],
  ];
  const done = files.map(() => 0);
  const report = () => onProgress(done.reduce((a, b) => a + b, 0) / files.length);
  const loader = new GLTFLoader();
  await Promise.all(files.map(async ([url, use], i) => {
    const buf = await download(url, (f) => { done[i] = f * 0.9; report(); });
    use(await loader.parseAsync(buf, ''));
    done[i] = 1;
    report();
  }));
  for (const [name, build] of Object.entries(PROC_WEAPONS)) Assets.items[name] = build(); // (the weapons drawn in code)
}

// ---------------------------------------------------------------- palettes
// Other colours for a character, painted over its texture: the KayKit textures are grids of colour swatches
// (128 x 256 px, each a top-to-bottom gradient), so a palette repaints chosen swatches: [x, y, w, h, top, bottom].
const PALETTES = {
  cleric: [ // a white robe with gold, for healers
    [0, 256, 256, 256, '#ffffff', '#c4ccd8'], [896, 256, 128, 256, '#f2e2b0', '#a8884a'], [256, 256, 128, 256, '#ffe08a', '#b8862a'], [128, 512, 128, 256, '#ffe08a', '#b8862a'],
  ],
  alchemist: [ // a green coat with copper
    [0, 256, 256, 256, '#7ab06a', '#244a22'], [896, 256, 128, 256, '#4a6a3a', '#162616'], [256, 256, 128, 256, '#e09a4a', '#7a3a10'], [128, 512, 128, 256, '#e09a4a', '#7a3a10'],
  ],
  paladin: [ // a knight in white and gold
    [0, 256, 128, 256, '#ffe9a0', '#b8862a'], [256, 512, 128, 256, '#ffe9a0', '#b8862a'],
  ],
};
const paletteCache = new Map();
function paletteTexture(base, name) {
  const key = `${base.uuid}:${name}`;
  if (paletteCache.has(key)) return paletteCache.get(key);
  const img = base.image, c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const sx = img.width / 1024, sy = img.height / 1024;
  for (const [x, y, w, h, top, bottom] of PALETTES[name] || []) {
    const grad = ctx.createLinearGradient(0, y * sy, 0, (y + h) * sy);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(x * sx, y * sy, w * sx, h * sy);
  }
  const tex = new THREE.CanvasTexture(c);
  for (const k of ['flipY', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'colorSpace', 'channel']) tex[k] = base[k];
  tex.needsUpdate = true;
  paletteCache.set(key, tex);
  return tex;
}

// palette: repaint it (see PALETTES)
export function cloneCharacter(name, palette = null) {
  const root = SkeletonUtils.clone(Assets.chars[name].scene);
  const bones = {}, meshes = {}, mats = new Map();
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      meshes[o.name] = o;
      if (!mats.has(o.material)) {
        const m = o.material.clone();
        if (palette && m.map) m.map = paletteTexture(o.material.map, palette);
        mats.set(o.material, m);
      }
      o.material = mats.get(o.material);
    }
  });
  return { root, bones, meshes, materials: [...mats.values()] };
}

// An item's model; glow: an emissive colour (unique and well upgraded items); tint: its colour multiplied.
export function cloneItem(name, glow = null, tint = null) {
  if (!Assets.items[name]) { console.warn(`item model ${name} is missing`); return new THREE.Group(); }
  const obj = Assets.items[name].clone(true);
  if (glow || tint) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (tint) o.material.color.multiply(new THREE.Color(tint));
      if (glow) { o.material.emissive = new THREE.Color(glow); o.material.emissiveIntensity = 0.55; }
    });
  }
  return obj;
}

// What an item looks like as a small model (icons, and loot on the ground): weapons, shields and books are
// the pack's (or the ones drawn in code); clothes and accessories come from gear.js.
const ARMOR_STYLE = { warrior: 'plate', healer: 'coif', rogue: 'hood', scientist: 'cap' };
// it: an item, its definition, or its key
export function itemModel(it, { glow = true } = {}) {
  const d = typeof it === 'string' ? ITEMS[it] : it?.key ? it : itemDef(it);
  if (!d) return new THREE.Group();
  if (d.model) return cloneItem(d.model, glow && d.unique ? d.glow ?? 0xff6a10 : null, d.tint ?? null);
  return buildGearModel(gearSpec(d));
}
export function gearSpec(d) {
  if (d.gear) return { ...d.gear, kind: d.gear.kind };
  const cls = d.classes?.[0];
  return { kind: d.slot, color: d.look?.body ?? 0x8a6a4a, metal: d.look?.metal ?? 0.1, rough: 0.6, style: ARMOR_STYLE[cls] || 'plate', plate: cls === 'warrior' || cls === 'healer' };
}

// ---------------------------------------------------------------- icons
let iconRenderer = null;
function getIconRenderer() {
  if (iconRenderer) return iconRenderer;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(128, 128);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  iconRenderer = { renderer, scene, camera };
  return iconRenderer;
}

function snapshot(object, { rot = [0, 0, 0], boxFrom = null, pad = 1.12, dir = new THREE.Vector3(0, 0, 1) } = {}) {
  const { renderer, scene, camera } = getIconRenderer();
  const pivot = new THREE.Group();
  object.rotation.set(rot[0], rot[1], rot[2]);
  pivot.add(object);
  scene.add(pivot);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3();
  if (boxFrom) for (const m of boxFrom) box.expandByObject(m, true);
  else box.setFromObject(object, true);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 * pad;
  const dist = radius / Math.tan(THREE.MathUtils.degToRad(15));
  camera.position.copy(center).addScaledVector(dir.normalize(), dist);
  camera.lookAt(center);
  camera.near = dist * 0.1;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(pivot);
  return url;
}

// Icons are drawn the first time they're needed (there are a lot of items) and kept.
export function iconFor(it) {
  const d = typeof it === 'string' ? ITEMS[it] : it?.key ? it : itemDef(it);
  if (!d) return '';
  const key = `item_${d.key}`;
  if (Assets.icons[key]) return Assets.icons[key];
  let url;
  if (d.icon) url = svgIcon(d.icon);
  else if (d.model) {
    const isShield = /shield|spellbook/i.test(d.model), isBow = d.model.startsWith('bow');
    const rot = isShield ? [0.15, -0.5, 0] : isBow ? [0, Math.PI / 2, -Math.PI / 4] : [0, 0.5, -Math.PI / 4];
    url = snapshot(itemModel(d), { rot });
  } else {
    const spec = gearSpec(d);
    url = snapshot(buildGearModel(spec), { rot: GEAR_ICON_ROT[spec.kind] || [0.2, 0.4, 0] });
  }
  Assets.icons[key] = url;
  return url;
}

// Potions, elixirs, scrolls and recipes: small drawings.
const SVG_ICONS = {
  potion: (c1, c2, size) => `<path d="M26 6h12v8l${size} ${12 + size}a12 12 0 0 1-11 18H25a12 12 0 0 1-11-18l${size} -${12 + size}z" fill="#2a2018" stroke="#c8b898" stroke-width="2.5" stroke-linejoin="round"/><path d="M18 34h28l2 4a9 9 0 0 1-8 12H24a9 9 0 0 1-8-12z" fill="${c1}"/><path d="M22 38h6" stroke="${c2}" stroke-width="3" stroke-linecap="round"/><rect x="24" y="2" width="16" height="6" rx="2" fill="#8a6a3a"/>`,
  elixir: (c1) => `<path d="M28 4h8v12l10 16v22a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V32l10-16z" fill="#2a2018" stroke="#c8b898" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 34h24v20a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4z" fill="${c1}"/><circle cx="27" cy="44" r="3" fill="#fff" opacity=".6"/>`,
  key: (c1) => `<circle cx="20" cy="22" r="11" fill="none" stroke="#e8c060" stroke-width="6"/><circle cx="20" cy="22" r="11" fill="none" stroke="#8a6a2a" stroke-width="1.5" opacity=".6"/><circle cx="20" cy="22" r="4.5" fill="${c1}" stroke="#fff" stroke-width="1"/><path d="M28 30l22 22" stroke="#e8c060" stroke-width="6" stroke-linecap="round"/><path d="M44 46l6-6M38 40l5-5" stroke="#e8c060" stroke-width="5" stroke-linecap="round"/><path d="M30 32l19 19" stroke="#fff6d0" stroke-width="1.5" opacity=".6"/>`,
  scroll: (c1) => `<rect x="14" y="12" width="36" height="40" rx="3" fill="#f1e1bf" stroke="#8a6a3a" stroke-width="2.5"/><rect x="10" y="8" width="44" height="8" rx="4" fill="#c8a070" stroke="#6a4a2a" stroke-width="2"/><rect x="10" y="48" width="44" height="8" rx="4" fill="#c8a070" stroke="#6a4a2a" stroke-width="2"/><path d="M20 24h24M20 30h24M20 36h16" stroke="#8a6a3a" stroke-width="2"/><circle cx="42" cy="40" r="5" fill="${c1}"/>`,
};
const ICON_SPECS = {
  potion_red: ['potion', '#e8322a', '#ff9a8a', 2], potion_red2: ['potion', '#d81a2a', '#ff7a8a', 4], potion_red3: ['potion', '#b8102a', '#ff6a7a', 6],
  potion_blue: ['potion', '#3a78e0', '#9ac0ff', 2], potion_blue2: ['potion', '#2a5ae0', '#8ab0ff', 4], potion_blue3: ['potion', '#1a3ac0', '#7aa0ff', 6],
  elixir_red: ['elixir', '#ff6a2a'], elixir_grey: ['elixir', '#a8b4c4'], elixir_green: ['elixir', '#4ad46a'],
  scroll: ['scroll', '#5ad0ff'], recipe_low: ['scroll', '#e8e4da'], recipe_mid: ['scroll', '#6aa9ff'], recipe_high: ['scroll', '#ffd84a'],
  key_emberwood: ['key', '#7dff9a'], key_frostfang: ['key', '#7fd8ff'], key_cinderfall: ['key', '#ff7a2a'], key_shadowmere: ['key', '#c07aff'],
};
function svgIcon(name) {
  const [kind, ...args] = ICON_SPECS[name] || ['scroll', '#888'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${SVG_ICONS[kind](...args)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// At startup: each class look's portrait (the hero list on the title screen and the HUD), and the mug.
export function buildIcons() {
  Assets.icons.mug_full = snapshot(cloneItem('mug_full'), { rot: [0.2, -0.6, 0] });
  const part = (visible, dir, model, palette) => {
    const k = cloneCharacter(model, palette);
    const shown = [];
    for (const [n, m] of Object.entries(k.meshes)) {
      m.visible = visible.includes(n);
      if (m.visible) shown.push(m);
    }
    return snapshot(k.root, { boxFrom: shown, dir });
  };
  for (const [id, c] of Object.entries(CLASSES)) {
    c.looks.forEach((L, i) => { Assets.icons[`portrait_${id}_${i}`] = part(L.portrait, new THREE.Vector3(0.35, 0.1, 1), L.model, L.palette || null); });
    Assets.icons[`portrait_${id}`] = Assets.icons[`portrait_${id}_0`];
  }
  Assets.icons.portrait = Assets.icons.portrait_warrior;
}

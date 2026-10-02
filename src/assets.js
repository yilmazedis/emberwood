// Loads the KayKit models/animations and renders inventory icons from the same 3D models.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BASES } from './items.js';
import { buildGearModel, GEAR_ICON_ROT } from './gear.js';
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
  'shield_badge', 'shield_badge_color', 'spellbook_open', 'mug_full',
  'Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A',
  'Skeleton_Shield_Small_B', 'Skeleton_Shield_Large_B', 'shield_round_barbarian', 'bow_withString', // (monsters' gear)
];

// Downloads are patient with slow connections but not with stuck ones: a download that gets no data
// for STALL ms is dropped and asked for again, up to TRIES times. (The host can be slow to answer, and
// phones drop requests; one stuck request used to leave the game on "Loading models" for good.)
const STALL = 20000, TRIES = 3;

async function download(url, onProgress) {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), STALL);
    try {
      // a retry gets its own address, so it doesn't queue behind the stuck one
      const res = await fetch(attempt === 1 ? url : `${url}?try=${attempt}`, { signal: ctrl.signal });
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

// The characters, their animations, and every item model (packed into one file: tools/pack-items.mjs).
export async function loadAssets(onProgress) {
  const files = [
    ...CHARACTERS.map((c) => [`assets/characters/${c}.glb`, (g) => { Assets.chars[c] = g; }]),
    ...ANIMATIONS.map((a) => [`assets/animations/${a}.glb`, (g) => { for (const clip of g.animations) Assets.clips[clip.name] = clip; }]),
    ['assets/items/items.glb?v=2', (g) => { // (?v=: a new pack is a new address, so no stale copy is used)
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
}

export function cloneCharacter(name) {
  const root = SkeletonUtils.clone(Assets.chars[name].scene);
  const bones = {}, meshes = {}, mats = new Map();
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      meshes[o.name] = o;
      if (!mats.has(o.material)) mats.set(o.material, o.material.clone());
      o.material = mats.get(o.material);
    }
  });
  return { root, bones, meshes, materials: [...mats.values()] };
}

export function cloneItem(name, glow = null) {
  if (!Assets.items[name]) { console.warn(`item model ${name} is missing`); return new THREE.Group(); }
  const obj = Assets.items[name].clone(true);
  if (glow) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(glow);
        o.material.emissiveIntensity = 0.55;
      }
    });
  }
  return obj;
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

export function buildIcons() {
  for (const name of ITEM_MODELS) {
    const isShield = /shield|spellbook/i.test(name);
    const isMug = name.startsWith('mug');
    const rot = isShield ? [0.15, -0.5, 0] : isMug ? [0.2, -0.6, 0] : [0, 0.5, -Math.PI / 4];
    Assets.icons[name] = snapshot(cloneItem(name), { rot });
  }
  // Gloves, boots and rings: procedural models (gear.js).
  for (const [key, base] of Object.entries(BASES)) {
    if (base.gear) Assets.icons[`gear_${key}`] = snapshot(buildGearModel(base.gear), { rot: GEAR_ICON_ROT[base.gear.kind] });
  }
  // Helmets and cape are parts of the Knight mesh: render just those parts.
  const part = (visible, dir, rot = [0, 0, 0], model = 'Knight') => {
    const k = cloneCharacter(model);
    const shown = [];
    for (const [n, m] of Object.entries(k.meshes)) {
      m.visible = visible.includes(n);
      if (m.visible) shown.push(m);
    }
    return snapshot(k.root, { boxFrom: shown, dir, rot });
  };
  Assets.icons.helm = part(['Knight_Helmet'], new THREE.Vector3(0.9, 0.3, 1));
  Assets.icons.visor = part(['Knight_Helmet', 'Knight_HelmetVisor'], new THREE.Vector3(0.9, 0.3, 1));
  Assets.icons.cape = part(['Knight_Cape'], new THREE.Vector3(-0.6, 0.2, -1));
  // a portrait of each class (the hero list on the title screen and the HUD)
  for (const [id, c] of Object.entries(CLASSES)) Assets.icons[`portrait_${id}`] = part(c.portrait, new THREE.Vector3(0.35, 0.1, 1), [0, 0, 0], c.model);
  Assets.icons.portrait = Assets.icons.portrait_knight;
}

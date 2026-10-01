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
];

export async function loadAssets(onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const loader = new GLTFLoader(manager);
  const jobs = [];
  for (const c of CHARACTERS) {
    jobs.push(loader.loadAsync(`assets/characters/${c}.glb`).then((g) => { Assets.chars[c] = g; }));
  }
  for (const a of ANIMATIONS) {
    jobs.push(loader.loadAsync(`assets/animations/${a}.glb`).then((g) => {
      for (const clip of g.animations) Assets.clips[clip.name] = clip;
    }));
  }
  for (const i of ITEM_MODELS) {
    jobs.push(loader.loadAsync(`assets/items/${i}.gltf`).then((g) => {
      g.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      Assets.items[i] = g.scene;
    }));
  }
  await Promise.all(jobs);
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

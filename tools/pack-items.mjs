// Packs the item models the game uses (ITEM_MODELS in src/assets.js: weapons, shields, the ale mug…)
// from assets/items/*.gltf into one binary glTF, assets/items/items.glb: one download instead of ~50
// (each model is a .gltf, a .bin and a texture, and the host is slow to answer each request).
// Textures and materials shared between models are stored once. Each model is a root node whose
// extras.model (userData.model in three.js) is its name.
//
//   node tools/pack-items.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/items');
const OUT = join(SRC, 'items.glb');

const code = readFileSync(join(ROOT, 'src/assets.js'), 'utf8');
const list = code.match(/export const ITEM_MODELS = \[([\s\S]*?)\];/);
if (!list) throw new Error('ITEM_MODELS not found in src/assets.js');
const names = [...list[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);

const out = {
  asset: { version: '2.0', generator: 'emberwood tools/pack-items.mjs' },
  scene: 0, scenes: [{ name: 'items', nodes: [] }],
  nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
  materials: [], textures: [], images: [], samplers: [],
};
const chunks = [];
let length = 0;
function append(buf) { // into the one binary buffer, 4-byte aligned
  const pad = (4 - (length % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
  const offset = length;
  chunks.push(buf);
  length += buf.length;
  return offset;
}

const imageIndex = new Map(); // texture file -> image (and texture) index in the pack
const materialIndex = new Map(); // material name + texture -> material index
function texture(g, i) {
  const t = g.textures[i], uri = g.images[t.source].uri;
  if (!imageIndex.has(uri)) {
    const png = readFileSync(join(SRC, uri));
    const view = out.bufferViews.push({ buffer: 0, byteOffset: append(png), byteLength: png.length }) - 1;
    const image = out.images.push({ name: uri.replace(/\.png$/, ''), mimeType: 'image/png', bufferView: view }) - 1;
    const sampler = out.samplers.push(g.samplers?.[t.sampler] || {}) - 1;
    imageIndex.set(uri, out.textures.push({ sampler, source: image }) - 1);
  }
  return imageIndex.get(uri);
}
function material(g, i) {
  const m = g.materials[i], tex = m.pbrMetallicRoughness?.baseColorTexture;
  const key = `${m.name}|${tex ? g.images[g.textures[tex.index].source].uri : ''}`;
  if (!materialIndex.has(key)) {
    const copy = JSON.parse(JSON.stringify(m));
    if (tex) copy.pbrMetallicRoughness.baseColorTexture = { ...tex, index: texture(g, tex.index) };
    materialIndex.set(key, out.materials.push(copy) - 1);
  }
  return materialIndex.get(key);
}

for (const name of names) {
  const g = JSON.parse(readFileSync(join(SRC, `${name}.gltf`), 'utf8'));
  const bin = readFileSync(join(SRC, g.buffers[0].uri));
  const views = g.bufferViews.map((v) => {
    const start = v.byteOffset || 0;
    const view = { buffer: 0, byteOffset: append(bin.subarray(start, start + v.byteLength)), byteLength: v.byteLength };
    if (v.byteStride) view.byteStride = v.byteStride;
    if (v.target) view.target = v.target;
    return out.bufferViews.push(view) - 1;
  });
  const accessors = g.accessors.map((a) => out.accessors.push({ ...a, bufferView: views[a.bufferView] }) - 1);
  const meshes = g.meshes.map((m) => out.meshes.push({
    ...m,
    primitives: m.primitives.map((p) => ({
      ...p,
      attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, accessors[v]])),
      ...(p.indices !== undefined ? { indices: accessors[p.indices] } : {}),
      ...(p.material !== undefined ? { material: material(g, p.material) } : {}),
    })),
  }) - 1);
  // the model's node tree, under one root node named after it
  const base = out.nodes.length;
  for (const n of g.nodes) {
    const copy = { ...n };
    if (n.mesh !== undefined) copy.mesh = meshes[n.mesh];
    if (n.children) copy.children = n.children.map((c) => c + base);
    out.nodes.push(copy);
  }
  const roots = g.scenes[g.scene || 0].nodes.map((i) => i + base);
  const root = out.nodes.push({ name, children: roots, extras: { model: name } }) - 1;
  out.scenes[0].nodes.push(root);
}

const bin = Buffer.concat(chunks);
out.buffers[0].byteLength = bin.length;
if (!out.samplers.length) delete out.samplers;
let json = Buffer.from(JSON.stringify(out));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // glTF
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
writeFileSync(OUT, Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, binPad)]));
console.log(`${names.length} models, ${out.images.length} textures, ${out.materials.length} materials -> ${OUT} (${(bin.length / 1024).toFixed(0)} KB)`);

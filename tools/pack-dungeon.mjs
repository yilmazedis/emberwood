// Packs the KayKit Dungeon pieces the dungeons use (every model named in src/dungeon-map.js and the maps
// in src/maps/) into one binary glTF, assets/dungeon/dungeon.glb, so the game makes a single request
// instead of ~100 (the host is slow to answer each one). The pieces share one material and texture, which
// are stored once.
//
//   node tools/pack-dungeon.mjs "<KayKit_Dungeon_Pack_1.1_FREE>/Assets/gltf"
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
const OUT = join(ROOT, 'assets/dungeon/dungeon.glb');
if (!SRC) {
  console.error('usage: node tools/pack-dungeon.mjs <KayKit Dungeon pack>/Assets/gltf');
  process.exit(1);
}

// every model the dungeons name: put('…'), banner('…'), model: '…' and the quoted wall/floor variants (the
// lands' put('…') props are drawn in code, so names the pack doesn't have are left out)
const code = ['src/dungeon-map.js', ...readdirSync(join(ROOT, 'src/maps')).map((f) => `src/maps/${f}`)]
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
const names = [...new Set([...code.matchAll(/(?:put|banner)\('(\w+)'|model: '(\w+)'|'((?:wall|floor)\w*)'/g)]
  .map((m) => m[1] || m[2] || m[3]))].filter((n) => existsSync(join(SRC, `${n}.gltf`))).sort();
console.log(`${names.length} pieces`);

const out = {
  asset: { version: '2.0', generator: 'emberwood tools/pack-dungeon.mjs' },
  scene: 0, scenes: [{ name: 'crypt', nodes: [] }],
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

for (const name of names) {
  const g = JSON.parse(readFileSync(join(SRC, `${name}.gltf`), 'utf8'));
  if (g.materials.length !== 1 || g.images[0].uri !== 'dungeon_texture.png') console.warn(`${name}: unexpected material setup`);
  const bin = readFileSync(join(SRC, g.buffers[0].uri));
  if (!out.materials.length) { // the shared texture and material, stored once
    const png = readFileSync(join(SRC, g.images[0].uri));
    out.bufferViews.push({ buffer: 0, byteOffset: append(png), byteLength: png.length });
    out.images.push({ name: g.images[0].name, mimeType: 'image/png', bufferView: 0 });
    out.samplers.push(g.samplers[0]);
    out.textures.push({ sampler: 0, source: 0 });
    const m = g.materials[0];
    out.materials.push({ ...m, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, baseColorTexture: { index: 0 } } });
  }
  const views = g.bufferViews.map((v) => {
    const start = v.byteOffset || 0;
    const view = { buffer: 0, byteOffset: append(bin.subarray(start, start + v.byteLength)), byteLength: v.byteLength };
    if (v.byteStride) view.byteStride = v.byteStride;
    if (v.target) view.target = v.target;
    return out.bufferViews.push(view) - 1;
  });
  const accessors = g.accessors.map((a) => out.accessors.push({ ...a, bufferView: views[a.bufferView] }) - 1);
  const meshes = g.meshes.map((m) => out.meshes.push({
    name: m.name,
    primitives: m.primitives.map((p) => {
      const prim = { attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, accessors[v]])), material: 0 };
      if (p.indices !== undefined) prim.indices = accessors[p.indices];
      if (p.mode !== undefined) prim.mode = p.mode;
      return prim;
    }),
  }) - 1);
  const base = out.nodes.length;
  for (const n of g.nodes) {
    const node = { ...n };
    if (n.mesh !== undefined) node.mesh = meshes[n.mesh];
    if (n.children) node.children = n.children.map((c) => c + base);
    out.nodes.push(node);
  }
  // one root per model; the game finds it by extras.model (the loader de-duplicates node names)
  const roots = g.scenes[g.scene ?? 0].nodes.map((i) => i + base);
  out.scenes[0].nodes.push(out.nodes.push({ name: `kit_${name}`, extras: { model: name }, children: roots }) - 1);
}

const bin = Buffer.concat([...chunks, Buffer.alloc((4 - (length % 4)) % 4)]);
out.buffers[0].byteLength = bin.length;
let json = Buffer.from(JSON.stringify(out));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const jsonHead = Buffer.alloc(8);
jsonHead.writeUInt32LE(json.length, 0);
jsonHead.writeUInt32LE(0x4e4f534a, 4); // "JSON"
const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(bin.length, 0);
binHead.writeUInt32LE(0x004e4942, 4); // "BIN"
writeFileSync(OUT, Buffer.concat([header, jsonHead, json, binHead, bin]));
console.log(`${names.length} models -> ${OUT} (${(12 + 16 + json.length + bin.length) / 1024 | 0} KB)`);

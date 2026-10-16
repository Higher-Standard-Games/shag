import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { validateEmbeddedGlb } from './package-player-model.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/import-arc-blade.mjs <source.glb>');
const bytes = await fs.readFile(path.resolve(input));
validateEmbeddedGlb(bytes, 'arc_blade.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const old = await io.read(path.join(root, 'assets-source/weapons/exports/blade/blade.glb'));
const incoming = await io.readBinary(bytes);
const target = getBounds(old.getRoot().getDefaultScene());
const source = getBounds(incoming.getRoot().getDefaultScene());
// The source sword runs along +Z; the established blade export runs along +X.
const scale = (target.max[0] - target.min[0]) / (source.max[2] - source.min[2]);
if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid blade bounds');
const center = (bounds, axis) => (bounds.min[axis] + bounds.max[axis]) / 2;
// Roll the broad face so the cutting edge faces outward in the carry pose.
const matrix = [0,-scale,0,0, 0,0,-scale,0, scale,0,0,0,
  target.min[0] - source.min[2] * scale,
  center(target,1) + center(source,0) * scale,
  center(target,2) + center(source,1) * scale,1];

// Add an export-space parent without re-encoding meshes, images or material extensions.
const jsonSize = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString('utf8'));
const scene = document.scenes[document.scene ?? 0];
const wrapper = document.nodes.length;
document.nodes.push({name:'ArcBlade_Export',matrix,children:scene.nodes});
scene.nodes = [wrapper];
document.asset.extras = {...document.asset.extras, runtimeName:'Arc Blade'};
const encoded = Buffer.from(JSON.stringify(document));
const json = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
encoded.copy(json);
const tail = bytes.subarray(20 + jsonSize);
const output = Buffer.alloc(20 + json.length + tail.length);
bytes.copy(output,0,0,12);
output.writeUInt32LE(output.length,8);
output.writeUInt32LE(json.length,12);
output.writeUInt32LE(0x4e4f534a,16);
json.copy(output,20);tail.copy(output,20+json.length);
validateEmbeddedGlb(output,'arc_blade.glb');
const sourceDir = path.join(root,'assets-source/weapons/arc-blade');
const destination = path.join(root,'assets-source/weapons/exports/blade/arc_blade.glb');
await fs.mkdir(sourceDir,{recursive:true});
await fs.writeFile(path.join(sourceDir,'arc_blade.glb'),bytes);
await fs.writeFile(destination,output);
const normalized = await io.readBinary(output);
const bounds = getBounds(normalized.getRoot().getDefaultScene());
console.log(JSON.stringify({destination,scale,previousBounds:target,sourceBounds:source,exportBounds:bounds,credit:document.asset.extras},null,2));

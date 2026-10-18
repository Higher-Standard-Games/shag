import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { shaderSourceBlocks } from '../src/engine/loader/shader/ShaderSourceBlocks.ts';

const args = process.argv.slice(2);
const bankPath = path.resolve(args.includes('--package') ? args[args.indexOf('--package') + 1] : 'public/data/washoi_textures.pk3');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const date = new Date('1980-01-01T00:00:00Z');
const textureName = 'textures/baxandall/teleglow_01.tga';
const shaderFile = 'scripts/washoi_maps.shader';
const target = 'textures/wsw_cave1/ball_glowb_portal';
const original = await fs.readFile(bankPath);
const bank = await JSZip.loadAsync(original, { checkCRC32: true });
const replacementText = await fs.readFile('assets/teleporter/dm2_portal.shader', 'utf8');
const definitions = shaderSourceBlocks(replacementText);
const source = await bank.file(shaderFile).async('string');
let updated = source;
for (const definition of definitions) {
  const previous = shaderSourceBlocks(updated).find(block => block.name === definition.name);
  if (definition.name === target && !previous) throw new Error(`Missing DM2 portal shader: ${target}`);
  updated = previous ? updated.replace(previous.source, definition.source) : `${updated}\n${definition.source}\n`;
}
const texture = await fs.readFile('assets/teleporter/teleglow_01.tga');
if (hash(texture) !== '35db5592db5eeb988c954ed4c5902fcc4490475514444465cc0369bffb3885b6') throw new Error('Archived glow texture hash mismatch');
const replacements = new Map([[shaderFile, Buffer.from(updated)], [textureName, texture]]);
for (const entry of Object.values(bank.files)) {
  if (entry.dir || !/^media-manifests\/.*\.json$/.test(entry.name)) continue;
  const manifest = JSON.parse(await entry.async('string'));
  const shader = manifest.shaders?.find(item => item.name === target);
  if (!shader) continue;
  shader.sha256 = hash(Buffer.from(definitions.find(item => item.name === target).source));
  const asset = { name: textureName, owner: 'washoi_textures.pk3', bytes: texture.length, sha256: hash(texture), reasons: [`shader ${target}`] };
  const index = manifest.assets.findIndex(item => item.name === textureName);
  if (index >= 0) manifest.assets[index] = asset;
  else manifest.assets.push(asset);
  replacements.set(entry.name, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}
const provenance = {
  version: 1, target, effect: 'textures/baxandall/teleglow_02',
  texture: { path: textureName, archive: 'archive/data0_21.pk3', sha256: hash(texture) },
  shader: { archive: 'archive/data0_21pure.pk3', path: 'scripts/baxandall.shader' },
  adaptations: ['DM2 material alias', 'Explicit TGA source path', 'Double-sided rendering'],
};
replacements.set('media-manifests/washoi_teleporter.json', Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`));
await fs.mkdir('archive/media/teleporter', { recursive: true });
try { await fs.writeFile('archive/media/teleporter/washoi_maps.before-portal.shader', source, { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
for (const [name, bytes] of replacements) bank.file(name, bytes, { date, createFolders: false });
const output = await bank.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const verified = await JSZip.loadAsync(output, { checkCRC32: true });
const before = await JSZip.loadAsync(original);
let unchanged = 0;
for (const entry of Object.values(verified.files)) {
  if (entry.dir) continue;
  const expected = replacements.get(entry.name) ?? await before.file(entry.name).async('nodebuffer');
  if (hash(await entry.async('nodebuffer')) !== hash(expected)) throw new Error(`Verification failed: ${entry.name}`);
  if (!replacements.has(entry.name)) unchanged++;
}
// All other shader definitions must also retain their exact source text.
const afterBlocks = new Map(shaderSourceBlocks(updated).map(block => [block.name, block.source]));
for (const block of shaderSourceBlocks(source)) {
  if (!definitions.some(item => item.name === block.name) && afterBlocks.get(block.name) !== block.source) throw new Error(`Unrelated shader changed: ${block.name}`);
}
await fs.writeFile(`${bankPath}.tmp`, output);
await fs.rename(`${bankPath}.tmp`, bankPath);
console.log(JSON.stringify({ package: bankPath, target, definitions: definitions.map(item => item.name), texture: textureName, verifiedUnchangedEntries: unchanged, bytes: output.length, sha256: hash(output) }, null, 2));

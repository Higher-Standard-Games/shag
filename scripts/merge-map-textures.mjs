import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { shaderSourceBlocks } from '../src/engine/loader/shader/ShaderSourceBlocks.ts';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const sourcePath = option('--source');
if (!sourcePath) throw new Error('Usage: node scripts/merge-map-textures.mjs --source <tex_map.pk3> [--output <bank.pk3>] [--prefer-existing]');
const outputPath = path.resolve(option('--output', 'public/data/washoi_textures.pk3'));
const preferExisting = args.includes('--prefer-existing');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = await fs.readFile(outputPath);
const base = await JSZip.loadAsync(original, { checkCRC32: true });
const incoming = await JSZip.loadAsync(await fs.readFile(sourcePath), { checkCRC32: true });
const shaderPath = 'scripts/washoi_maps.shader';
const currentShader = await base.file(shaderPath).async('string');
const shaders = new Map(shaderSourceBlocks(currentShader).map(block => [block.name.toLowerCase(), block.source]));
const additions = new Map();
const retainedConflicts = [];
let shaderText = currentShader;
let addedShaders = 0;
for (const entry of Object.values(incoming.files)) {
  if (entry.dir) continue;
  if (entry.name.startsWith('/') || entry.name.split('/').includes('..')) throw new Error(`Unsafe asset path: ${entry.name}`);
  const bytes = await entry.async('nodebuffer');
  if (/^scripts\/.*\.shader$/.test(entry.name)) {
    for (const block of shaderSourceBlocks(bytes.toString('utf8'))) {
      const key = block.name.toLowerCase();
      if (shaders.has(key)) {
        if (shaders.get(key) !== block.source) {
          if (!preferExisting) throw new Error(`Shader conflict: ${key}`);
          retainedConflicts.push({ kind: 'shader', name: key });
        }
      } else {
        shaders.set(key, block.source);
        shaderText += `\n\n${block.source}\n`;
        addedShaders++;
      }
    }
    continue;
  }
  const current = base.file(entry.name);
  if (/^media-manifests\/.*\.json$/.test(entry.name)) {
    // Replacing a compiled map also replaces its dependency ledger.
    additions.set(entry.name, bytes);
  } else if (current) {
    if (hash(await current.async('nodebuffer')) !== hash(bytes)) {
      if (!preferExisting) throw new Error(`Asset conflict: ${entry.name}`);
      retainedConflicts.push({ kind: 'asset', name: entry.name });
    }
  } else additions.set(entry.name, bytes);
}
// A map's dependency ledger describes the actual merged winners.
for (const [name, bytes] of additions) {
  if (!/^media-manifests\/.*\.json$/.test(name)) continue;
  const manifest = JSON.parse(bytes.toString('utf8'));
  let mapPackage;
  for (const asset of manifest.assets ?? []) {
    let winner = additions.get(asset.name) ?? await base.file(asset.name)?.async('nodebuffer');
    let owner = path.basename(outputPath);
    if (!winner && /^(levelshots|minimaps|navigation|maps)\//.test(asset.name)) {
      if (!/^[a-z0-9_]+$/.test(manifest.map)) throw new Error('Invalid map ID in dependency ledger');
      owner = `map_${manifest.map}.pk3`;
      mapPackage ??= await JSZip.loadAsync(await fs.readFile(path.join(path.dirname(sourcePath), owner)), { checkCRC32: true });
      winner = await mapPackage.file(asset.name)?.async('nodebuffer');
    }
    if (!winner) throw new Error(`Dependency missing after merge: ${asset.name}`);
    asset.owner = owner;
    asset.bytes = winner.length;
    asset.sha256 = hash(winner);
  }
  for (const shader of manifest.shaders ?? []) {
    const winner = shaders.get(shader.name.toLowerCase());
    if (!winner) throw new Error(`Shader missing after merge: ${shader.name}`);
    shader.owner = path.basename(outputPath);
    shader.source = shaderPath;
    shader.sha256 = hash(Buffer.from(winner));
  }
  additions.set(name, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}
const date = new Date('1980-01-01T00:00:00Z');
for (const [name, bytes] of additions) base.file(name, bytes, { date, createFolders: false });
base.file(shaderPath, shaderText, { date, createFolders: false });
const output = await base.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const verified = await JSZip.loadAsync(output, { checkCRC32: true });
const before = await JSZip.loadAsync(original);
for (const entry of Object.values(before.files)) {
  if (entry.dir || entry.name === shaderPath || additions.has(entry.name)) continue;
  if (hash(await entry.async('nodebuffer')) !== hash(await verified.file(entry.name).async('nodebuffer'))) throw new Error(`Existing asset changed: ${entry.name}`);
}
for (const [name, bytes] of additions) {
  if (hash(await verified.file(name).async('nodebuffer')) !== hash(bytes)) throw new Error(`Added asset mismatch: ${name}`);
}
const finalShaders = new Map(shaderSourceBlocks(await verified.file(shaderPath).async('string')).map(block => [block.name.toLowerCase(), block.source]));
for (const [name, source] of shaders) if (finalShaders.get(name) !== source) throw new Error(`Shader mismatch: ${name}`);
// A content-addressed backup makes repeated runs safe without overwriting prior banks.
const backupDir = path.resolve('archive/media/map-texture-merge');
await fs.mkdir(backupDir, { recursive: true });
try { await fs.writeFile(path.join(backupDir, `${hash(original)}.pk3`), original, { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
await fs.writeFile(`${outputPath}.tmp`, output);
await fs.rename(`${outputPath}.tmp`, outputPath);
console.log(JSON.stringify({ source: sourcePath, output: outputPath, addedFiles: additions.size, addedShaders, retainedConflicts, bytes: output.length, sha256: hash(output) }, null, 2));

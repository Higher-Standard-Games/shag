import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const recipe = JSON.parse(await fs.readFile(path.join(repoRoot, 'config/player-model-vanguard.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Only self-contained runtime GLBs go into the package. Original FBX files and
// intermediary exports remain in the unserved asset source directory.
export function validateEmbeddedGlb(bytes, name) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a)
    throw new Error(`Invalid GLB: ${name}`);
  const length = bytes.readUInt32LE(12);
  if (20 + length > bytes.length) throw new Error(`Truncated GLB JSON: ${name}`);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  for (const entry of [...(json.images ?? []), ...(json.buffers ?? [])])
    if (entry.uri && !entry.uri.startsWith('data:')) throw new Error(`External GLB resource in ${name}: ${entry.uri}`);
}

export async function buildPlayerModelPackage(sourceDir) {
  const names = (await fs.readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.glb')).map(entry => entry.name).sort();
  for (const name of [recipe.model, ...recipe.animations.filter(clip => !clip.optional).map(clip => clip.file)])
    if (!names.includes(name)) throw new Error(`Required player asset missing: ${name}`);
  const zip = new JSZip(), files = {};
  const fileOptions = { date: new Date('1980-01-01T00:00:00Z'), createFolders: false };
  for (const name of names) {
    const bytes = await fs.readFile(path.join(sourceDir, name));
    validateEmbeddedGlb(bytes, name);
    zip.file(recipe.root + name, bytes, fileOptions);
    files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  const manifest = { version: 1, model: recipe.model,
    animations: recipe.animations.filter(clip => names.includes(clip.file)), files };
  zip.file(recipe.root + 'manifest.json', JSON.stringify(manifest, null, 2) + '\n', fileOptions);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { bytes, manifest };
}

async function main() {
  let sourceDir = path.join(repoRoot, recipe.sourceDir);
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] !== '--source-dir' || !process.argv[i + 1])
      throw new Error('Usage: npm run tools:player-model -- [--source-dir <GLB directory>]');
    sourceDir = path.resolve(process.argv[++i]);
  }
  const { bytes, manifest } = await buildPlayerModelPackage(sourceDir);
  const output = path.join(repoRoot, 'public/data', recipe.package);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output + '.tmp', bytes);
  await fs.rename(output + '.tmp', output);
  console.log(`${recipe.package}: ${Object.keys(manifest.files).length} GLBs, ${bytes.length} bytes, SHA-256 ${sha256(bytes)}`);
  console.log('Regenerate discovery with npm run tools:pk3-index (also runs before npm run build).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

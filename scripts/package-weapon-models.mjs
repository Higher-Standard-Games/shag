import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { validateEmbeddedGlb } from './package-player-model.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const recipe = JSON.parse(await fs.readFile(path.join(repoRoot, 'config/weapon-models.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { date: new Date('1980-01-01T00:00:00Z'), createFolders: false };

async function exportsIn(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await exportsIn(path.join(directory, entry.name), name + '/'));
    else if (entry.isFile() && (/\.(glb|cfg)$/i.test(entry.name) || entry.name === 'tags.txt')) files.push(name);
  }
  return files.sort();
}

/** Preserve the original override bank and add validated, embedded runtime exports. */
export async function buildWeaponModelPackage(sourceDir, basePackage, projectilePackage = null) {
  const names = await exportsIn(sourceDir);
  for (const name of recipe.required)
    if (!names.includes(name)) throw new Error(`Required weapon asset missing: ${name}`);
  const baseBytes = await fs.readFile(basePackage);
  const base = await JSZip.loadAsync(baseBytes), output = new JSZip();
  const files = new Map();
  for (const entry of Object.values(base.files)) {
    if (entry.dir) continue;
    if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..'))
      throw new Error(`Invalid base package path: ${entry.name}`);
    files.set(entry.name, await entry.async('nodebuffer'));
  }
  const exports = {};
  if (projectilePackage) {
    const projectiles = await JSZip.loadAsync(await fs.readFile(projectilePackage));
    for (const entry of Object.values(projectiles.files)) {
      if (!entry.dir) files.set(entry.name, await entry.async('nodebuffer'));
    }
  }
  for (const name of names) {
    const bytes = await fs.readFile(path.join(sourceDir, name));
    if (/\.glb$/i.test(name)) validateEmbeddedGlb(bytes, name);
    files.set(recipe.root + name, bytes);
    exports[name] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  const manifest = { version: 1, baseSha256: sha256(baseBytes), files: exports, credits: recipe.credits ?? [] };
  files.set(recipe.root + 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) output.file(name, bytes, options);
  const bytes = await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { bytes, manifest };
}

async function main() {
  let sourceDir = path.join(repoRoot, recipe.sourceDir);
  let basePackage = path.join(repoRoot, recipe.basePackage);
  let output = path.join(repoRoot, 'public/data', recipe.package);
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i], value = process.argv[++i];
    if (!value || !['--source-dir', '--base-package', '--output'].includes(flag))
      throw new Error('Usage: npm run tools:weapon-models -- [--source-dir DIR] [--base-package PK3] [--output PK3]');
    if (flag === '--source-dir') sourceDir = path.resolve(value);
    if (flag === '--base-package') basePackage = path.resolve(value);
    if (flag === '--output') output = path.resolve(value);
  }
  if (path.resolve(output) === path.resolve(basePackage)) throw new Error('Output must not overwrite the source bank');
  const { bytes, manifest } = await buildWeaponModelPackage(sourceDir, basePackage, path.join(repoRoot, recipe.projectilePackage));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output + '.tmp', bytes);
  await fs.rename(output + '.tmp', output);
  console.log(`${path.basename(output)}: ${Object.keys(manifest.files).length} exports, ${bytes.length} bytes, SHA-256 ${sha256(bytes)}`);
  console.log('Regenerate discovery with npm run tools:pk3-index (also runs before npm run build).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

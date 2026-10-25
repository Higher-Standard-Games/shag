import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { validateEmbeddedGlb } from './package-player-model.mjs';
import { buildRuntimeWeaponGlb } from './weapon-textures.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const recipe = JSON.parse(await fs.readFile(path.join(repoRoot, 'config/weapon-models.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { date: new Date('1980-01-01T00:00:00Z'), createFolders: false };

/**
 * Build the runtime weapon package: the recipe's files (pack path → export
 * path), each GLB given its surface maps and WebP textures from the source
 * bank, plus the projectile package. The source bank itself is not shipped.
 */
export async function buildWeaponModelPackage(sourceDir, basePackage, projectilePackage = null) {
  const baseBytes = await fs.readFile(basePackage);
  const base = await JSZip.loadAsync(baseBytes);
  const bankFiles = new Map();
  for (const entry of Object.values(base.files))
    if (!entry.dir) bankFiles.set(entry.name.toLowerCase(), await entry.async('nodebuffer'));
  const bank = (name) => bankFiles.get(name) ?? null;
  const files = new Map();
  if (projectilePackage) {
    const projectiles = await JSZip.loadAsync(await fs.readFile(projectilePackage));
    for (const entry of Object.values(projectiles.files)) {
      if (!entry.dir) files.set(entry.name, await entry.async('nodebuffer'));
    }
  }
  const exports = {};
  for (const [name, source] of Object.entries(recipe.files)) {
    for (const part of [name, source])
      if (part.startsWith('/') || part.includes('\\') || part.split('/').includes('..'))
        throw new Error(`Invalid weapon asset path: ${part}`);
    let bytes;
    try {
      bytes = await fs.readFile(path.join(sourceDir, source));
    } catch {
      throw new Error(`Required weapon asset missing: ${source}`);
    }
    if (/\.glb$/i.test(name)) {
      validateEmbeddedGlb(bytes, source);
      bytes = (await buildRuntimeWeaponGlb(bytes, bank)).bytes;
      validateEmbeddedGlb(bytes, name);
    }
    files.set(recipe.root + name, bytes);
    exports[name] = { source, bytes: bytes.length, sha256: sha256(bytes) };
  }
  const manifest = { version: 2, baseSha256: sha256(baseBytes), files: exports, credits: recipe.credits ?? [] };
  files.set(recipe.root + 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  const output = new JSZip();
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

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { readPackagePolicy, sharedPackageForPath } from '../src/cli/pk3-package-policy.ts';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const recipe = JSON.parse(await fs.readFile('config/billboard-package.json', 'utf8'));
const policy = readPackagePolicy(), definition = policy.sharedTexturePackages[recipe.package];
if (!definition) throw new Error('Billboard bank is not configured in pk3-packages.json');
const sourcePath = path.resolve(option('--package', 'public/data/washoi_textures.pk3'));
const outputPath = path.resolve(option('--output', `public/data/${recipe.package}`));
const artworkDir = path.resolve(option('--source-dir', 'assets/billboards'));
if (sourcePath === outputPath) throw new Error('Billboard output must not replace the master');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = await fs.readFile(sourcePath), sourceHash = hash(original);
const source = await JSZip.loadAsync(original, { checkCRC32: true });
const files = new Map();
for (const file of Object.values(source.files)) {
  if (!file.dir && (sharedPackageForPath(file.name, policy) === recipe.package || file.name.startsWith('media-sources/')))
    files.set(file.name, await file.async('nodebuffer'));
}
const replacements = [];
for (const entry of recipe.files) {
  const destination = entry.destination ?? `textures/billboard/${entry.name}.${entry.extension}`;
  if (sharedPackageForPath(destination, policy) !== recipe.package) continue;
  if (!files.has(destination)) throw new Error(`Expected billboard missing from master: ${destination}`);
  const png = await fs.readFile(path.join(artworkDir, `${entry.name}.png`));
  const image = PNG.sync.read(png);
  if (image.width !== entry.width || image.height !== entry.height) throw new Error(`Wrong dimensions: ${entry.name}`);
  let bytes = png;
  if (entry.extension === 'tga') {
    bytes = Buffer.alloc(18 + image.width * image.height * 4);
    bytes[2] = 2; bytes.writeUInt16LE(image.width, 12); bytes.writeUInt16LE(image.height, 14);
    bytes[16] = 32; bytes[17] = 0x28;
    for (let i = 0; i < image.data.length; i += 4) {
      bytes[18+i] = image.data[i+2]; bytes[19+i] = image.data[i+1];
      bytes[20+i] = image.data[i]; bytes[21+i] = image.data[i+3];
    }
  }
  files.set(destination, bytes); replacements.push(destination);
}
for (const overlay of recipe.retainedOverlays) if (!files.has(overlay)) throw new Error(`Missing billboard overlay: ${overlay}`);
const ledger = {
  version: 1, package: recipe.package, dynamic: definition.dynamic, prefixes: definition.prefixes,
  sourcePackage: path.basename(sourcePath), sourceSha256: sourceHash, replacements,
  files: [...files].filter(([name]) => sharedPackageForPath(name, policy) === recipe.package)
    .map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) })),
};
files.set('media-manifests/washoi_billboards.json', Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`));
const output = new JSZip(), date = new Date('1980-01-01T00:00:00Z');
for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b)))
  output.file(name, bytes, { date, createFolders: false });
const bytes = await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const verified = await JSZip.loadAsync(bytes, { checkCRC32: true });
for (const [name, data] of files) if (hash(await verified.file(name).async('nodebuffer')) !== hash(data)) throw new Error(`Verification failed: ${name}`);
if (hash(await fs.readFile(sourcePath)) !== sourceHash) throw new Error('Master changed while packaging');
await fs.mkdir(path.dirname(outputPath), { recursive: true });
try {
  const previous = await fs.readFile(outputPath), backup = path.resolve('archive/media/billboard-bank');
  await fs.mkdir(backup, { recursive: true });
  try { await fs.writeFile(path.join(backup, `${hash(previous)}.pk3`), previous, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(`${outputPath}.tmp`, bytes); await fs.rename(`${outputPath}.tmp`, outputPath);
console.log(JSON.stringify({ package: outputPath, textures: ledger.files.length, replacements: replacements.length,
  bytes: bytes.length, sha256: hash(bytes), masterUnchanged: true }, null, 2));

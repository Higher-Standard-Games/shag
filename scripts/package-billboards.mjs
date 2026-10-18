import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { PNG } from 'pngjs';

// Apply after tools:map-media when rebuilding a bank from upstream media.
const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const bankPath = path.resolve(option('--package', 'public/data/washoi_textures.pk3'));
const config = JSON.parse(await fs.readFile('config/billboard-package.json', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const date = new Date('1980-01-01T00:00:00Z');
const texturePath = entry => entry.destination ?? `textures/billboard/${entry.name}.${entry.extension}`;
const original = await fs.readFile(bankPath);
const bank = await JSZip.loadAsync(original, { checkCRC32: true });
const replacements = new Map();
const files = [];
for (const entry of config.files) {
  const source = `assets/billboards/${entry.name}.png`;
  const png = await fs.readFile(source);
  const image = PNG.sync.read(png);
  if (image.width !== entry.width || image.height !== entry.height) throw new Error(`Wrong dimensions: ${source}`);
  let bytes = png;
  if (entry.extension === 'tga') {
    // Uncompressed, top-left-origin BGRA TGA preserves the existing lookup path.
    bytes = Buffer.alloc(18 + image.width * image.height * 4);
    bytes[2] = 2;
    bytes.writeUInt16LE(image.width, 12);
    bytes.writeUInt16LE(image.height, 14);
    bytes[16] = 32;
    bytes[17] = 0x28;
    for (let i = 0; i < image.data.length; i += 4) {
      bytes[18 + i] = image.data[i + 2];
      bytes[19 + i] = image.data[i + 1];
      bytes[20 + i] = image.data[i];
      bytes[21 + i] = image.data[i + 3];
    }
  }
  const destination = texturePath(entry);
  if (!bank.file(destination)) throw new Error(`Expected billboard missing: ${destination}`);
  replacements.set(destination, bytes);
  files.push({ ...entry, destination, source, bytes: bytes.length, sha256: hash(bytes) });
}

// Keep the packaged dependency ledgers accurate, including legacy map aliases.
for (const entry of Object.values(bank.files)) {
  if (entry.dir || !/^media-manifests\/.*\.json$/.test(entry.name)) continue;
  const manifest = JSON.parse(await entry.async('string'));
  let changed = false;
  for (const asset of manifest.assets ?? []) {
    const bytes = replacements.get(asset.name);
    if (!bytes) continue;
    asset.bytes = bytes.length;
    asset.sha256 = hash(bytes);
    changed = true;
  }
  if (changed) replacements.set(entry.name, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}
replacements.set('media-manifests/washoi_billboards.json', Buffer.from(`${JSON.stringify({ version: 1, files, retainedOverlays: config.retainedOverlays }, null, 2)}\n`));
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
// Save the original art outside the served tree once, for review or rollback.
for (const entry of config.files) {
  const name = texturePath(entry);
  const backup = path.join('archive/media/billboards', name);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  try { await fs.writeFile(backup, await before.file(name).async('nodebuffer'), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
await fs.writeFile(`${bankPath}.tmp`, output);
await fs.rename(`${bankPath}.tmp`, bankPath);
console.log(JSON.stringify({ package: bankPath, replacedArtwork: files.length, verifiedUnchangedEntries: unchanged, bytes: output.length, sha256: hash(output) }, null, 2));

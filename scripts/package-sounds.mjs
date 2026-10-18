import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const recipe = JSON.parse(await fs.readFile(option('--config', 'config/sound-package.json'), 'utf8'));
const output = option('--output', 'public/data/washoi_sounds.pk3');
const zip = new JSZip();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const date = new Date('1980-01-01T00:00:00Z');
for (const entry of recipe.files) {
  if (entry.path.includes('..') || entry.source.includes('..') || path.isAbsolute(entry.source)) throw new Error('Unsafe sound path');
  const bytes = await fs.readFile(path.join(recipe.sourceDirectory, entry.source));
  if (hash(bytes) !== entry.sha256) throw new Error(`Source hash changed: ${entry.source}`);
  zip.file(entry.path, bytes, { date, createFolders: false });
}
for (const license of recipe.licenses) {
  zip.file(`licenses/${path.basename(license.notice)}`, await fs.readFile(path.join(recipe.sourceDirectory, license.notice)), { date, createFolders: false });
}
zip.file('media-manifests/washoi_sounds.json', JSON.stringify(recipe, null, 2) + '\n', { date, createFolders: false });
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const check = await JSZip.loadAsync(bytes, { checkCRC32: true });
for (const entry of recipe.files) {
  if (hash(await check.file(entry.path).async('nodebuffer')) !== entry.sha256) throw new Error(`Package hash mismatch: ${entry.path}`);
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, bytes);
console.log(JSON.stringify({ output, files: recipe.files.length, bytes: bytes.length, sha256: hash(bytes) }));

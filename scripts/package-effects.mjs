import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const source = path.resolve(option('--source-dir', 'archive/media/effects'));
const output = path.resolve(option('--output', 'public/data/effects.pk3'));
const zip = new JSZip();
const files = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const name of ['cartoonhit1.png', 'cartoonhit2.png']) {
  const bytes = await fs.readFile(path.join(source, name));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${name}`);
  const key = `effects/${name}`;
  zip.file(key, bytes, { date: new Date('1980-01-01T00:00:00Z'), createFolders: false });
  files[key] = { bytes: bytes.length, sha256: hash(bytes) };
}
zip.file('media-manifests/effects.json', JSON.stringify({ version: 1, files }, null, 2) + '\n', {
  date: new Date('1980-01-01T00:00:00Z'), createFolders: false,
});
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const verified = await JSZip.loadAsync(bytes, { checkCRC32: true });
for (const [name, entry] of Object.entries(files)) {
  if (hash(await verified.file(name).async('nodebuffer')) !== entry.sha256) throw new Error(`Hash mismatch: ${name}`);
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, bytes);
console.log(`Packaged ${Object.keys(files).length} unchanged PNGs into ${output} (${bytes.length} bytes)`);

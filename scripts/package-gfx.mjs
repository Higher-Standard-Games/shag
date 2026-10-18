import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const source = path.resolve(option('--source-dir', 'archive/media/gfx'));
const output = path.resolve(option('--output', 'public/data/washoi_gfx.pk3'));
const icons = ['bulletsammo', 'riotammo', 'grenadeammo', 'rocketammo', 'plasmaammo', 'laserammo', 'electroammo', 'instaammo'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const zip = new JSZip();
const files = {};
for (const icon of icons) {
  const key = `gfx/hud/icons/ammo/${icon}.tga`;
  const bytes = await fs.readFile(path.join(source, key));
  if (bytes.length < 18 || ![2, 3, 10, 11].includes(bytes[2])) throw new Error(`Invalid TGA: ${key}`);
  zip.file(key, bytes, { date: new Date('1980-01-01T00:00:00Z'), createFolders: false });
  files[key] = { bytes: bytes.length, sha256: hash(bytes) };
}
zip.file('media-manifests/washoi_gfx.json', JSON.stringify({ version: 1, files }, null, 2) + '\n', {
  date: new Date('1980-01-01T00:00:00Z'), createFolders: false,
});
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const verified = await JSZip.loadAsync(bytes, { checkCRC32: true });
for (const [name, entry] of Object.entries(files)) {
  if (hash(await verified.file(name).async('nodebuffer')) !== entry.sha256) throw new Error(`Hash mismatch: ${name}`);
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, bytes);
console.log(`Packaged ${icons.length} unchanged ammo icons into ${output} (${bytes.length} bytes)`);

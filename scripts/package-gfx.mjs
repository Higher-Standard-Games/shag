import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const source = path.resolve(option('--source-dir', 'archive/media/gfx'));
const output = path.resolve(option('--output', 'public/data/washoi_gfx.pk3'));
const icons = ['bulletsammo', 'riotammo', 'grenadeammo', 'rocketammo', 'plasmaammo', 'laserammo', 'electroammo', 'instaammo'];
// The weapon symbols stamped on the sides of the ammo box, one per ammo type
const simpleItems = ['machinegun', 'riot', 'grenade', 'rocket', 'plasma', 'laser', 'electro'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const zip = new JSZip();
const files = {};
const add = (key, bytes) => {
  zip.file(key, bytes, { date: new Date('1980-01-01T00:00:00Z'), createFolders: false });
  files[key] = { bytes: bytes.length, sha256: hash(bytes) };
};

/** Decode a truecolour TGA (raw or RLE, 24 or 32 bit) to top-down RGBA. */
function decodeTga(bytes, key) {
  const type = bytes[2];
  const width = bytes.readUInt16LE(12);
  const height = bytes.readUInt16LE(14);
  const depth = bytes[16] / 8;
  if (![2, 10].includes(type) || ![3, 4].includes(depth)) throw new Error(`Unsupported TGA: ${key}`);
  const rgba = Buffer.alloc(width * height * 4);
  let at = 18 + bytes[0];
  let pixel = 0;
  const put = from => {
    rgba[pixel * 4] = bytes[from + 2];
    rgba[pixel * 4 + 1] = bytes[from + 1];
    rgba[pixel * 4 + 2] = bytes[from];
    rgba[pixel * 4 + 3] = depth === 4 ? bytes[from + 3] : 255;
    pixel++;
  };
  while (pixel < width * height) {
    if (type === 2) {
      put(at);
      at += depth;
      continue;
    }
    const header = bytes[at++];
    const count = (header & 127) + 1;
    for (let i = 0; i < count; i++) {
      put(at);
      if (!(header & 128)) at += depth;
    }
    if (header & 128) at += depth;
  }
  // Bottom-up unless the descriptor says top-down
  if (!(bytes[17] & 32)) {
    const row = width * 4;
    const swap = Buffer.alloc(row);
    for (let y = 0; y < height / 2; y++) {
      const top = y * row;
      const bottom = (height - 1 - y) * row;
      rgba.copy(swap, 0, top, top + row);
      rgba.copy(rgba, top, bottom, bottom + row);
      swap.copy(rgba, bottom);
    }
  }
  return { rgba, width, height };
}

for (const icon of icons) {
  const key = `gfx/hud/icons/ammo/${icon}.tga`;
  const bytes = await fs.readFile(path.join(source, key));
  if (bytes.length < 18 || ![2, 3, 10, 11].includes(bytes[2])) throw new Error(`Invalid TGA: ${key}`);
  add(key, bytes);
}
for (const item of simpleItems) {
  const from = `gfx/simpleitems/weapon/${item}.tga`;
  const { rgba, width, height } = decodeTga(await fs.readFile(path.join(source, from)), from);
  const webp = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toBuffer();
  add(`gfx/simpleitems/weapon/${item}.webp`, webp);
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
console.log(
  `Packaged ${icons.length} ammo icons and ${simpleItems.length} weapon symbols into ${output} (${bytes.length} bytes)`,
);

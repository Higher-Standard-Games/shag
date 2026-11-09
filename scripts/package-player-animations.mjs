import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { validateEmbeddedGlb } from './validate-glb.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const recipe = JSON.parse(await fs.readFile(path.join(root, 'config/player-animations.json'), 'utf8'));

/** The recipe's clips from `sourceDir` as a reproducible archive; authoring files stay out. */
export async function buildPlayerAnimationPackage(sourceDir) {
  const zip = new JSZip();
  const files = {};
  const options = { date: new Date('1980-01-01T00:00:00Z'), createFolders: false };
  for (const clip of recipe.animations) {
    let bytes;
    try { bytes = await fs.readFile(path.join(sourceDir, clip.file)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (clip.optional) continue;
      throw new Error(`Required player animation missing: ${clip.file}`);
    }
    validateEmbeddedGlb(bytes, clip.file);
    zip.file(recipe.root + clip.file, bytes, options);
    files[clip.file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  zip.file(recipe.root + 'animations-manifest.json', JSON.stringify({ version: 1, files }, null, 2) + '\n', options);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { bytes, files };
}

async function main() {
  const { bytes, files } = await buildPlayerAnimationPackage(path.join(root, recipe.sourceDir));
  const output = path.join(root, 'public/data', recipe.package);
  await fs.writeFile(output + '.tmp', bytes);
  await fs.rename(output + '.tmp', output);
  console.log(`${recipe.package}: ${Object.keys(files).length} shared clips, ${bytes.length} bytes`);
  console.log('Regenerate discovery with npm run tools:pk3-index. The body model archive is unchanged.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

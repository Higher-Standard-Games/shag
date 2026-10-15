import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const recipe = JSON.parse(await fs.readFile(path.join(root, 'config/weapon-models.json'), 'utf8'));
if (process.argv.length > 2) throw new Error('Usage: npm run convert:weapons');
const python = process.env.PYTHON ?? 'python';
const prerequisite = spawnSync(python, ['-c', 'import PIL'], { cwd: root, shell: false });
if (prerequisite.error) throw prerequisite.error;
if (prerequisite.status !== 0)
  throw new Error('Weapon conversion needs Python Pillow. Install it in the selected Python environment before converting; no exports were changed.');
for (const script of ['convert_iqm_weapons.py', 'embed_weapon_textures.py']) {
  const result = spawnSync(python, [path.join(root, 'scripts', script),
    '--package', path.join(root, recipe.basePackage), '--output-dir', path.join(root, recipe.sourceDir)],
  { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

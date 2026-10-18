import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { buildWeaponModelPackage } from '../package-weapon-models.mjs';

const recipe = JSON.parse(await fs.readFile(new URL('../../config/weapon-models.json', import.meta.url), 'utf8'));
function glb(extra = {}) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, ...extra }).padEnd(
    Math.ceil(JSON.stringify({ asset: { version: '2.0' }, ...extra }).length / 4) * 4, ' '));
  const bytes = Buffer.alloc(20 + json.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  return bytes;
}
test('preserves the source bank, includes cfg overrides, and rebuilds deterministically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shag-weapons-'));
  try {
    const source = path.join(dir, 'exports'), base = path.join(dir, 'base.pk3');
    const zip = new JSZip(); zip.file('models/weapons/example.iqm', 'original');
    zip.file(recipe.root + 'glauncher/glauncher.cfg', 'old cfg');
    await fs.writeFile(base, await zip.generateAsync({ type: 'nodebuffer' }));
    for (const name of recipe.required) {
      await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
      await fs.writeFile(path.join(source, name), name.endsWith('.glb') ? glb() : 'tag "tag_barrel2" "tag_barrel" 0 0 0 0 0 0');
    }
    await fs.writeFile(path.join(source, 'glauncher/glauncher.cfg'), 'new cfg');
    await fs.writeFile(path.join(source, 'blade/source.fbx'), 'authoring file');
    const result = await buildWeaponModelPackage(source, base);
    assert.deepEqual(result.bytes, (await buildWeaponModelPackage(source, base)).bytes);
    const output = await JSZip.loadAsync(result.bytes);
    assert.equal(await output.file('models/weapons/example.iqm').async('string'), 'original');
    assert.equal(await output.file(recipe.root + 'glauncher/glauncher.cfg').async('string'), 'new cfg');
    assert.equal(output.file(recipe.root + 'blade/source.fbx'), null);
    const projectilePackage = path.join(dir, 'projectiles.pk3');
    const projectiles = new JSZip();
    projectiles.file('models/objects/projectile/rlauncher/rocket_strong.md3', 'rocket');
    projectiles.file('scripts/washoi_projectiles.shader', 'projectile shader');
    await fs.writeFile(projectilePackage, await projectiles.generateAsync({ type: 'nodebuffer' }));
    const combined = await JSZip.loadAsync((await buildWeaponModelPackage(source, base, projectilePackage)).bytes);
    assert.equal(await combined.file('models/objects/projectile/rlauncher/rocket_strong.md3').async('string'), 'rocket');
    assert.equal(await combined.file('scripts/washoi_projectiles.shader').async('string'), 'projectile shader');
    assert.equal(await combined.file('models/weapons/example.iqm').async('string'), 'original');
    assert.equal(await output.file(recipe.root + 'plasmagun/tags.txt').async('string'),
      'tag "tag_barrel2" "tag_barrel" 0 0 0 0 0 0');
    await fs.writeFile(path.join(source, recipe.required[0]), glb({ images: [{ uri: 'external.png' }] }));
    await assert.rejects(buildWeaponModelPackage(source, base), /External GLB resource/);
    await fs.unlink(path.join(source, recipe.required[0]));
    await assert.rejects(buildWeaponModelPackage(source, base), /Required weapon asset missing/);
  } finally {
    if (!path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()), 'shag-weapons-')))
      throw new Error('Unsafe test cleanup path');
    await fs.rm(dir, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { buildPlayerModelPackage, validateEmbeddedGlb } from '../package-player-model.mjs';

const recipe = JSON.parse(await fs.readFile(new URL('../../config/player-model-vanguard.json', import.meta.url), 'utf8'));
function glb(extra = {}) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, ...extra }));
  const length = Math.ceil(json.length / 4) * 4, bytes = Buffer.alloc(20 + length, 32);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  return bytes;
}

test('player archive is reproducible, preserves GLB bytes and excludes authoring inputs', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'shag-player-package-'));
  try {
    const bytes = glb();
    for (const name of new Set([recipe.model, ...recipe.animations.filter(clip => !clip.optional).map(clip => clip.file), 'extra.glb']))
      await fs.writeFile(path.join(source, name), bytes);
    await fs.writeFile(path.join(source, 'vanguard.fbx'), 'source only');
    const first = await buildPlayerModelPackage(source), second = await buildPlayerModelPackage(source);
    assert.deepEqual(first.bytes, second.bytes);
    const zip = await JSZip.loadAsync(first.bytes);
    assert.deepEqual(await zip.file(recipe.root + recipe.model).async('nodebuffer'), bytes);
    assert.equal(zip.file(recipe.root + 'vanguard.fbx'), null);
    assert.equal(Object.keys(first.manifest.files).length, 19);
    assert.ok(first.manifest.animations.every(clip => !clip.optional));
    assert.equal(first.manifest.files[recipe.model].sha256.length, 64);
    await fs.unlink(path.join(source, 'rifle run.glb'));
    await assert.rejects(buildPlayerModelPackage(source), /Required player asset missing/);
  } finally {
    assert.equal(path.dirname(path.resolve(source)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(source).startsWith('shag-player-package-'));
    await fs.rm(source, { recursive: true, force: true });
  }
});

test('rejects damaged or externally dependent GLBs instead of publishing broken package entries', () => {
  assert.throws(() => validateEmbeddedGlb(Buffer.from('bad'), 'bad.glb'), /Invalid GLB/);
  assert.throws(() => validateEmbeddedGlb(glb({ buffers: [{ uri: 'buffer.bin' }] }), 'bad.glb'), /External GLB resource/);
  assert.throws(() => validateEmbeddedGlb(glb({ images: [{ uri: 'skin.png' }] }), 'bad.glb'), /External GLB resource/);
  assert.doesNotThrow(() => validateEmbeddedGlb(glb({ buffers: [{ uri: 'data:application/octet-stream;base64,AQ==' }] }), 'valid.glb'));
});

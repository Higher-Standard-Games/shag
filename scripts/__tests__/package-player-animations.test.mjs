import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { buildPlayerAnimationPackage } from '../package-player-animations.mjs';
import { validateEmbeddedGlb } from '../validate-glb.mjs';

const recipe = JSON.parse(await fs.readFile(new URL('../../config/player-animations.json', import.meta.url), 'utf8'));
function glb(extra = {}) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, ...extra }));
  const length = Math.ceil(json.length / 4) * 4, bytes = Buffer.alloc(20 + length, 32);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  return bytes;
}

test('animation archive is reproducible, preserves GLB bytes and excludes authoring inputs', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'shag-player-animations-'));
  try {
    const bytes = glb();
    const required = recipe.animations.filter(clip => !clip.optional).map(clip => clip.file);
    for (const name of [...required, 'extra.glb']) await fs.writeFile(path.join(source, name), bytes);
    await fs.writeFile(path.join(source, 'backwards_run.fbx'), 'source only');
    const first = await buildPlayerAnimationPackage(source), second = await buildPlayerAnimationPackage(source);
    assert.deepEqual(first.bytes, second.bytes);
    const zip = await JSZip.loadAsync(first.bytes);
    assert.deepEqual(await zip.file(recipe.root + 'rifle run.glb').async('nodebuffer'), bytes);
    assert.equal(zip.file(recipe.root + 'backwards_run.fbx'), null);
    assert.equal(zip.file(recipe.root + 'extra.glb'), null);
    assert.deepEqual(Object.keys(first.files).sort(), [...required].sort());
    assert.equal(first.files['rifle run.glb'].sha256.length, 64);
    await fs.unlink(path.join(source, 'rifle run.glb'));
    await assert.rejects(buildPlayerAnimationPackage(source), /Required player animation missing/);
  } finally {
    assert.equal(path.dirname(path.resolve(source)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(source).startsWith('shag-player-animations-'));
    await fs.rm(source, { recursive: true, force: true });
  }
});

test('rejects damaged or externally dependent GLBs instead of publishing broken package entries', () => {
  assert.throws(() => validateEmbeddedGlb(Buffer.from('bad'), 'bad.glb'), /Invalid GLB/);
  assert.throws(() => validateEmbeddedGlb(glb({ buffers: [{ uri: 'buffer.bin' }] }), 'bad.glb'), /External GLB resource/);
  assert.throws(() => validateEmbeddedGlb(glb({ images: [{ uri: 'skin.png' }] }), 'bad.glb'), /External GLB resource/);
  assert.doesNotThrow(() => validateEmbeddedGlb(glb({ buffers: [{ uri: 'data:application/octet-stream;base64,AQ==' }] }), 'valid.glb'));
});

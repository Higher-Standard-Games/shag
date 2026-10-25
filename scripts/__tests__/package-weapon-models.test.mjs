import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import JSZip from 'jszip';
import sharp from 'sharp';
import { buildWeaponModelPackage } from '../package-weapon-models.mjs';
import { buildRuntimeWeaponGlb, decodeTga } from '../weapon-textures.mjs';

const recipe = JSON.parse(await fs.readFile(new URL('../../config/weapon-models.json', import.meta.url), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** A GLB with one triangle whose material is named after a weapon texture path. */
async function weaponGlb(materialName = 'models/weapons/example/example') {
  const document = new Document();
  const buffer = document.createBuffer();
  const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const uv = document.createAccessor().setType('VEC2').setBuffer(buffer).setArray(new Float32Array([0, 0, 1, 0, 0, 1]));
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } }).png().toBuffer();
  const material = document.createMaterial(materialName)
    .setBaseColorTexture(document.createTexture(materialName).setMimeType('image/png').setImage(image));
  const primitive = document.createPrimitive().setAttribute('POSITION', position).setAttribute('TEXCOORD_0', uv)
    .setMaterial(material);
  document.createScene().addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
  return Buffer.from(await io.writeBinary(document));
}

/** An uncompressed 24-bit TGA filled with one colour, stored bottom-up. */
function tga(width, height, [r, g, b]) {
  const bytes = Buffer.alloc(18 + width * height * 3);
  bytes[2] = 2;
  bytes.writeUInt16LE(width, 12);
  bytes.writeUInt16LE(height, 14);
  bytes[16] = 24;
  for (let i = 0; i < width * height; i++) bytes.set([b, g, r], 18 + i * 3);
  return bytes;
}

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shag-weapons-'));
  try {
    await run(dir);
  } finally {
    if (!path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()), 'shag-weapons-')))
      throw new Error('Unsafe test cleanup path');
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('packs only the recipe files under their pack names, with projectiles, deterministically', () =>
  withTempDir(async (dir) => {
    const source = path.join(dir, 'exports'), base = path.join(dir, 'base.pk3');
    const bank = new JSZip();
    bank.file('models/weapons/example.iqm', 'original');
    await fs.writeFile(base, await bank.generateAsync({ type: 'nodebuffer' }));
    const glb = await weaponGlb();
    for (const from of new Set(Object.values(recipe.files))) {
      await fs.mkdir(path.dirname(path.join(source, from)), { recursive: true });
      await fs.writeFile(path.join(source, from), from.endsWith('.glb') ? glb : `contents of ${from}`);
    }
    await fs.writeFile(path.join(source, 'blade/blade.glb'), glb);
    const projectilePackage = path.join(dir, 'projectiles.pk3');
    const projectiles = new JSZip();
    projectiles.file('scripts/washoi_projectiles.shader', 'projectile shader');
    await fs.writeFile(projectilePackage, await projectiles.generateAsync({ type: 'nodebuffer' }));

    const result = await buildWeaponModelPackage(source, base, projectilePackage);
    assert.deepEqual(result.bytes, (await buildWeaponModelPackage(source, base, projectilePackage)).bytes);
    const output = await JSZip.loadAsync(result.bytes);
    assert.equal(output.file('models/weapons/example.iqm'), null);
    assert.equal(output.file(recipe.root + 'blade/blade.glb'), null);
    assert.equal(await output.file('scripts/washoi_projectiles.shader').async('string'), 'projectile shader');
    assert.equal(await output.file(recipe.root + 'voltaic/voltaic.cfg').async('string'), 'contents of lasergun/lasergun.cfg');
    assert.ok(output.file(recipe.root + 'voltaic/voltaic.glb'));
    assert.equal(output.file(recipe.root + 'lasergun/lasergun.glb'), null);
    assert.equal(result.manifest.files['voltaic/voltaic.glb'].source, 'lasergun/lasergun.glb');

    await fs.unlink(path.join(source, 'plasmagun/tags.txt'));
    await assert.rejects(buildWeaponModelPackage(source, base), /Required weapon asset missing: plasmagun\/tags.txt/);
  }));

test('adds normal and roughness maps from the source bank, as WebP no larger than 1024', async () => {
  const bank = new Map([
    ['models/weapons/example/example_norm.tga', tga(2048, 2048, [128, 128, 255])],
    ['models/weapons/example/example_gloss.tga', tga(4, 4, [255, 255, 255])],
  ]);
  const { bytes, added } = await buildRuntimeWeaponGlb(await weaponGlb(), (name) => bank.get(name) ?? null);
  assert.deepEqual(added, ['models/weapons/example/example_norm', 'models/weapons/example/example_gloss']);
  const material = (await io.readBinary(bytes)).getRoot().listMaterials()[0];
  for (const texture of [material.getBaseColorTexture(), material.getNormalTexture(), material.getMetallicRoughnessTexture()]) {
    assert.equal(texture.getMimeType(), 'image/webp');
    const { width } = await sharp(Buffer.from(texture.getImage())).metadata();
    assert.ok(width <= 1024);
  }
  // A fully glossy texel is the glossiest roughness
  const roughness = await sharp(Buffer.from(material.getMetallicRoughnessTexture().getImage())).raw().toBuffer();
  assert.ok(Math.abs(roughness[1] - 0.3 * 255) < 6);
  assert.equal(material.getRoughnessFactor(), 1);
});

test('decodes RLE, palette and bottom-up TGAs top-down', () => {
  const header = (type, depth, extra = {}) => {
    const bytes = Buffer.alloc(18);
    bytes[1] = extra.colorMap ? 1 : 0;
    bytes[2] = type;
    if (extra.colorMap) {
      bytes.writeUInt16LE(extra.colorMap.length / 3, 5);
      bytes[7] = 24;
    }
    bytes.writeUInt16LE(1, 12);
    bytes.writeUInt16LE(2, 14);
    bytes[16] = depth;
    return bytes;
  };
  // Bottom-up rows: the second stored pixel is the top one
  const rle = Buffer.concat([header(10, 24), Buffer.from([0x00, 0, 0, 255, 0x00, 255, 0, 0])]);
  assert.deepEqual([...decodeTga(rle).rgba], [0, 0, 255, 255, 255, 0, 0, 255]);
  const palette = Buffer.from([0, 255, 0, 255, 255, 255]);
  const paletted = Buffer.concat([header(1, 8, { colorMap: palette }), palette, Buffer.from([1, 0])]);
  assert.deepEqual([...decodeTga(paletted).rgba], [0, 255, 0, 255, 255, 255, 255, 255]);
  assert.throws(() => decodeTga(header(2, 16)), /Unsupported TGA/);
});

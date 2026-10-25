/**
 * Runtime textures for packaged weapon GLBs.
 *
 * The IQM conversion embeds each material's colour map only. Packaging adds the
 * material's normal map (`<material>_norm`) and turns its gloss map
 * (`<material>_gloss`, Quake-style specular strength) into glTF roughness, then
 * re-encodes every texture as WebP no larger than MAX_TEXTURE_SIZE.
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

export const MAX_TEXTURE_SIZE = 1024;
/** Roughness where a gloss map is black, and where it is white. */
export const ROUGHNESS_DULL = 0.85;
export const ROUGHNESS_GLOSSY = 0.3;
const COLOR_QUALITY = 85;
const NORMAL_QUALITY = 92;

/** Decode an uncompressed or RLE TGA (8-bit grey or palette, 24- or 32-bit colour) into top-down RGBA. */
export function decodeTga(bytes) {
  const idLength = bytes[0], colorMapType = bytes[1], type = bytes[2];
  const mapFirst = bytes.readUInt16LE(3), mapLength = bytes.readUInt16LE(5), mapDepth = bytes[7];
  const width = bytes.readUInt16LE(12), height = bytes.readUInt16LE(14);
  const depth = bytes[16], descriptor = bytes[17];
  const paletted = type === 1 || type === 9;
  if (![1, 2, 3, 9, 10, 11].includes(type) || ![8, 24, 32].includes(depth) ||
      (paletted && (colorMapType !== 1 || depth !== 8 || ![24, 32].includes(mapDepth))))
    throw new Error(`Unsupported TGA: type ${type}, ${depth} bits`);
  let at = 18 + idLength;
  let palette = null;
  if (colorMapType === 1) {
    const entry = Math.ceil(mapDepth / 8);
    if (paletted) palette = bytes.subarray(at, at + mapLength * entry);
    at += mapLength * entry;
  }
  const size = depth / 8, pixels = width * height;
  const raw = Buffer.alloc(pixels * size);
  if (type <= 3) bytes.copy(raw, 0, at, at + raw.length);
  else {
    for (let out = 0; out < raw.length; ) {
      const header = bytes[at++], count = (header & 0x7f) + 1;
      if (header & 0x80) {
        for (let i = 0; i < count; i++) bytes.copy(raw, out + i * size, at, at + size);
        at += size;
      } else {
        bytes.copy(raw, out, at, at + count * size);
        at += count * size;
      }
      out += count * size;
    }
  }
  const rgba = Buffer.alloc(pixels * 4);
  const topDown = (descriptor & 0x20) !== 0;
  const entry = Math.ceil(mapDepth / 8);
  for (let y = 0; y < height; y++) {
    const row = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const from = (row * width + x) * size, to = (y * width + x) * 4;
      if (palette) {
        const p = (raw[from] - mapFirst) * entry;
        rgba[to] = palette[p + 2];
        rgba[to + 1] = palette[p + 1];
        rgba[to + 2] = palette[p];
        rgba[to + 3] = entry === 4 ? palette[p + 3] : 255;
        continue;
      }
      if (size === 1) rgba.fill(raw[from], to, to + 3);
      else {
        rgba[to] = raw[from + 2];
        rgba[to + 1] = raw[from + 1];
        rgba[to + 2] = raw[from];
      }
      rgba[to + 3] = size === 4 ? raw[from + 3] : 255;
    }
  }
  return { width, height, rgba };
}

/**
 * A tangent-space normal map as PNG, without the height some Quake maps keep
 * in alpha. The source maps already use glTF's convention (green up).
 */
async function normalPng({ width, height, rgba }) {
  return sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().png().toBuffer();
}

/** A glTF metallic-roughness map (roughness in green, metal in blue) from a gloss map's brightness. */
async function roughnessPng({ width, height, rgba }) {
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const gloss = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    const roughness = ROUGHNESS_DULL + (ROUGHNESS_GLOSSY - ROUGHNESS_DULL) * gloss;
    out[i * 3] = 255;
    out[i * 3 + 1] = Math.round(roughness * 255);
    out[i * 3 + 2] = 0;
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/**
 * Add normal and roughness maps from `bank` (a lower-cased path → bytes lookup
 * of the source package) to the materials named after their texture path, and
 * re-encode every texture as WebP. Returns the GLB and what it added.
 */
export async function buildRuntimeWeaponGlb(bytes, bank) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'sharp': sharp });
  const document = await io.readBinary(bytes);
  const added = [];
  for (const material of document.getRoot().listMaterials()) {
    const key = material.getName().toLowerCase();
    if (!key.startsWith('models/')) continue;
    const norm = bank(`${key}_norm.tga`);
    if (norm && !material.getNormalTexture()) {
      const texture = document.createTexture(`${key}_norm`).setMimeType('image/png')
        .setImage(await normalPng(decodeTga(norm)));
      material.setNormalTexture(texture);
      added.push(`${key}_norm`);
    }
    const gloss = bank(`${key}_gloss.tga`);
    if (gloss && !material.getMetallicRoughnessTexture()) {
      const texture = document.createTexture(`${key}_roughness`).setMimeType('image/png')
        .setImage(await roughnessPng(decodeTga(gloss)));
      material.setMetallicRoughnessTexture(texture).setRoughnessFactor(1).setMetallicFactor(0);
      added.push(`${key}_gloss`);
    }
  }
  const resize = [MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE];
  await document.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize, slots: /^normalTexture$/, quality: NORMAL_QUALITY }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize, slots: /^(?!normalTexture$)/, quality: COLOR_QUALITY }),
    // Solid-colour glow and emit maps stay textures: the renderer finds glowing parts by their texture
    prune({ keepSolidTextures: true }),
  );
  return { bytes: Buffer.from(await io.writeBinary(document)), added };
}

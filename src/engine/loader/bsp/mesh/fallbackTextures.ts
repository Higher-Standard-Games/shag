import { Constants } from "@babylonjs/core/Engines/constants";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

/** Cache for generated fallback textures */
const fallbackTextureCache: Map<string, RawTexture> = new Map();

/**
 * Create a radial gradient texture for additive halos/flares.
 * White center fading to transparent edges.
 */
export function createRadialGradientTexture(scene: Scene, size: number = 64): RawTexture {
  const cacheKey = `radial_${size}`;
  if (fallbackTextureCache.has(cacheKey)) {
    return fallbackTextureCache.get(cacheKey)!;
  }

  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  const maxDist = center;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, 1 - dist / maxDist);
      const smoothAlpha = alpha * alpha;

      const idx = (y * size + x) * 4;
      data[idx + 0] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.floor(smoothAlpha * 255);
    }
  }

  const texture = new RawTexture(
    data,
    size,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.hasAlpha = true;
  texture.name = "fallback_radial_gradient";

  fallbackTextureCache.set(cacheKey, texture);
  console.log("[BspMeshBuilder] Created fallback radial gradient texture");
  return texture;
}

/**
 * Create a solid color texture ($whiteimage, $blackimage).
 */
export function createSolidColorTexture(scene: Scene, r: number, g: number, b: number, a: number = 255): RawTexture {
  const cacheKey = `solid_${r}_${g}_${b}_${a}`;
  if (fallbackTextureCache.has(cacheKey)) {
    return fallbackTextureCache.get(cacheKey)!;
  }

  const size = 8;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }

  const texture = new RawTexture(
    data,
    size,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
  );
  texture.hasAlpha = a < 255;
  texture.name = `fallback_solid_${r}_${g}_${b}`;

  fallbackTextureCache.set(cacheKey, texture);
  return texture;
}

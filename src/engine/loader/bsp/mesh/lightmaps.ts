import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { q3ToBabylon } from "./coordinates";

/** Qfusion scales and hue-normalizes baked vertex RGB, leaving opacity untouched. */
export function scaleBspVertexColors(colors: number[], gain: number): number[] {
  return colors.map((value, i) => {
    if (i % 4 === 3) return value;
    const start = i - (i % 4);
    const peak = Math.max(1, colors[start] * gain, colors[start + 1] * gain, colors[start + 2] * gain);
    return (value * gain) / peak;
  });
}

/** Keep authored alpha while removing a second baked RGB lighting factor. */
export function neutralizeFallbackVertexRgb(mesh: Mesh): void {
  if (mesh.metadata?.usesVertexRgb || mesh.metadata?.preserveVertexLighting) return;
  const source = mesh.getVerticesData(VertexBuffer.ColorKind);
  if (!source || mesh.metadata?.bakedVertexRgbNeutralized) return;
  const colors = Float32Array.from(source);
  for (let i = 0; i < colors.length; i += 4) colors[i] = colors[i + 1] = colors[i + 2] = 1;
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, false);
  mesh.metadata ??= {};
  mesh.metadata.bakedVertexRgbNeutralized = true;
}

/** One page's RGBA, written into `rgba` from `offset`: the baked-light encoding every lightmap texture uses. */
function writeBspLightmapRgba(
  rgb: Uint8Array,
  size: number,
  raw: boolean,
  direction: boolean,
  rgba: Uint8Array,
  offset = 0,
): void {
  for (let i = 0; i < size * size; i++) {
    const o = offset + i * 4;
    // FBSP keeps authored bytes; IBSP retains its legacy transfer curve.
    rgba[o] = raw ? rgb[i * 3] : Math.min(255, (rgb[i * 3] / 255) ** 0.7 * 255 * 2);
    rgba[o + 1] = raw ? rgb[i * 3 + 1] : Math.min(255, (rgb[i * 3 + 1] / 255) ** 0.7 * 255 * 2);
    rgba[o + 2] = raw ? rgb[i * 3 + 2] : Math.min(255, (rgb[i * 3 + 2] / 255) ** 0.7 * 255 * 2);
    rgba[o + 3] = 255;
    if (direction) {
      const converted = q3ToBabylon(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      rgba.set(converted, o);
    }
  }
}

/** The same baked-light encoding for static world surfaces and inline movers. */
export function createBspLightmapTexture(
  rgb: Uint8Array,
  size: number,
  scene: Scene,
  name: string,
  raw = false,
  direction = false,
): RawTexture {
  const rgba = new Uint8Array(size * size * 4);
  writeBspLightmapRgba(rgb, size, raw, direction, rgba);
  const texture = RawTexture.CreateRGBATexture(rgba, size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = name;
  if (raw) texture.gammaSpace = false;
  return texture;
}

/**
 * Several lightmap pages as the layers of one texture, in page order, with the
 * encoding `createBspLightmapTexture` gives one page. Surfaces on different
 * pages can then share a mesh and a draw.
 */
export function createBspLightmapArray(
  pages: readonly Uint8Array[],
  size: number,
  scene: Scene,
  name: string,
  raw = false,
  direction = false,
): RawTexture2DArray {
  const layer = size * size * 4;
  const rgba = new Uint8Array(layer * pages.length);
  pages.forEach((rgb, i) => {
    writeBspLightmapRgba(rgb, size, raw, direction, rgba, i * layer);
  });
  const texture = new RawTexture2DArray(
    rgba,
    size,
    size,
    pages.length,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.name = name;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  if (raw) texture.gammaSpace = false;
  return texture;
}

/** A white lightmap: keeps Babylon's lightmap path (and its UV) for surfaces whose light comes from a layered page. */
export function createWhiteLightmap(scene: Scene): RawTexture {
  const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false);
  texture.name = "lightmap_white";
  return texture;
}

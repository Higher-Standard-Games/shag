import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
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
  for (let j = 0; j < size * size; j++) {
    // FBSP keeps authored bytes; IBSP retains its legacy transfer curve.
    rgba[j * 4] = raw ? rgb[j * 3] : Math.min(255, (rgb[j * 3] / 255) ** 0.7 * 255 * 2);
    rgba[j * 4 + 1] = raw ? rgb[j * 3 + 1] : Math.min(255, (rgb[j * 3 + 1] / 255) ** 0.7 * 255 * 2);
    rgba[j * 4 + 2] = raw ? rgb[j * 3 + 2] : Math.min(255, (rgb[j * 3 + 2] / 255) ** 0.7 * 255 * 2);
    rgba[j * 4 + 3] = 255;
    if (direction) {
      const converted = q3ToBabylon(rgb[j * 3], rgb[j * 3 + 1], rgb[j * 3 + 2]);
      rgba.set(converted, j * 4);
    }
  }
  const texture = RawTexture.CreateRGBATexture(rgba, size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = name;
  if (raw) texture.gammaSpace = false;
  return texture;
}

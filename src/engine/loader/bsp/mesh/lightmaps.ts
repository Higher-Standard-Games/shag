import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

/** The same baked-light encoding for static world surfaces and inline movers. */
export function createBspLightmapTexture(rgb: Uint8Array, size: number, scene: Scene, name: string): RawTexture {
  const rgba = new Uint8Array(size * size * 4);
  for (let j = 0; j < size * size; j++) {
    // Preserve the world's established gamma/overbright treatment.
    rgba[j * 4] = Math.min(255, (rgb[j * 3] / 255) ** 0.7 * 255 * 2);
    rgba[j * 4 + 1] = Math.min(255, (rgb[j * 3 + 1] / 255) ** 0.7 * 255 * 2);
    rgba[j * 4 + 2] = Math.min(255, (rgb[j * 3 + 2] / 255) ** 0.7 * 255 * 2);
    rgba[j * 4 + 3] = 255;
  }
  const texture = RawTexture.CreateRGBATexture(rgba, size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = name;
  return texture;
}

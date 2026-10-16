import { Constants } from "@babylonjs/core/Engines/constants";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { SphericalPolynomial } from "@babylonjs/core/Maths/sphericalPolynomial";
import type { Scene } from "@babylonjs/core/scene";

/** A small neutral reflection fill for the first-person blade's metallic surface. */
export function createBladeEnvironment(scene: Scene): RawCubeTexture {
  const size = 16;
  const faces = Array.from({ length: 6 }, (_, face) => {
    const bytes = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (2 * (x + 0.5)) / size - 1;
        const v = 1 - (2 * (y + 0.5)) / size;
        const dirs = [
          [1, v, -u],
          [-1, v, u],
          [u, 1, -v],
          [u, -1, v],
          [u, v, 1],
          [-u, v, -1],
        ];
        const d = dirs[face];
        const height = d[1] / Math.hypot(...d);
        const value = Math.round(255 * (0.2 + 0.4 * (height * 0.5 + 0.5)));
        bytes.set([value, value, value, 255], (y * size + x) * 4);
      }
    }
    return bytes;
  });
  const cube = new RawCubeTexture(
    scene,
    faces,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  cube.name = "blade-reflection-fill";
  cube.coordinatesMode = Texture.CUBIC_MODE;
  cube.gammaSpace = false;
  cube.linearSpecularLOD = true;
  cube.lodGenerationScale = 1;
  cube.lodGenerationOffset = 0;
  // Metal needs specular reflection; direct/hemispheric lights supply diffuse.
  cube.sphericalPolynomial = new SphericalPolynomial();
  return cube;
}

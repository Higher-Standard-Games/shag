/**
 * Materials for the textured 3D preview, one per shader, owned by the
 * editor's scene. A material shows a flat colour at once and gains its image
 * when the decode lands, so the preview never waits on a texture. This is a
 * plain diffuse preview of the image a shader draws, not the gameplay shader
 * pipeline: no stages, blends or animation.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { TextureEntry } from "./TextureCatalog";

export interface PreviewTextureDeps {
  /** A package file's bytes, or null when it isn't mounted. */
  readFile(path: string): Promise<ArrayBuffer | null>;
  /** RGBA pixels, top row first. */
  decode(path: string, bytes: ArrayBuffer): Promise<{ pixels: Uint8Array; width: number; height: number } | null>;
}

/** Shown while an image decodes, and kept when there is none to draw. */
const PENDING = new Color3(0.42, 0.47, 0.52);
/** A shader whose image isn't in any package: the game will draw it wrong too. */
const MISSING = new Color3(0.85, 0.1, 0.75);
/** Fog volumes and colour shaders draw no image. */
const NO_IMAGE = new Color3(0.3, 0.55, 0.7);

export class PreviewTextures {
  private readonly materials = new Map<string, StandardMaterial>();
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly deps: PreviewTextureDeps,
  ) {}

  /** The shader's material, created on first use; `entry` is its catalog entry, if the catalog has one. */
  material(shader: string, entry: TextureEntry | undefined): StandardMaterial {
    const key = shader.toLowerCase();
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new StandardMaterial(`shagged-preview-${key}`, this.scene);
    material.specularColor = Color3.Black();
    // Face winding flips between Quake and Babylon handedness; the preview draws both sides.
    material.backFaceCulling = false;
    material.diffuseColor = !entry || entry.missing ? MISSING : entry.image ? PENDING : NO_IMAGE;
    this.materials.set(key, material);
    if (entry?.image && !entry.missing) void this.load(material, entry.image, entry.transparent);
    return material;
  }

  private async load(material: StandardMaterial, path: string, transparent: boolean): Promise<void> {
    try {
      const bytes = await this.deps.readFile(path);
      const decoded = bytes && !this.disposed ? await this.deps.decode(path, bytes) : null;
      if (!decoded || this.disposed) return;
      const texture = new RawTexture(
        decoded.pixels,
        decoded.width,
        decoded.height,
        Constants.TEXTUREFORMAT_RGBA,
        this.scene,
        true,
        false,
        Texture.TRILINEAR_SAMPLINGMODE,
      );
      texture.name = path;
      texture.wrapU = Texture.WRAP_ADDRESSMODE;
      texture.wrapV = Texture.WRAP_ADDRESSMODE;
      if (transparent) {
        texture.hasAlpha = true;
        material.useAlphaFromDiffuseTexture = false;
      }
      material.diffuseColor = Color3.White();
      material.diffuseTexture = texture;
    } catch (error) {
      console.warn(`[SHAGGED] preview texture ${path} failed`, error);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const material of this.materials.values()) material.dispose(false, true);
    this.materials.clear();
  }
}

/** Package bytes from PK3Loader, decoded and capped by TexturePixels. */
export async function browserPreviewDeps(): Promise<PreviewTextureDeps> {
  const [{ PK3Loader }, { previewPixels }] = await Promise.all([
    import("../loader/pk3/PK3Loader"),
    import("./TexturePixels"),
  ]);
  const loader = PK3Loader.getInstance();
  return { readFile: (path) => loader.getFile(path), decode: previewPixels };
}

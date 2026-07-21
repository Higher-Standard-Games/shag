/**
 * AreaLightPanel — a Babylon 9 textured rectangular area light (POC / building
 * block). Proves out "any image as a light source" for our sci-fi aesthetic:
 * glowing wall signs, LED panels, holo-screens, monitor glow — physically
 * emitted onto nearby surfaces.
 *
 * Research + integration plan: docs/research/BABYLON9_AREA_VOLUMETRIC_LIGHTS.md
 *
 * Key Babylon-9 facts baked in here:
 *  - `RectAreaLight` emits from a width×height rectangle in its local −Z. We
 *    orient it by parenting to an anchor node aimed with `lookAt`.
 *  - The emission texture MUST be pre-processed by `AreaLightTextureTools`
 *    (progressive-blur mip pyramid for the LTC evaluation) before assignment.
 *  - Area lights use LTC lookup textures fetched from Babylon's CDN; we vendor
 *    them and redirect via `localizeBabylonAssetUrls()` (no-CDN posture).
 *  - Area lights are NOT clustered (ClusteredLightContainer only accepts
 *    point/spot), so each one occupies a real `maxSimultaneousLights` slot on
 *    lit surfaces — budget them like the sun/ambient, not like pooled glows.
 *
 * Side-effect import registers the RectAreaLight type (same pattern as the
 * outline/physics scene components — without it the light silently no-ops).
 */

import "@babylonjs/core/Lights/rectAreaLight";
import { RectAreaLight } from "@babylonjs/core/Lights/rectAreaLight";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AreaLightTextureTools } from "@babylonjs/core/Misc/areaLightsTextureTools";
import type { Scene } from "@babylonjs/core/scene";
import { localizeBabylonAssetUrls } from "./AreaLightAssets";

export interface AreaLightPanelOptions {
  name: string;
  /** World position of the rectangle's center. */
  position: Vector3;
  /** Direction the panel emits toward (into the room). Default −Z world. */
  faceDir?: Vector3;
  width: number;
  height: number;
  intensity?: number;
  /** Tint (multiplies the emission texture; the panel's base color if untextured). */
  color?: Color3;
  /**
   * Image projected as the light. Loaded then pre-processed via
   * AreaLightTextureTools. Omit for a flat rectangular emitter.
   */
  emissionTextureUrl?: string;
  /**
   * A ready-made source texture to project (e.g. a `DynamicTexture`). Takes
   * precedence over `emissionTextureUrl`. Pre-processed the same way; the panel
   * does NOT take ownership of the source (caller disposes it).
   */
  emissionSource?: BaseTexture;
}

export class AreaLightPanel {
  readonly light: RectAreaLight;
  private readonly anchor: TransformNode;
  private sourceTexture: Texture | null = null;
  private emissionTexture: BaseTexture | null = null;
  private disposed = false;

  constructor(scene: Scene, opts: AreaLightPanelOptions) {
    // Ensure the LTC lookup data resolves to our vendored copy, not the CDN.
    localizeBabylonAssetUrls();

    // Orient by parenting to an anchor aimed so the light's local −Z (its
    // emission axis) points along faceDir: looking at (pos − faceDir) puts the
    // anchor's +Z on −faceDir, hence −Z on +faceDir.
    const faceDir = (opts.faceDir ?? new Vector3(0, 0, -1)).normalizeToNew();
    this.anchor = new TransformNode(`${opts.name}_anchor`, scene);
    this.anchor.position.copyFrom(opts.position);
    this.anchor.lookAt(opts.position.subtract(faceDir));

    this.light = new RectAreaLight(opts.name, Vector3.Zero(), opts.width, opts.height, scene);
    this.light.parent = this.anchor;
    this.light.intensity = opts.intensity ?? 1;
    if (opts.color) this.light.diffuse = opts.color.clone();

    if (opts.emissionSource) {
      void this.preprocessAndAssign(scene, opts.emissionSource, false);
    } else if (opts.emissionTextureUrl) {
      void this.applyEmissionTextureUrl(scene, opts.emissionTextureUrl);
    }
  }

  /** Load an image URL, then pre-process + assign it. Owns the loaded texture. */
  private async applyEmissionTextureUrl(scene: Scene, url: string): Promise<void> {
    let src!: Texture;
    await new Promise<void>((resolve, reject) => {
      src = new Texture(
        url,
        scene,
        true, // no mipmaps (the tool builds its own blur pyramid)
        false,
        undefined,
        () => resolve(),
        (message) => reject(new Error(`[AreaLightPanel] emission texture failed: ${url} (${message})`)),
      );
    });
    if (this.disposed) {
      src.dispose();
      return;
    }
    this.sourceTexture = src; // owned — disposed with the panel
    await this.preprocessAndAssign(scene, src, true);
  }

  /**
   * Run a source texture through AreaLightTextureTools and set it as the
   * emission texture. `ownsSource` toggles whether the panel disposes the source.
   */
  private async preprocessAndAssign(scene: Scene, source: BaseTexture, ownsSource: boolean): Promise<void> {
    if (ownsSource) this.sourceTexture = source as Texture;
    const tools = new AreaLightTextureTools(scene.getEngine());
    try {
      const processed = await tools.processAsync(source);
      if (this.disposed || !processed) {
        processed?.dispose();
        return;
      }
      this.light.emissionTexture = processed;
      this.emissionTexture = processed;
    } finally {
      tools.dispose();
    }
  }

  /** Move the panel (center) and re-aim it. */
  setPose(position: Vector3, faceDir?: Vector3): void {
    this.anchor.position.copyFrom(position);
    const dir = (faceDir ?? new Vector3(0, 0, -1)).normalizeToNew();
    this.anchor.lookAt(position.subtract(dir));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.emissionTexture?.dispose();
    this.sourceTexture?.dispose();
    this.light.dispose();
    this.anchor.dispose();
  }
}

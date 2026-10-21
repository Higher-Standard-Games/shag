/**
 * Camera-scoped, half-resolution world colour for Epic water transmission, and
 * the depth of the same capture, so Epic needs no separate depth pass.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

export class WaterRefractionProvider {
  private map: RenderTargetTexture | null = null;
  private camera: Camera | null = null;
  private unavailable = false;
  private readonly candidates: AbstractMesh[] = [];
  private depth: BaseTexture | null = null;
  private depthSource: InternalTexture | null = null;
  private ceiling: number | null = null;

  constructor(private readonly scene: Scene) {}

  mapFor(camera: Camera): RenderTargetTexture | null {
    if (this.unavailable) return null;
    const engine = this.scene.getEngine();
    const size = {
      width: Math.max(1, Math.floor(engine.getRenderWidth(true) / 2)),
      height: Math.max(1, Math.floor(engine.getRenderHeight(true) / 2)),
    };
    if (this.camera === camera && this.map) {
      const current = this.map.getSize();
      if (current.width !== size.width || current.height !== size.height) this.map.resize(size);
      return this.map;
    }
    this.release();
    try {
      const caps = this.scene.getEngine().getCaps();
      // Float capture avoids clipping linear HDR lighting before image processing.
      const type =
        caps.textureHalfFloatRender && caps.textureHalfFloatLinearFiltering
          ? Constants.TEXTURETYPE_HALF_FLOAT
          : Constants.TEXTURETYPE_UNSIGNED_BYTE;
      // Babylon's reflection-oriented ratio sizing rounds each axis to a power
      // of two. Screen refraction needs the actual viewport aspect ratio.
      const map = new RenderTargetTexture("water-scene-colour", size, this.scene, {
        generateMipMaps: false,
        type,
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
        generateDepthBuffer: true,
        generateStencilBuffer: false,
      });
      // A sampleable depth buffer instead of a render buffer, made again after
      // every resize, which rebuilds the target without it. Float depth is not
      // filterable in WebGL2, so it is read nearest. A device that cannot make
      // one keeps its render buffer, and water falls back to the depth pass.
      const withDepth = () => {
        try {
          map.createDepthStencilTexture(
            0,
            false,
            false,
            1,
            Constants.TEXTUREFORMAT_DEPTH32_FLOAT,
            "water-scene-colour-depth",
          );
        } catch (error) {
          console.warn("[Water] No depth texture for the colour capture; using the depth pass", error);
        }
      };
      withDepth();
      map.onResizeObservable.add(withDepth);
      this.map = map;
      this.camera = camera;
      map.activeCamera = camera;
      map.useCameraPostProcesses = false;
      map.ignoreCameraViewport = false;
      map.renderParticles = false;
      map.renderSprites = false;
      map.forceLayerMaskCheck = true;
      map.renderList = null;
      map.getCustomRenderList = (_pass, list, length) => {
        this.candidates.length = 0;
        for (let i = 0; list && i < length; i++) {
          const mesh = list[i];
          if (!mesh?.isEnabled() || !mesh.isVisible || mesh.visibility <= 0) continue;
          if (mesh.metadata?.liquidKind || mesh.metadata?.effectOwned || mesh.metadata?.excludeFromWaterCapture)
            continue;
          if (mesh.layerMask & 0x10000000) continue;
          if (this.ceiling !== null && mesh.getBoundingInfo().boundingBox.minimumWorld.y > this.ceiling) continue;
          // Opaque and alpha-tested world geometry only: never recursively
          // sample water, or duplicate muzzle flashes / translucent particles.
          if (mesh.material?.needAlphaBlendingForMesh(mesh)) continue;
          this.candidates.push(mesh);
        }
        return this.candidates;
      };
      // Bind-time colour-space metadata follows the world material pipeline.
      map.onBeforeBindObservable.add(() => {
        const processing = this.scene.imageProcessingConfiguration;
        map.gammaSpace = !(processing.isEnabled && processing.applyByPostProcess);
      });
      this.setRendering(true);
      return map;
    } catch (error) {
      this.release();
      this.unavailable = true;
      console.warn("[Water] Refraction unavailable; using transparent water", error);
      return null;
    }
  }

  /**
   * The capture's own depth buffer, null when there is none. It holds the
   * projection's depth, not view-space Z, and is rebuilt with the target.
   */
  depthTexture(): BaseTexture | null {
    const source = this.map?.depthStencilTexture ?? null;
    if (source !== this.depthSource) {
      // Made on the engine, not the scene: the target owns the texture, and a
      // wrapper the scene disposed would release it under the target
      this.depth = source ? new BaseTexture(this.scene.getEngine(), source) : null;
      this.depthSource = source;
    }
    return this.depth;
  }

  /**
   * Meshes wholly above this height are left out of the capture: seen from
   * above a flat surface, the water shows only what lies below it. null
   * captures everything.
   */
  setCaptureCeiling(height: number | null): void {
    this.ceiling = height;
  }

  setRendering(enabled: boolean): void {
    if (!this.map || !this.camera) return;
    const targets = this.camera.customRenderTargets;
    const index = targets.indexOf(this.map);
    if (enabled && index < 0) targets.push(this.map);
    else if (!enabled && index >= 0) targets.splice(index, 1);
  }

  private release(): void {
    this.setRendering(false);
    this.depth = null;
    this.depthSource = null;
    this.map?.dispose();
    this.map = null;
    this.camera = null;
  }

  dispose(): void {
    this.release();
    this.unavailable = false;
  }
}

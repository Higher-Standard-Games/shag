import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Material } from "@babylonjs/core/Materials/material";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import type { Scene } from "@babylonjs/core/scene";

const providers = new WeakMap<Scene, Q3SoftParticleDepth>();
const WEAPON_LAYER = 0x10000000;

/** A camera-owned view-Z capture, independent of outline and water encodings. */
export class Q3SoftParticleDepth {
  private readonly materials = new Set<Material>();
  private renderer: DepthRenderer | null = null;
  private camera: Camera | null = null;
  private unavailable = false;
  readonly fallback: RawTexture;
  private readonly observer;

  static acquire(material: Material): Q3SoftParticleDepth {
    const scene = material.getScene();
    let provider = providers.get(scene);
    if (!provider) {
      provider = new Q3SoftParticleDepth(scene);
      providers.set(scene, provider);
    }
    provider.materials.add(material);
    material.onDisposeObservable.addOnce(() => {
      provider.materials.delete(material);
      if (!provider.materials.size) provider.dispose();
    });
    return provider;
  }

  private constructor(private readonly scene: Scene) {
    this.fallback = RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 255]), 1, 1, scene, false, false);
    this.observer = scene.onBeforeCameraRenderObservable.add((camera) => this.prepare(camera));
  }

  private prepare(camera: Camera): void {
    if ((camera.layerMask & WEAPON_LAYER) !== 0) return;
    const visible = this.scene.meshes.some(
      (mesh) =>
        mesh.material &&
        this.materials.has(mesh.material) &&
        mesh.isVisible &&
        mesh.isEnabled() &&
        (mesh.layerMask & camera.layerMask) !== 0 &&
        camera.isInFrustum(mesh),
    );
    if (!visible || this.unavailable) {
      this.setRendering(false);
      return;
    }
    if (this.camera === camera) {
      this.setRendering(true);
      return;
    }
    this.release();
    const caps = this.scene.getEngine().getCaps();
    const type = caps.textureHalfFloatRender
      ? Constants.TEXTURETYPE_HALF_FLOAT
      : caps.textureFloatRender
        ? Constants.TEXTURETYPE_FLOAT
        : null;
    if (type === null) {
      this.unavailable = true;
      return;
    }
    const renderer = new DepthRenderer(
      this.scene,
      type,
      camera,
      false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      true,
      "q3-soft-depth",
    );
    const map = renderer.getDepthMap();
    map.renderList = null;
    map.forceLayerMaskCheck = true;
    map.getCustomRenderList = (_pass, list, length) =>
      (list ?? [])
        .slice(0, length)
        .filter(
          (mesh) =>
            mesh.isVisible &&
            mesh.isEnabled() &&
            !mesh.infiniteDistance &&
            (mesh.layerMask & WEAPON_LAYER) === 0 &&
            !this.materials.has(mesh.material!),
        );
    // DepthRenderer excludes alpha-blended submeshes and retains alpha-tested cutouts.
    camera.customRenderTargets.push(map);
    this.renderer = renderer;
    this.camera = camera;
  }

  mapFor(camera: Camera | null): Texture | null {
    const map = this.renderer?.getDepthMap();
    return map && camera && camera === this.camera && camera.customRenderTargets.includes(map) ? map : null;
  }

  private setRendering(enabled: boolean): void {
    if (!this.renderer) return;
    const map = this.renderer.getDepthMap();
    const targets = this.camera!.customRenderTargets;
    const index = targets.indexOf(map);
    if (enabled && index === -1) targets.push(map);
    else if (!enabled && index !== -1) targets.splice(index, 1);
  }

  private release(): void {
    if (!this.renderer) return;
    const map = this.renderer.getDepthMap();
    const targets = this.camera!.customRenderTargets;
    const index = targets.indexOf(map);
    if (index !== -1) targets.splice(index, 1);
    map.dispose();
    this.renderer.dispose();
    this.renderer = null;
    this.camera = null;
  }

  private dispose(): void {
    this.scene.onBeforeCameraRenderObservable.remove(this.observer);
    this.release();
    this.fallback.dispose();
    providers.delete(this.scene);
  }
}

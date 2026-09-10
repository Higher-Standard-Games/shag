/**
 * One tightly-budgeted planar reflection for the loaded map.
 *
 * A mirror is a complete scene submission, so the budget is deliberately one
 * horizontal plane, quarter resolution, every third frame, and only while a
 * water mesh was actually drawn by the player's camera. All other surfaces use
 * the environment cubemap rather than multiplying render targets per pool.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { MirrorTexture } from "@babylonjs/core/Materials/Textures/mirrorTexture";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

const MIRROR_RATIO = 0.25;
const MIRROR_REFRESH_RATE = 3;
const WEAPON_LAYER_MASK = 0x10000000;

export class WaterReflection {
  private mirror: MirrorTexture | null = null;
  private planeY: number | null = null;
  private failed = false;
  /** Reused filtered view of Babylon's already-PVS/frustum-culled active list. */
  private readonly reflectedMeshes: AbstractMesh[] = [];

  constructor(private readonly scene: Scene) {}

  /** Choose the largest approximately-horizontal water footprint. */
  static choosePlaneY(surfaces: readonly AbstractMesh[]): number | null {
    let bestArea = 0;
    let bestY: number | null = null;

    for (const mesh of surfaces) {
      const box = mesh.getBoundingInfo().boundingBox;
      const size = box.maximumWorld.subtract(box.minimumWorld);
      const footprint = size.x * size.z;
      const horizontalTolerance = Math.max(2, Math.min(size.x, size.z) * 0.05);

      // MirrorTexture only represents a horizontal plane. A waterfall or a
      // steeply sloped patch keeps the cubemap rather than reflecting through
      // a plane that does not match its geometry.
      if (size.x <= 0 || size.z <= 0 || size.y > horizontalTolerance) continue;
      if (footprint <= bestArea) continue;

      bestArea = footprint;
      bestY = (box.minimumWorld.y + box.maximumWorld.y) * 0.5;
    }

    return bestY;
  }

  textureFor(camera: Camera, planeY: number): MirrorTexture | null {
    if (this.failed) return null;

    if (!this.mirror || this.planeY !== planeY) {
      this.release();
      if (!this.build(planeY)) return null;
    }

    if (this.mirror) this.mirror.activeCamera = camera;
    return this.mirror;
  }

  private build(planeY: number): boolean {
    try {
      const mirror = new MirrorTexture("water-planar-reflection", { ratio: MIRROR_RATIO }, this.scene, false);
      mirror.mirrorPlane = new Plane(0, -1, 0, planeY);
      mirror.adaptiveBlurKernel = 0;
      mirror.refreshRate = MIRROR_REFRESH_RATE;
      mirror.renderParticles = false;
      mirror.renderSprites = false;
      mirror.forceLayerMaskCheck = true;

      // renderListPredicate scans scene.meshes and turns the result into an
      // explicit render list. Babylon does not frustum-cull that path, so the
      // first implementation re-submitted the whole BSP. Filter the engine's
      // already active/PVS/frustum-culled list instead.
      mirror.renderList = null;
      mirror.getCustomRenderList = (_layer, renderList, renderListLength) => {
        this.reflectedMeshes.length = 0;
        if (!renderList) return this.reflectedMeshes;

        for (let i = 0; i < renderListLength; i++) {
          const mesh = renderList[i];
          if (mesh && this.shouldReflect(mesh)) this.reflectedMeshes.push(mesh);
        }
        return this.reflectedMeshes;
      };

      this.scene.customRenderTargets.push(mirror);
      this.mirror = mirror;
      this.planeY = planeY;
      return true;
    } catch (error) {
      console.warn("[Water] Planar reflection unavailable; using the environment reflection", error);
      this.failed = true;
      return false;
    }
  }

  private shouldReflect(mesh: AbstractMesh): boolean {
    if (!mesh.isVisible || !mesh.isEnabled()) return false;
    if (mesh.metadata?.liquidKind) return false;
    // Procedural muzzle flashes, rails and voltaic arcs are screen-facing HDR
    // quads. Capturing them produces a second, displaced "ghost" of every
    // shot in the water sample and makes the mirror prepare transient shaders.
    if (mesh.metadata?.effectOwned) return false;
    if (mesh.metadata?.excludeFromWaterCapture) return false;
    if ((mesh.layerMask & WEAPON_LAYER_MASK) !== 0) return false;
    return true;
  }

  setRendering(enabled: boolean): void {
    if (!this.mirror) return;
    const index = this.scene.customRenderTargets.indexOf(this.mirror);
    if (enabled && index === -1) this.scene.customRenderTargets.push(this.mirror);
    else if (!enabled && index !== -1) this.scene.customRenderTargets.splice(index, 1);
  }

  get isRendering(): boolean {
    return this.mirror !== null && this.scene.customRenderTargets.indexOf(this.mirror) !== -1;
  }

  get reflectedY(): number | null {
    return this.planeY;
  }

  private release(): void {
    this.reflectedMeshes.length = 0;
    if (!this.mirror) return;
    const index = this.scene.customRenderTargets.indexOf(this.mirror);
    if (index !== -1) this.scene.customRenderTargets.splice(index, 1);
    this.mirror.dispose();
    this.mirror = null;
    this.planeY = null;
  }

  dispose(): void {
    this.release();
    this.failed = false;
  }
}

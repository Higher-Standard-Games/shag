/**
 * Planar reflection for the largest pool in the map.
 *
 * Until now the surface reflected one constant colour — a stand-in for a sky
 * that most Q3 pools cannot see, because they are indoors. That is why the
 * Fresnel term had to be capped: reflecting a single bright colour at grazing
 * angles turns the far half of a pool into a sheet of white. Reflecting the
 * ROOM instead is what lets the Fresnel do what Fresnel actually does.
 *
 * `MirrorTexture` renders the scene from the camera reflected through a plane,
 * with the same projection — which is what makes it samplable at the
 * fragment's own screen coordinate, no reprojection needed.
 *
 * ONE mirror, for one height. A map with pools on three floors gets a
 * reflection on the biggest of them and the flat sky colour on the rest, which
 * is a deliberate budget rather than an oversight: each mirror is a full pass
 * over the world, and reflections are the least load-bearing thing here. The
 * chosen plane is the one the player is most likely to be standing at.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { MirrorTexture } from "@babylonjs/core/Materials/Textures/mirrorTexture";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { EXCLUDE_FROM_WATER_CAPTURE } from "./WaterSceneCapture";

/**
 * Resolution of the reflection, as a fraction of the render size.
 *
 * Lower than the refraction capture. A reflection is seen at a glancing angle
 * through a wave-distorted normal and is mixed in at a fraction of the final
 * colour, so it survives being soft far better than the refraction does.
 */
const MIRROR_RATIO = 0.35;

/** The viewmodel camera's layer. The weapon does not appear in the pool. */
const WEAPON_LAYER_MASK = 0x10000000;

export class WaterReflection {
  private mirror: MirrorTexture | null = null;
  private planeY: number | null = null;
  private failed = false;

  constructor(private readonly scene: Scene) {}

  /**
   * Choose the plane to reflect: the largest liquid surface handed in.
   *
   * By area rather than by any notion of importance, because area is what
   * decides how much of the screen the reflection can ever occupy — and it is
   * the one property available without knowing anything about the map.
   */
  static choosePlaneY(surfaces: readonly AbstractMesh[]): number | null {
    let bestArea = 0;
    let bestY: number | null = null;

    for (const mesh of surfaces) {
      const box = mesh.getBoundingInfo().boundingBox;
      const size = box.maximumWorld.subtract(box.minimumWorld);
      const area = size.x * size.z;
      if (area > bestArea) {
        bestArea = area;
        // The TOP of the volume: a liquid brush is a box, and the surface the
        // player sees is its lid, not its middle.
        bestY = box.maximumWorld.y;
      }
    }

    return bestY;
  }

  /**
   * The reflection for this camera, or null if there is nothing to reflect.
   *
   * Rebuilt only when the plane moves, which in practice means once per map.
   */
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
      const mirror = new MirrorTexture("water-reflection", { ratio: MIRROR_RATIO }, this.scene, false);

      // Babylon's convention for a horizontal mirror: the normal points DOWN
      // and the displacement is the height. Getting the sign wrong here does
      // not fail — it reflects the room through the floor instead of through
      // the water, which looks like a reflection until you move.
      mirror.mirrorPlane = new Plane(0, -1, 0, planeY);

      // Softened deliberately. A mirror-sharp reflection on a rippling surface
      // reads as ice; blurring it is what makes it read as a wet one.
      mirror.adaptiveBlurKernel = 16;

      mirror.renderList = [];
      mirror.renderListPredicate = (mesh: AbstractMesh) => this.shouldReflect(mesh);

      this.scene.customRenderTargets.push(mirror);
      this.mirror = mirror;
      this.planeY = planeY;
      return true;
    } catch (error) {
      console.warn("[Water] Planar reflection unavailable; keeping the flat sky colour", error);
      this.failed = true;
      return false;
    }
  }

  /**
   * The room, and nothing that belongs to the water itself.
   *
   * Liquid is excluded for the same reason it is excluded from the refraction
   * capture — a mirror that can see the water reflects the water reflecting
   * the water. Spray is excluded because it sits above the surface and would
   * appear in the reflection as a second crown hanging under the pool.
   */
  private shouldReflect(mesh: AbstractMesh): boolean {
    if (!mesh.isVisible || !mesh.isEnabled()) return false;
    if (mesh.metadata?.liquidKind) return false;
    if (mesh.metadata?.[EXCLUDE_FROM_WATER_CAPTURE]) return false;
    if ((mesh.layerMask & WEAPON_LAYER_MASK) !== 0) return false;
    return true;
  }

  /** Height of the reflected plane, or null. Tests and diagnostics only. */
  get reflectedY(): number | null {
    return this.planeY;
  }

  private release(): void {
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

/**
 * A copy of the world behind the water, for refraction.
 *
 * Tinting what is behind a surface makes coloured glass. BENDING it is what
 * makes water — it is the single strongest cue the eye has, stronger than
 * colour, waves or foam, and until now the surface had none of it.
 *
 * Doing it properly means the shader has to sample the background itself
 * rather than leaving it to the hardware blend, because a blend can only mix
 * the pixel that is *directly* behind — which is the one place refraction says
 * you should NOT be looking. So the opaque world is rendered once more into a
 * texture the water shader can sample at an offset.
 *
 * That costs a second pass over the world geometry, which is why it is gated
 * to the Epic tier. Half resolution: the sample is being deliberately smeared
 * by a wave normal, so the detail would be thrown away anyway.
 *
 * The water must not appear in its own capture — it would sample itself, and
 * each frame would compound the last. `renderListPredicate` rebuilds the list
 * from `scene.meshes` every render, so meshes that appear mid-map (players,
 * projectiles, gibs) are included without anything having to register them.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Fraction of the render size to capture at.
 *
 * The result is sampled through a wave-distorted offset, so anything sharper
 * is detail that gets destroyed on the way in. A quarter of the pixels.
 */
const CAPTURE_RATIO = 0.5;

/** The viewmodel camera's layer. The weapon is not behind the water. */
const WEAPON_LAYER_MASK = 0x10000000;

/**
 * Meshes tagged with this are kept out of the capture.
 *
 * Splash spray is the reason it exists: droplets live ABOVE the surface, so
 * including them would show the crown a second time, refracted, underneath the
 * pool it was thrown from.
 */
export const EXCLUDE_FROM_WATER_CAPTURE = "excludeFromWaterCapture";

export class WaterSceneCapture {
  private texture: RenderTargetTexture | null = null;
  private failed = false;

  constructor(private readonly scene: Scene) {}

  /**
   * The capture for the camera rendering this frame, or null.
   *
   * The camera is re-pointed rather than the target rebuilt — unlike the depth
   * pass, an RTT can simply be told which camera to render from, so a switch
   * to the death or spectate camera costs nothing here.
   */
  textureFor(camera: Camera): RenderTargetTexture | null {
    if (this.failed) return null;

    if (!this.texture) {
      if (!this.build()) return null;
    }

    if (this.texture) this.texture.activeCamera = camera;
    return this.texture;
  }

  private build(): boolean {
    try {
      const rtt = new RenderTargetTexture(
        "water-scene-capture",
        { ratio: CAPTURE_RATIO },
        this.scene,
        // No mipmaps: sampled once, at one level, through an offset.
        false,
      );

      // Rebuilt from scene.meshes every render, so nothing has to register.
      rtt.renderListPredicate = (mesh: AbstractMesh) => this.shouldCapture(mesh);

      this.scene.customRenderTargets.push(rtt);
      this.texture = rtt;
      return true;
    } catch (error) {
      console.warn("[Water] Scene capture unavailable; water will not refract", error);
      this.failed = true;
      return false;
    }
  }

  /**
   * Everything solid behind the water, and nothing else.
   *
   * Three exclusions, each for its own reason: liquid surfaces would sample
   * themselves and compound frame over frame; the viewmodel is not behind
   * anything; and spray is above the water rather than under it.
   */
  private shouldCapture(mesh: AbstractMesh): boolean {
    if (!mesh.isVisible || !mesh.isEnabled()) return false;
    if (mesh.metadata?.liquidKind) return false;
    if (mesh.metadata?.[EXCLUDE_FROM_WATER_CAPTURE]) return false;
    if ((mesh.layerMask & WEAPON_LAYER_MASK) !== 0) return false;
    return true;
  }

  /**
   * Start or stop rendering, without tearing the target down.
   *
   * A capture only earns its cost while water is actually on screen, and in a
   * Q3 map that is a small fraction of the time. Registration in
   * `customRenderTargets` is what decides whether the scene renders it, so
   * removing it there is a complete stop — no pass, no cost — while keeping
   * the texture allocated so walking back to the pool does not rebuild it.
   */
  setRendering(enabled: boolean): void {
    if (!this.texture) return;

    const index = this.scene.customRenderTargets.indexOf(this.texture);
    if (enabled && index === -1) this.scene.customRenderTargets.push(this.texture);
    else if (!enabled && index !== -1) this.scene.customRenderTargets.splice(index, 1);
  }

  /** Whether the scene is currently rendering this. Tests and diagnostics. */
  get isRendering(): boolean {
    return this.texture !== null && this.scene.customRenderTargets.indexOf(this.texture) !== -1;
  }

  get isAvailable(): boolean {
    return this.texture !== null;
  }

  dispose(): void {
    if (this.texture) {
      const index = this.scene.customRenderTargets.indexOf(this.texture);
      if (index !== -1) this.scene.customRenderTargets.splice(index, 1);
      this.texture.dispose();
      this.texture = null;
    }
    this.failed = false;
  }
}

/**
 * The scene depth water reads its thickness from.
 *
 * This exists because `scene.enableDepthRenderer()` cannot be shared safely.
 * It caches one renderer per camera and returns the cached one **with its
 * original settings**, silently discarding the arguments of every later caller:
 *
 *   if (!this._depthRenderer[camera.uniqueId]) { ...create with your args... }
 *   return this._depthRenderer[camera.uniqueId];
 *
 * Water needs camera-space Z in world units; the cel outline pass needs the
 * default clip-space metric. Whoever asks first decides for both, and the loser
 * gets an encoding it will misread — for water that means reading a 0..1 metric
 * as world units, which does not fail, it just quietly stops varying with
 * depth. Worse, `disableDepthRenderer()` would then tear down a renderer the
 * other consumer is still using.
 *
 * So water owns its own `DepthRenderer` and registers the target itself. It
 * costs one more depth pass when both are enabled, which is the honest price of
 * two passes wanting two different encodings.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import type { Scene } from "@babylonjs/core/scene";

/** Matches the default `scene.enableDepthRenderer` used before this existed. */
const SAMPLING_MODE = Constants.TEXTURE_TRILINEAR_SAMPLINGMODE;

/** The viewmodel camera layer. The weapon is not part of the world. */
const WEAPON_LAYER_MASK = 0x10000000;

export class WaterDepthProvider {
  private renderer: DepthRenderer | null = null;
  private camera: Camera | null = null;
  /** null once we know this device cannot give us a usable depth format. */
  private unavailable = false;

  constructor(private readonly scene: Scene) {}

  /**
   * The depth map for the camera rendering this frame, or null.
   *
   * Takes the camera every call rather than resolving one at construction: the
   * active camera changes constantly in play — death cam, spectate, freefly,
   * the round-end focus — and a depth map belonging to a camera that is no
   * longer rendering describes a view nobody is looking through. The surface
   * would keep shading against it while the shader's own camera position moved
   * on, which is wrong in a way that still renders.
   */
  mapFor(camera: Camera): Texture | null {
    if (this.unavailable) return null;
    if (this.renderer && this.camera === camera) return this.renderer.getDepthMap();

    this.release();

    const type = this.depthTextureType();
    if (type === null) {
      // An 8-bit target cannot hold a world-space distance; it would clamp
      // every pool deeper than one unit. Better no depth term at all than a
      // saturated one, so the surface falls back to its uniform look.
      console.warn("[Water] No float depth target on this device; water will not be depth-tinted");
      this.unavailable = true;
      return null;
    }

    try {
      const renderer = new DepthRenderer(this.scene, type, camera, false, SAMPLING_MODE, true, "water-scene-depth");
      const map = renderer.getDepthMap();

      // An EXPLICIT list, rather than DepthRenderer's default of null.
      //
      // Null means "whatever is in scene.getActiveMeshes()", and that list is
      // rewritten by every render target that draws — including water's own
      // refraction capture and mirror, which run in the same phase and
      // deliberately exclude liquid. Depending on it made the depth pass draw
      // an unpredictable subset, and where it drew nothing the map keeps its
      // clear value: with storeCameraSpaceZ that clear is 0.0, so thickness
      // computes as max(0, 0 - viewDepth) = ZERO.
      //
      // Zero thickness is the white-plaster look exactly — no absorption at
      // any coefficient, and full shoreline foam across the whole pool. It is
      // also why raising absorption five-fold changed nothing.
      map.renderListPredicate = (mesh: AbstractMesh) => this.shouldRender(mesh);

      // Ours to render: the scene component's gather step only walks the
      // cameras in `scene._depthRenderer`, and this deliberately is not one.
      this.scene.customRenderTargets.push(map);
      this.renderer = renderer;
      this.camera = camera;
      return renderer.getDepthMap();
    } catch (error) {
      console.warn("[Water] Depth renderer unavailable; water will not be depth-tinted", error);
      this.unavailable = true;
      return null;
    }
  }

  /**
   * The world the water measures its thickness against.
   *
   * Liquid is excluded because the gap between the surface and what is BEHIND
   * it is the whole quantity — a surface that appears in its own depth map
   * measures zero. Babylon already skips it, since the material declares alpha
   * blending and the depth pass drops transparent submeshes, but stating it
   * here means the exclusion does not depend on that staying true.
   *
   * The viewmodel is excluded because it is not in the world.
   */
  private shouldRender(mesh: AbstractMesh): boolean {
    if (!mesh.isVisible || !mesh.isEnabled()) return false;
    if (mesh.metadata?.liquidKind) return false;
    if ((mesh.layerMask & WEAPON_LAYER_MASK) !== 0) return false;
    return true;
  }

  /**
   * Half-float if the device renders it, full float otherwise, null if neither.
   *
   * The same order `enableDepthRenderer` uses, minus its unsigned-byte
   * fallback, which is unusable for a value measured in world units.
   */
  private depthTextureType(): number | null {
    const caps = this.scene.getEngine().getCaps();
    if (caps.textureHalfFloatRender) return Constants.TEXTURETYPE_HALF_FLOAT;
    if (caps.textureFloatRender) return Constants.TEXTURETYPE_FLOAT;
    return null;
  }

  /** Drop the current renderer and unregister its target. */
  private release(): void {
    if (!this.renderer) return;

    const map = this.renderer.getDepthMap();
    const index = this.scene.customRenderTargets.indexOf(map);
    if (index !== -1) this.scene.customRenderTargets.splice(index, 1);

    this.renderer.dispose();
    this.renderer = null;
    this.camera = null;
  }

  dispose(): void {
    this.release();
    this.unavailable = false;
  }

  /** Which camera the current map belongs to. Tests and diagnostics only. */
  get boundCamera(): Camera | null {
    return this.camera;
  }
}

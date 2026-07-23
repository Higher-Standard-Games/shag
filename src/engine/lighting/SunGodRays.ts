/**
 * SunGodRays — Babylon 9 volumetric light scattering (god rays / light shafts)
 * as a self-contained, tunable building block for our sci-fi maps.
 *
 * Research + integration plan: docs/research/BABYLON9_AREA_VOLUMETRIC_LIGHTS.md
 *
 * What it does: a `VolumetricLightScatteringPostProcess` radially smears a bright
 * source (the sun, or a fixed emitter) outward in screen space, occluded by scene
 * geometry — so a wall/grate/window between the camera and the source carves the
 * classic shaft silhouette. Two modes:
 *
 *  - `"sun"`     — the source tracks the camera at a large distance along the sun
 *                  direction (from `SkyLightSystem` or an explicit vector), so it
 *                  behaves like a sun at infinity. Sky shafts through windows.
 *  - `"anchored"`— the source sits at a fixed world position (a bright ceiling
 *                  light, a portal, an energy conduit). Localized shafts.
 *
 * Key Babylon-9 facts baked in here:
 *  - The effect is a `PostProcess` bound to ONE camera; only one full-screen VLS
 *    pass is cheap, so we run a single instance (sun OR one anchored source), not
 *    a per-light swarm. True per-light/brush-volume volumetrics are the WebGPU
 *    frame-graph path (deferred — see the research doc).
 *  - The side-effect import registers the post-process + its shaders (same
 *    pattern as the outline/physics/area-light regressions this cycle — without
 *    it the class is unregistered and the effect silently no-ops).
 *  - `dispose(camera)` takes the camera to detach from; we hold that reference.
 *  - The radial center is the source mesh's projected screen position, so we just
 *    move an emissive billboard and the rays follow it.
 */

import "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
import type { Scene } from "@babylonjs/core/scene";

export type GodRaysMode = "sun" | "anchored";

export interface SunGodRaysOptions {
  /** "sun" (tracks the camera along a direction) or "anchored" (fixed position). */
  mode?: GodRaysMode;
  /**
   * Direction the sunlight travels (points FROM the sun TOWARD the scene, i.e.
   * a `DirectionalLight.direction`). The source sits opposite, along −direction.
   * Sun mode only. Defaults to a low forward-down vector if omitted.
   */
  direction?: Vector3;
  /** Fixed world position of the emitter. Anchored mode only. */
  anchor?: Vector3;
  /** How far along −direction to place the sun (sun mode). Large = "at infinity". */
  distance?: number;
  /** World size of the glowing source billboard. */
  size?: number;
  /** Tint of the source glow (and thus the shafts). */
  color?: Color3;
  /** Post-process quality (radial taps). Budget by quality tier. Default 60. */
  samples?: number;
  /** Overall intensity of the effect [0..1-ish]. Default 0.3. */
  exposure?: number;
  /** Per-sample falloff [0..1]. Default 0.965. */
  decay?: number;
  /** Per-sample weight. Default 0.5. */
  weight?: number;
  /** Sample density. Default 0.9. */
  density?: number;
  /**
   * Meshes to exclude from the internal (occlusion) pass — they render as empty
   * so they DON'T block the source. The skybox belongs here in sun mode: we want
   * shafts to fill the visible sky and be carved only by solid world geometry.
   */
  excludedMeshes?: AbstractMesh[];
}

const DEFAULT_DIRECTION = new Vector3(-0.5, -1, -0.2);

export class SunGodRays {
  readonly postProcess: VolumetricLightScatteringPostProcess;
  readonly source: Mesh;

  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly mode: GodRaysMode;
  private readonly distance: number;
  private direction: Vector3;
  private anchor: Vector3;
  private glow: DynamicTexture | null = null;
  private trackObserver: Observer<Scene> | null = null;
  private disposed = false;

  constructor(scene: Scene, camera: Camera, opts: SunGodRaysOptions = {}) {
    this.scene = scene;
    this.camera = camera;
    this.mode = opts.mode ?? "sun";
    this.distance = opts.distance ?? 6000;
    this.direction = (opts.direction ?? DEFAULT_DIRECTION).normalizeToNew();
    this.anchor = opts.anchor?.clone() ?? Vector3.Zero();

    // Bright emissive billboard = the thing the rays radiate from.
    this.source = this.buildSourceMesh(scene, opts.size ?? 220, opts.color ?? new Color3(1, 0.96, 0.85));

    this.postProcess = new VolumetricLightScatteringPostProcess(
      "sunGodRays",
      1.0,
      camera,
      this.source,
      opts.samples ?? 60,
      Texture.BILINEAR_SAMPLINGMODE,
      scene.getEngine(),
    );
    this.postProcess.exposure = opts.exposure ?? 0.3;
    this.postProcess.decay = opts.decay ?? 0.965;
    this.postProcess.weight = opts.weight ?? 0.5;
    this.postProcess.density = opts.density ?? 0.9;
    if (opts.excludedMeshes?.length) {
      this.postProcess.excludedMeshes = opts.excludedMeshes.slice();
    }

    this.positionSource();
    // In sun mode the source must follow the camera each frame to stay at
    // "infinity"; anchored mode is static, so no per-frame work is needed.
    if (this.mode === "sun") {
      this.trackObserver = scene.onBeforeRenderObservable.add(() => this.positionSource());
    }
  }

  /** Aim the sun (sun mode). `direction` travels from the sun toward the scene. */
  setDirection(direction: Vector3): void {
    this.direction = direction.normalizeToNew();
    this.positionSource();
  }

  /** Move the emitter (anchored mode). */
  setAnchor(position: Vector3): void {
    this.anchor = position.clone();
    this.positionSource();
  }

  /** Exclude meshes from the occlusion pass so they don't block the source. */
  setExcludedMeshes(meshes: AbstractMesh[]): void {
    this.postProcess.excludedMeshes = meshes.slice();
  }

  private positionSource(): void {
    if (this.disposed) return;
    if (this.mode === "anchored") {
      this.source.position.copyFrom(this.anchor);
      return;
    }
    // Sun: place the source far along −direction from the active camera so it
    // reads as a fixed sun and is occluded by everything nearer.
    const cam = this.scene.activeCamera ?? this.camera;
    const away = this.direction.scale(-this.distance);
    this.source.position.copyFrom(cam.position).addInPlace(away);
  }

  private buildSourceMesh(scene: Scene, size: number, color: Color3): Mesh {
    const mesh = CreatePlane("godray_source", { size }, scene);
    mesh.billboardMode = 7; // BILLBOARDMODE_ALL — always face the camera.
    mesh.isPickable = false;
    mesh.infiniteDistance = false;
    mesh.doNotSyncBoundingInfo = true;

    const mat = new StandardMaterial("godray_source_mat", scene);
    mat.disableLighting = true;
    mat.emissiveColor = color.clone();
    const glow = this.buildGlowTexture(scene, color);
    if (glow) {
      mat.emissiveTexture = glow;
      mat.opacityTexture = glow; // round off the square corners
    }
    mat.backFaceCulling = false;
    mesh.material = mat;
    return mesh;
  }

  /**
   * Soft radial gradient (white-hot core → transparent edge) = a sun disc/glow.
   * Needs a 2D canvas; degrades to a flat emissive color where none exists
   * (NullEngine/headless), which never renders anyway.
   */
  private buildGlowTexture(scene: Scene, color: Color3): DynamicTexture | null {
    let tex: DynamicTexture;
    try {
      const s = 256;
      tex = new DynamicTexture("godray_glow", { width: s, height: s }, scene, false);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0.0, "rgba(255,255,255,1)");
      grad.addColorStop(0.25, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.6, `rgba(${r},${g},${b},0.35)`);
      grad.addColorStop(1.0, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      tex.hasAlpha = true;
      tex.update();
    } catch {
      return null;
    }
    this.glow = tex;
    return tex;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.trackObserver) {
      this.scene.onBeforeRenderObservable.remove(this.trackObserver);
      this.trackObserver = null;
    }
    // VLS.dispose() needs the camera it was attached to.
    this.postProcess.dispose(this.camera);
    this.source.material?.dispose();
    this.glow?.dispose();
    this.source.dispose();
  }
}

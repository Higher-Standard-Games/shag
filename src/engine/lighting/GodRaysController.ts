/**
 * GodRaysController — single owner of the one active volumetric-light-scattering
 * pass (SunGodRays). VLS is a full-screen post-process, so exactly one instance
 * runs at a time; both the `godrays` console command and BSP worldspawn keys
 * drive the effect through here rather than each holding their own instance.
 *
 * Integration paths (docs/research/BABYLON9_AREA_VOLUMETRIC_LIGHTS.md):
 *  - Sun / sky shafts: `enableSun()` reads the live sun direction from
 *    SkyLightSystem and excludes the skybox, so the sky reads as open and only
 *    solid world geometry carves the shafts. This is the "sun entity / sky
 *    shader" path — a BSP map opts in via a worldspawn `godrays` key.
 *  - Localized emitter: `enableAnchored()` fixes the source at a world point (a
 *    bright lamp / portal). Screen-space VLS is one pass, so this is one dominant
 *    emitter, not a per-light swarm — true per-brush volumetrics are the WebGPU
 *    frame-graph task (deferred).
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { BspManager } from "../loader/bsp/BspManager";
import { SkyLightSystem } from "./SkyLightSystem";
import { SunGodRays, type SunGodRaysOptions } from "./SunGodRays";

export class GodRaysController {
  private static instance: GodRaysController;

  /** Clear the cached singleton so a fresh scene re-inits cleanly (QA-WO13 pattern). */
  static resetInstance(): void {
    GodRaysController.instance?.disable();
    GodRaysController.instance = null as unknown as GodRaysController;
  }

  static getInstance(): GodRaysController {
    if (!GodRaysController.instance) {
      GodRaysController.instance = new GodRaysController();
    }
    return GodRaysController.instance;
  }

  private rays: SunGodRays | null = null;

  isEnabled(): boolean {
    return this.rays !== null;
  }

  /** Sun shafts tracking the SkyLightSystem sun (skybox excluded from occlusion). */
  enableSun(scene: Scene, camera: Camera, opts: Partial<SunGodRaysOptions> = {}): SunGodRays {
    this.disable();
    const sunDir = SkyLightSystem.getInstance().getSunLight()?.direction;
    this.rays = new SunGodRays(scene, camera, {
      mode: "sun",
      direction: sunDir ? sunDir.clone() : new Vector3(-0.5, -1, -0.2),
      color: new Color3(1, 0.95, 0.82),
      exposure: 0.32,
      decay: 0.965,
      weight: 0.5,
      density: 0.92,
      excludedMeshes: this.findSkyMeshes(scene),
      ...opts,
    });
    return this.rays;
  }

  /** A fixed god-ray emitter at a world position (a bright lamp / portal). */
  enableAnchored(scene: Scene, camera: Camera, anchor: Vector3, opts: Partial<SunGodRaysOptions> = {}): SunGodRays {
    this.disable();
    this.rays = new SunGodRays(scene, camera, {
      mode: "anchored",
      anchor,
      color: new Color3(0.6, 0.85, 1),
      exposure: 0.35,
      weight: 0.6,
      ...opts,
    });
    return this.rays;
  }

  disable(): void {
    this.rays?.dispose();
    this.rays = null;
  }

  /**
   * Read god-ray settings from the loaded BSP worldspawn and activate sun shafts
   * if opted in. Called at BSP map-load (next to SkyLightSystem.loadFromWorldspawn).
   *
   * Worldspawn keys (all optional except the enable):
   *   godrays          "1" to enable sun shafts
   *   godrays_color    "r g b" (0-1 or 0-255) tint
   *   godrays_exposure  overall intensity (default 0.32)
   *   godrays_decay     per-sample falloff (default 0.965)
   *   godrays_weight    per-sample weight (default 0.5)
   *   godrays_density   sample density (default 0.92)
   *   godrays_samples   radial taps / quality (default 60)
   */
  loadFromWorldspawn(scene: Scene, camera: Camera): boolean {
    let bsp: BspManager;
    try {
      bsp = BspManager.getInstance();
    } catch {
      return false;
    }
    if (!bsp.isLoaded()) return false;
    if (bsp.getWorldspawnProperty("godrays") !== "1") return false;

    const opts: Partial<SunGodRaysOptions> = {};
    const color = this.parseColor(bsp.getWorldspawnProperty("godrays_color"));
    if (color) opts.color = color;
    const exposure = this.parseNum(bsp.getWorldspawnProperty("godrays_exposure"));
    if (exposure !== undefined) opts.exposure = exposure;
    const decay = this.parseNum(bsp.getWorldspawnProperty("godrays_decay"));
    if (decay !== undefined) opts.decay = decay;
    const weight = this.parseNum(bsp.getWorldspawnProperty("godrays_weight"));
    if (weight !== undefined) opts.weight = weight;
    const density = this.parseNum(bsp.getWorldspawnProperty("godrays_density"));
    if (density !== undefined) opts.density = density;
    const samples = this.parseNum(bsp.getWorldspawnProperty("godrays_samples"));
    if (samples !== undefined) opts.samples = Math.round(samples);

    this.enableSun(scene, camera, opts);
    console.log("[GodRaysController] Sun god rays enabled from worldspawn", opts);
    return true;
  }

  private parseNum(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const n = parseFloat(raw);
    return Number.isNaN(n) ? undefined : n;
  }

  private parseColor(raw: string | undefined): Color3 | undefined {
    if (!raw) return undefined;
    const p = raw.split(/\s+/).map(parseFloat);
    if (p.length < 3 || p.some((c) => Number.isNaN(c))) return undefined;
    const scale = p.some((c) => c > 1.0) ? 1 / 255 : 1;
    return new Color3(p[0] * scale, p[1] * scale, p[2] * scale);
  }

  /** Skybox meshes must not occlude the sun in the internal pass. */
  private findSkyMeshes(scene: Scene): AbstractMesh[] {
    return scene.meshes.filter((m) => /sky/i.test(m.name));
  }
}

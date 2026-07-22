/**
 * GodRaysController — single owner of the one active volumetric-light-scattering
 * pass (SunGodRays). VLS is a full-screen post-process, so exactly one instance
 * runs at a time; the `godrays` console command, the `r_godrays*` cvars, and BSP
 * map entities all drive the effect through here.
 *
 * Map hooks (docs/research/BABYLON9_AREA_VOLUMETRIC_LIGHTS.md), in priority order
 * at load (`loadFromWorldspawn`):
 *  1. **Warsow/Q3 sun entity** — a targeted `sun`/`_sun` light authored in the
 *     map (`resolveMapSunDirection`); shafts follow the map's real sun.
 *  2. **worldspawn `godrays "1"`** — sun shafts along the engine's SkyLightSystem
 *     sun, with optional per-map look override keys.
 *  3. **`light_volumetric`** — a mapper-placed anchored emitter (one active; VLS
 *     is one pass).
 *
 * The look is the `r_godrays_*` cvars (persisted, live-tunable); per-map keys and
 * entities override at activation. `r_godrays` is a master gate (0 disables).
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { BspManager } from "../loader/bsp/BspManager";
import RenderVars from "../rendering/RenderVars";
import { parseEntityColor, resolveMapSunDirection, resolveVolumetricEmitters } from "./MapGodRayEntities";
import { SkyLightSystem } from "./SkyLightSystem";
import { SunGodRays, type SunGodRaysOptions } from "./SunGodRays";

const DEFAULT_SUN_DIR = new Vector3(-0.5, -1, -0.2);

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
  private unsubs: (() => void)[] = [];

  isEnabled(): boolean {
    return this.rays !== null;
  }

  /** Sun shafts tracking a sun direction (skybox excluded from occlusion). */
  enableSun(scene: Scene, camera: Camera, opts: Partial<SunGodRaysOptions> = {}): SunGodRays {
    this.disable();
    const sunDir = SkyLightSystem.getInstance().getSunLight()?.direction?.clone() ?? DEFAULT_SUN_DIR.clone();
    this.rays = new SunGodRays(scene, camera, {
      mode: "sun",
      direction: sunDir,
      color: new Color3(1, 0.95, 0.82),
      excludedMeshes: this.findSkyMeshes(scene),
      ...this.tuning(),
      ...opts, // caller (map sun direction / worldspawn overrides) wins
    });
    this.attachTuningListeners();
    return this.rays;
  }

  /** A fixed god-ray emitter at a world position (a bright lamp / portal). */
  enableAnchored(scene: Scene, camera: Camera, anchor: Vector3, opts: Partial<SunGodRaysOptions> = {}): SunGodRays {
    this.disable();
    this.rays = new SunGodRays(scene, camera, {
      mode: "anchored",
      anchor,
      color: new Color3(0.6, 0.85, 1),
      ...this.tuning(),
      ...opts,
    });
    this.attachTuningListeners();
    return this.rays;
  }

  disable(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.rays?.dispose();
    this.rays = null;
  }

  /**
   * Activate god rays for the loaded BSP map (called at map load, next to
   * SkyLightSystem.loadFromWorldspawn). Priority: sun entity → worldspawn key →
   * light_volumetric. Master-gated by `r_godrays`.
   */
  loadFromWorldspawn(scene: Scene, camera: Camera): boolean {
    if ((RenderVars.getInstance().get("r_godrays") ?? 1) < 0.5) {
      this.disable();
      return false;
    }

    let bsp: BspManager;
    try {
      bsp = BspManager.getInstance();
    } catch {
      return false;
    }
    if (!bsp.isLoaded()) return false;

    const entities = bsp.getRawEntities();

    // 1. Warsow/Q3 sun entity → shafts along the map's authored sun.
    const sunDir = resolveMapSunDirection(entities);
    if (sunDir) {
      this.enableSun(scene, camera, { direction: sunDir });
      console.log("[GodRaysController] Sun god rays from map sun entity");
      return true;
    }

    // 2. worldspawn `godrays "1"` (+ optional look overrides) → SkyLightSystem sun.
    if (bsp.getWorldspawnProperty("godrays") === "1") {
      this.enableSun(scene, camera, this.worldspawnOverrides(bsp));
      console.log("[GodRaysController] Sun god rays from worldspawn godrays key");
      return true;
    }

    // 3. light_volumetric point entity → one anchored emitter (VLS is one pass).
    const emitters = resolveVolumetricEmitters(entities);
    if (emitters.length > 0) {
      const e = emitters[0];
      const opts: Partial<SunGodRaysOptions> = {};
      if (e.color) opts.color = e.color;
      if (e.exposure !== undefined) opts.exposure = e.exposure;
      if (e.size !== undefined) opts.size = e.size;
      this.enableAnchored(scene, camera, e.position, opts);
      console.log(`[GodRaysController] Anchored god rays from light_volumetric (${emitters.length} present, 1 active)`);
      return true;
    }

    this.disable();
    return false;
  }

  // ── internals ──

  /** The live look, read from the `r_godrays_*` cvars. */
  private tuning(): Partial<SunGodRaysOptions> {
    const rv = RenderVars.getInstance();
    return {
      exposure: rv.get("r_godrays_exposure"),
      decay: rv.get("r_godrays_decay"),
      weight: rv.get("r_godrays_weight"),
      density: rv.get("r_godrays_density"),
      samples: Math.round(rv.get("r_godrays_samples") ?? 60),
    };
  }

  /** Live-apply exposure/decay/weight/density cvar edits to the active pass. */
  private applyTuning(): void {
    if (!this.rays) return;
    const rv = RenderVars.getInstance();
    const pp = this.rays.postProcess;
    pp.exposure = rv.get("r_godrays_exposure") ?? pp.exposure;
    pp.decay = rv.get("r_godrays_decay") ?? pp.decay;
    pp.weight = rv.get("r_godrays_weight") ?? pp.weight;
    pp.density = rv.get("r_godrays_density") ?? pp.density;
  }

  private attachTuningListeners(): void {
    const rv = RenderVars.getInstance();
    const apply = () => this.applyTuning();
    this.unsubs = [
      rv.onChange("r_godrays_exposure", apply),
      rv.onChange("r_godrays_decay", apply),
      rv.onChange("r_godrays_weight", apply),
      rv.onChange("r_godrays_density", apply),
      rv.onChange("r_godrays", (v) => {
        if (v < 0.5) this.disable();
      }),
    ];
  }

  /** Per-map worldspawn look overrides (take precedence over the cvar look). */
  private worldspawnOverrides(bsp: BspManager): Partial<SunGodRaysOptions> {
    const opts: Partial<SunGodRaysOptions> = {};
    const color = parseEntityColor(bsp.getWorldspawnProperty("godrays_color"));
    if (color) opts.color = color;
    const num = (key: string): number | undefined => {
      const raw = bsp.getWorldspawnProperty(key);
      if (raw === undefined) return undefined;
      const n = Number.parseFloat(raw);
      return Number.isNaN(n) ? undefined : n;
    };
    const exposure = num("godrays_exposure");
    if (exposure !== undefined) opts.exposure = exposure;
    const decay = num("godrays_decay");
    if (decay !== undefined) opts.decay = decay;
    const weight = num("godrays_weight");
    if (weight !== undefined) opts.weight = weight;
    const density = num("godrays_density");
    if (density !== undefined) opts.density = density;
    const samples = num("godrays_samples");
    if (samples !== undefined) opts.samples = Math.round(samples);
    return opts;
  }

  /** Skybox meshes must not occlude the sun in the internal pass. */
  private findSkyMeshes(scene: Scene): AbstractMesh[] {
    return scene.meshes.filter((m) => /sky/i.test(m.name));
  }
}

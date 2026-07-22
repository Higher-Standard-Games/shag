/**
 * AreaLightManager — owns the textured area lights for the loaded BSP map.
 *
 * Area lights (RectAreaLight) turn a mapper-placed `light_area` entity into a
 * physically-emitting panel — a glowing sign/screen actually lighting the room
 * (docs/research/BABYLON9_AREA_VOLUMETRIC_LIGHTS.md). Unlike the pooled/clustered
 * dynamic lights, area lights are NOT clustered: each consumes a real per-surface
 * `maxSimultaneousLights` slot, and BSP world meshes are texture-grouped
 * (map-wide), so mesh-scoping can't localize them. The only safe lever is COUNT —
 * so the manager caps the number of panels (`r_arealights_max`) and the whole
 * feature is master-gated by `r_arealights`.
 *
 * Emissive-surface auto-placement (spawning panels from the brightest emissive
 * Q3 surfaces) is a documented follow-up: it needs per-face surface extraction
 * and is budget-hostile at scale, so it stays capped/deferred.
 */

import type { Scene } from "@babylonjs/core/scene";
import { BspManager } from "../loader/bsp/BspManager";
import RenderVars from "../rendering/RenderVars";
import { AreaLightPanel } from "./AreaLightPanel";
import { type AreaLightSpec, resolveAreaLightEntities } from "./MapAreaLightEntities";

export class AreaLightManager {
  private static instance: AreaLightManager;

  /** Clear the cached singleton so a fresh scene re-inits cleanly (QA-WO13 pattern). */
  static resetInstance(): void {
    AreaLightManager.instance?.dispose();
    AreaLightManager.instance = null as unknown as AreaLightManager;
  }

  static getInstance(): AreaLightManager {
    if (!AreaLightManager.instance) {
      AreaLightManager.instance = new AreaLightManager();
    }
    return AreaLightManager.instance;
  }

  private panels: AreaLightPanel[] = [];

  isEnabled(): boolean {
    return this.panels.length > 0;
  }

  count(): number {
    return this.panels.length;
  }

  /**
   * Create panels from specs, capped at `cap` (area lights are budget-limited).
   * Replaces any existing panels. Returns the number created.
   */
  applySpecs(scene: Scene, specs: readonly AreaLightSpec[], cap: number): number {
    this.dispose();
    const capped = specs.slice(0, Math.max(0, Math.floor(cap)));
    for (const spec of capped) {
      this.panels.push(
        new AreaLightPanel(scene, {
          name: spec.name,
          position: spec.position,
          faceDir: spec.faceDir,
          width: spec.width,
          height: spec.height,
          intensity: spec.intensity,
          color: spec.color,
          emissionTextureUrl: spec.emissionTextureUrl,
        }),
      );
    }
    return this.panels.length;
  }

  /**
   * Read `light_area` entities from the loaded BSP and build the panels
   * (master-gated by `r_arealights`, capped by `r_arealights_max`). Called at
   * BSP map-load, next to the sky/god-ray worldspawn hooks.
   */
  loadFromMap(scene: Scene): number {
    const rv = RenderVars.getInstance();
    if ((rv.get("r_arealights") ?? 1) < 0.5) {
      this.dispose();
      return 0;
    }

    let bsp: BspManager;
    try {
      bsp = BspManager.getInstance();
    } catch {
      return 0;
    }
    if (!bsp.isLoaded()) return 0;

    const specs = resolveAreaLightEntities(bsp.getRawEntities());
    const cap = Math.round(rv.get("r_arealights_max") ?? 4);
    const created = this.applySpecs(scene, specs, cap);
    if (specs.length > 0) {
      console.log(`[AreaLightManager] ${created} area lights active (${specs.length} light_area entities, cap ${cap})`);
    }
    return created;
  }

  dispose(): void {
    for (const panel of this.panels) panel.dispose();
    this.panels = [];
  }
}

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

import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";
import { BspManager } from "../loader/bsp/BspManager";
import { Q3ShaderRegistry } from "../loader/shader/Q3ShaderRegistry";
import RenderVars from "../rendering/RenderVars";
import { AreaLightPanel } from "./AreaLightPanel";
import { type AreaLightSpec, resolveAreaLightEntities } from "./MapAreaLightEntities";
import { extractEmissiveSurfaces } from "./MapEmissiveSurfaces";

/** Default intensity for auto-placed area lights on surfaces with no light value. */
const AUTO_INTENSITY = 2;
/** A "typical" q3map_surfacelight value that maps to AUTO_INTENSITY. */
const SURFACELIGHT_REF = 300;

/** Map a shader surface-light strength to an area-light intensity (clamped). */
function autoIntensity(surfaceLight: number): number {
  if (surfaceLight <= 0) return AUTO_INTENSITY;
  return Math.min(6, Math.max(1, AUTO_INTENSITY * (surfaceLight / SURFACELIGHT_REF)));
}

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
    const intensityMul = RenderVars.getInstance().get("r_arealights_intensity") ?? 1;
    const capped = specs.slice(0, Math.max(0, Math.floor(cap)));
    for (const spec of capped) {
      this.panels.push(
        new AreaLightPanel(scene, {
          name: spec.name,
          position: spec.position,
          faceDir: spec.faceDir,
          width: spec.width,
          height: spec.height,
          intensity: spec.intensity * intensityMul,
          color: spec.color,
          emissionTextureUrl: spec.emissionTextureUrl,
          emissionSource: spec.emissionSource,
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

    // Explicit light_area entities rank first; auto-placed emissive surfaces
    // (opt-in) fill the remaining budget, largest signs first.
    const specs = resolveAreaLightEntities(bsp.getRawEntities());
    let autoCount = 0;
    if ((rv.get("r_arealights_auto") ?? 0) >= 0.5) {
      const bspFile = bsp.getLoadedBsp();
      if (bspFile) {
        const shaderReg = Q3ShaderRegistry.getInstance();
        const surfaces = extractEmissiveSurfaces(bspFile, (name) => {
          const p = shaderReg.resolveMaterialProps(name);
          const surfaceLight = p.surfaceLight ?? 0;
          return { emissive: p.isFullbright || surfaceLight > 0, surfaceLight };
        });
        for (const s of surfaces) {
          // Project the sign's own loaded texture so the emitted light carries
          // its colors/shape (not flat white). Falls back to a flat emitter.
          const emissionSource = this.resolveSurfaceTexture(scene, s.textureIndex) ?? undefined;
          specs.push({
            name: `light_area_auto_${autoCount++}`,
            position: s.position,
            faceDir: s.normal,
            width: s.width,
            height: s.height,
            // Brighter for surfaces the shader authored as stronger light emitters.
            intensity: autoIntensity(s.surfaceLight),
            emissionSource,
          });
        }
      }
    }

    const cap = Math.round(rv.get("r_arealights_max") ?? 4);
    const created = this.applySpecs(scene, specs, cap);
    if (specs.length > 0) {
      devLog(
        `[AreaLightManager] ${created} area lights active (${specs.length - autoCount} entities + ${autoCount} auto-emissive, cap ${cap})`,
      );
    }
    return created;
  }

  /**
   * Reuse a fullbright surface's already-loaded BSP texture (on its
   * `bsp_tex_<index>` mesh material) as the panel's emitter, so the projected
   * light carries the sign's own colors/shape. Null if not found/loaded.
   */
  private resolveSurfaceTexture(scene: Scene, textureIndex: number): BaseTexture | null {
    const mat = scene.getMeshByName(`bsp_tex_${textureIndex}`)?.material;
    if (!mat) return null;
    const m = mat as unknown as {
      diffuseTexture?: BaseTexture | null;
      emissiveTexture?: BaseTexture | null;
      albedoTexture?: BaseTexture | null;
    };
    return m.diffuseTexture ?? m.emissiveTexture ?? m.albedoTexture ?? null;
  }

  dispose(): void {
    for (const panel of this.panels) panel.dispose();
    this.panels = [];
  }
}

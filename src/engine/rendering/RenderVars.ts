/**
 * RenderVars - Runtime-configurable renderer variables
 *
 * Provides Q3/Warsow-style r_* console variables for tuning
 * material intensities, lighting, and visual settings.
 *
 * Values are persisted to localStorage and can be exported/imported
 * as config blocks.
 */

import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";
import { PostProcessingManager } from "../effects/PostProcessingManager";
import type { BspBakedLightingPlugin } from "../loader/bsp/BspBakedLightingPlugin";

// ==================== Babylon Property Helpers ====================
// Babylon.js objects don't expose all properties in their public TypeScript API.
// These helpers provide a single, centralized `any` cast for:
// 1. Stashing/restoring original values (e.g. `_originalBumpLevel`) on Babylon objects
// 2. Accessing runtime properties missing from type definitions (e.g. `wireframe`, `diffuseTexture`)

// biome-ignore lint/suspicious/noExplicitAny: Babylon objects used as generic property bags for stashing originals
type AnyRecord = Record<string, any>;

/** Get a stashed property from a Babylon object */
function getStashed<T>(obj: object, key: string): T | undefined {
  return (obj as AnyRecord)[key] as T | undefined;
}

/** Set a stashed property on a Babylon object */
function setStashed(obj: object, key: string, value: unknown): void {
  (obj as AnyRecord)[key] = value;
}

/** Delete a stashed property from a Babylon object */
function deleteStashed(obj: object, key: string): void {
  delete (obj as AnyRecord)[key];
}

/** Get a runtime property from a Babylon object (for untyped API access) */
function getProp<T>(obj: object, key: string): T | undefined {
  return (obj as AnyRecord)[key] as T | undefined;
}

/** Set a runtime property on a Babylon object (for untyped API access) */
function setProp(obj: object, key: string, value: unknown): void {
  (obj as AnyRecord)[key] = value;
}

// ==================== Types ====================

export interface RenderVar {
  name: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  description: string;
  category: "material" | "lighting" | "display" | "texture" | "debug";
}

export type RenderVarName =
  | "r_deluxe"
  | "r_bsp_pbr"
  | "r_normalmap"
  | "r_glossmap"
  | "r_lightmap"
  | "r_ambient"
  | "r_emissive"
  | "r_anisotropy"
  | "r_ktx2"
  | "r_webgpu"
  | "r_bsp_freeze"
  | "r_bsp_cellsize"
  | "r_godrays"
  | "r_godrays_exposure"
  | "r_godrays_decay"
  | "r_godrays_weight"
  | "r_godrays_density"
  | "r_godrays_samples"
  | "r_arealights"
  | "r_arealights_max"
  | "r_arealights_auto"
  | "r_arealights_intensity"
  | "r_wireframe"
  | "r_glow"
  | "r_ssr"
  | "r_ssr_strength"
  | "r_bloom"
  | "r_exposure"
  | "r_contrast"
  | "r_pickupProcedural"
  // Future vars (documented but not yet implemented)
  | "r_lightintensity"
  | "r_lightmapscale"
  | "r_underwater_distortion"
  | "r_water"
  | "r_water_quality"
  | "r_water_debug"
  | "r_water_highlights"
  | "r_water_roughness"
  | "r_water_reflection"
  | "r_water_blur"
  | "r_water_detail"
  | "r_water_contact"
  | "r_water_actors"
  | "r_water_probe_height"
  | "r_shadows"
  | "r_gamma"
  | "r_saturation"
  | "r_picmip"
  | "r_showtris"
  | "r_shownormals"
  | "r_showlightmaps"
  // Day/night cycle
  | "r_daynight"
  | "r_daynight_time"
  | "r_daynight_animate"
  | "r_daynight_speed"
  | "r_daynight_length"
  | "r_daynight_lm_min"
  | "r_daynight_lm_max"
  | "r_daynight_sun_intensity"
  | "r_daynight_moon_intensity"
  | "r_daynight_sky_tint";

// ==================== Constants ====================

const STORAGE_KEY = "engine.renderVars";

const DEFAULT_VARS: Record<string, Omit<RenderVar, "name">> = {
  // Material intensities (core 4)
  r_deluxe: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: "Use paired FBSP light directions and deluxe shader branches at next map load (0/1)",
    category: "material",
  },
  r_bsp_pbr: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: "Use generated PBR materials for rich BSP companion-map surfaces on next map/material build (0/1)",
    category: "material",
  },
  r_normalmap: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: "Normal/bump map intensity multiplier",
    category: "material",
  },
  r_glossmap: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: "Specular/gloss map intensity multiplier",
    category: "material",
  },
  r_lightmap: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: "Lightmap intensity multiplier",
    category: "material",
  },
  r_ambient: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: "Ambient light intensity multiplier",
    category: "lighting",
  },
  r_emissive: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: "Emissive/glow intensity multiplier",
    category: "material",
  },
  r_anisotropy: {
    value: 8,
    defaultValue: 8,
    min: 1,
    max: 16,
    description: "Anisotropic filtering level (1-16)",
    category: "texture",
  },
  r_picmip: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 8,
    description: "Map surface texture reduction (next map): 0 = full, 1 = half size, 8 = flat color.",
    category: "texture",
  },
  r_ktx2: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: "Prefer generated KTX2 texture sidecars when available (0/1). Applies on next texture load.",
    category: "texture",
  },
  r_webgpu: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description:
      "Experimental WebGPU renderer (restart required). Use ?renderer=webgpu while the compatibility gate is open.",
    category: "display",
  },
  r_bsp_freeze: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description:
      "Freeze world matrices + bounding info on static BSP world meshes (skips per-frame transform/bounds recompute). Applies on next map load (0/1).",
    category: "display",
  },
  r_bsp_cellsize: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 4096,
    description:
      "Experimental opaque BSP spatial grouping on next map load: 0 off; positive sizes clamp to 128-4096 map units. Try 1024, compare with PVS on.",
    category: "display",
  },
  // Volumetric god rays (see GodRaysController). Master gate + live-tunable look.
  r_godrays: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: "Master gate for volumetric god rays (0 disables; maps opt in via sun entity / worldspawn) (0/1)",
    category: "lighting",
  },
  r_godrays_exposure: {
    value: 0.32,
    defaultValue: 0.32,
    min: 0,
    max: 2,
    description: "God-ray overall intensity (live-tunes the active pass)",
    category: "lighting",
  },
  r_godrays_decay: {
    value: 0.965,
    defaultValue: 0.965,
    min: 0.5,
    max: 1,
    description: "God-ray per-sample falloff (live-tunes the active pass)",
    category: "lighting",
  },
  r_godrays_weight: {
    value: 0.5,
    defaultValue: 0.5,
    min: 0,
    max: 2,
    description: "God-ray per-sample weight (live-tunes the active pass)",
    category: "lighting",
  },
  r_godrays_density: {
    value: 0.92,
    defaultValue: 0.92,
    min: 0,
    max: 1,
    description: "God-ray sample density (live-tunes the active pass)",
    category: "lighting",
  },
  r_godrays_samples: {
    value: 60,
    defaultValue: 60,
    min: 8,
    max: 200,
    description: "God-ray radial sample count / quality (applies on next activation)",
    category: "lighting",
  },
  // Textured area lights (see AreaLightManager). Not clustered → budget by count.
  r_arealights: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: "Enable textured area lights from map `light_area` entities (0/1). Applies on next map load.",
    category: "lighting",
  },
  r_arealights_max: {
    value: 4,
    defaultValue: 4,
    min: 0,
    max: 32,
    description: "Max area lights per map (they consume real per-surface light slots). Applies on next map load.",
    category: "lighting",
  },
  r_arealights_auto: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description:
      "Auto-place area lights on the biggest emissive (fullbright) BSP surfaces, filling the r_arealights_max budget after explicit light_area entities. Experimental (0/1). Applies on next map load.",
    category: "lighting",
  },
  r_arealights_intensity: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4,
    description: "Brightness multiplier for all area lights. Applies on next map load.",
    category: "lighting",
  },
  r_wireframe: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: "Wireframe mode toggle (0/1)",
    category: "debug",
  },
  // Screen-space reflections (see SSREffect) — dynamic reflections on glossy metal.
  r_ssr: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: "Screen-space reflections on glossy surfaces (0/1). GPU-expensive; off by default.",
    category: "display",
  },
  r_ssr_strength: {
    value: 0.4,
    defaultValue: 0.4,
    min: 0,
    max: 2,
    description: "SSR reflection strength (subtle by default). Tunes live when r_ssr is on.",
    category: "display",
  },
  // Emissive glow layer (see GlowEffect) — controllable glow on top of bloom.
  // Off by default: bloom already covers bright surfaces; glow is opt-in polish.
  r_glow: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 2,
    description: "Emissive glow-layer intensity (0 = off, default). Glows signs/strips/energy on top of bloom.",
    category: "display",
  },
  // Post-processing (multipliers)
  r_bloom: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 3.0,
    description: "Bloom intensity multiplier (applies to post-processing pipeline)",
    category: "display",
  },
  r_exposure: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 3.0,
    description: "Exposure multiplier (applies to post-processing pipeline)",
    category: "display",
  },
  r_contrast: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 3.0,
    description: "Contrast multiplier (applies to post-processing pipeline)",
    category: "display",
  },
  r_pickupProcedural: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description:
      "Render health/armor pickups as procedural sculptures instead of MD3 models (0/1). Applies on next map load.",
    category: "display",
  },
  // Lighting
  r_lightintensity: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: "Global light intensity multiplier",
    category: "lighting",
  },
  r_lightmapscale: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0.1,
    max: 3.0,
    description: "Scales baked lightmap gain on top of the per-format default (takes effect on map load)",
    category: "lighting",
  },
  r_water: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description:
      "Draw liquid surfaces with the unified water material. 0 falls back to the legacy Q3/Warsow shader translation (applies on next map load).",
    category: "lighting",
  },
  r_water_quality: {
    value: 2,
    defaultValue: 2,
    min: 1,
    max: 3,
    description:
      "Water quality. All tiers use cached room reflections and calm reactive waves. 1 = no capture pass; 2 = depth tint; 3 = depth plus half-resolution refraction. Splash detail initializes on map load. No recurring reflection capture.",
    category: "lighting",
  },
  r_water_debug: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 6,
    description:
      "Water debug: 1 = absorption, 2 = thickness, 3 = environment, 4 = cached room, 5 = reactive slopes, 6 = undistorted refraction capture (red = unavailable). 0 = normal rendering.",
    category: "debug",
  },
  r_water_highlights: {
    value: 0.6,
    defaultValue: 0.6,
    min: 0,
    max: 2,
    description: "Water highlights from authored static map lights; 0 disables. No weapon/projectile lights.",
    category: "lighting",
  },
  r_water_roughness: {
    value: 0.3,
    defaultValue: 0.3,
    min: 0.12,
    max: 0.8,
    description: "Water point-highlight roughness: higher gives broader, softer highlights (not cubemap blur).",
    category: "lighting",
  },
  r_water_reflection: {
    value: 1.3,
    defaultValue: 1.3,
    min: 0,
    max: 2,
    description:
      "Water cached reflection weighting. 1 = previous baseline; 1.3 = default; 0 disables reflected contribution.",
    category: "lighting",
  },
  r_water_probe_height: {
    value: 64,
    defaultValue: 64,
    min: 0,
    max: 128,
    description:
      "Static water probe lift above its waterline anchor, clamped below solid geometry. Map reload required; 0 restores the low probe.",
    category: "lighting",
  },
  r_water_blur: {
    value: 0.3,
    defaultValue: 0.3,
    min: 0,
    max: 1,
    description:
      "Cached water reflection softness. 0 = single sharp sample; higher = wider five-tap angular filter. Updates live.",
    category: "lighting",
  },
  r_water_detail: {
    value: 0.8,
    defaultValue: 0.8,
    min: 0,
    max: 1,
    description:
      "Fine water wave strength, faded at distance/grazing angles. 0 leaves broad waves and player ripples. Updates live.",
    category: "lighting",
  },
  r_water_contact: {
    value: 0.25,
    defaultValue: 0.25,
    min: 0,
    max: 1,
    description:
      "Subtle neutral bank-contact shade from depth (quality 2/3, above water). No coloured dots or extra opacity. 0 disables. Updates live.",
    category: "lighting",
  },
  r_water_actors: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description:
      "Experimental near-water actor reflection overlay (quality 3). One small live pass, two nearby actors; 0 disables. Updates live.",
    category: "lighting",
  },
  r_underwater_distortion: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 1.0,
    description:
      "Underwater view-warp strength. At 0 the motion stops entirely and tint, fog and audio still say you are underwater — nothing is communicated by movement alone.",
    category: "lighting",
  },
  // Debug visualization
  r_showtris: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: "Force wireframe on entire scene (0/1)",
    category: "debug",
  },
  // Day/night cycle
  r_daynight: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: "Enable day/night cycle for BSP maps (0/1)",
    category: "lighting",
  },
  r_daynight_time: {
    value: 0.5,
    defaultValue: 0.5,
    min: 0,
    max: 1,
    description: "Time of day (0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset)",
    category: "lighting",
  },
  r_daynight_animate: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: "Animate time progression (0/1)",
    category: "lighting",
  },
  r_daynight_speed: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0.1,
    max: 10.0,
    description: "Animation speed multiplier",
    category: "lighting",
  },
  r_daynight_length: {
    value: 1440,
    defaultValue: 1440,
    min: 60,
    max: 86400,
    description: "Full day cycle length in seconds (default 24 min)",
    category: "lighting",
  },
  r_daynight_lm_min: {
    value: 0.05,
    defaultValue: 0.05,
    min: 0,
    max: 1,
    description: "Minimum lightmap intensity at night",
    category: "lighting",
  },
  r_daynight_lm_max: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 2,
    description: "Maximum lightmap intensity at noon",
    category: "lighting",
  },
  r_daynight_sun_intensity: {
    value: 0.3,
    defaultValue: 0.3,
    min: 0,
    max: 2,
    description: "Sun light intensity on BSP geometry",
    category: "lighting",
  },
  r_daynight_moon_intensity: {
    value: 0.15,
    defaultValue: 0.15,
    min: 0,
    max: 1,
    description: "Moon light intensity at night",
    category: "lighting",
  },
  r_daynight_sky_tint: {
    value: 1,
    defaultValue: 1,
    min: 0,
    max: 1,
    description: "Enable skybox tinting for day/night (0/1)",
    category: "lighting",
  },
};

type RenderVarPostProcessBaseline = {
  bloomWeight: number;
  exposure: number;
  contrast: number;
};

// ==================== RenderVars Singleton ====================

export class RenderVars {
  private static instance: RenderVars;

  private vars: Map<string, RenderVar> = new Map();
  private scene: Scene | null = null;
  private updateScheduled = false;

  /** Listeners for var changes */
  private listeners: Map<string, Set<(value: number) => void>> = new Map();

  private constructor() {
    this.initializeDefaults();
    this.loadFromStorage();
    this.registerCvars();
  }

  public static getInstance(): RenderVars {
    if (!RenderVars.instance) {
      RenderVars.instance = new RenderVars();
    }
    return RenderVars.instance;
  }

  public init(): void {
    // Cvars are registered in constructor, init() is for scene-dependent setup
    console.log(`[RenderVars] init() called, vars count: ${this.vars.size}`);
  }

  // ==================== Initialization ====================

  private initializeDefaults(): void {
    for (const [name, def] of Object.entries(DEFAULT_VARS)) {
      this.vars.set(name, { name, ...def });
    }
  }

  /**
   * Register all render vars as Cvars for console integration.
   * Call this after ConsoleCommandRegistry is initialized.
   */
  public registerCvars(): void {
    for (const [name, def] of this.vars) {
      // Determine type based on var characteristics
      const isDebug = def.category === "debug";
      const fractionalWater = name === "r_water_blur" || name === "r_water_detail" || name === "r_water_contact";
      const isInt = name === "r_anisotropy" || name === "r_picmip" || (def.max === 1 && !fractionalWater);

      Cvar.register(name, def.value, {
        type: isInt ? "int" : "float",
        min: def.min,
        max: def.max,
        description: def.description,
        persist: !isDebug, // Don't persist debug vars
        onChange: (value) => {
          // Route cvar changes back to RenderVars
          this.set(name, value as number);
        },
      });
    }
    console.log(`[RenderVars] Registered ${this.vars.size} cvars`);
  }

  private applyToPostProcessing(bloomMul: number, exposureMul: number, contrastMul: number): void {
    try {
      const pp = PostProcessingManager.getInstance();
      if (!pp.isInitialized()) {
        return;
      }

      if (this.scene?.activeCamera) {
        pp.setCamera(this.scene.activeCamera);
      }

      const s = pp.getSettings();
      const anyOverride = bloomMul !== 1.0 || exposureMul !== 1.0 || contrastMul !== 1.0;
      const baseKey = "_renderVarPostProcessBaseline";

      const currentBase = getStashed<RenderVarPostProcessBaseline>(pp, baseKey);
      if (!anyOverride) {
        // Restore baseline when returning to defaults
        if (currentBase) {
          pp.updateSettings({
            bloom: {
              ...s.bloom,
              weight: currentBase.bloomWeight,
            },
            colorGrading: {
              ...s.colorGrading,
              exposure: currentBase.exposure,
              contrast: currentBase.contrast,
            },
          });
          deleteStashed(pp, baseKey);
        }
        return;
      }

      // Capture baseline once when first overriding
      const base: RenderVarPostProcessBaseline = currentBase ?? {
        bloomWeight: s.bloom.weight,
        exposure: s.colorGrading.exposure,
        contrast: s.colorGrading.contrast,
      };
      setStashed(pp, baseKey, base);

      const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
      const nextBloomWeight = clamp01(base.bloomWeight * bloomMul);
      const nextExposure = base.exposure * exposureMul;
      const nextContrast = base.contrast * contrastMul;

      pp.updateSettings({
        bloom: {
          ...s.bloom,
          weight: nextBloomWeight,
        },
        colorGrading: {
          ...s.colorGrading,
          exposure: nextExposure,
          contrast: nextContrast,
        },
      });
    } catch {
      // Ignore if post-processing is unavailable
    }
  }

  /**
   * Set the active scene for applying material updates
   */
  public setScene(scene: Scene): void {
    this.scene = scene;
  }

  // ==================== Get/Set ====================

  /**
   * Get a render variable value
   */
  public get(name: string): number | undefined {
    return this.vars.get(name)?.value;
  }

  /**
   * Get full variable info
   */
  public getVar(name: string): RenderVar | undefined {
    return this.vars.get(name);
  }

  /**
   * Set a render variable value
   */
  public set(name: string, value: number): boolean {
    const varDef = this.vars.get(name);
    if (!varDef) {
      return false;
    }

    // Integer-like vars
    if (
      name === "r_anisotropy" ||
      name === "r_picmip" ||
      name === "r_ktx2" ||
      name === "r_wireframe" ||
      name === "r_webgpu" ||
      name === "r_bsp_freeze" ||
      name === "r_bsp_cellsize"
    ) {
      value = Math.round(value);
    }

    // Clamp to valid range
    const clamped = Math.max(varDef.min, Math.min(varDef.max, value));

    // No-op: avoid re-applying to the entire scene when nothing changed
    if (varDef.value === clamped) {
      return true;
    }

    varDef.value = clamped;

    // Save and apply
    this.saveToStorage();
    if (this.shouldApplyLive(name)) {
      this.scheduleUpdate();
    }
    this.notifyListeners(name, clamped);

    return true;
  }

  /**
   * Reset a variable to its default value
   */
  public reset(name: string): boolean {
    const varDef = this.vars.get(name);
    if (!varDef) {
      return false;
    }
    return this.set(name, varDef.defaultValue);
  }

  /**
   * Reset all variables to defaults
   */
  public resetAll(): void {
    for (const varDef of this.vars.values()) {
      varDef.value = varDef.defaultValue;
    }
    this.saveToStorage();
    this.scheduleUpdate();
  }

  // ==================== Listing ====================

  /**
   * Get all variable names
   */
  public getNames(): string[] {
    return Array.from(this.vars.keys()).sort();
  }

  /**
   * Get all variables
   */
  public getAll(): RenderVar[] {
    return Array.from(this.vars.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get variables by category
   */
  public getByCategory(category: RenderVar["category"]): RenderVar[] {
    return this.getAll().filter((v) => v.category === category);
  }

  // ==================== Persistence ====================

  private loadFromStorage(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as Record<string, number>;
        for (const [name, value] of Object.entries(data)) {
          const varDef = this.vars.get(name);
          // Skip debug vars - they should always start at defaults
          if (varDef && varDef.category !== "debug" && typeof value === "number") {
            varDef.value = Math.max(varDef.min, Math.min(varDef.max, value));
          }
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage(): void {
    try {
      const data: Record<string, number> = {};
      for (const [name, varDef] of this.vars) {
        // Don't persist debug vars (wireframe, showtris, etc.) - they should reset on reload
        if (varDef.category === "debug") continue;
        data[name] = varDef.value;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Export all vars as a config string (for copy/paste)
   */
  public exportConfig(): string {
    const lines: string[] = ["// Render variables config"];
    for (const varDef of this.getAll()) {
      lines.push(`${varDef.name} ${varDef.value}`);
    }
    return lines.join("\n");
  }

  /**
   * Import vars from a config string
   */
  public importConfig(config: string): { applied: number; errors: string[] } {
    const lines = config.split("\n");
    let applied = 0;
    const errors: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^(r_\w+)\s+([\d.]+)$/);
      if (match) {
        const [, name, valueStr] = match;
        const value = parseFloat(valueStr);
        if (!Number.isNaN(value) && this.set(name, value)) {
          applied++;
        } else {
          errors.push(`Unknown or invalid: ${trimmed}`);
        }
      } else {
        errors.push(`Parse error: ${trimmed}`);
      }
    }

    return { applied, errors };
  }

  // ==================== Live Updates ====================

  /**
   * Schedule a material update (batched for performance)
   */
  private scheduleUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;

    // Use requestAnimationFrame for batching
    requestAnimationFrame(() => {
      this.updateScheduled = false;
      this.applyToScene();
    });
  }

  private shouldApplyLive(name: string): boolean {
    return name !== "r_deluxe" && name !== "r_bsp_pbr" && name !== "r_bsp_cellsize" && name !== "r_picmip";
  }

  /**
   * Apply current vars to all scene materials
   */
  public applyToScene(): void {
    const normalIntensity = this.get("r_normalmap") ?? 1.0;
    const glossIntensity = this.get("r_glossmap") ?? 1.0;
    const lightmapIntensity = this.get("r_lightmap") ?? 1.0;
    const ambientIntensity = this.get("r_ambient") ?? 1.0;
    const emissiveIntensity = this.get("r_emissive") ?? 1.0;
    const anisotropy = this.get("r_anisotropy") ?? 8;
    const wireframe = (this.get("r_wireframe") ?? 0) >= 0.5;

    // Post-processing
    const bloomMul = this.get("r_bloom") ?? 1.0;
    const exposureMul = this.get("r_exposure") ?? 1.0;
    const contrastMul = this.get("r_contrast") ?? 1.0;
    this.applyToPostProcessing(bloomMul, exposureMul, contrastMul);

    if (!this.scene) return;

    // Deduplicate: many meshes share the same material. Track processed materials to skip redundant work.
    const processedMaterials = new Set<number>();

    // Update all meshes (skipping already-processed materials)
    for (const mesh of this.scene.meshes) {
      const mat = mesh.material;
      const wasFrozen = mat?.isFrozen ?? false;
      if (mat) {
        if (processedMaterials.has(mat.uniqueId)) continue;
        processedMaterials.add(mat.uniqueId);
        // Preserve the material owner's decision. Lightmapped/dynamic materials
        // intentionally stay mutable so light membership can change at runtime.
        if (wasFrozen) mat.unfreeze();
      }
      try {
        const bakedLighting = mat?.pluginManager?.getPlugin("BspBakedLighting") as BspBakedLightingPlugin | undefined;
        bakedLighting?.setGlossScale(glossIntensity);
        bakedLighting?.setAmbientScale(ambientIntensity);
        bakedLighting?.setLightmapScale(lightmapIntensity);
        this.applyToMesh(
          mesh,
          normalIntensity,
          glossIntensity,
          lightmapIntensity,
          emissiveIntensity,
          anisotropy,
          wireframe,
        );
      } finally {
        if (wasFrozen) mat!.freeze();
      }
    }

    // Update ambient color
    if (this.scene.ambientColor) {
      // Store original if not stored
      const original = getStashed<{ r: number; g: number; b: number }>(this.scene, "_originalAmbientColor");
      if (!original) {
        setStashed(this.scene, "_originalAmbientColor", this.scene.ambientColor.clone());
      }
      const baseAmbient = getStashed<{ r: number; g: number; b: number }>(this.scene, "_originalAmbientColor");
      if (baseAmbient) {
        this.scene.ambientColor.r = baseAmbient.r * ambientIntensity;
        this.scene.ambientColor.g = baseAmbient.g * ambientIntensity;
        this.scene.ambientColor.b = baseAmbient.b * ambientIntensity;
      }
    }

    // Light intensity multiplier
    const lightIntensity = this.get("r_lightintensity") ?? 1.0;
    for (const light of this.scene.lights) {
      const hasOriginal = getStashed<number>(light, "_originalIntensity") !== undefined;
      if (lightIntensity !== 1.0) {
        if (!hasOriginal) {
          setStashed(light, "_originalIntensity", light.intensity);
        }
        light.intensity = getStashed<number>(light, "_originalIntensity")! * lightIntensity;
      } else if (hasOriginal) {
        light.intensity = getStashed<number>(light, "_originalIntensity")!;
        deleteStashed(light, "_originalIntensity");
      }
    }

    // Force wireframe (r_showtris) - scene-level toggle
    const showTris = (this.get("r_showtris") ?? 0) >= 0.5;
    this.scene.forceWireframe = showTris;
  }

  private applyToMesh(
    mesh: AbstractMesh,
    normalIntensity: number,
    glossIntensity: number,
    lightmapIntensity: number,
    emissiveIntensity: number,
    anisotropy: number,
    wireframe: boolean,
  ): void {
    const mat = mesh.material;
    if (!mat) return;

    const setAniso = (tex: object | null | undefined) => {
      if (tex && typeof tex === "object") {
        setProp(tex, "anisotropicFilteringLevel", anisotropy);
      }
    };

    if (mat instanceof StandardMaterial) {
      setProp(mat, "wireframe", wireframe);

      const shouldApplyNormal = normalIntensity !== 1.0;
      const shouldApplyGloss = glossIntensity !== 1.0;
      const shouldApplyLightmap = lightmapIntensity !== 1.0;
      const shouldApplyEmissive = emissiveIntensity !== 1.0;

      // Normal map intensity
      if (mat.bumpTexture) {
        const hasOriginal = getStashed<number>(mat, "_originalBumpLevel") !== undefined;
        if (shouldApplyNormal) {
          if (!hasOriginal) {
            setStashed(mat, "_originalBumpLevel", mat.bumpTexture.level);
          }
          mat.bumpTexture.level = getStashed<number>(mat, "_originalBumpLevel")! * normalIntensity;
        } else if (hasOriginal) {
          mat.bumpTexture.level = getStashed<number>(mat, "_originalBumpLevel")!;
          deleteStashed(mat, "_originalBumpLevel");
        }
      }

      // Specular intensity (gloss)
      // Scale both the gloss texture energy and highlight width so filename-inferred
      // Warsow companion maps can be tuned without making highlights vanish.
      if (mat.specularTexture) {
        const hasOriginal = getStashed<number>(mat, "_originalSpecularTextureLevel") !== undefined;
        if (shouldApplyGloss) {
          if (!hasOriginal) {
            setStashed(mat, "_originalSpecularTextureLevel", mat.specularTexture.level);
          }
          mat.specularTexture.level = getStashed<number>(mat, "_originalSpecularTextureLevel")! * glossIntensity;
        } else if (hasOriginal) {
          mat.specularTexture.level = getStashed<number>(mat, "_originalSpecularTextureLevel")!;
          deleteStashed(mat, "_originalSpecularTextureLevel");
        }
      }

      // Store original specular power if not stored
      if (getStashed<number>(mat, "_originalSpecularPower") === undefined && mat.specularPower !== undefined) {
        setStashed(mat, "_originalSpecularPower", mat.specularPower);
      }
      const baseSpecPower = getStashed<number>(mat, "_originalSpecularPower") ?? 64;
      if (shouldApplyGloss) {
        mat.specularPower = baseSpecPower * Math.sqrt(glossIntensity);
      } else if (getStashed<number>(mat, "_originalSpecularPower") !== undefined) {
        mat.specularPower = getStashed<number>(mat, "_originalSpecularPower")!;
        deleteStashed(mat, "_originalSpecularPower");
      }

      // Lightmap intensity (via emissive or lightmapTexture level)
      if (mat.lightmapTexture) {
        const hasOriginal = getStashed<number>(mat, "_originalLightmapLevel") !== undefined;
        if (shouldApplyLightmap) {
          if (!hasOriginal) {
            setStashed(mat, "_originalLightmapLevel", mat.lightmapTexture.level);
          }
          mat.lightmapTexture.level = getStashed<number>(mat, "_originalLightmapLevel")! * lightmapIntensity;
        } else if (hasOriginal) {
          mat.lightmapTexture.level = getStashed<number>(mat, "_originalLightmapLevel")!;
          deleteStashed(mat, "_originalLightmapLevel");
        }
      }

      const hasOriginalEmissive = getStashed(mat, "_originalEmissiveColor") !== undefined;
      if (shouldApplyEmissive) {
        if (!hasOriginalEmissive && mat.emissiveColor) {
          setStashed(mat, "_originalEmissiveColor", mat.emissiveColor.clone());
        }
        const baseEmissive = getStashed<{ r: number; g: number; b: number }>(mat, "_originalEmissiveColor");
        if (baseEmissive) {
          mat.emissiveColor.r = baseEmissive.r * emissiveIntensity;
          mat.emissiveColor.g = baseEmissive.g * emissiveIntensity;
          mat.emissiveColor.b = baseEmissive.b * emissiveIntensity;
        }
      } else if (hasOriginalEmissive) {
        const baseEmissive = getStashed<{ r: number; g: number; b: number }>(mat, "_originalEmissiveColor");
        if (baseEmissive && mat.emissiveColor) {
          mat.emissiveColor.r = baseEmissive.r;
          mat.emissiveColor.g = baseEmissive.g;
          mat.emissiveColor.b = baseEmissive.b;
        }
        deleteStashed(mat, "_originalEmissiveColor");
      }

      const setAniso = (tex: object | null | undefined) => {
        if (tex && typeof tex === "object") {
          setProp(tex!, "anisotropicFilteringLevel", anisotropy);
        }
      };
      setAniso(getProp(mat, "diffuseTexture"));
      setAniso(getProp(mat, "albedoTexture"));
      setAniso(getProp(mat, "bumpTexture"));
      setAniso(getProp(mat, "specularTexture"));
      setAniso(getProp(mat, "reflectivityTexture"));
      setAniso(getProp(mat, "lightmapTexture"));
      setAniso(getProp(mat, "emissiveTexture"));
    } else if (mat instanceof PBRMaterial) {
      setProp(mat, "wireframe", wireframe);

      const shouldApplyNormal = normalIntensity !== 1.0;
      const shouldApplyGloss = glossIntensity !== 1.0;
      const shouldApplyLightmap = lightmapIntensity !== 1.0;
      const shouldApplyEmissive = emissiveIntensity !== 1.0;

      if (mat.bumpTexture) {
        const hasOriginal = getStashed<number>(mat, "_originalBumpLevel") !== undefined;
        if (shouldApplyNormal) {
          if (!hasOriginal) {
            setStashed(mat, "_originalBumpLevel", mat.bumpTexture.level);
          }
          mat.bumpTexture.level = getStashed<number>(mat, "_originalBumpLevel")! * normalIntensity;
        } else if (hasOriginal) {
          mat.bumpTexture.level = getStashed<number>(mat, "_originalBumpLevel")!;
          deleteStashed(mat, "_originalBumpLevel");
        }
      }

      if (mat.reflectivityTexture) {
        const hasOriginal = getStashed<number>(mat, "_originalReflectivityLevel") !== undefined;
        if (shouldApplyGloss) {
          if (!hasOriginal) {
            setStashed(mat, "_originalReflectivityLevel", mat.reflectivityTexture.level);
          }
          mat.reflectivityTexture.level = getStashed<number>(mat, "_originalReflectivityLevel")! * glossIntensity;
        } else if (hasOriginal) {
          mat.reflectivityTexture.level = getStashed<number>(mat, "_originalReflectivityLevel")!;
          deleteStashed(mat, "_originalReflectivityLevel");
        }
      }

      if (mat.microSurfaceTexture) {
        const hasOriginal = getStashed<number>(mat, "_originalMicroSurfaceTextureLevel") !== undefined;
        if (shouldApplyGloss) {
          if (!hasOriginal) {
            setStashed(mat, "_originalMicroSurfaceTextureLevel", mat.microSurfaceTexture.level);
          }
          mat.microSurfaceTexture.level =
            getStashed<number>(mat, "_originalMicroSurfaceTextureLevel")! * glossIntensity;
        } else if (hasOriginal) {
          mat.microSurfaceTexture.level = getStashed<number>(mat, "_originalMicroSurfaceTextureLevel")!;
          deleteStashed(mat, "_originalMicroSurfaceTextureLevel");
        }
      }

      const hasOriginalRoughness = getStashed<number>(mat, "_originalRoughness") !== undefined;
      if (shouldApplyGloss && mat.roughness !== null) {
        if (!hasOriginalRoughness) {
          setStashed(mat, "_originalRoughness", mat.roughness);
        }
        const baseRoughness = getStashed<number>(mat, "_originalRoughness") ?? mat.roughness ?? 1.0;
        const glossShape = Math.sqrt(glossIntensity);
        mat.roughness = Math.max(0.12, baseRoughness / glossShape);
      } else if (hasOriginalRoughness) {
        mat.roughness = getStashed<number>(mat, "_originalRoughness")!;
        deleteStashed(mat, "_originalRoughness");
      }

      const hasOriginalMicroSurface = getStashed<number>(mat, "_originalMicroSurface") !== undefined;
      if (shouldApplyGloss) {
        if (!hasOriginalMicroSurface) {
          setStashed(mat, "_originalMicroSurface", mat.microSurface);
        }
        const baseMicroSurface = getStashed<number>(mat, "_originalMicroSurface") ?? mat.microSurface ?? 0;
        const glossShape = Math.sqrt(glossIntensity);
        mat.microSurface = Math.min(1.0, baseMicroSurface * glossShape);
      } else if (hasOriginalMicroSurface) {
        mat.microSurface = getStashed<number>(mat, "_originalMicroSurface")!;
        deleteStashed(mat, "_originalMicroSurface");
      }

      if (mat.lightmapTexture) {
        const hasOriginal = getStashed<number>(mat, "_originalLightmapLevel") !== undefined;
        if (shouldApplyLightmap) {
          if (!hasOriginal) {
            setStashed(mat, "_originalLightmapLevel", mat.lightmapTexture.level);
          }
          mat.lightmapTexture.level = getStashed<number>(mat, "_originalLightmapLevel")! * lightmapIntensity;
        } else if (hasOriginal) {
          mat.lightmapTexture.level = getStashed<number>(mat, "_originalLightmapLevel")!;
          deleteStashed(mat, "_originalLightmapLevel");
        }
      }

      const hasOriginalEmissive = getStashed(mat, "_originalEmissiveColor") !== undefined;
      if (shouldApplyEmissive) {
        if (!hasOriginalEmissive && mat.emissiveColor) {
          setStashed(mat, "_originalEmissiveColor", mat.emissiveColor.clone());
        }
        const baseEmissive = getStashed<{ r: number; g: number; b: number }>(mat, "_originalEmissiveColor");
        if (baseEmissive) {
          mat.emissiveColor.r = baseEmissive.r * emissiveIntensity;
          mat.emissiveColor.g = baseEmissive.g * emissiveIntensity;
          mat.emissiveColor.b = baseEmissive.b * emissiveIntensity;
        }
      } else if (hasOriginalEmissive) {
        const baseEmissive = getStashed<{ r: number; g: number; b: number }>(mat, "_originalEmissiveColor");
        if (baseEmissive && mat.emissiveColor) {
          mat.emissiveColor.r = baseEmissive.r;
          mat.emissiveColor.g = baseEmissive.g;
          mat.emissiveColor.b = baseEmissive.b;
        }
        deleteStashed(mat, "_originalEmissiveColor");
      }

      setAniso(getProp(mat, "albedoTexture"));
      setAniso(getProp(mat, "bumpTexture"));
      setAniso(getProp(mat, "reflectivityTexture"));
      setAniso(getProp(mat, "microSurfaceTexture"));
      setAniso(getProp(mat, "lightmapTexture"));
      setAniso(getProp(mat, "emissiveTexture"));
    }
  }
  // ==================== Listeners ====================

  /**
   * Subscribe to changes on a specific variable
   */
  public onChange(name: string, callback: (value: number) => void): () => void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set());
    }
    this.listeners.get(name)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(name)?.delete(callback);
    };
  }

  private notifyListeners(name: string, value: number): void {
    const callbacks = this.listeners.get(name);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(value);
        } catch (e) {
          console.error(`[RenderVars] Listener error for ${name}:`, e);
        }
      }
    }
  }
}

export default RenderVars;

/**
 * RenderVars - Runtime-configurable renderer variables
 * 
 * Provides Q3/Warsow-style r_* console variables for tuning
 * material intensities, lighting, and visual settings.
 * 
 * Values are persisted to localStorage and can be exported/imported
 * as config blocks.
 */

import { Scene } from '@babylonjs/core/scene';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { PostProcessingManager } from '../effects/PostProcessingManager';
import { Service } from '../core/ServiceLocator';
import { Cvar } from '../core/Cvar';

// ==================== Types ====================

export interface RenderVar {
  name: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  description: string;
  category: 'material' | 'lighting' | 'display' | 'texture' | 'debug';
}

export type RenderVarName = 
  | 'r_normalmap'
  | 'r_glossmap'
  | 'r_lightmap'
  | 'r_ambient'
  | 'r_emissive'
  | 'r_anisotropy'
  | 'r_wireframe'
  | 'r_bloom'
  | 'r_exposure'
  | 'r_contrast'
  // Future vars (documented but not yet implemented)
  | 'r_lightintensity'
  | 'r_shadows'
  | 'r_gamma'
  | 'r_saturation'
  | 'r_picmip'
  | 'r_showtris'
  | 'r_shownormals'
  | 'r_showlightmaps';

// ==================== Constants ====================

const STORAGE_KEY = 'engine.renderVars';

const DEFAULT_VARS: Record<string, Omit<RenderVar, 'name'>> = {
  // Material intensities (core 4)
  r_normalmap: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: 'Normal/bump map intensity multiplier',
    category: 'material',
  },
  r_glossmap: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: 'Specular/gloss map intensity multiplier',
    category: 'material',
  },
  r_lightmap: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: 'Lightmap intensity multiplier',
    category: 'material',
  },
  r_ambient: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: 'Ambient light intensity multiplier',
    category: 'lighting',
  },
  r_emissive: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: 'Emissive/glow intensity multiplier',
    category: 'material',
  },
  r_anisotropy: {
    value: 8,
    defaultValue: 8,
    min: 1,
    max: 16,
    description: 'Anisotropic filtering level (1-16)',
    category: 'texture',
  },
  r_wireframe: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: 'Wireframe mode toggle (0/1)',
    category: 'debug',
  },
  // Post-processing (multipliers)
  r_bloom: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 3.0,
    description: 'Bloom intensity multiplier (applies to post-processing pipeline)',
    category: 'display',
  },
  r_exposure: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 3.0,
    description: 'Exposure multiplier (applies to post-processing pipeline)',
    category: 'display',
  },
  r_contrast: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 3.0,
    description: 'Contrast multiplier (applies to post-processing pipeline)',
    category: 'display',
  },
  // Lighting
  r_lightintensity: {
    value: 1.0,
    defaultValue: 1.0,
    min: 0,
    max: 4.0,
    description: 'Global light intensity multiplier',
    category: 'lighting',
  },
  // Debug visualization
  r_showtris: {
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 1,
    description: 'Force wireframe on entire scene (0/1)',
    category: 'debug',
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
      const isDebug = def.category === 'debug';
      const isInt = name === 'r_anisotropy' || def.max === 1;
      
      Cvar.register(name, def.value, {
        type: isInt ? 'int' : 'float',
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
      const baseKey = '_renderVarPostProcessBaseline';

      const currentBase = (pp as any)[baseKey] as RenderVarPostProcessBaseline | undefined;
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
          delete (pp as any)[baseKey];
        }
        return;
      }

      // Capture baseline once when first overriding
      const base: RenderVarPostProcessBaseline = currentBase ?? {
        bloomWeight: s.bloom.weight,
        exposure: s.colorGrading.exposure,
        contrast: s.colorGrading.contrast,
      };
      (pp as any)[baseKey] = base;

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
    if (name === 'r_anisotropy' || name === 'r_wireframe') {
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
    this.scheduleUpdate();
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
  public getByCategory(category: RenderVar['category']): RenderVar[] {
    return this.getAll().filter(v => v.category === category);
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
          if (varDef && varDef.category !== 'debug' && typeof value === 'number') {
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
        if (varDef.category === 'debug') continue;
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
    const lines: string[] = ['// Render variables config'];
    for (const varDef of this.getAll()) {
      lines.push(`${varDef.name} ${varDef.value}`);
    }
    return lines.join('\n');
  }

  /**
   * Import vars from a config string
   */
  public importConfig(config: string): { applied: number; errors: string[] } {
    const lines = config.split('\n');
    let applied = 0;
    const errors: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
        continue;
      }

      const match = trimmed.match(/^(r_\w+)\s+([\d.]+)$/);
      if (match) {
        const [, name, valueStr] = match;
        const value = parseFloat(valueStr);
        if (!isNaN(value) && this.set(name, value)) {
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

  /**
   * Apply current vars to all scene materials
   */
  public applyToScene(): void {
    const normalIntensity = this.get('r_normalmap') ?? 1.0;
    const glossIntensity = this.get('r_glossmap') ?? 1.0;
    const lightmapIntensity = this.get('r_lightmap') ?? 1.0;
    const ambientIntensity = this.get('r_ambient') ?? 1.0;
    const emissiveIntensity = this.get('r_emissive') ?? 1.0;
    const anisotropy = this.get('r_anisotropy') ?? 8;
    const wireframe = (this.get('r_wireframe') ?? 0) >= 0.5;

    // Post-processing
    const bloomMul = this.get('r_bloom') ?? 1.0;
    const exposureMul = this.get('r_exposure') ?? 1.0;
    const contrastMul = this.get('r_contrast') ?? 1.0;
    this.applyToPostProcessing(bloomMul, exposureMul, contrastMul);

    if (!this.scene) return;

    // Update all meshes
    for (const mesh of this.scene.meshes) {
      this.applyToMesh(mesh, normalIntensity, glossIntensity, lightmapIntensity, emissiveIntensity, anisotropy, wireframe);
    }

    // Update ambient color
    if (this.scene.ambientColor) {
      // Store original if not stored
      const original = (this.scene as any)._originalAmbientColor;
      if (!original) {
        (this.scene as any)._originalAmbientColor = this.scene.ambientColor.clone();
      }
      const baseAmbient = (this.scene as any)._originalAmbientColor;
      if (baseAmbient) {
        this.scene.ambientColor.r = baseAmbient.r * ambientIntensity;
        this.scene.ambientColor.g = baseAmbient.g * ambientIntensity;
        this.scene.ambientColor.b = baseAmbient.b * ambientIntensity;
      }
    }

    // Light intensity multiplier
    const lightIntensity = this.get('r_lightintensity') ?? 1.0;
    for (const light of this.scene.lights) {
      const hasOriginal = (light as any)._originalIntensity !== undefined;
      if (lightIntensity !== 1.0) {
        if (!hasOriginal) {
          (light as any)._originalIntensity = light.intensity;
        }
        light.intensity = (light as any)._originalIntensity * lightIntensity;
      } else if (hasOriginal) {
        light.intensity = (light as any)._originalIntensity;
        delete (light as any)._originalIntensity;
      }
    }

    // Force wireframe (r_showtris) - scene-level toggle
    const showTris = (this.get('r_showtris') ?? 0) >= 0.5;
    this.scene.forceWireframe = showTris;

  }

  private applyToMesh(
    mesh: AbstractMesh,
    normalIntensity: number,
    glossIntensity: number,
    lightmapIntensity: number,
    emissiveIntensity: number,
    anisotropy: number,
    wireframe: boolean
  ): void {
    const mat = mesh.material;
    if (!mat) return;

    if (mat instanceof StandardMaterial) {
      (mat as any).wireframe = wireframe;

      const shouldApplyNormal = normalIntensity !== 1.0;
      const shouldApplyGloss = glossIntensity !== 1.0;
      const shouldApplyLightmap = lightmapIntensity !== 1.0;
      const shouldApplyEmissive = emissiveIntensity !== 1.0;

      // Normal map intensity
      if (mat.bumpTexture) {
        const hasOriginal = (mat as any)._originalBumpLevel !== undefined;
        if (shouldApplyNormal) {
          if (!hasOriginal) {
            (mat as any)._originalBumpLevel = mat.bumpTexture.level;
          }
          mat.bumpTexture.level = (mat as any)._originalBumpLevel * normalIntensity;
        } else if (hasOriginal) {
          mat.bumpTexture.level = (mat as any)._originalBumpLevel;
          delete (mat as any)._originalBumpLevel;
        }
      }

      // Specular intensity (gloss)
      // Store original specular power if not stored
      if ((mat as any)._originalSpecularPower === undefined && mat.specularPower !== undefined) {
        (mat as any)._originalSpecularPower = mat.specularPower;
      }
      const baseSpecPower = (mat as any)._originalSpecularPower ?? 64;
      if (shouldApplyGloss) {
        mat.specularPower = baseSpecPower * glossIntensity;
      } else if ((mat as any)._originalSpecularPower !== undefined) {
        mat.specularPower = (mat as any)._originalSpecularPower;
        delete (mat as any)._originalSpecularPower;
      }

      // Lightmap intensity (via emissive or lightmapTexture level)
      if (mat.lightmapTexture) {
        const hasOriginal = (mat as any)._originalLightmapLevel !== undefined;
        if (shouldApplyLightmap) {
          if (!hasOriginal) {
            (mat as any)._originalLightmapLevel = mat.lightmapTexture.level;
          }
          mat.lightmapTexture.level = (mat as any)._originalLightmapLevel * lightmapIntensity;
        } else if (hasOriginal) {
          mat.lightmapTexture.level = (mat as any)._originalLightmapLevel;
          delete (mat as any)._originalLightmapLevel;
        }
      }

      const hasOriginalEmissive = (mat as any)._originalEmissiveColor !== undefined;
      if (shouldApplyEmissive) {
        if (!hasOriginalEmissive && mat.emissiveColor) {
          (mat as any)._originalEmissiveColor = mat.emissiveColor.clone();
        }
        const baseEmissive = (mat as any)._originalEmissiveColor;
        if (baseEmissive) {
          mat.emissiveColor.r = baseEmissive.r * emissiveIntensity;
          mat.emissiveColor.g = baseEmissive.g * emissiveIntensity;
          mat.emissiveColor.b = baseEmissive.b * emissiveIntensity;
        }
      } else if (hasOriginalEmissive) {
        const baseEmissive = (mat as any)._originalEmissiveColor;
        if (baseEmissive && mat.emissiveColor) {
          mat.emissiveColor.r = baseEmissive.r;
          mat.emissiveColor.g = baseEmissive.g;
          mat.emissiveColor.b = baseEmissive.b;
        }
        delete (mat as any)._originalEmissiveColor;
      }

      const setAniso = (tex: any) => {
        if (tex && typeof tex === 'object') {
          (tex as any).anisotropicFilteringLevel = anisotropy;
        }
      };
      setAniso((mat as any).diffuseTexture);
      setAniso((mat as any).albedoTexture);
      setAniso((mat as any).bumpTexture);
      setAniso((mat as any).specularTexture);
      setAniso((mat as any).reflectivityTexture);
      setAniso((mat as any).lightmapTexture);
      setAniso((mat as any).emissiveTexture);
    } else if (mat instanceof PBRMaterial) {
      (mat as any).wireframe = wireframe;

      const shouldApplyNormal = normalIntensity !== 1.0;
      const shouldApplyGloss = glossIntensity !== 1.0;
      const shouldApplyLightmap = lightmapIntensity !== 1.0;
      const shouldApplyEmissive = emissiveIntensity !== 1.0;

      // PBR normal map
      if (mat.bumpTexture) {
        const hasOriginal = (mat as any)._originalBumpLevel !== undefined;
        if (shouldApplyNormal) {
          if (!hasOriginal) {
            (mat as any)._originalBumpLevel = mat.bumpTexture.level;
          }
          mat.bumpTexture.level = (mat as any)._originalBumpLevel * normalIntensity;
        } else if (hasOriginal) {
          mat.bumpTexture.level = (mat as any)._originalBumpLevel;
          delete (mat as any)._originalBumpLevel;
        }
      }

      // PBR roughness/metallic (inverse of gloss)
      if (mat.reflectivityTexture) {
        const hasOriginal = (mat as any)._originalReflectivityLevel !== undefined;
        if (shouldApplyGloss) {
          if (!hasOriginal) {
            (mat as any)._originalReflectivityLevel = mat.reflectivityTexture.level;
          }
          mat.reflectivityTexture.level = (mat as any)._originalReflectivityLevel * glossIntensity;
        } else if (hasOriginal) {
          mat.reflectivityTexture.level = (mat as any)._originalReflectivityLevel;
          delete (mat as any)._originalReflectivityLevel;
        }
      }

      // Lightmap
      if (mat.lightmapTexture) {
        const hasOriginal = (mat as any)._originalLightmapLevel !== undefined;
        if (shouldApplyLightmap) {
          if (!hasOriginal) {
            (mat as any)._originalLightmapLevel = mat.lightmapTexture.level;
          }
          mat.lightmapTexture.level = (mat as any)._originalLightmapLevel * lightmapIntensity;
        } else if (hasOriginal) {
          mat.lightmapTexture.level = (mat as any)._originalLightmapLevel;
          delete (mat as any)._originalLightmapLevel;
        }
      }

      const hasOriginalEmissive = (mat as any)._originalEmissiveColor !== undefined;
      if (shouldApplyEmissive) {
        if (!hasOriginalEmissive && mat.emissiveColor) {
          (mat as any)._originalEmissiveColor = mat.emissiveColor.clone();
        }
        const baseEmissive = (mat as any)._originalEmissiveColor;
        if (baseEmissive) {
          mat.emissiveColor.r = baseEmissive.r * emissiveIntensity;
          mat.emissiveColor.g = baseEmissive.g * emissiveIntensity;
          mat.emissiveColor.b = baseEmissive.b * emissiveIntensity;
        }
      } else if (hasOriginalEmissive) {
        const baseEmissive = (mat as any)._originalEmissiveColor;
        if (baseEmissive && mat.emissiveColor) {
          mat.emissiveColor.r = baseEmissive.r;
          mat.emissiveColor.g = baseEmissive.g;
          mat.emissiveColor.b = baseEmissive.b;
        }
        delete (mat as any)._originalEmissiveColor;
      }

      const setAniso = (tex: any) => {
        if (tex && typeof tex === 'object') {
          (tex as any).anisotropicFilteringLevel = anisotropy;
        }
      };
      setAniso((mat as any).albedoTexture);
      setAniso((mat as any).bumpTexture);
      setAniso((mat as any).reflectivityTexture);
      setAniso((mat as any).lightmapTexture);
      setAniso((mat as any).emissiveTexture);
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

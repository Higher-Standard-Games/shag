/**
 * RenderVars - Runtime-configurable renderer variables
 * 
 * Provides Q3/Warsow-style r_* console variables for tuning
 * material intensities, lighting, and visual settings.
 * 
 * Values are persisted to localStorage and can be exported/imported
 * as config blocks.
 */

import { Scene, AbstractMesh, StandardMaterial, PBRMaterial } from 'babylonjs';

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
  // Future vars (documented but not yet implemented)
  | 'r_lightintensity'
  | 'r_shadows'
  | 'r_gamma'
  | 'r_contrast'
  | 'r_saturation'
  | 'r_exposure'
  | 'r_bloom'
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
  }

  public static getInstance(): RenderVars {
    if (!RenderVars.instance) {
      RenderVars.instance = new RenderVars();
    }
    return RenderVars.instance;
  }

  // ==================== Initialization ====================

  private initializeDefaults(): void {
    for (const [name, def] of Object.entries(DEFAULT_VARS)) {
      this.vars.set(name, { name, ...def });
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
          if (varDef && typeof value === 'number') {
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
    if (!this.scene) return;

    const normalIntensity = this.get('r_normalmap') ?? 1.0;
    const glossIntensity = this.get('r_glossmap') ?? 1.0;
    const lightmapIntensity = this.get('r_lightmap') ?? 1.0;
    const ambientIntensity = this.get('r_ambient') ?? 1.0;
    const emissiveIntensity = this.get('r_emissive') ?? 1.0;
    const anisotropy = this.get('r_anisotropy') ?? 8;
    const wireframe = (this.get('r_wireframe') ?? 0) >= 0.5;

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

      // Normal map intensity
      if (mat.bumpTexture) {
        mat.bumpTexture.level = normalIntensity;
      }

      // Specular intensity (gloss)
      // Store original specular power if not stored
      if ((mat as any)._originalSpecularPower === undefined && mat.specularPower !== undefined) {
        (mat as any)._originalSpecularPower = mat.specularPower;
      }
      const baseSpecPower = (mat as any)._originalSpecularPower ?? 64;
      mat.specularPower = baseSpecPower * glossIntensity;

      // Lightmap intensity (via emissive or lightmapTexture level)
      if (mat.lightmapTexture) {
        mat.lightmapTexture.level = lightmapIntensity;
      }

      if ((mat as any)._originalEmissiveColor === undefined && mat.emissiveColor) {
        (mat as any)._originalEmissiveColor = mat.emissiveColor.clone();
      }
      const baseEmissive = (mat as any)._originalEmissiveColor;
      if (baseEmissive) {
        mat.emissiveColor.r = baseEmissive.r * emissiveIntensity;
        mat.emissiveColor.g = baseEmissive.g * emissiveIntensity;
        mat.emissiveColor.b = baseEmissive.b * emissiveIntensity;
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

      // PBR normal map
      if (mat.bumpTexture) {
        mat.bumpTexture.level = normalIntensity;
      }

      // PBR roughness/metallic (inverse of gloss)
      if (mat.reflectivityTexture) {
        mat.reflectivityTexture.level = glossIntensity;
      }

      // Lightmap
      if (mat.lightmapTexture) {
        mat.lightmapTexture.level = lightmapIntensity;
      }

      if ((mat as any)._originalEmissiveColor === undefined && mat.emissiveColor) {
        (mat as any)._originalEmissiveColor = mat.emissiveColor.clone();
      }
      const baseEmissive = (mat as any)._originalEmissiveColor;
      if (baseEmissive) {
        mat.emissiveColor.r = baseEmissive.r * emissiveIntensity;
        mat.emissiveColor.g = baseEmissive.g * emissiveIntensity;
        mat.emissiveColor.b = baseEmissive.b * emissiveIntensity;
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

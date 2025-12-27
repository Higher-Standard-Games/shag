/**
 * ProceduralTextureGenerator - Generate procedural textures at runtime
 * 
 * Engine-level texture generation using Canvas API and noise algorithms.
 * Games can register custom presets for their specific needs.
 */

import { Scene, DynamicTexture, Texture } from "babylonjs";
import { ValueNoise } from "../math/Noise";

export type NoiseType = 'value' | 'perlin';

export interface TexturePreset {
  name: string;
  size: number;
  baseColor: [number, number, number];
  noiseAmount: number;
  noiseScale: number;
  noiseOctaves?: number;
  noisePersistence?: number;
  alpha?: number;
  noiseType?: NoiseType;
}

// Default presets that can be overridden or extended
const DEFAULT_PRESETS: Record<string, TexturePreset> = {
  grass: {
    name: 'grass',
    size: 256,
    baseColor: [80, 130, 50],
    noiseAmount: 30,
    noiseScale: 4,
    noiseOctaves: 3,
    noisePersistence: 0.5,
  },
  water: {
    name: 'water',
    size: 256,
    baseColor: [60, 120, 160],
    noiseAmount: 15,
    noiseScale: 8,
    noiseOctaves: 2,
    alpha: 0.85,
  },
  rock: {
    name: 'rock',
    size: 256,
    baseColor: [90, 85, 80],
    noiseAmount: 40,
    noiseScale: 2,
    noiseOctaves: 4,
    noisePersistence: 0.6,
  },
  dirt: {
    name: 'dirt',
    size: 256,
    baseColor: [70, 55, 35],
    noiseAmount: 25,
    noiseScale: 3,
    noiseOctaves: 3,
  },
  sand: {
    name: 'sand',
    size: 256,
    baseColor: [95, 80, 55],
    noiseAmount: 20,
    noiseScale: 3,
    noiseOctaves: 2,
  },
};

export class ProceduralTextureGenerator {
  private static instance: ProceduralTextureGenerator;
  private textureCache: Map<string, DynamicTexture> = new Map();
  private presets: Map<string, TexturePreset> = new Map();
  private scene: Scene | null = null;

  private constructor() {
    // Load default presets
    for (const [key, preset] of Object.entries(DEFAULT_PRESETS)) {
      this.presets.set(key, preset);
    }
  }

  static getInstance(): ProceduralTextureGenerator {
    if (!ProceduralTextureGenerator.instance) {
      ProceduralTextureGenerator.instance = new ProceduralTextureGenerator();
    }
    return ProceduralTextureGenerator.instance;
  }

  /**
   * Initialize with a Babylon.js scene
   */
  initialize(scene: Scene): void {
    this.scene = scene;
  }

  /**
   * Register a custom texture preset
   */
  registerPreset(preset: TexturePreset): void {
    this.presets.set(preset.name, preset);
  }

  /**
   * Register multiple presets at once
   */
  registerPresets(presets: TexturePreset[]): void {
    for (const preset of presets) {
      this.registerPreset(preset);
    }
  }

  /**
   * Override default presets with custom ones
   */
  setPresets(presets: Record<string, Partial<TexturePreset>>): void {
    for (const [name, overrides] of Object.entries(presets)) {
      const existing = this.presets.get(name) || DEFAULT_PRESETS[name];
      if (existing) {
        this.presets.set(name, { ...existing, ...overrides, name });
      }
    }
  }

  /**
   * Check if a texture name is a procedural texture
   */
  isProceduralTexture(textureName: string): boolean {
    return textureName.startsWith("terrain_") || textureName.startsWith("proc_");
  }

  /**
   * Parse preset name from texture name
   */
  parsePresetName(textureName: string): string | null {
    if (textureName.startsWith("terrain_")) {
      return textureName.replace("terrain_", "");
    }
    if (textureName.startsWith("proc_")) {
      return textureName.replace("proc_", "");
    }
    return null;
  }

  /**
   * Get or generate a procedural texture
   */
  getTexture(textureName: string): Texture | null {
    if (!this.scene) {
      console.error("ProceduralTextureGenerator not initialized with scene");
      return null;
    }

    const presetName = this.parsePresetName(textureName);
    if (!presetName) return null;

    const preset = this.presets.get(presetName);
    if (!preset) {
      console.warn(`Unknown procedural texture preset: ${presetName}`);
      return null;
    }

    // Check cache
    if (this.textureCache.has(textureName)) {
      return this.textureCache.get(textureName)!;
    }

    // Generate new texture
    const texture = this.generateTexture(preset);
    if (texture) {
      this.textureCache.set(textureName, texture);
    }

    return texture;
  }

  /**
   * Generate a texture directly from a preset config
   */
  generateFromConfig(config: TexturePreset): DynamicTexture | null {
    return this.generateTexture(config);
  }

  /**
   * Generate a procedural texture using Canvas
   */
  private generateTexture(preset: TexturePreset): DynamicTexture | null {
    if (!this.scene) return null;

    const {
      name,
      size,
      baseColor,
      noiseAmount,
      noiseScale,
      noiseOctaves = 3,
      noisePersistence = 0.5,
      alpha,
    } = preset;

    // Create dynamic texture
    const texture = new DynamicTexture(
      `proc_${name}_generated`,
      size,
      this.scene,
      true, // generateMipMaps
      Texture.TRILINEAR_SAMPLINGMODE
    );

    const ctx = texture.getContext() as CanvasRenderingContext2D;
    
    // Use value noise (faster for texture generation)
    const noise = new ValueNoise(Date.now());
    
    // Draw pixel by pixel
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Multi-octave noise for natural look
        const noiseValue = noise.octaveNoise(
          x * noiseScale / size,
          y * noiseScale / size,
          noiseOctaves,
          noisePersistence
        );

        // Apply noise to base color
        const variation = (noiseValue - 0.5) * noiseAmount * 2;

        const r = Math.max(0, Math.min(255, Math.floor(baseColor[0] + variation)));
        const g = Math.max(0, Math.min(255, Math.floor(baseColor[1] + variation)));
        const b = Math.max(0, Math.min(255, Math.floor(baseColor[2] + variation)));
        const a = alpha !== undefined ? alpha : 1;

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    texture.update();

    // Set texture properties for tiling
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;

    console.log(`Generated procedural texture: ${name}`);
    return texture;
  }

  /**
   * Clear texture cache
   */
  clearCache(): void {
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
  }

  /**
   * Get list of available preset names
   */
  getPresetNames(): string[] {
    return Array.from(this.presets.keys());
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearCache();
    this.scene = null;
  }
}

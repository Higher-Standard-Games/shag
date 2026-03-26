import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { GamePaths } from "../../core/GamePaths";
import { ProceduralTextureGenerator } from "../../procedural/ProceduralTextureGenerator";
import { PK3Loader } from "../pk3/PK3Loader";
import { PK3TextureLoader } from "../pk3/PK3TextureLoader";

// Check if we're in production mode (Vite sets this)
const IS_PRODUCTION: boolean = import.meta.env?.PROD ?? false;

// KTX2 texture directory (converted textures for production)
const KTX2_BASE_PATH = "/textures-ktx2";

export interface TextureInfo {
  path: string;
  u_offset: number;
  v_offset: number;
  rotation: number;
  u_scale: number;
  v_scale: number;
}

/**
 * TextureManager handles loading and caching textures from Quake/Radiant-style paths.
 *
 * Texture path resolution:
 * - "textures/base_wall/wall01" → "/textures/base_wall/wall01.jpg" (or .png, .tga)
 * - "common/caulk" → skip (editor-only texture)
 * - "color_255_0_0" → skip (use color instead)
 */
export class TextureManager {
  private static instance: TextureManager;
  private textureCache: Map<string, Texture> = new Map();
  private materialCache: Map<string, StandardMaterial> = new Map();
  private scene: Scene | null = null;

  // Base path for textures (set from GamePaths on init)
  private basePath: string | null = null;

  // Supported extensions in order of preference
  // In production, try KTX2 first for GPU-compressed textures
  private extensions: string[] = [".png", ".jpg", ".jpeg", ".tga", ".webp"];
  private ktx2Extensions: string[] = [".ktx2"];

  // Textures to skip (editor-only)
  private skipTextures: Set<string> = new Set([
    "common/caulk",
    "common/nodraw",
    "common/clip",
    "common/hint",
    "common/skip",
    "common/areaportal",
    "common/origin",
  ]);

  private constructor() {}

  static getInstance(): TextureManager {
    if (!TextureManager.instance) {
      TextureManager.instance = new TextureManager();
    }
    return TextureManager.instance;
  }

  /**
   * Initialize the TextureManager with a scene
   */
  init(scene: Scene): void {
    this.scene = scene;
    // Set base path from GamePaths
    this.basePath = GamePaths.getInstance().textures();
    // Initialize procedural texture generator
    ProceduralTextureGenerator.getInstance().initialize(scene);
  }

  /**
   * Check if the TextureManager has been initialized with a scene
   */
  isInitialized(): boolean {
    return this.scene !== null;
  }

  /**
   * Set the base path for texture loading
   */
  setBasePath(path: string): void {
    this.basePath = path;
  }

  /**
   * Check if a texture name is a color definition
   */
  isColorTexture(textureName: string): boolean {
    return textureName.startsWith("color_");
  }

  /**
   * Check if a texture name is a terrain texture
   */
  isTerrainTexture(textureName: string): boolean {
    return textureName.startsWith("terrain_");
  }

  /**
   * Parse color from texture name (e.g., "color_255_128_0")
   */
  parseColorTexture(textureName: string): Color3 | null {
    if (!this.isColorTexture(textureName)) return null;

    try {
      const parts = textureName.replace("color_", "").split("_").map(parseFloat);
      if (parts.length === 3 && parts.every((p) => !Number.isNaN(p))) {
        return new Color3(parts[0] / 255, parts[1] / 255, parts[2] / 255);
      }
    } catch {
      console.warn(`Failed to parse color texture: ${textureName}`);
    }
    return null;
  }

  /**
   * Check if texture should be skipped (editor-only)
   */
  shouldSkipTexture(textureName: string): boolean {
    return this.skipTextures.has(textureName.toLowerCase());
  }

  /**
   * Check if texture is a trigger texture
   */
  isTriggerTexture(textureName: string): boolean {
    return textureName.toLowerCase().includes("trigger");
  }

  /**
   * Get or create a texture from cache
   */
  async getTexture(textureName: string): Promise<Texture | null> {
    if (!this.scene) {
      console.error("TextureManager not initialized with scene");
      return null;
    }

    // Skip special textures
    if (this.shouldSkipTexture(textureName) || this.isColorTexture(textureName)) {
      return null;
    }

    // Handle terrain textures (procedurally generated)
    if (this.isTerrainTexture(textureName)) {
      const terrainTexture = ProceduralTextureGenerator.getInstance().getTexture(textureName);
      if (terrainTexture) {
        this.textureCache.set(textureName, terrainTexture);
        return terrainTexture;
      }
      return null;
    }

    // Check cache
    if (this.textureCache.has(textureName)) {
      return this.textureCache.get(textureName)!;
    }

    // Try loading with different extensions
    const texture = await this.tryLoadTexture(textureName);
    if (texture) {
      this.textureCache.set(textureName, texture);
    }

    return texture;
  }

  /**
   * Try loading a texture with various extensions
   * Priority: PK3 packages → KTX2 (production) → regular files
   */
  private async tryLoadTexture(textureName: string): Promise<Texture | null> {
    if (!this.scene) return null;

    // Normalize path (remove leading slashes, handle both formats)
    let normalizedPath = textureName;
    if (!normalizedPath.startsWith("textures/")) {
      normalizedPath = `textures/${normalizedPath}`;
    }
    // Remove the "textures/" prefix for building paths
    const cleanPath = normalizedPath.replace(/^textures\//, "");

    // Try PK3 packages first
    const pk3Texture = await this.tryLoadFromPK3(normalizedPath);
    if (pk3Texture) {
      return pk3Texture;
    }

    // In production, try KTX2 first (GPU-compressed textures)
    if (IS_PRODUCTION) {
      for (const ext of this.ktx2Extensions) {
        const ktx2Path = `${KTX2_BASE_PATH}/${cleanPath}${ext}`;

        try {
          const exists = await this.checkTextureExists(ktx2Path);
          if (exists) {
            const texture = new Texture(ktx2Path, this.scene);
            texture.name = textureName;
            texture.wrapU = Texture.WRAP_ADDRESSMODE;
            texture.wrapV = Texture.WRAP_ADDRESSMODE;
            console.log(`Loaded KTX2 texture: ${ktx2Path}`);
            return texture;
          }
        } catch {
          // KTX2 not available, fall through to regular textures
        }
      }
    }

    // Fall back to regular texture formats
    const basePath = this.basePath || "/textures";
    for (const ext of this.extensions) {
      const fullPath = `${basePath}/${normalizedPath}${ext}`.replace("textures/textures", "textures");

      try {
        const exists = await this.checkTextureExists(fullPath);
        if (exists) {
          const texture = new Texture(fullPath, this.scene);
          texture.name = textureName;

          // Quake textures typically tile
          texture.wrapU = Texture.WRAP_ADDRESSMODE;
          texture.wrapV = Texture.WRAP_ADDRESSMODE;

          console.log(`Loaded texture: ${fullPath}`);
          return texture;
        }
      } catch {
        // Continue to next extension
      }
    }

    console.warn(`Texture not found: ${textureName}`);
    return null;
  }

  /**
   * Try loading a texture from PK3 packages
   */
  private async tryLoadFromPK3(texturePath: string): Promise<Texture | null> {
    if (!this.scene) return null;

    const pk3 = PK3Loader.getInstance();
    const pk3Tex = PK3TextureLoader.getInstance();

    // Check if any PK3 packages are loaded
    if (pk3.getPackageInfo().length === 0) {
      return null;
    }

    // PK3 texture extensions to try
    const pk3Extensions = [".ktx", ".tga", ".png", ".jpg"];

    for (const ext of pk3Extensions) {
      const fullPath = `${texturePath}${ext}`;
      if (pk3.hasFile(fullPath)) {
        // Initialize PK3TextureLoader if needed
        // biome-ignore lint/suspicious/noExplicitAny: Babylon texture internals
        pk3Tex.init(this.scene.getEngine() as any, this.scene);

        const texture = await pk3Tex.loadTexture(fullPath);
        if (texture) {
          texture.name = texturePath;
          texture.wrapU = Texture.WRAP_ADDRESSMODE;
          texture.wrapV = Texture.WRAP_ADDRESSMODE;
          console.log(`[TextureManager] Loaded from PK3: ${fullPath}`);
          return texture;
        }
      }
    }

    return null;
  }

  /**
   * Check if a texture file exists
   */
  private async checkTextureExists(path: string): Promise<boolean> {
    try {
      const response = await fetch(path, { method: "HEAD" });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Load companion maps (_norm, _gloss) for a texture - Quake/Warsow standard
   */
  private async loadCompanionMaps(material: StandardMaterial, textureInfo: TextureInfo): Promise<void> {
    if (!this.scene) return;

    // Get base path without extension
    const basePath = textureInfo.path.replace(/\.[^/.]+$/, "");

    // Try to load normal map (_norm)
    const normTexture = await this.tryLoadCompanionTexture(`${basePath}_norm`);
    if (normTexture) {
      material.bumpTexture = normTexture;
      // Apply same UV transform as diffuse
      this.applyUVTransform(normTexture, textureInfo);
      console.log(`[TextureManager] Loaded normal map: ${basePath}_norm`);
    }

    // Try to load gloss/specular map (_gloss)
    const glossTexture = await this.tryLoadCompanionTexture(`${basePath}_gloss`);
    if (glossTexture) {
      material.specularTexture = glossTexture;
      // Enable specular for gloss maps
      material.specularColor = new Color3(0.3, 0.3, 0.3);
      // Apply same UV transform as diffuse
      this.applyUVTransform(glossTexture, textureInfo);
      console.log(`[TextureManager] Loaded gloss map: ${basePath}_gloss`);
    }
  }

  /**
   * Try to load a companion texture (norm/gloss) from PK3 or filesystem
   */
  private async tryLoadCompanionTexture(basePath: string): Promise<Texture | null> {
    if (!this.scene) return null;

    // Normalize path
    let normalizedPath = basePath;
    if (!normalizedPath.startsWith("textures/")) {
      normalizedPath = `textures/${normalizedPath}`;
    }

    // Try PK3 first
    const pk3Texture = await this.tryLoadFromPK3(normalizedPath);
    if (pk3Texture) {
      return pk3Texture;
    }

    // Try filesystem with various extensions
    const extensions = [".tga", ".png", ".jpg", ".jpeg"];
    for (const ext of extensions) {
      const fullPath = `/textures/${normalizedPath}${ext}`.replace("textures/textures", "textures");
      try {
        const exists = await this.checkTextureExists(fullPath);
        if (exists) {
          const texture = new Texture(fullPath, this.scene);
          texture.name = basePath;
          texture.wrapU = Texture.WRAP_ADDRESSMODE;
          texture.wrapV = Texture.WRAP_ADDRESSMODE;
          return texture;
        }
      } catch {
        // Continue to next extension
      }
    }

    return null;
  }

  /**
   * Get or create a material for a texture with UV parameters
   */
  async getMaterial(textureInfo: TextureInfo): Promise<StandardMaterial> {
    if (!this.scene) {
      throw new Error("TextureManager not initialized with scene");
    }

    const cacheKey = this.getMaterialCacheKey(textureInfo);

    // Check cache
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey)!;
    }

    const material = new StandardMaterial(`mat_${textureInfo.path}`, this.scene);
    material.specularColor = new Color3(0, 0, 0); // Flat shading
    material.backFaceCulling = false;

    // Handle color textures - generate procedural noisy texture
    if (this.isColorTexture(textureInfo.path)) {
      const color = this.parseColorTexture(textureInfo.path);
      if (color) {
        const noisyTexture = this.generateNoisyColorTexture(textureInfo.path, color);
        if (noisyTexture) {
          material.diffuseTexture = noisyTexture;
        } else {
          material.diffuseColor = color;
        }
      } else {
        material.diffuseColor = new Color3(0.5, 0.5, 0.5);
      }
    }
    // Handle trigger textures
    else if (this.isTriggerTexture(textureInfo.path)) {
      material.diffuseColor = new Color3(1, 0, 0);
      material.alpha = 0.3;
      material.wireframe = true;
    }
    // Handle real textures
    else if (!this.shouldSkipTexture(textureInfo.path)) {
      const texture = await this.getTexture(textureInfo.path);
      if (texture) {
        material.diffuseTexture = texture;

        // Apply UV transformations
        this.applyUVTransform(texture, textureInfo);

        // Try to load companion maps (_norm, _gloss) - Quake/Warsow standard
        await this.loadCompanionMaps(material, textureInfo);
      } else {
        // Fallback color for missing textures
        material.diffuseColor = new Color3(0.8, 0.8, 0.8);
      }
    } else {
      // Skip texture - use default gray
      material.diffuseColor = new Color3(0.8, 0.8, 0.8);
    }

    // Freeze material for better performance (BabylonJS 8 optimization)
    // Frozen materials skip shader recompilation checks
    material.freeze();

    this.materialCache.set(cacheKey, material);
    return material;
  }

  /**
   * Apply UV offset, rotation, and scale to a texture
   */
  private applyUVTransform(texture: Texture, info: TextureInfo): void {
    // Quake uses different UV conventions
    // u_offset/v_offset are in texture pixels, need to convert to 0-1 range
    // Assuming 64x64 texture size as default (common in Quake)
    const textureSize = 64;

    texture.uOffset = info.u_offset / textureSize;
    texture.vOffset = info.v_offset / textureSize;

    // Rotation in degrees, convert to radians
    texture.wAng = (info.rotation * Math.PI) / 180;

    // Scale (Quake uses inverse scale - 0.5 means texture is 2x larger)
    texture.uScale = 1 / info.u_scale;
    texture.vScale = 1 / info.v_scale;
  }

  /**
   * Generate a cache key for a material
   */
  private getMaterialCacheKey(info: TextureInfo): string {
    return `${info.path}_${info.u_offset}_${info.v_offset}_${info.rotation}_${info.u_scale}_${info.v_scale}`;
  }

  /**
   * Clear all cached textures and materials
   */
  clearCache(): void {
    console.log(`[TextureManager] clearCache called at ${Date.now()}`);
    this.textureCache.forEach((texture) => {
      texture.dispose();
    });
    this.materialCache.forEach((material) => {
      material.dispose();
    });
    this.noisyTextureCache.forEach((texture) => {
      texture.dispose();
    });
    this.textureCache.clear();
    this.materialCache.clear();
    this.noisyTextureCache.clear();
    console.log("[TextureManager] Cache cleared");
  }

  /**
   * Preload textures from a list of texture names
   */
  async preloadTextures(textureNames: string[]): Promise<void> {
    const uniqueNames = [...new Set(textureNames)];
    const promises = uniqueNames
      .filter((name) => !this.isColorTexture(name) && !this.shouldSkipTexture(name))
      .map((name) => this.getTexture(name));

    await Promise.all(promises);
    console.log(`Preloaded ${promises.length} textures`);
  }

  // Cache for noisy color textures
  private noisyTextureCache: Map<string, DynamicTexture> = new Map();

  /**
   * Generate a procedural noisy texture from a base color
   * Creates seamlessly tileable noise texture
   */
  private generateNoisyColorTexture(textureName: string, baseColor: Color3): DynamicTexture | null {
    if (!this.scene) return null;

    // Check cache
    if (this.noisyTextureCache.has(textureName)) {
      return this.noisyTextureCache.get(textureName)!;
    }

    // Create a dynamic texture
    const size = 128;
    const texture = new DynamicTexture(`noisy_${textureName}`, size, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;

    // Base color in 0-255 range
    const r = Math.floor(baseColor.r * 255);
    const g = Math.floor(baseColor.g * 255);
    const b = Math.floor(baseColor.b * 255);

    // Noise parameters
    const noiseAmount = 18;

    // Use seeded random for consistent results per color
    const seed = r * 1000 + g * 100 + b;
    const seededRandom = this.createSeededRandom(seed);

    // Generate seamless tileable noise
    // Use multiple octaves of seamless noise
    const noiseGrid = this.generateTileableNoise(size, seededRandom);

    // Draw pixels
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const noiseVal = noiseGrid[y][x];
        const totalNoise = noiseVal * noiseAmount;

        // Apply noise
        const pr = Math.max(0, Math.min(255, Math.floor(r + totalNoise)));
        const pg = Math.max(0, Math.min(255, Math.floor(g + totalNoise * 0.9)));
        const pb = Math.max(0, Math.min(255, Math.floor(b + totalNoise * 0.8)));

        ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    texture.update();

    // Set texture to tile
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;

    // Cache it
    this.noisyTextureCache.set(textureName, texture);

    return texture;
  }

  /**
   * Create a seeded random number generator
   */
  private createSeededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  /**
   * Generate seamlessly tileable noise using mirroring technique
   * This ensures the texture tiles perfectly without visible seams
   */
  private generateTileableNoise(size: number, random: () => number): number[][] {
    const grid: number[][] = [];
    const halfSize = size / 2;

    // Generate noise for one quadrant
    const baseNoise: number[][] = [];
    for (let y = 0; y <= halfSize; y++) {
      baseNoise[y] = [];
      for (let x = 0; x <= halfSize; x++) {
        // Multi-frequency noise
        let value = 0;
        value += (random() - 0.5) * 1.0; // Base noise
        value += Math.sin(x * 0.2 + random() * 6.28) * 0.3; // Low freq
        value += Math.sin(y * 0.15 + random() * 6.28) * 0.3;
        baseNoise[y][x] = value;
      }
    }

    // Mirror to create seamless tiling
    for (let y = 0; y < size; y++) {
      grid[y] = [];
      for (let x = 0; x < size; x++) {
        // Mirror coordinates
        const mx = x < halfSize ? x : size - x;
        const my = y < halfSize ? y : size - y;

        // Blend at edges for smoother transition
        const bx = Math.min(mx, halfSize);
        const by = Math.min(my, halfSize);

        grid[y][x] = baseNoise[by]?.[bx] ?? 0;
      }
    }

    return grid;
  }
}

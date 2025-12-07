import { Color3, type Scene, StandardMaterial, Texture } from "babylonjs";

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

  // Base path for textures (can be configured)
  private basePath: string = "/textures";

  // Supported extensions in order of preference
  private extensions: string[] = [".png", ".jpg", ".jpeg", ".tga", ".webp"];

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
   * Parse color from texture name (e.g., "color_255_128_0")
   */
  parseColorTexture(textureName: string): Color3 | null {
    if (!this.isColorTexture(textureName)) return null;

    try {
      const parts = textureName.replace("color_", "").split("_").map(parseFloat);
      if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
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
   */
  private async tryLoadTexture(textureName: string): Promise<Texture | null> {
    if (!this.scene) return null;

    // Normalize path (remove leading slashes, handle both formats)
    let normalizedPath = textureName;
    if (!normalizedPath.startsWith("textures/")) {
      normalizedPath = `textures/${normalizedPath}`;
    }

    for (const ext of this.extensions) {
      const fullPath = `${this.basePath}/${normalizedPath}${ext}`.replace("textures/textures", "textures");

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

    // Handle color textures
    if (this.isColorTexture(textureInfo.path)) {
      const color = this.parseColorTexture(textureInfo.path);
      material.diffuseColor = color || new Color3(0.5, 0.5, 0.5);
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
      } else {
        // Fallback color for missing textures
        material.diffuseColor = new Color3(0.8, 0.8, 0.8);
      }
    } else {
      // Skip texture - use default gray
      material.diffuseColor = new Color3(0.8, 0.8, 0.8);
    }

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
    this.textureCache.forEach((texture) => {
      texture.dispose();
    });
    this.materialCache.forEach((material) => {
      material.dispose();
    });
    this.textureCache.clear();
    this.materialCache.clear();
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
}

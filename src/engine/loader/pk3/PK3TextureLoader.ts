/**
 * PK3TextureLoader - Load textures from PK3 packages into BabylonJS
 * 
 * Features:
 * - Load KTX1 compressed textures
 * - Auto-detect companion maps (_gloss, _norm)
 * - Support for TGA and other formats
 * - Create PBR materials from texture sets
 */

import { Engine } from "@babylonjs/core/Engines/engine";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Scene } from "@babylonjs/core/scene";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PK3Loader } from "./PK3Loader";
import { parseKTX1, createTextureFromKTX1, isFormatSupported } from "../texture/KTX1Loader";

export interface TextureSet {
  /** Base/diffuse texture path */
  diffuse: string;
  /** Gloss/specular map path (auto-detected) */
  gloss?: string;
  /** Normal map path (auto-detected) */
  normal?: string;
  /** Original file extension */
  extension: string;
}

export interface LoadedTextureSet {
  diffuse: Texture | null;
  gloss: Texture | null;
  normal: Texture | null;
  name: string;
}

/**
 * Load textures from PK3 packages
 */
export class PK3TextureLoader {
  private static instance: PK3TextureLoader | null = null;

  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private textureCache: Map<string, Texture> = new Map();

  private constructor() { }

  public static getInstance(): PK3TextureLoader {
    if (!PK3TextureLoader.instance) {
      PK3TextureLoader.instance = new PK3TextureLoader();
    }
    return PK3TextureLoader.instance;
  }

  /**
   * Initialize with BabylonJS engine and scene
   */
  public init(engine: Engine, scene: Scene): void {
    this.engine = engine;
    this.scene = scene;
    console.log("[PK3TextureLoader] Initialized");
  }

  /**
   * Find all texture sets in a directory
   * Groups diffuse textures with their _gloss and _norm companions
   */
  public findTextureSets(directory: string): TextureSet[] {
    const pk3 = PK3Loader.getInstance();
    const files = pk3.listFiles(`${directory}/*`);

    // Find base textures (exclude _gloss, _norm, _blue, _red, etc.)
    const suffixPattern = /_(gloss|norm|normal|spec|bump|ao|height|blue|red|green|orange|daze)$/i;
    const textureExts = ['.ktx', '.tga', '.png', '.jpg', '.jpeg', '.dds'];

    const baseTextures = new Map<string, TextureSet>();

    for (const file of files) {
      const ext = this.getExtension(file);
      if (!textureExts.includes(ext.toLowerCase())) continue;

      const baseName = this.getBaseName(file);
      const nameWithoutExt = baseName.replace(/\.[^.]+$/, '');

      // Skip companion maps
      if (suffixPattern.test(nameWithoutExt)) continue;

      // This is a base/diffuse texture
      const key = `${directory}/${nameWithoutExt}`.toLowerCase();
      if (!baseTextures.has(key)) {
        baseTextures.set(key, {
          diffuse: file,
          extension: ext,
        });
      }
    }

    // Find companion maps for each base texture
    for (const [key, set] of baseTextures) {
      const nameWithoutExt = key.split('/').pop()!;

      // Look for gloss map
      const glossPatterns = [`${nameWithoutExt}_gloss`, `${nameWithoutExt}_spec`];
      for (const pattern of glossPatterns) {
        const found = files.find(f =>
          f.toLowerCase().includes(pattern.toLowerCase()) &&
          this.isTextureFile(f)
        );
        if (found) {
          set.gloss = found;
          break;
        }
      }

      // Look for normal map
      const normPatterns = [`${nameWithoutExt}_norm`, `${nameWithoutExt}_normal`, `${nameWithoutExt}_bump`];
      for (const pattern of normPatterns) {
        const found = files.find(f =>
          f.toLowerCase().includes(pattern.toLowerCase()) &&
          this.isTextureFile(f)
        );
        if (found) {
          set.normal = found;
          break;
        }
      }
    }

    return Array.from(baseTextures.values());
  }

  /**
   * Load a single texture from PK3
   */
  public async loadTexture(path: string): Promise<Texture | null> {
    if (!this.engine || !this.scene) {
      console.error("[PK3TextureLoader] Not initialized");
      return null;
    }

    // Check cache
    const cacheKey = path.toLowerCase();
    if (this.textureCache.has(cacheKey)) {
      const cached = this.textureCache.get(cacheKey)!;
      // Check if cached texture is still valid (not disposed)
      // Disposed textures have null internal texture reference
      if (cached.isReady() || (cached as any)._texture !== null) {
        return cached;
      } else {
        // Cached texture was disposed, remove from cache
        console.warn(`[PK3TextureLoader] Cached texture was disposed, reloading: ${path}`);
        this.textureCache.delete(cacheKey);
      }
    }

    const pk3 = PK3Loader.getInstance();
    const data = await pk3.getFile(path);

    if (!data) {
      return null;
    }

    const ext = this.getExtension(path).toLowerCase();
    let texture: Texture | null = null;

    try {
      if (ext === '.ktx') {
        texture = await this.loadKTXTexture(path, data);
      } else if (ext === '.tga') {
        texture = await this.loadTGATexture(path, data);
      } else {
        // PNG, JPG, etc. - use blob URL
        texture = await this.loadStandardTexture(path, data, ext);
      }

      if (texture) {
        // Enable texture tiling (Quake/Warsow textures always repeat by default)
        texture.wrapU = Texture.WRAP_ADDRESSMODE;
        texture.wrapV = Texture.WRAP_ADDRESSMODE;

        this.textureCache.set(cacheKey, texture);
        console.log(`[PK3TextureLoader] Loaded: ${path}`);
      }
    } catch (e) {
      console.error(`[PK3TextureLoader] Failed to load ${path}:`, e);
    }

    return texture;
  }

  /**
   * Load KTX1 compressed texture
   */
  private async loadKTXTexture(path: string, data: ArrayBuffer): Promise<Texture | null> {
    if (!this.engine || !this.scene) return null;

    try {
      const ktx = parseKTX1(data);

      // Check if format is supported
      if (!isFormatSupported(this.engine, ktx.header.glInternalFormat)) {
        console.warn(`[PK3TextureLoader] KTX format not supported: ${ktx.formatName}, falling back to placeholder`);
        // Return a placeholder texture
        return this.createPlaceholderTexture(path);
      }

      const internalTexture = createTextureFromKTX1(this.engine, ktx, path);
      if (!internalTexture) {
        return this.createPlaceholderTexture(path);
      }

      // Wrap in Texture
      const texture = new Texture(null, this.scene);
      texture.name = path;
      (texture as any)._texture = internalTexture;

      return texture;
    } catch (e) {
      console.error(`[PK3TextureLoader] KTX parse error for ${path}:`, e);
      return this.createPlaceholderTexture(path);
    }
  }

  /**
   * Load TGA texture
   */
  private async loadTGATexture(path: string, data: ArrayBuffer): Promise<Texture | null> {
    if (!this.scene) return null;

    try {
      const tgaData = this.parseTGA(data);
      if (!tgaData) {
        return this.createPlaceholderTexture(path);
      }

      const texture = RawTexture.CreateRGBATexture(
        tgaData.pixels,
        tgaData.width,
        tgaData.height,
        this.scene,
        true, // generateMipMaps
        false, // invertY - TGA is usually bottom-up, handled in parser
      );
      texture.name = path;

      return texture;
    } catch (e) {
      console.error(`[PK3TextureLoader] TGA parse error for ${path}:`, e);
      return this.createPlaceholderTexture(path);
    }
  }

  /**
   * Load standard image format via blob URL
   */
  private async loadStandardTexture(path: string, data: ArrayBuffer, ext: string): Promise<Texture | null> {
    if (!this.scene) return null;

    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);

    try {
      const texture = new Texture(url, this.scene);
      texture.name = path;

      // Clean up blob URL after texture loads
      texture.onLoadObservable.addOnce(() => {
        URL.revokeObjectURL(url);
      });

      return texture;
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  /**
   * Create a placeholder texture for unsupported formats
   */
  private createPlaceholderTexture(name: string): Texture | null {
    if (!this.scene) return null;

    // Create a simple 64x64 checkerboard pattern
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const isWhite = ((x >> 3) ^ (y >> 3)) & 1;
        const c = isWhite ? 200 : 100;
        pixels[i] = c;     // R
        pixels[i + 1] = c; // G
        pixels[i + 2] = c; // B
        pixels[i + 3] = 255; // A
      }
    }

    const texture = RawTexture.CreateRGBATexture(
      pixels,
      size,
      size,
      this.scene,
      true,
      false
    );
    texture.name = `placeholder:${name}`;

    return texture;
  }

  /**
   * Parse TGA file format
   */
  private parseTGA(data: ArrayBuffer): { pixels: Uint8Array; width: number; height: number } | null {
    const view = new DataView(data);
    const uint8 = new Uint8Array(data);

    // TGA Header
    const idLength = view.getUint8(0);
    const colorMapType = view.getUint8(1);
    const imageType = view.getUint8(2);
    const width = view.getUint16(12, true);
    const height = view.getUint16(14, true);
    const bpp = view.getUint8(16);
    const descriptor = view.getUint8(17);

    // Only support uncompressed true-color (type 2) and RLE (type 10)
    if (imageType !== 2 && imageType !== 10) {
      console.warn(`[TGA] Unsupported image type: ${imageType}`);
      return null;
    }

    if (colorMapType !== 0) {
      console.warn(`[TGA] Color-mapped TGA not supported`);
      return null;
    }

    const bytesPerPixel = bpp / 8;
    if (bytesPerPixel !== 3 && bytesPerPixel !== 4) {
      console.warn(`[TGA] Unsupported BPP: ${bpp}`);
      return null;
    }

    const headerSize = 18 + idLength;
    const pixels = new Uint8Array(width * height * 4);

    // Check if image is flipped
    const isTopToBottom = (descriptor & 0x20) !== 0;

    if (imageType === 2) {
      // Uncompressed
      let srcOffset = headerSize;

      for (let y = 0; y < height; y++) {
        const destY = isTopToBottom ? y : (height - 1 - y);

        for (let x = 0; x < width; x++) {
          const destOffset = (destY * width + x) * 4;

          // TGA is BGR(A)
          pixels[destOffset + 2] = uint8[srcOffset];     // B -> R
          pixels[destOffset + 1] = uint8[srcOffset + 1]; // G -> G
          pixels[destOffset] = uint8[srcOffset + 2];     // R -> B
          pixels[destOffset + 3] = bytesPerPixel === 4 ? uint8[srcOffset + 3] : 255;

          srcOffset += bytesPerPixel;
        }
      }
    } else {
      // RLE compressed
      let srcOffset = headerSize;
      let pixelIndex = 0;

      while (pixelIndex < width * height) {
        const packet = uint8[srcOffset++];
        const count = (packet & 0x7F) + 1;
        const isRLE = (packet & 0x80) !== 0;

        if (isRLE) {
          // RLE packet - one pixel repeated
          const b = uint8[srcOffset];
          const g = uint8[srcOffset + 1];
          const r = uint8[srcOffset + 2];
          const a = bytesPerPixel === 4 ? uint8[srcOffset + 3] : 255;
          srcOffset += bytesPerPixel;

          for (let i = 0; i < count; i++) {
            const y = Math.floor(pixelIndex / width);
            const x = pixelIndex % width;
            const destY = isTopToBottom ? y : (height - 1 - y);
            const destOffset = (destY * width + x) * 4;

            pixels[destOffset] = r;
            pixels[destOffset + 1] = g;
            pixels[destOffset + 2] = b;
            pixels[destOffset + 3] = a;

            pixelIndex++;
          }
        } else {
          // Raw packet - multiple pixels
          for (let i = 0; i < count; i++) {
            const y = Math.floor(pixelIndex / width);
            const x = pixelIndex % width;
            const destY = isTopToBottom ? y : (height - 1 - y);
            const destOffset = (destY * width + x) * 4;

            pixels[destOffset + 2] = uint8[srcOffset];     // B
            pixels[destOffset + 1] = uint8[srcOffset + 1]; // G
            pixels[destOffset] = uint8[srcOffset + 2];     // R
            pixels[destOffset + 3] = bytesPerPixel === 4 ? uint8[srcOffset + 3] : 255;

            srcOffset += bytesPerPixel;
            pixelIndex++;
          }
        }
      }
    }

    return { pixels, width, height };
  }

  /**
   * Load a complete texture set (diffuse + gloss + normal)
   */
  public async loadTextureSet(diffusePath: string): Promise<LoadedTextureSet> {
    const basePath = diffusePath.replace(/\.[^.]+$/, '');
    const pk3 = PK3Loader.getInstance();

    // Find companion textures
    const glossPatterns = [`${basePath}_gloss`, `${basePath}_spec`];
    const normPatterns = [`${basePath}_norm`, `${basePath}_normal`];

    let glossPath: string | undefined;
    let normPath: string | undefined;

    // Check common extensions for companions
    const exts = ['.tga', '.ktx', '.png', '.jpg'];

    for (const pattern of glossPatterns) {
      for (const e of exts) {
        if (pk3.hasFile(pattern + e)) {
          glossPath = pattern + e;
          break;
        }
      }
      if (glossPath) break;
    }

    for (const pattern of normPatterns) {
      for (const e of exts) {
        if (pk3.hasFile(pattern + e)) {
          normPath = pattern + e;
          break;
        }
      }
      if (normPath) break;
    }

    // Load all textures
    const [diffuse, gloss, normal] = await Promise.all([
      this.loadTexture(diffusePath),
      glossPath ? this.loadTexture(glossPath) : Promise.resolve(null),
      normPath ? this.loadTexture(normPath) : Promise.resolve(null),
    ]);

    return {
      diffuse,
      gloss,
      normal,
      name: basePath.split('/').pop() || 'unknown',
    };
  }

  /**
   * Create a PBR material from a texture set
   */
  public createPBRMaterial(textureSet: LoadedTextureSet, scene: Scene): PBRMaterial {
    const material = new PBRMaterial(textureSet.name, scene);

    if (textureSet.diffuse) {
      material.albedoTexture = textureSet.diffuse;
    }

    if (textureSet.gloss) {
      material.reflectivityTexture = textureSet.gloss;
      material.useRoughnessFromMetallicTextureAlpha = false;
      material.useRoughnessFromMetallicTextureGreen = false;
    }

    if (textureSet.normal) {
      material.bumpTexture = textureSet.normal;
    }

    // Default PBR settings for game textures
    material.metallic = 0;
    material.roughness = 0.8;
    material.albedoColor = Color3.White();

    return material;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getExtension(path: string): string {
    const match = path.match(/\.[^.]+$/);
    return match ? match[0] : '';
  }

  private getBaseName(path: string): string {
    return path.split('/').pop() || path;
  }

  private isTextureFile(path: string): boolean {
    const ext = this.getExtension(path).toLowerCase();
    return ['.ktx', '.tga', '.png', '.jpg', '.jpeg', '.dds'].includes(ext);
  }

  /**
   * Clear texture cache
   */
  public clearCache(): void {
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
    console.log("[PK3TextureLoader] Cache cleared");
  }

  /**
   * Get cache info
   */
  public getCacheInfo(): { count: number; textures: string[] } {
    return {
      count: this.textureCache.size,
      textures: Array.from(this.textureCache.keys()),
    };
  }
}

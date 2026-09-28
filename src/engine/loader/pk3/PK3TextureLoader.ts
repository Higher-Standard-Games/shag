/**
 * PK3TextureLoader - Load textures from PK3 packages into BabylonJS
 *
 * Features:
 * - Load KTX1 compressed textures
 * - Auto-detect companion maps (_gloss, _norm)
 * - Support for TGA and other formats
 * - Create PBR materials from texture sets
 */

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../../core/Cvar";
import { createTextureFromKTX1, parseKTX1 } from "../texture/KTX1Loader";
import { ensureKTX2Decoder } from "../texture/KTX2DecoderRuntime";
import { KTX2_SIDECAR_EXTENSION, registerKTX2SidecarLoader } from "../texture/KTX2SidecarLoader";
import { PK3Loader } from "./PK3Loader";

type KTX2ManifestEntry = string | { file: string };

interface KTX2Manifest {
  version: 1;
  textures: Record<string, KTX2ManifestEntry>;
}

interface LocatedKTX2Manifest {
  baseUrl: string;
  manifest: KTX2Manifest;
}

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

  private engine: AbstractEngine | null = null;
  private scene: Scene | null = null;
  private textureCache: Map<string, Texture> = new Map();
  private ktx2ManifestPromise: Promise<LocatedKTX2Manifest | null> | null = null;
  private failedKTX2Sidecars = new Set<string>();

  private constructor() {}

  public static getInstance(): PK3TextureLoader {
    if (!PK3TextureLoader.instance) {
      PK3TextureLoader.instance = new PK3TextureLoader();
    }
    return PK3TextureLoader.instance;
  }

  /**
   * Initialize with BabylonJS engine and scene
   */
  public init(engine: AbstractEngine, scene: Scene): void {
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
    const textureExts = [".ktx", ".tga", ".png", ".jpg", ".jpeg", ".dds"];

    const baseTextures = new Map<string, TextureSet>();

    for (const file of files) {
      const ext = this.getExtension(file);
      if (!textureExts.includes(ext.toLowerCase())) continue;

      const baseName = this.getBaseName(file);
      const nameWithoutExt = baseName.replace(/\.[^.]+$/, "");

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
      const nameWithoutExt = key.split("/").pop()!;

      // Look for gloss map
      const glossPatterns = [`${nameWithoutExt}_gloss`, `${nameWithoutExt}_spec`];
      for (const pattern of glossPatterns) {
        const found = files.find((f) => f.toLowerCase().includes(pattern.toLowerCase()) && this.isTextureFile(f));
        if (found) {
          set.gloss = found;
          break;
        }
      }

      // Look for normal map
      const normPatterns = [`${nameWithoutExt}_norm`, `${nameWithoutExt}_normal`, `${nameWithoutExt}_bump`];
      for (const pattern of normPatterns) {
        const found = files.find((f) => f.toLowerCase().includes(pattern.toLowerCase()) && this.isTextureFile(f));
        if (found) {
          set.normal = found;
          break;
        }
      }
    }

    return Array.from(baseTextures.values());
  }

  /**
   * Resolve a texture path by trying multiple extensions, then load it.
   * Accepts paths with or without extension. Prefers lossless formats (TGA, PNG, JPG)
   * and falls back to KTX (lossy ETC1) only when no lossless source exists.
   *
   * @param basePath - Texture path, e.g. "models/weapons/plasmagun/plasmagun" or "textures/foo.tga"
   */
  public async resolveAndLoadTexture(basePath: string): Promise<Texture | null> {
    const pk3 = PK3Loader.getInstance();
    const cleanPath = basePath.replace(/^\//, "");

    // Strip existing extension to get the base
    const stripped = cleanPath.replace(/\.(ktx|tga|png|jpg|jpeg)$/i, "");

    const sidecar = await this.tryLoadKTX2Sidecar(stripped);
    if (sidecar) {
      return sidecar;
    }

    // Try extensions in priority order: lossless formats first,
    // then KTX (lossy ETC1 compression) as fallback only when no lossless source exists
    const candidates = [
      cleanPath, // original path with original extension (highest priority)
      `${stripped}.tga`,
      `${stripped}.png`,
      `${stripped}.jpg`,
      `${stripped}.ktx`, // lossy ETC1 — fallback only
    ];

    // De-duplicate (in case cleanPath === stripped + ext matches one above)
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (pk3.hasFile(candidate)) {
        return this.loadTexture(candidate);
      }
    }

    return null;
  }

  private isKTX2Enabled(): boolean {
    const value = Cvar.get("r_ktx2");
    return value === undefined || Cvar.getBool("r_ktx2");
  }

  private async getKTX2Manifest(): Promise<LocatedKTX2Manifest | null> {
    if (this.ktx2ManifestPromise) {
      return this.ktx2ManifestPromise;
    }

    this.ktx2ManifestPromise = (async () => {
      for (const baseUrl of PK3Loader.getInstance().getSearchPaths()) {
        try {
          const response = await fetch(`${baseUrl}ktx2cache/manifest.json`);
          if (!response.ok || (response.headers.get("Content-Type") || "").includes("text/html")) {
            continue;
          }
          const manifest = (await response.json()) as Partial<KTX2Manifest>;
          if (manifest.version === 1 && manifest.textures && typeof manifest.textures === "object") {
            return { baseUrl, manifest: manifest as KTX2Manifest };
          }
        } catch {
          // KTX2 sidecars are optional. Try the next configured search path.
        }
      }
      return null;
    })();

    return this.ktx2ManifestPromise;
  }

  private async tryLoadKTX2Sidecar(strippedPath: string): Promise<Texture | null> {
    if (!this.scene || !this.isKTX2Enabled()) {
      return null;
    }

    const canonicalPath = strippedPath.toLowerCase().replace(/\\/g, "/");
    const cacheKey = `ktx2:${canonicalPath}`;
    const cached = this.textureCache.get(cacheKey);
    if (cached && (cached.isReady() || (cached as unknown as { _texture: unknown })._texture !== null)) {
      return cached;
    }
    if (this.failedKTX2Sidecars.has(canonicalPath)) {
      return null;
    }

    const located = await this.getKTX2Manifest();
    const entry = located?.manifest.textures[canonicalPath];
    if (!located || !entry) {
      return null;
    }

    const relativeFile = typeof entry === "string" ? entry : entry.file;
    if (typeof relativeFile !== "string") {
      console.warn("[PK3TextureLoader] Ignoring malformed KTX2 manifest entry");
      this.failedKTX2Sidecars.add(canonicalPath);
      return null;
    }
    const normalizedRelativeFile = relativeFile.replace(/\\/g, "/");
    if (
      !normalizedRelativeFile ||
      normalizedRelativeFile.startsWith("/") ||
      normalizedRelativeFile.split("/").includes("..") ||
      !normalizedRelativeFile.toLowerCase().endsWith(".ktx2")
    ) {
      console.warn(`[PK3TextureLoader] Ignoring unsafe KTX2 manifest entry: ${relativeFile}`);
      this.failedKTX2Sidecars.add(canonicalPath);
      return null;
    }

    const url = `${located.baseUrl}ktx2cache/${normalizedRelativeFile}`;
    try {
      await ensureKTX2Decoder();
      registerKTX2SidecarLoader();
      const texture = await new Promise<Texture | null>((resolve) => {
        let candidate: Texture;
        candidate = new Texture(url, this.scene!, {
          noMipmap: false,
          invertY: false,
          forcedExtension: KTX2_SIDECAR_EXTENSION,
          samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
          onLoad: () => resolve(candidate),
          onError: (message, exception) => {
            candidate.dispose();
            console.warn(`[PK3TextureLoader] KTX2 sidecar failed, using source texture: ${url}`, message, exception);
            resolve(null);
          },
        });
        candidate.name = strippedPath;
      });

      if (!texture) {
        this.failedKTX2Sidecars.add(canonicalPath);
        return null;
      }

      texture.wrapU = Texture.WRAP_ADDRESSMODE;
      texture.wrapV = Texture.WRAP_ADDRESSMODE;
      this.textureCache.set(cacheKey, texture);
      console.log(`[PK3TextureLoader] Loaded KTX2 sidecar: ${url}`);
      return texture;
    } catch (error) {
      this.failedKTX2Sidecars.add(canonicalPath);
      console.warn(`[PK3TextureLoader] KTX2 decoder unavailable, using source texture: ${url}`, error);
      return null;
    }
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
      // biome-ignore lint/suspicious/noExplicitAny: PK3 texture loader internals
      if (cached.isReady() || (cached as any)._texture !== null) {
        return cached;
      } else {
        // Cached texture was disposed, remove from cache
        console.warn(`[PK3TextureLoader] Cached texture was disposed, reloading: ${path}`);
        this.textureCache.delete(cacheKey);
      }
    }

    const pk3 = PK3Loader.getInstance();
    let data = await pk3.getFile(path);

    // Fallback: check for a loose file (loose assets that aren't packed into a
    // loaded pk3). Try the game() root AND the PK3 search roots (e.g. "data/") —
    // in some layouts loose model/HUD assets serve from the pk3 root, not the
    // game() root, so we probe both.
    if (!data) {
      const { GamePaths } = await import("../../core/GamePaths");
      const candidateUrls = [
        GamePaths.getInstance().game(path),
        ...pk3.getSearchPaths().map((base) => `${base}${path.replace(/^\//, "")}`),
      ];
      for (const url of candidateUrls) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          // Vite dev server returns 200 OK with HTML for non-existent files (SPA
          // fallback), so reject HTML to avoid treating a page as texture data.
          const contentType = response.headers.get("Content-Type") || "";
          if (contentType.includes("text/html")) continue;
          data = await response.arrayBuffer();
          break;
        } catch {
          // try the next candidate
        }
      }
    }

    if (!data) {
      return null;
    }

    const ext = this.getExtension(path).toLowerCase();
    let texture: Texture | null = null;

    // Detect actual format by magic bytes (handles misnamed files like .tga that are actually JPG/PNG)
    const actualFormat = this.detectFormatByMagic(data);
    const effectiveFormat = actualFormat || ext;

    try {
      if (ext === ".ktx") {
        texture = await this.loadKTXTexture(path, data);
      } else if (effectiveFormat === ".tga") {
        texture = await this.loadTGATexture(path, data);
      } else if (
        effectiveFormat === ".jpg" ||
        effectiveFormat === ".jpeg" ||
        effectiveFormat === ".png" ||
        effectiveFormat === ".webp"
      ) {
        // Handle files that are actually JPG/PNG regardless of extension
        texture = await this.loadStandardTexture(path, data, effectiveFormat);
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

      // Try createTextureFromKTX1 first — it handles:
      // 1. Babylon-managed compressed upload (if device supports it)
      // 2. Software decode (DXT1/3/5, ETC1)
      // 3. Uncompressed KTX data
      const internalTexture = await createTextureFromKTX1(this.engine, ktx, path);
      if (!internalTexture) {
        console.warn(`[PK3TextureLoader] KTX format unsupported: ${ktx.formatName}, trying fallback for ${path}`);
        return this.loadKTXFallback(path);
      }

      // The public wrapper applies Babylon's compressed-texture orientation
      // metadata. Wait for it before handing the texture to material factories.
      return await new Promise<Texture>((resolve, reject) => {
        const texture = new Texture(null, this.scene, {
          internalTexture,
          noMipmap: !internalTexture.generateMipMaps,
          invertY: false,
          onLoad: () => resolve(texture),
          onError: (message) => {
            texture.dispose();
            reject(new Error(message));
          },
        });
        texture.name = path;
      });
    } catch (e) {
      console.error(`[PK3TextureLoader] KTX load error for ${path}:`, e);
      return this.loadKTXFallback(path);
    }
  }

  /**
   * When KTX format is unsupported, try to find the same texture in JPG/PNG/TGA
   */
  private async loadKTXFallback(ktxPath: string): Promise<Texture | null> {
    const basePath = ktxPath.replace(/\.ktx$/i, "");
    const pk3 = PK3Loader.getInstance();

    for (const altExt of [".jpg", ".png", ".tga"]) {
      const altPath = basePath + altExt;
      const altData = await pk3.getFile(altPath);
      if (altData) {
        console.log(`[PK3TextureLoader] KTX fallback: ${ktxPath} -> ${altPath}`);
        // Load directly to avoid infinite recursion through loadTexture
        if (altExt === ".tga") {
          return this.loadTGATexture(altPath, altData);
        } else {
          return this.loadStandardTexture(altPath, altData, altExt);
        }
      }
    }

    // No alternative found
    return this.createPlaceholderTexture(ktxPath);
  }

  /**
   * Load TGA texture
   */
  private async loadTGATexture(path: string, data: ArrayBuffer): Promise<Texture | null> {
    if (!this.scene) return null;

    try {
      const tgaData = this.parseTGA(data, path);
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
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };

    const mimeType = mimeTypes[ext] || "application/octet-stream";
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
   * Detect actual file format by examining magic bytes
   * Returns the detected extension (.png, .jpg, etc.) or null if unknown
   */
  private detectFormatByMagic(data: ArrayBuffer): string | null {
    if (data.byteLength < 4) return null;
    const view = new Uint8Array(data, 0, 12);

    // PNG: 89 50 4E 47 (‰PNG)
    if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) {
      return ".png";
    }

    // JPEG/JFIF: FF D8 FF
    if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
      return ".jpg";
    }

    // WebP: RIFF....WEBP
    if (
      view[0] === 0x52 &&
      view[1] === 0x49 &&
      view[2] === 0x46 &&
      view[3] === 0x46 &&
      view[8] === 0x57 &&
      view[9] === 0x45 &&
      view[10] === 0x42 &&
      view[11] === 0x50
    ) {
      return ".webp";
    }

    // TGA has no magic bytes, but we can identify it's NOT TGA if it starts with known magic
    // If none of the above, assume it might be TGA and let the parser handle it
    return null;
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
        pixels[i] = c; // R
        pixels[i + 1] = c; // G
        pixels[i + 2] = c; // B
        pixels[i + 3] = 255; // A
      }
    }

    const texture = RawTexture.CreateRGBATexture(pixels, size, size, this.scene, true, false);
    texture.name = `placeholder:${name}`;

    return texture;
  }

  /**
   * Parse TGA file format
   */
  private parseTGA(data: ArrayBuffer, path: string = ""): { pixels: Uint8Array; width: number; height: number } | null {
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

    // Support: uncompressed true-color (2), uncompressed grayscale (3), RLE true-color (10), RLE grayscale (11)
    if (imageType !== 2 && imageType !== 3 && imageType !== 10 && imageType !== 11) {
      // Check if this might be a JPEG or PNG with wrong extension
      const magic0 = uint8[0],
        magic1 = uint8[1],
        magic2 = uint8[2];
      const isPNG = magic0 === 0x89 && magic1 === 0x50 && magic2 === 0x4e;
      const isJPG = magic0 === 0xff && magic1 === 0xd8 && magic2 === 0xff;
      if (isPNG) {
        console.warn(`[TGA] File is actually a PNG (wrong extension): ${path}`);
      } else if (isJPG) {
        console.warn(`[TGA] File is actually a JPEG (wrong extension): ${path}`);
      } else {
        console.warn(
          `[TGA] Unsupported image type: ${imageType} for ${path} (header: idLen=${idLength}, colorMap=${colorMapType})`,
        );
      }
      return null;
    }

    // Grayscale types (3, 11)
    const isGrayscale = imageType === 3 || imageType === 11;

    if (colorMapType !== 0) {
      console.warn(`[TGA] Color-mapped TGA not supported: ${path}`);
      return null;
    }

    const bytesPerPixel = bpp / 8;
    if (isGrayscale) {
      if (bytesPerPixel !== 1 && bytesPerPixel !== 2) {
        console.warn(`[TGA] Unsupported grayscale BPP: ${bpp} for ${path}`);
        return null;
      }
    } else if (bytesPerPixel !== 3 && bytesPerPixel !== 4) {
      console.warn(`[TGA] Unsupported BPP: ${bpp} for ${path}`);
      return null;
    }

    const headerSize = 18 + idLength;
    const pixels = new Uint8Array(width * height * 4);

    // Check if image is flipped
    const isTopToBottom = (descriptor & 0x20) !== 0;

    if (isGrayscale && imageType === 3) {
      // Uncompressed grayscale
      let srcOffset = headerSize;
      for (let y = 0; y < height; y++) {
        const destY = isTopToBottom ? y : height - 1 - y;
        for (let x = 0; x < width; x++) {
          const destOffset = (destY * width + x) * 4;
          const lum = uint8[srcOffset];
          pixels[destOffset] = lum; // R
          pixels[destOffset + 1] = lum; // G
          pixels[destOffset + 2] = lum; // B
          pixels[destOffset + 3] = bytesPerPixel === 2 ? uint8[srcOffset + 1] : 255; // A
          srcOffset += bytesPerPixel;
        }
      }
    } else if (isGrayscale && imageType === 11) {
      // RLE grayscale
      let srcOffset = headerSize;
      let pixelIndex = 0;
      while (pixelIndex < width * height) {
        const packet = uint8[srcOffset++];
        const count = (packet & 0x7f) + 1;
        const isRLEPacket = (packet & 0x80) !== 0;
        if (isRLEPacket) {
          const lum = uint8[srcOffset];
          const a = bytesPerPixel === 2 ? uint8[srcOffset + 1] : 255;
          srcOffset += bytesPerPixel;
          for (let i = 0; i < count; i++) {
            const y = Math.floor(pixelIndex / width);
            const x = pixelIndex % width;
            const destY = isTopToBottom ? y : height - 1 - y;
            const destOffset = (destY * width + x) * 4;
            pixels[destOffset] = lum;
            pixels[destOffset + 1] = lum;
            pixels[destOffset + 2] = lum;
            pixels[destOffset + 3] = a;
            pixelIndex++;
          }
        } else {
          for (let i = 0; i < count; i++) {
            const y = Math.floor(pixelIndex / width);
            const x = pixelIndex % width;
            const destY = isTopToBottom ? y : height - 1 - y;
            const destOffset = (destY * width + x) * 4;
            const lum = uint8[srcOffset];
            pixels[destOffset] = lum;
            pixels[destOffset + 1] = lum;
            pixels[destOffset + 2] = lum;
            pixels[destOffset + 3] = bytesPerPixel === 2 ? uint8[srcOffset + 1] : 255;
            srcOffset += bytesPerPixel;
            pixelIndex++;
          }
        }
      }
    } else if (imageType === 2) {
      // Uncompressed truecolor
      let srcOffset = headerSize;

      for (let y = 0; y < height; y++) {
        const destY = isTopToBottom ? y : height - 1 - y;

        for (let x = 0; x < width; x++) {
          const destOffset = (destY * width + x) * 4;

          // TGA is BGR(A)
          pixels[destOffset + 2] = uint8[srcOffset]; // B -> R
          pixels[destOffset + 1] = uint8[srcOffset + 1]; // G -> G
          pixels[destOffset] = uint8[srcOffset + 2]; // R -> B
          pixels[destOffset + 3] = bytesPerPixel === 4 ? uint8[srcOffset + 3] : 255;

          srcOffset += bytesPerPixel;
        }
      }
    } else {
      // RLE truecolor (type 10)
      let srcOffset = headerSize;
      let pixelIndex = 0;

      while (pixelIndex < width * height) {
        const packet = uint8[srcOffset++];
        const count = (packet & 0x7f) + 1;
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
            const destY = isTopToBottom ? y : height - 1 - y;
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
            const destY = isTopToBottom ? y : height - 1 - y;
            const destOffset = (destY * width + x) * 4;

            pixels[destOffset + 2] = uint8[srcOffset]; // B
            pixels[destOffset + 1] = uint8[srcOffset + 1]; // G
            pixels[destOffset] = uint8[srcOffset + 2]; // R
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
    const basePath = diffusePath.replace(/\.[^.]+$/, "");
    const pk3 = PK3Loader.getInstance();

    // Find companion textures
    const glossPatterns = [`${basePath}_gloss`, `${basePath}_spec`];
    const normPatterns = [`${basePath}_norm`, `${basePath}_normal`];

    let glossPath: string | undefined;
    let normPath: string | undefined;

    // Check common extensions for companions
    const exts = [".tga", ".ktx", ".png", ".jpg"];

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
      name: basePath.split("/").pop() || "unknown",
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
    return match ? match[0] : "";
  }

  private getBaseName(path: string): string {
    return path.split("/").pop() || path;
  }

  private isTextureFile(path: string): boolean {
    const ext = this.getExtension(path).toLowerCase();
    return [".ktx", ".tga", ".png", ".jpg", ".jpeg", ".dds"].includes(ext);
  }

  /**
   * Clear texture cache
   */
  public clearCache(): void {
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
    this.ktx2ManifestPromise = null;
    this.failedKTX2Sidecars.clear();
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

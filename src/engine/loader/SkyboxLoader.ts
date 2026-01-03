/**
 * SkyboxLoader - Load Q3/Warsow skybox textures from PK3s
 *
 * Handles the 6-face skybox format used by Quake 3 and Warsow:
 * - Loads textures with suffixes: _ft, _bk, _lf, _rt, _up, _dn
 * - Supports TGA, JPG, PNG formats
 * - Creates Babylon.js skybox mesh with proper coordinate mapping
 */

import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Color3,
  RawCubeTexture,
  Mesh,
  Constants,
} from "babylonjs";
import { PK3Loader } from "./PK3Loader";

// Q3 skybox face suffixes
const Q3_FACE_SUFFIXES = ['_ft', '_bk', '_lf', '_rt', '_up', '_dn'] as const;
// Indices:                  0     1     2     3     4     5

// From Q3 source (tr_sky.c):
// Q3 axis: 0=rt(+X), 1=lf(-X), 2=ft(+Y), 3=bk(-Y), 4=up(+Z), 5=dn(-Z)
// Q3 applies "t = 1.0 - t" which flips textures vertically
//
// Babylon.js cube texture face order: px, py, pz, nx, ny, nz
// px = +X (right), py = +Y (up), pz = +Z (front)
// nx = -X (left), ny = -Y (down), nz = -Z (back)
//
// Q3 coordinate system: +X=right, +Y=forward, +Z=up
// Babylon.js: +X=right, +Y=up, +Z=forward
// So Q3's +Y (front) maps to Babylon's +Z, Q3's +Z (up) maps to Babylon's +Y
//
// Transform types for face orientation
type FaceTransform = 'none' | 'flipH' | 'flipV' | 'rotate180' | 'rotate90CW' | 'rotate90CCW';

// Q3 suffixes: ft=0, bk=1, lf=2, rt=3, up=4, dn=5
//
// From Anton's OpenGL cubemap tutorial:
// OpenGL cubemap convention: front=-Z, back=+Z, top=+Y, bottom=-Y, left=-X, right=+X
//
// Babylon RawCubeTexture order: px, py, pz, nx, ny, nz (+X, +Y, +Z, -X, -Y, -Z)
// Mapping based on OpenGL standard:
const Q3_TO_BABYLON_FACE_MAP: { index: number; transform: FaceTransform }[] = [
  { index: 3, transform: 'none' },  // px (+X/right) <- rt
  { index: 4, transform: 'none' },  // py (+Y/top) <- up
  { index: 1, transform: 'none' },  // pz (+Z/back) <- bk  *** BACK goes to +Z ***
  { index: 2, transform: 'none' },  // nx (-X/left) <- lf
  { index: 5, transform: 'none' },  // ny (-Y/bottom) <- dn
  { index: 0, transform: 'none' },  // nz (-Z/front) <- ft  *** FRONT goes to -Z ***
];

export interface SkyboxLoadResult {
  /** Whether loading was successful */
  success: boolean;
  /** The created skybox mesh (if successful) */
  skybox?: Mesh;
  /** Error message (if failed) */
  error?: string;
  /** Loaded texture paths for debugging */
  loadedFaces?: string[];
}

export class SkyboxLoader {
  private static instance: SkyboxLoader;
  private scene: Scene | null = null;

  private constructor() {}

  static getInstance(): SkyboxLoader {
    if (!SkyboxLoader.instance) {
      SkyboxLoader.instance = new SkyboxLoader();
    }
    return SkyboxLoader.instance;
  }

  /**
   * Initialize with scene
   */
  init(scene: Scene): void {
    this.scene = scene;
  }

  /**
   * Load skybox from Q3 skybox path
   * @param basePath - Base path without suffix (e.g., "env/stormydays/stormydays")
   * @param size - Skybox size (default 10000)
   */
  async loadSkybox(basePath: string, size: number = 10000): Promise<SkyboxLoadResult> {
    if (!this.scene) {
      return { success: false, error: "SkyboxLoader not initialized" };
    }

    console.log(`[SkyboxLoader] Loading skybox: ${basePath}`);

    // Try to load all 6 faces
    const faceImages: (Uint8Array | null)[] = [];
    const loadedFaces: string[] = [];
    let faceSize = 0;

    for (const suffix of Q3_FACE_SUFFIXES) {
      const result = await this.loadSkyboxFace(basePath, suffix);
      if (!result) {
        return {
          success: false,
          error: `Failed to load skybox face: ${basePath}${suffix}`,
        };
      }
      faceImages.push(result.data);
      loadedFaces.push(result.path);
      if (faceSize === 0) {
        faceSize = result.size;
      }
    }

    console.log(`[SkyboxLoader] Loaded ${faceImages.length} faces (${faceSize}x${faceSize})`);

    // Reorder and transform faces from Q3 order to Babylon.js order
    const babylonFaces: Uint8Array[] = [];
    for (const mapping of Q3_TO_BABYLON_FACE_MAP) {
      const srcData = faceImages[mapping.index]!;
      const transformed = this.transformFace(srcData, faceSize, mapping.transform);
      babylonFaces.push(transformed);
    }

    // Create RawCubeTexture
    const cubeTexture = new RawCubeTexture(
      this.scene,
      babylonFaces,
      faceSize,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_UNSIGNED_INT,
      false, // generateMipMaps
      false, // invertY
      Texture.TRILINEAR_SAMPLINGMODE
    );
    cubeTexture.name = `skybox_${basePath.replace(/\//g, '_')}`;

    // Create skybox mesh
    const skybox = MeshBuilder.CreateBox("skybox", { size }, this.scene);
    skybox.infiniteDistance = true;
    skybox.renderingGroupId = 0; // Render first

    // Create skybox material
    const skyMaterial = new StandardMaterial("skyboxMat", this.scene);
    skyMaterial.backFaceCulling = false;
    skyMaterial.reflectionTexture = cubeTexture;
    skyMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    skyMaterial.disableLighting = true;
    skyMaterial.diffuseColor = new Color3(0, 0, 0);
    skyMaterial.specularColor = new Color3(0, 0, 0);

    skybox.material = skyMaterial;

    console.log(`[SkyboxLoader] Created skybox mesh`);

    return {
      success: true,
      skybox,
      loadedFaces,
    };
  }

  /**
   * Load a single skybox face texture
   */
  private async loadSkyboxFace(
    basePath: string,
    suffix: string
  ): Promise<{ data: Uint8Array; size: number; path: string } | null> {
    const pk3 = PK3Loader.getInstance();
    const extensions = ['.tga', '.jpg', '.png', '.jpeg'];

    // Try different path prefixes
    const pathPrefixes = ['', 'textures/'];

    for (const prefix of pathPrefixes) {
      for (const ext of extensions) {
        const fullPath = `${prefix}${basePath}${suffix}${ext}`;
        const data = await pk3.getFile(fullPath);

        if (data) {
          // Parse the image to get RGBA data
          const rgba = await this.parseImageToRGBA(new Uint8Array(data), ext);
          if (rgba) {
            console.log(`[SkyboxLoader] Loaded face: ${fullPath} (${rgba.size}x${rgba.size})`);
            return { data: rgba.data, size: rgba.size, path: fullPath };
          }
        }
      }
    }

    return null;
  }

  /**
   * Parse image data to RGBA Uint8Array
   */
  private async parseImageToRGBA(
    data: Uint8Array,
    ext: string
  ): Promise<{ data: Uint8Array; size: number } | null> {
    if (ext === '.tga') {
      return this.parseTGAToRGBA(data);
    }

    // For JPG/PNG, use browser's image decoding
    return await this.parseStandardImageToRGBA(data, ext);
  }

  /**
   * Parse TGA to RGBA
   */
  private parseTGAToRGBA(data: Uint8Array): { data: Uint8Array; size: number } | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const idLength = view.getUint8(0);
    const colorMapType = view.getUint8(1);
    const imageType = view.getUint8(2);
    const width = view.getUint16(12, true);
    const height = view.getUint16(14, true);
    const bpp = view.getUint8(16);
    const descriptor = view.getUint8(17);

    // Only support uncompressed (2) and RLE (10) true-color
    if (imageType !== 2 && imageType !== 10) {
      console.warn(`[SkyboxLoader] Unsupported TGA type: ${imageType}`);
      return null;
    }

    if (colorMapType !== 0) {
      console.warn(`[SkyboxLoader] Color-mapped TGA not supported`);
      return null;
    }

    const bytesPerPixel = bpp / 8;
    if (bytesPerPixel !== 3 && bytesPerPixel !== 4) {
      console.warn(`[SkyboxLoader] Unsupported TGA BPP: ${bpp}`);
      return null;
    }

    const headerSize = 18 + idLength;
    const pixels = new Uint8Array(width * height * 4);
    const isTopToBottom = (descriptor & 0x20) !== 0;

    if (imageType === 2) {
      // Uncompressed
      let srcOffset = headerSize;
      for (let y = 0; y < height; y++) {
        const destY = isTopToBottom ? y : height - 1 - y;
        for (let x = 0; x < width; x++) {
          const destOffset = (destY * width + x) * 4;
          pixels[destOffset + 0] = data[srcOffset + 2]; // R
          pixels[destOffset + 1] = data[srcOffset + 1]; // G
          pixels[destOffset + 2] = data[srcOffset + 0]; // B
          pixels[destOffset + 3] = bytesPerPixel === 4 ? data[srcOffset + 3] : 255;
          srcOffset += bytesPerPixel;
        }
      }
    } else {
      // RLE compressed
      let srcOffset = headerSize;
      let pixelIndex = 0;

      while (pixelIndex < width * height) {
        const packet = data[srcOffset++];
        const count = (packet & 0x7f) + 1;
        const isRLE = (packet & 0x80) !== 0;

        if (isRLE) {
          const b = data[srcOffset];
          const g = data[srcOffset + 1];
          const r = data[srcOffset + 2];
          const a = bytesPerPixel === 4 ? data[srcOffset + 3] : 255;
          srcOffset += bytesPerPixel;

          for (let i = 0; i < count; i++) {
            const y = Math.floor(pixelIndex / width);
            const x = pixelIndex % width;
            const destY = isTopToBottom ? y : height - 1 - y;
            const destOffset = (destY * width + x) * 4;
            pixels[destOffset + 0] = r;
            pixels[destOffset + 1] = g;
            pixels[destOffset + 2] = b;
            pixels[destOffset + 3] = a;
            pixelIndex++;
          }
        } else {
          for (let i = 0; i < count; i++) {
            const y = Math.floor(pixelIndex / width);
            const x = pixelIndex % width;
            const destY = isTopToBottom ? y : height - 1 - y;
            const destOffset = (destY * width + x) * 4;
            pixels[destOffset + 0] = data[srcOffset + 2]; // R
            pixels[destOffset + 1] = data[srcOffset + 1]; // G
            pixels[destOffset + 2] = data[srcOffset + 0]; // B
            pixels[destOffset + 3] = bytesPerPixel === 4 ? data[srcOffset + 3] : 255;
            srcOffset += bytesPerPixel;
            pixelIndex++;
          }
        }
      }
    }

    return { data: pixels, size: width }; // Assuming square skybox faces
  }

  /**
   * Parse standard image formats (JPG, PNG) to RGBA
   */
  private async parseStandardImageToRGBA(
    data: Uint8Array,
    ext: string
  ): Promise<{ data: Uint8Array; size: number } | null> {
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
    };

    const mimeType = mimeTypes[ext];
    if (!mimeType) return null;

    return new Promise((resolve) => {
      // Create a proper ArrayBuffer copy for Blob compatibility
      const buffer = new ArrayBuffer(data.length);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        resolve({
          data: new Uint8Array(imageData.data.buffer),
          size: img.width,
        });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };

      img.src = url;
    });
  }

  /**
   * Transform a face image (flip/rotate) to match Babylon.js expectations
   */
  private transformFace(
    data: Uint8Array,
    size: number,
    transform: FaceTransform
  ): Uint8Array {
    if (transform === 'none') {
      return data;
    }

    const result = new Uint8Array(data.length);
    const pixelSize = 4; // RGBA

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const srcIdx = (y * size + x) * pixelSize;
        let destX = x;
        let destY = y;

        switch (transform) {
          case 'flipH':
            destX = size - 1 - x;
            break;
          case 'flipV':
            destY = size - 1 - y;
            break;
          case 'rotate180':
            destX = size - 1 - x;
            destY = size - 1 - y;
            break;
          case 'rotate90CW':
            // 90° clockwise: (x,y) -> (size-1-y, x)
            destX = size - 1 - y;
            destY = x;
            break;
          case 'rotate90CCW':
            // 90° counter-clockwise: (x,y) -> (y, size-1-x)
            destX = y;
            destY = size - 1 - x;
            break;
        }

        const destIdx = (destY * size + destX) * pixelSize;
        result[destIdx + 0] = data[srcIdx + 0];
        result[destIdx + 1] = data[srcIdx + 1];
        result[destIdx + 2] = data[srcIdx + 2];
        result[destIdx + 3] = data[srcIdx + 3];
      }
    }

    return result;
  }

  /**
   * Remove existing skybox from scene
   */
  disposeSkybox(): void {
    if (!this.scene) return;

    const existing = this.scene.getMeshByName("skybox");
    if (existing) {
      existing.dispose();
      console.log(`[SkyboxLoader] Disposed existing skybox`);
    }
  }
}

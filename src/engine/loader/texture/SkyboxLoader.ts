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
import { PK3Loader } from "../pk3/PK3Loader";

// Q3 skybox face suffixes - MUST match Q3 tr_shader.c order!
// From Q3 source: static char *suf[6] = {"rt", "bk", "lf", "ft", "up", "dn"};
const Q3_FACE_SUFFIXES = ['_rt', '_bk', '_lf', '_ft', '_up', '_dn'] as const;
// Indices:                  0     1     2     3     4     5

// Q3 coordinate system: +X=right, +Y=forward, +Z=up (right-handed, Z-up)
// Babylon.js: +X=right, +Y=up, +Z=forward (left-handed, Y-up)
//
// Coordinate conversion: Q3_Y → Babylon_Z, Q3_Z → Babylon_Y
//
// Q3 faces and their directions:
//   rt(0) = looking toward +X (right)
//   bk(1) = looking toward -Y (back in Q3)
//   lf(2) = looking toward -X (left)
//   ft(3) = looking toward +Y (front in Q3)
//   up(4) = looking toward +Z (up in Q3)
//   dn(5) = looking toward -Z (down in Q3)
//
// Babylon RawCubeTexture order: px, py, pz, nx, ny, nz
//   px = face looking toward +X
//   py = face looking toward +Y (up in Babylon)
//   pz = face looking toward +Z (forward in Babylon)
//   nx = face looking toward -X
//   ny = face looking toward -Y (down in Babylon)
//   nz = face looking toward -Z (back in Babylon)
//
// Mapping (Q3 face → Babylon face):
//   Q3 rt(+X) → px (+X) - same axis
//   Q3 ft(+Y in Q3 = +Z in Babylon) → pz
//   Q3 up(+Z in Q3 = +Y in Babylon) → py
//   Q3 lf(-X) → nx (-X) - same axis
//   Q3 bk(-Y in Q3 = -Z in Babylon) → nz
//   Q3 dn(-Z in Q3 = -Y in Babylon) → ny

type FaceTransform = 'none' | 'flipH' | 'flipV' | 'rotate180' | 'rotate90CW' | 'rotate90CCW' | 'rotate90CW_flipH' | 'rotate90CCW_flipH';

// Q3 index → Babylon face position
// CORRECTED: Babylon RawCubeTexture order is actually: [nx, px, py, ny, nz, pz]
// NOT [px, py, pz, nx, ny, nz] as commonly documented!
//
// From Q3 array: [rt, bk, lf, ft, up, dn] = indices [0, 1, 2, 3, 4, 5]
//
// Babylon slot → direction → Q3 face:
// slot 0 (nx/-X/left)  ← Q3 lf (index 2)
// slot 1 (px/+X/right) ← Q3 rt (index 0)
// slot 2 (py/+Y/up)    ← Q3 up (index 4) - Q3 +Z maps to Babylon +Y
// slot 3 (ny/-Y/down)  ← Q3 dn (index 5) - Q3 -Z maps to Babylon -Y
// slot 4 (nz/-Z/back)  ← Q3 bk (index 1) - Q3 -Y maps to Babylon -Z
// slot 5 (pz/+Z/front) ← Q3 ft (index 3) - Q3 +Y maps to Babylon +Z
//
// Handedness correction: Q3 is right-handed, Babylon is left-handed
// This causes horizontal mirroring on most faces. DN (floor) confirmed correct with 'none'.
const Q3_TO_BABYLON_FACE_MAP: { index: number; transform: FaceTransform }[] = [
  { index: 2, transform: 'flipH' },           // slot 0: nx ← lf
  { index: 0, transform: 'flipH' },           // slot 1: px ← rt
  { index: 4, transform: 'rotate90CCW_flipH' }, // slot 2: py ← up (ceiling works!)
  { index: 5, transform: 'rotate90CW_flipH' },  // slot 3: ny ← dn (floor faces opposite, try opposite rotation)
  { index: 1, transform: 'flipH' },           // slot 4: nz ← bk
  { index: 3, transform: 'flipH' },           // slot 5: pz ← ft
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

  private constructor() { }

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
    // Babylon RawCubeTexture actual order: nx, px, py, ny, nz, pz
    const babylonFaceNames = ['nx(-X/left)', 'px(+X/right)', 'py(+Y/up)', 'ny(-Y/down)', 'nz(-Z/back)', 'pz(+Z/front)'];
    const q3FaceNames = ['rt', 'bk', 'lf', 'ft', 'up', 'dn'];

    console.log(`[SkyboxLoader] Face mapping (Q3 → Babylon):`);
    const babylonFaces: Uint8Array[] = [];
    for (let i = 0; i < Q3_TO_BABYLON_FACE_MAP.length; i++) {
      const mapping = Q3_TO_BABYLON_FACE_MAP[i];
      const srcData = faceImages[mapping.index]!;
      const transformed = this.transformFace(srcData, faceSize, mapping.transform);
      babylonFaces.push(transformed);

      console.log(`  ${babylonFaceNames[i]} ← Q3 ${q3FaceNames[mapping.index]} (transform: ${mapping.transform})`);
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
          case 'rotate90CW_flipH':
            // rotate90CW then flipH: (x,y) -> (size-1-y, x) -> (y, x)
            destX = y;
            destY = x;
            break;
          case 'rotate90CCW_flipH':
            // rotate90CCW then flipH: (x,y) -> (y, size-1-x) -> (size-1-y, size-1-x)
            destX = size - 1 - y;
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

  /**
   * Create a debug skybox with colored/labeled faces
   * This helps identify the correct face mapping visually
   */
  createDebugSkybox(size: number = 10000): SkyboxLoadResult {
    if (!this.scene) {
      return { success: false, error: "SkyboxLoader not initialized" };
    }

    console.log(`[SkyboxLoader] Creating DEBUG skybox with colored faces`);

    const faceSize = 256;

    // Q3 face colors and labels - loaded in Q3 order
    // These will be reordered to Babylon order using Q3_TO_BABYLON_FACE_MAP
    const q3Faces = [
      { name: 'RT', color: [255, 0, 0] },      // 0: rt - RED
      { name: 'BK', color: [0, 255, 0] },      // 1: bk - GREEN
      { name: 'LF', color: [0, 0, 255] },      // 2: lf - BLUE
      { name: 'FT', color: [255, 255, 0] },    // 3: ft - YELLOW
      { name: 'UP', color: [255, 0, 255] },    // 4: up - MAGENTA
      { name: 'DN', color: [0, 255, 255] },    // 5: dn - CYAN
    ];

    // Generate Q3 debug face textures
    const q3FaceData: Uint8Array[] = [];
    for (let i = 0; i < 6; i++) {
      const face = q3Faces[i];
      q3FaceData.push(this.generateDebugFace(faceSize, face.name, face.color as [number, number, number]));
    }

    // Reorder and transform faces from Q3 order to Babylon.js order
    // Babylon RawCubeTexture actual order: nx, px, py, ny, nz, pz
    const babylonFaceNames = ['nx(-X/left)', 'px(+X/right)', 'py(+Y/up)', 'ny(-Y/down)', 'nz(-Z/back)', 'pz(+Z/front)'];
    const q3FaceNames = ['rt', 'bk', 'lf', 'ft', 'up', 'dn'];

    console.log(`[SkyboxLoader] DEBUG Face mapping (Q3 → Babylon):`);
    const babylonFaces: Uint8Array[] = [];
    for (let i = 0; i < Q3_TO_BABYLON_FACE_MAP.length; i++) {
      const mapping = Q3_TO_BABYLON_FACE_MAP[i];
      const srcData = q3FaceData[mapping.index];
      const transformed = this.transformFace(srcData, faceSize, mapping.transform);
      babylonFaces.push(transformed);

      console.log(`  ${babylonFaceNames[i]} ← Q3 ${q3FaceNames[mapping.index]} (${q3Faces[mapping.index].name}, transform: ${mapping.transform})`);
    }

    // Create RawCubeTexture
    const cubeTexture = new RawCubeTexture(
      this.scene,
      babylonFaces,
      faceSize,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_UNSIGNED_INT,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    cubeTexture.name = 'skybox_debug';

    // Create skybox mesh
    const skybox = MeshBuilder.CreateBox("skybox", { size }, this.scene);
    skybox.infiniteDistance = true;
    skybox.renderingGroupId = 0;

    const skyMaterial = new StandardMaterial("skyboxMat", this.scene);
    skyMaterial.backFaceCulling = false;
    skyMaterial.reflectionTexture = cubeTexture;
    skyMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    skyMaterial.disableLighting = true;
    skyMaterial.diffuseColor = new Color3(0, 0, 0);
    skyMaterial.specularColor = new Color3(0, 0, 0);

    skybox.material = skyMaterial;

    console.log(`[SkyboxLoader] DEBUG skybox created. Look around to identify faces:`);
    console.log(`  RT (red) should be on your RIGHT`);
    console.log(`  LF (blue) should be on your LEFT`);
    console.log(`  FT (yellow) should be in FRONT`);
    console.log(`  BK (green) should be BEHIND you`);
    console.log(`  UP (magenta) should be ABOVE`);
    console.log(`  DN (cyan) should be BELOW`);
    console.log(`  The TOP marker indicates which edge should be up`);

    return { success: true, skybox };
  }

  /**
   * Generate a debug face with color and label
   */
  private generateDebugFace(
    size: number,
    label: string,
    color: [number, number, number]
  ): Uint8Array {
    const data = new Uint8Array(size * size * 4);
    const [r, g, b] = color;

    // Fill with solid color
    for (let i = 0; i < size * size; i++) {
      data[i * 4 + 0] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }

    // Draw border (white)
    const borderWidth = Math.floor(size / 32);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < borderWidth || x >= size - borderWidth ||
          y < borderWidth || y >= size - borderWidth) {
          const i = (y * size + x) * 4;
          data[i + 0] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = 255;
        }
      }
    }

    // Draw label in center (simple pixel font)
    this.drawLabel(data, size, label, Math.floor(size / 2), Math.floor(size / 2));

    // Draw "TOP" marker at the top edge to show orientation
    this.drawLabel(data, size, 'TOP', Math.floor(size / 2), Math.floor(size / 6));

    // Draw arrow pointing up to show orientation
    const arrowCenterX = Math.floor(size / 2);
    const arrowCenterY = Math.floor(size * 0.35);
    const arrowSize = Math.floor(size / 8);
    this.drawArrowUp(data, size, arrowCenterX, arrowCenterY, arrowSize);

    return data;
  }

  /**
   * Draw a simple text label using a pixel font
   */
  private drawLabel(
    data: Uint8Array,
    size: number,
    text: string,
    centerX: number,
    centerY: number
  ): void {
    // Simple 5x7 pixel font for capital letters and numbers
    const font: Record<string, number[]> = {
      'A': [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
      'B': [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
      'C': [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
      'D': [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
      'E': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
      'F': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
      'G': [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
      'H': [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
      'I': [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
      'K': [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
      'L': [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
      'N': [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
      'O': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
      'P': [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
      'R': [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
      'T': [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
      'U': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
      ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
    };

    const charWidth = 5;
    const charHeight = 7;
    const scale = Math.floor(size / 32);
    const spacing = 1;

    const totalWidth = text.length * (charWidth + spacing) * scale - spacing * scale;
    const startX = centerX - Math.floor(totalWidth / 2);
    const startY = centerY - Math.floor((charHeight * scale) / 2);

    for (let charIdx = 0; charIdx < text.length; charIdx++) {
      const char = text[charIdx].toUpperCase();
      const charData = font[char];
      if (!charData) continue;

      const charStartX = startX + charIdx * (charWidth + spacing) * scale;

      for (let row = 0; row < charHeight; row++) {
        for (let col = 0; col < charWidth; col++) {
          if (charData[row] & (1 << (4 - col))) {
            // Draw scaled pixel (black text)
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = charStartX + col * scale + sx;
                const py = startY + row * scale + sy;
                if (px >= 0 && px < size && py >= 0 && py < size) {
                  const i = (py * size + px) * 4;
                  data[i + 0] = 0;
                  data[i + 1] = 0;
                  data[i + 2] = 0;
                  data[i + 3] = 255;
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Draw an upward-pointing arrow
   */
  private drawArrowUp(
    data: Uint8Array,
    size: number,
    centerX: number,
    centerY: number,
    arrowSize: number
  ): void {
    const scale = Math.floor(size / 64);

    // Arrow shaft
    for (let y = 0; y < arrowSize; y++) {
      for (let x = -scale; x <= scale; x++) {
        const px = centerX + x;
        const py = centerY + y;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          const i = (py * size + px) * 4;
          data[i + 0] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }

    // Arrow head
    for (let y = 0; y < arrowSize / 2; y++) {
      const width = Math.floor(y * 1.5) + scale;
      for (let x = -width; x <= width; x++) {
        const px = centerX + x;
        const py = centerY - y;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          const i = (py * size + px) * 4;
          data[i + 0] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
}

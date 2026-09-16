/**
 * HeightmapGenerator - Generate procedural heightmaps for terrain
 *
 * Creates 2D arrays of normalized height values (0-1) that can be used
 * by MapGenerator for terrain elevation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PNG } from "pngjs";
import { PerlinNoise } from "../engine/math/Noise";

export interface HeightmapConfig {
  width: number; // Width in pixels
  height: number; // Height in pixels
  seed?: number; // Random seed
}

export interface HeightmapPreset {
  name: string;
  generate: (config: HeightmapConfig) => number[][];
}

/**
 * Generate a heightmap using Perlin noise
 */
export function generatePerlinHeightmap(
  config: HeightmapConfig,
  options: {
    frequency?: number;
    octaves?: number;
    persistence?: number;
    lacunarity?: number;
  } = {},
): number[][] {
  const { frequency = 0.02, octaves = 4, persistence = 0.5, lacunarity = 2.0 } = options;

  const noise = new PerlinNoise(config.seed ?? Date.now());
  const data: number[][] = [];

  for (let y = 0; y < config.height; y++) {
    data[y] = [];
    for (let x = 0; x < config.width; x++) {
      let amplitude = 1;
      let freq = frequency;
      let value = 0;
      let maxValue = 0;

      for (let o = 0; o < octaves; o++) {
        value += noise.noise2D(x * freq, y * freq) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        freq *= lacunarity;
      }

      // Normalize to 0-1
      data[y][x] = (value / maxValue + 1) / 2;
    }
  }

  return data;
}

/**
 * Generate a heightmap with a central hill/mountain
 */
export function generateHillHeightmap(
  config: HeightmapConfig,
  options: {
    centerX?: number; // 0-1, default 0.5
    centerY?: number; // 0-1, default 0.5
    radius?: number; // 0-1, default 0.4
    falloff?: number; // Steepness, default 2
    noiseAmount?: number; // 0-1, default 0.2
  } = {},
): number[][] {
  const { centerX = 0.5, centerY = 0.5, radius = 0.4, falloff = 2, noiseAmount = 0.2 } = options;

  const noise = new PerlinNoise(config.seed ?? Date.now());
  const data: number[][] = [];

  for (let y = 0; y < config.height; y++) {
    data[y] = [];
    for (let x = 0; x < config.width; x++) {
      const u = x / (config.width - 1);
      const v = y / (config.height - 1);

      // Distance from center
      const dx = u - centerX;
      const dy = v - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Hill shape (inverse distance with falloff)
      let height = Math.max(0, 1 - (dist / radius) ** falloff);

      // Add noise for natural look
      if (noiseAmount > 0) {
        const noiseVal = (noise.noise2D(x * 0.05, y * 0.05) + 1) / 2;
        height = height * (1 - noiseAmount) + height * noiseVal * noiseAmount;
      }

      data[y][x] = Math.max(0, Math.min(1, height));
    }
  }

  return data;
}

/**
 * Generate a heightmap with multiple hills
 */
export function generateMultiHillHeightmap(
  config: HeightmapConfig,
  options: {
    hillCount?: number;
    minRadius?: number;
    maxRadius?: number;
    noiseAmount?: number;
  } = {},
): number[][] {
  const { hillCount = 5, minRadius = 0.15, maxRadius = 0.35, noiseAmount = 0.15 } = options;

  const rng = new PerlinNoise(config.seed ?? Date.now());
  const data: number[][] = [];

  // Initialize to zero
  for (let y = 0; y < config.height; y++) {
    data[y] = new Array(config.width).fill(0);
  }

  // Generate random hills
  const hills: Array<{ x: number; y: number; radius: number; height: number }> = [];
  for (let i = 0; i < hillCount; i++) {
    hills.push({
      x: 0.1 + rng.noise2D(i * 100, 0) * 0.4 + 0.4,
      y: 0.1 + rng.noise2D(0, i * 100) * 0.4 + 0.4,
      radius: minRadius + ((rng.noise2D(i * 50, i * 50) + 1) / 2) * (maxRadius - minRadius),
      height: 0.5 + ((rng.noise2D(i * 75, i * 25) + 1) / 2) * 0.5,
    });
  }

  // Accumulate hill heights
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const u = x / (config.width - 1);
      const v = y / (config.height - 1);

      let height = 0;
      for (const hill of hills) {
        const dx = u - hill.x;
        const dy = v - hill.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const contribution = Math.max(0, 1 - (dist / hill.radius) ** 2) * hill.height;
        height = Math.max(height, contribution);
      }

      // Add noise
      if (noiseAmount > 0) {
        const noiseVal = (rng.noise2D(x * 0.03, y * 0.03) + 1) / 2;
        height = height * (1 - noiseAmount) + height * noiseVal * noiseAmount * 2;
      }

      data[y][x] = Math.max(0, Math.min(1, height));
    }
  }

  return data;
}

/**
 * Generate a valley heightmap (high edges, low center)
 */
export function generateValleyHeightmap(
  config: HeightmapConfig,
  options: {
    valleyWidth?: number; // 0-1, default 0.3
    valleyDepth?: number; // 0-1, default 0.8
    noiseAmount?: number;
  } = {},
): number[][] {
  const { valleyWidth = 0.3, valleyDepth = 0.8, noiseAmount = 0.2 } = options;

  const noise = new PerlinNoise(config.seed ?? Date.now());
  const data: number[][] = [];

  for (let y = 0; y < config.height; y++) {
    data[y] = [];
    for (let x = 0; x < config.width; x++) {
      const u = x / (config.width - 1);
      const v = y / (config.height - 1);

      // Distance from center line (horizontal valley)
      // u available for vertical valley variant
      void u;
      const distFromCenter = Math.abs(v - 0.5) * 2;

      // Valley shape
      let height: number;
      if (distFromCenter < valleyWidth) {
        // In the valley
        height = (1 - valleyDepth) * (distFromCenter / valleyWidth);
      } else {
        // On the slopes
        const slopePos = (distFromCenter - valleyWidth) / (1 - valleyWidth);
        height = 1 - valleyDepth + slopePos * valleyDepth;
      }

      // Add noise
      if (noiseAmount > 0) {
        const noiseVal = (noise.noise2D(x * 0.04, y * 0.04) + 1) / 2;
        height += (noiseVal - 0.5) * noiseAmount;
      }

      data[y][x] = Math.max(0, Math.min(1, height));
    }
  }

  return data;
}

/**
 * Generate a plateau heightmap (flat top with steep edges)
 */
export function generatePlateauHeightmap(
  config: HeightmapConfig,
  options: {
    plateauRadius?: number; // 0-1, default 0.3
    edgeSharpness?: number; // Higher = sharper edges, default 8
    noiseAmount?: number;
  } = {},
): number[][] {
  const { plateauRadius = 0.3, edgeSharpness = 8, noiseAmount = 0.1 } = options;

  const noise = new PerlinNoise(config.seed ?? Date.now());
  const data: number[][] = [];

  for (let y = 0; y < config.height; y++) {
    data[y] = [];
    for (let x = 0; x < config.width; x++) {
      const u = x / (config.width - 1);
      const v = y / (config.height - 1);

      // Distance from center
      const dx = u - 0.5;
      const dy = v - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy) * 2;

      // Plateau shape using sigmoid-like function
      let height: number;
      if (dist < plateauRadius) {
        height = 1;
      } else {
        const t = (dist - plateauRadius) / (1 - plateauRadius);
        height = 1 / (1 + Math.exp(edgeSharpness * (t - 0.5)));
      }

      // Add noise to top surface
      if (noiseAmount > 0 && height > 0.5) {
        const noiseVal = (noise.noise2D(x * 0.05, y * 0.05) + 1) / 2;
        height += (noiseVal - 0.5) * noiseAmount * height;
      }

      data[y][x] = Math.max(0, Math.min(1, height));
    }
  }

  return data;
}

/**
 * Available heightmap presets
 */
export const HEIGHTMAP_PRESETS: Record<string, (config: HeightmapConfig) => number[][]> = {
  perlin: (config) => generatePerlinHeightmap(config),
  hill: (config) => generateHillHeightmap(config),
  multiHill: (config) => generateMultiHillHeightmap(config),
  valley: (config) => generateValleyHeightmap(config),
  plateau: (config) => generatePlateauHeightmap(config),
};

/**
 * Create a heightmap data structure for MapGenerator
 */
export function createHeightmapData(
  preset: keyof typeof HEIGHTMAP_PRESETS | ((config: HeightmapConfig) => number[][]),
  width: number = 64,
  height: number = 64,
  seed?: number,
): { data: number[][]; width: number; height: number } {
  const config: HeightmapConfig = { width, height, seed };

  const generator = typeof preset === "function" ? preset : HEIGHTMAP_PRESETS[preset];

  if (!generator) {
    throw new Error(`Unknown heightmap preset: ${preset}`);
  }

  return {
    data: generator(config),
    width,
    height,
  };
}

/**
 * Load a heightmap from a PNG file (grayscale or RGB - uses red channel or luminance)
 * Uses pngjs for proper PNG parsing
 */
export function loadHeightmapFromPNG(filePath: string): { data: number[][]; width: number; height: number } {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Heightmap file not found: ${absolutePath}`);
  }

  // Read and parse PNG file synchronously
  const buffer = fs.readFileSync(absolutePath);
  const png = PNG.sync.read(buffer);

  const { width, height } = png;
  const data: number[][] = [];

  console.log(`Loading heightmap: ${width}x${height} from ${path.basename(absolutePath)}`);

  for (let y = 0; y < height; y++) {
    data[y] = [];
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4; // RGBA format
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];

      // Use luminance formula for grayscale conversion
      // Or just use red channel if it's already grayscale
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      data[y][x] = luminance;
    }
  }

  return { data, width, height };
}

/**
 * Load heightmap from a simple raw grayscale file (8-bit per pixel)
 * Format: width (4 bytes) + height (4 bytes) + pixels (width * height bytes)
 */
export function loadHeightmapFromRaw(filePath: string): { data: number[][]; width: number; height: number } {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Heightmap file not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);

  const data: number[][] = [];
  let offset = 8;

  for (let y = 0; y < height; y++) {
    data[y] = [];
    for (let x = 0; x < width; x++) {
      // Normalize 0-255 to 0-1
      data[y][x] = buffer[offset++] / 255;
    }
  }

  console.log(`Loaded raw heightmap: ${width}x${height} from ${path.basename(absolutePath)}`);

  return { data, width, height };
}

/**
 * Save a heightmap to a raw grayscale file
 */
export function saveHeightmapToRaw(
  heightmap: { data: number[][]; width: number; height: number },
  filePath: string,
): void {
  const { data, width, height } = heightmap;
  const buffer = Buffer.alloc(8 + width * height);

  buffer.writeUInt32LE(width, 0);
  buffer.writeUInt32LE(height, 4);

  let offset = 8;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Convert 0-1 to 0-255
      buffer[offset++] = Math.round(Math.max(0, Math.min(1, data[y][x])) * 255);
    }
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  fs.writeFileSync(absolutePath, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  console.log(`Saved heightmap: ${width}x${height} to ${path.basename(absolutePath)}`);
}

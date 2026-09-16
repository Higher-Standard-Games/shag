/**
 * MapGenerator - Procedural map generator for ground geometry and roads
 *
 * Generates .map files compatible with the engine's Quake-style format.
 * Supports both brushDef (boxes) and patchDef2 (bezier curves).
 *
 * Features:
 * - Grid-based terrain generation with elevation
 * - Road network with intersections (flat and sloped)
 * - Biome-based color schemes
 * - Sprite vegetation placement
 * - Water features
 * - Street lamps and props
 */

import { PerlinNoise, SeededRandom } from "../engine/math";

// ============================================================================
// Types
// ============================================================================

export type RGB = [number, number, number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BiomeType = "urban" | "suburban" | "rural" | "industrial";

export interface BiomeColors {
  ground: RGB;
  groundAlt: RGB; // Alternative ground color for variety
  grass: RGB;
  road: RGB;
  roadLine: RGB;
  sidewalk: RGB;
  curb: RGB;
  water: RGB;
  dirt: RGB;
  sand: RGB; // Beach/shoreline color
}

export interface MapGeneratorConfig {
  // Map dimensions
  width: number; // Total width in units (default: 800)
  depth: number; // Total depth in units (default: 800)

  // Grid settings
  blockSize: number; // Size of each city block (default: 200)
  cellSize: number; // Size of terrain cells for elevation (default: 32)

  // Road settings
  roadWidth: number; // Width of main roads (default: 80)
  sideRoadWidth: number; // Width of side roads (default: 60)
  sidewalkWidth: number; // Width of sidewalks (default: 16)
  curbHeight: number; // Height of curbs (default: 4)

  // Terrain mode
  terrainOnly: boolean; // If true, skip roads/blocks, generate pure terrain

  // Elevation settings
  elevation: {
    enabled: boolean;
    maxHeight: number; // Maximum hill height (default: 40)
    frequency: number; // Noise frequency (default: 0.015)
    octaves: number; // Noise octaves (default: 3)
    persistence: number; // Noise persistence (default: 0.5)
    flattenRoads: boolean; // Keep roads flat (default: true)

    // Heightmap support
    heightmap?: {
      data: number[][]; // 2D array of heights (0-1 normalized)
      width: number; // Heightmap width in pixels
      height: number; // Heightmap height in pixels
    };
  };

  // Biome/style
  biome: BiomeType;

  // Features
  features: {
    water: boolean;
    vegetation: boolean;
    streetLamps: boolean;
    rocks: boolean;
  };

  // Density (0-1)
  density: {
    vegetation: number;
    rocks: number;
    streetLamps: number;
    water: number; // Chance of water features
    ponds: number; // Pond density (0-1), affects number of ponds
  };

  // Pond settings
  ponds: {
    enabled: boolean;
    waterLevel: number; // Z level of water surface (default: 10)
    maxDepth: number; // How deep ponds go below waterLevel (default: 30)
    minRadius: number; // Minimum pond radius (default: 64)
    maxRadius: number; // Maximum pond radius (default: 192)
  };

  // Optimization settings
  optimization: {
    mergeFlatBrushes: boolean; // Merge adjacent flat brushes of same type
    maxMergeSize: number; // Max size of merged brush (default: 128)
    flatTolerance: number; // Height diff tolerance for "flat" (default: 2)
  };

  // Patch settings
  patchResolution: number; // Control points per patch edge (3, 5, 7, 9) - must be odd

  // Generation options
  seed?: number; // Random seed for reproducibility

  // Map metadata
  mapName: string;
  areaId: string;
  areaTier: string;
}

// Grid cell types
export type CellType =
  | "ground"
  | "grass"
  | "grass_dark"
  | "dirt"
  | "road_h"
  | "road_v"
  | "intersection"
  | "sidewalk"
  | "water"
  | "building";

export interface GridCell {
  x: number;
  z: number;
  type: CellType;
  elevation: number;
  color: RGB;
}

// ============================================================================
// Biome Presets
// ============================================================================

export const BIOME_COLORS: Record<BiomeType, BiomeColors> = {
  urban: {
    ground: [60, 55, 50], // Dark concrete
    groundAlt: [55, 50, 45],
    grass: [70, 100, 50], // Sparse grass
    road: [45, 45, 50], // Dark asphalt
    roadLine: [200, 180, 50], // Yellow
    sidewalk: [130, 125, 120], // Concrete
    curb: [110, 105, 100],
    water: [40, 80, 120], // Dark blue
    dirt: [80, 70, 55],
    sand: [140, 130, 100], // Sandy beach
  },
  suburban: {
    ground: [90, 75, 55], // Light dirt
    groundAlt: [85, 70, 50],
    grass: [80, 130, 50], // Lush grass
    road: [50, 50, 55], // Asphalt
    roadLine: [220, 200, 60], // Bright yellow
    sidewalk: [140, 135, 130], // Light concrete
    curb: [120, 115, 110],
    water: [60, 120, 160], // Blue
    dirt: [50, 40, 25],
    sand: [90, 75, 50], // Dark sandy beach
  },
  rural: {
    ground: [100, 85, 60], // Dirt
    groundAlt: [95, 80, 55],
    grass: [90, 140, 55], // Wild grass
    road: [90, 80, 65], // Dirt road
    roadLine: [180, 160, 50], // Faded yellow
    sidewalk: [110, 100, 85], // Gravel path
    curb: [100, 90, 75],
    water: [70, 130, 170], // Clear blue
    dirt: [55, 45, 30],
    sand: [95, 80, 55], // Dark sandy beach
  },
  industrial: {
    ground: [50, 50, 55], // Dark concrete
    groundAlt: [45, 45, 50],
    grass: [60, 90, 45], // Sparse, dull grass
    road: [40, 40, 45], // Dark asphalt
    roadLine: [180, 160, 40], // Faded yellow
    sidewalk: [100, 95, 90], // Worn concrete
    curb: [80, 75, 70],
    water: [35, 60, 80], // Murky water
    dirt: [70, 65, 55],
    sand: [70, 60, 45], // Dark gritty sand
  },
};

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: MapGeneratorConfig = {
  width: 400,
  depth: 400,
  blockSize: 200,
  cellSize: 32,
  roadWidth: 80,
  sideRoadWidth: 60,
  sidewalkWidth: 16,
  curbHeight: 4,
  terrainOnly: false,
  elevation: {
    enabled: true,
    maxHeight: 30,
    frequency: 0.015,
    octaves: 3,
    persistence: 0.5,
    flattenRoads: true,
  },
  biome: "suburban",
  features: {
    water: false,
    vegetation: false,
    streetLamps: true,
    rocks: false,
  },
  density: {
    vegetation: 0.3,
    rocks: 0.15,
    streetLamps: 0.6,
    water: 0.1,
    ponds: 0.3,
  },
  ponds: {
    enabled: false,
    waterLevel: 10,
    maxDepth: 30,
    minRadius: 64,
    maxRadius: 192,
  },
  optimization: {
    mergeFlatBrushes: true,
    maxMergeSize: 128,
    flatTolerance: 2,
  },
  patchResolution: 3, // 3x3 control points (default)
  mapName: "Generated Map",
  areaId: "generated",
  areaTier: "suburbs",
};

// ============================================================================
// Map Generator
// ============================================================================

export class MapGenerator {
  private config: MapGeneratorConfig;
  private colors: BiomeColors;
  private rng: SeededRandom;
  private noise: PerlinNoise;
  private entityCount: number = 0;
  private brushCount: number = 0;
  private patchCount: number = 0;

  // Height map grid
  private heightMap: number[][] = [];
  private cellTypes: CellType[][] = [];
  private gridCols: number = 0;
  private gridRows: number = 0;

  // Pond locations
  private pondLocations: Array<{ x: number; y: number; radius: number }> = [];

  constructor(config: Partial<MapGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.colors = BIOME_COLORS[this.config.biome];
    const seed = this.config.seed ?? Date.now();
    this.rng = new SeededRandom(seed);
    this.noise = new PerlinNoise(seed);
  }

  /**
   * Generate height map using Perlin noise
   */
  private generateHeightMap(): void {
    const { width, depth, cellSize, elevation, blockSize, roadWidth } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;

    this.gridCols = Math.ceil(width / cellSize) + 1;
    this.gridRows = Math.ceil(depth / cellSize) + 1;

    // Initialize grids
    this.heightMap = [];
    this.cellTypes = [];

    for (let row = 0; row < this.gridRows; row++) {
      this.heightMap[row] = [];
      this.cellTypes[row] = [];

      for (let col = 0; col < this.gridCols; col++) {
        const worldX = -halfW + col * cellSize;
        const worldZ = -halfD + row * cellSize;

        // Determine cell type first
        const cellType = this.getCellType(worldX, worldZ, blockSize, roadWidth, halfW, halfD);
        this.cellTypes[row][col] = cellType;

        // Generate height based on cell type
        if (!elevation.enabled) {
          this.heightMap[row][col] = 0;
        } else if (cellType === "road_h" || cellType === "road_v" || cellType === "intersection") {
          // Roads are flat
          this.heightMap[row][col] = elevation.flattenRoads ? 0 : this.getTerrainHeight(worldX, worldZ);
        } else if (cellType === "sidewalk") {
          // Sidewalks slightly raised
          this.heightMap[row][col] = elevation.flattenRoads ? 4 : this.getTerrainHeight(worldX, worldZ) + 4;
        } else {
          // Natural terrain - use heightmap if available, otherwise noise
          this.heightMap[row][col] = this.getTerrainHeight(worldX, worldZ);
        }
      }
    }
  }

  /**
   * Get terrain height at world position
   * Uses heightmap if available, otherwise falls back to noise
   */
  private getTerrainHeight(worldX: number, worldZ: number): number {
    const { elevation, width, depth } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;

    // If heightmap is provided, sample from it
    if (elevation.heightmap) {
      const hm = elevation.heightmap;

      // Convert world coords to heightmap UV (0-1)
      const u = (worldX + halfW) / width;
      const v = (worldZ + halfD) / depth;

      // Convert to heightmap pixel coords
      const px = u * (hm.width - 1);
      const py = v * (hm.height - 1);

      // Bilinear interpolation
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(x0 + 1, hm.width - 1);
      const y1 = Math.min(y0 + 1, hm.height - 1);

      const fx = px - x0;
      const fy = py - y0;

      const h00 = hm.data[y0]?.[x0] ?? 0;
      const h10 = hm.data[y0]?.[x1] ?? 0;
      const h01 = hm.data[y1]?.[x0] ?? 0;
      const h11 = hm.data[y1]?.[x1] ?? 0;

      const h0 = h00 * (1 - fx) + h10 * fx;
      const h1 = h01 * (1 - fx) + h11 * fx;
      const normalizedHeight = h0 * (1 - fy) + h1 * fy;

      return normalizedHeight * elevation.maxHeight;
    }

    // Fall back to noise-based generation
    const noiseVal = this.noise.octaveNoise(
      worldX * elevation.frequency,
      worldZ * elevation.frequency,
      elevation.octaves,
      elevation.persistence,
    );
    return noiseVal * elevation.maxHeight;
  }

  /**
   * Get interpolated height at exact world position
   * Uses bilinear interpolation between grid points
   */
  private getHeightAtPosition(worldX: number, worldZ: number): number {
    const { width, depth, cellSize } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;

    // Convert world position to grid coordinates
    const gridX = (worldX + halfW) / cellSize;
    const gridZ = (worldZ + halfD) / cellSize;

    // Get the four surrounding grid points
    const col0 = Math.floor(gridX);
    const row0 = Math.floor(gridZ);
    const col1 = Math.min(col0 + 1, this.gridCols - 1);
    const row1 = Math.min(row0 + 1, this.gridRows - 1);

    // Clamp to valid range
    const c0 = Math.max(0, Math.min(col0, this.gridCols - 1));
    const r0 = Math.max(0, Math.min(row0, this.gridRows - 1));
    const c1 = Math.max(0, Math.min(col1, this.gridCols - 1));
    const r1 = Math.max(0, Math.min(row1, this.gridRows - 1));

    // Get heights at four corners
    const h00 = this.heightMap[r0][c0];
    const h10 = this.heightMap[r0][c1];
    const h01 = this.heightMap[r1][c0];
    const h11 = this.heightMap[r1][c1];

    // Bilinear interpolation
    const fx = gridX - col0;
    const fz = gridZ - row0;

    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;

    return h0 * (1 - fz) + h1 * fz;
  }

  /**
   * Determine cell type based on position
   */
  private getCellType(
    x: number,
    z: number,
    blockSize: number,
    roadWidth: number,
    halfW: number,
    halfD: number,
  ): CellType {
    // Terrain-only mode: all cells are grass
    if (this.config.terrainOnly) {
      return "grass";
    }

    const halfRoad = roadWidth / 2;

    // Check if on a road
    let onHorizontalRoad = false;
    let onVerticalRoad = false;

    // Check horizontal roads
    for (let roadZ = -halfD; roadZ <= halfD; roadZ += blockSize) {
      if (Math.abs(z - roadZ) < halfRoad) {
        onHorizontalRoad = true;
        break;
      }
    }

    // Check vertical roads
    for (let roadX = -halfW; roadX <= halfW; roadX += blockSize) {
      if (Math.abs(x - roadX) < halfRoad) {
        onVerticalRoad = true;
        break;
      }
    }

    if (onHorizontalRoad && onVerticalRoad) {
      return "intersection";
    } else if (onHorizontalRoad) {
      return "road_h";
    } else if (onVerticalRoad) {
      return "road_v";
    }

    // Check sidewalk (adjacent to road)
    const sidewalkWidth = this.config.sidewalkWidth;
    for (let roadZ = -halfD; roadZ <= halfD; roadZ += blockSize) {
      if (Math.abs(z - roadZ) < halfRoad + sidewalkWidth && Math.abs(z - roadZ) >= halfRoad) {
        return "sidewalk";
      }
    }
    for (let roadX = -halfW; roadX <= halfW; roadX += blockSize) {
      if (Math.abs(x - roadX) < halfRoad + sidewalkWidth && Math.abs(x - roadX) >= halfRoad) {
        return "sidewalk";
      }
    }

    // Default to grass/ground
    return this.rng.bool(0.7) ? "grass" : "ground";
  }

  /**
   * Generate a complete .map file
   */
  generate(): string {
    this.entityCount = 0;
    this.brushCount = 0;
    this.patchCount = 0;

    // Generate height map first
    this.generateHeightMap();

    const lines: string[] = [];

    // Header
    lines.push('//@$& layerdef "0" -1 0 0 0');
    lines.push("");

    // Worldspawn entity with all geometry
    lines.push(...this.generateWorldspawn());

    // Player start
    lines.push(...this.generatePlayerStart());

    // Lights
    lines.push(...this.generateLights());

    // Street lamps
    lines.push(...this.generateStreetLamps());

    // Sprites (rocks, vegetation, etc.)
    if (this.config.features.rocks || this.config.features.vegetation) {
      lines.push(...this.generateSprites());
    }

    return lines.join("\n");
  }

  /**
   * Rock pile presets - different arrangements of rocks
   */
  private readonly ROCK_PILE_PRESETS = [
    // Single rock
    { name: "single", rocks: [{ dx: 0, dz: 0, sizeIdx: 0, scale: 1.0 }] },
    // Pair of rocks
    {
      name: "pair",
      rocks: [
        { dx: 0, dz: 0, sizeIdx: 0, scale: 1.0 },
        { dx: 8, dz: 4, sizeIdx: 1, scale: 0.7 },
      ],
    },
    // Small cluster (3 rocks)
    {
      name: "cluster_small",
      rocks: [
        { dx: 0, dz: 0, sizeIdx: 0, scale: 0.9 },
        { dx: -6, dz: 5, sizeIdx: 1, scale: 0.6 },
        { dx: 7, dz: -3, sizeIdx: 1, scale: 0.5 },
      ],
    },
    // Medium cluster (4-5 rocks)
    {
      name: "cluster_medium",
      rocks: [
        { dx: 0, dz: 0, sizeIdx: 0, scale: 1.0 },
        { dx: -10, dz: 3, sizeIdx: 0, scale: 0.7 },
        { dx: 8, dz: 6, sizeIdx: 1, scale: 0.6 },
        { dx: 5, dz: -8, sizeIdx: 1, scale: 0.5 },
        { dx: -5, dz: -6, sizeIdx: 1, scale: 0.4 },
      ],
    },
    // Scattered (spread out)
    {
      name: "scattered",
      rocks: [
        { dx: -12, dz: -8, sizeIdx: 1, scale: 0.5 },
        { dx: 10, dz: 5, sizeIdx: 1, scale: 0.6 },
        { dx: -5, dz: 10, sizeIdx: 1, scale: 0.4 },
      ],
    },
  ];

  /**
   * Generate sprite entities from manifest
   * Uses FIXED counts based on map area, not cell count
   */
  private generateSprites(): string[] {
    const lines: string[] = [];
    const { width, depth } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;
    const mapArea = width * depth;

    const spriteDefinitions = this.getSpriteDefinitions();
    const rockSprites = spriteDefinitions.rocks;
    const treeSprites = spriteDefinitions.trees;
    const grassSprites = spriteDefinitions.grass;

    // Fixed counts based on map area (per 10000 sq units = 100x100 area)
    const areaFactor = mapArea / 10000;
    const rockCount = Math.floor(8 * areaFactor * this.config.density.rocks);
    const treeCount = Math.floor(12 * areaFactor * this.config.density.vegetation);
    const grassCount = Math.floor(30 * areaFactor * this.config.density.vegetation);

    // --- ROCKS ---
    if (this.config.features.rocks && rockSprites.length > 0) {
      for (let i = 0; i < rockCount; i++) {
        const x = -halfW + this.rng.next() * width;
        const z = -halfD + this.rng.next() * depth;
        const y = this.getHeightAtPosition(x, z);

        // Skip if in water (low height) or in pond
        if (y < 5) continue;
        if (this.isInPond(x, z)) continue;

        lines.push(...this.generateRockPile(rockSprites, x, y, z, 32));
      }
    }

    // --- TREES ---
    if (this.config.features.vegetation && treeSprites.length > 0) {
      for (let i = 0; i < treeCount; i++) {
        const x = -halfW + this.rng.next() * width;
        const z = -halfD + this.rng.next() * depth;
        const y = this.getHeightAtPosition(x, z);

        // Skip if in water or in pond
        if (y < 5) continue;
        if (this.isInPond(x, z)) continue;

        const tree = treeSprites[Math.floor(this.rng.next() * treeSprites.length)];
        const scaleMin = tree.scaleRange?.[0] ?? 1;
        const scaleMax = tree.scaleRange?.[1] ?? 1;
        const scale = scaleMin + this.rng.next() * (scaleMax - scaleMin);
        lines.push(...this.generateSpriteEntity(tree, x, y, z, scale));
      }
    }

    // --- GRASS TUFTS ---
    if (this.config.features.vegetation && grassSprites.length > 0) {
      for (let i = 0; i < grassCount; i++) {
        const x = -halfW + this.rng.next() * width;
        const z = -halfD + this.rng.next() * depth;
        const y = this.getHeightAtPosition(x, z);

        // Skip if in water or in pond
        if (y < 5) continue;
        if (this.isInPond(x, z)) continue;

        const grass = grassSprites[Math.floor(this.rng.next() * grassSprites.length)];
        const scaleMin = grass.scaleRange?.[0] ?? 1;
        const scaleMax = grass.scaleRange?.[1] ?? 1;
        const scale = scaleMin + this.rng.next() * (scaleMax - scaleMin);
        lines.push(...this.generateSpriteEntity(grass, x, y, z, scale));
      }
    }

    return lines;
  }

  /**
   * Generate a rock pile using presets
   */
  private generateRockPile(
    rockSprites: Array<{
      id: string;
      file: string;
      width: number;
      height: number;
      scaleRange?: [number, number];
      shadow?: boolean;
    }>,
    baseX: number,
    _baseY: number,
    baseZ: number,
    cellSize: number,
  ): string[] {
    const lines: string[] = [];

    // Random offset within cell
    const offsetX = (this.rng.next() - 0.5) * cellSize * 0.4;
    const offsetZ = (this.rng.next() - 0.5) * cellSize * 0.4;

    // Pick a random pile preset (weighted towards simpler ones)
    const presetRoll = this.rng.next();
    let preset: (typeof this.ROCK_PILE_PRESETS)[number];
    if (presetRoll < 0.4) {
      preset = this.ROCK_PILE_PRESETS[0]; // single (40%)
    } else if (presetRoll < 0.65) {
      preset = this.ROCK_PILE_PRESETS[1]; // pair (25%)
    } else if (presetRoll < 0.85) {
      preset = this.ROCK_PILE_PRESETS[2]; // cluster_small (20%)
    } else if (presetRoll < 0.95) {
      preset = this.ROCK_PILE_PRESETS[3]; // cluster_medium (10%)
    } else {
      preset = this.ROCK_PILE_PRESETS[4]; // scattered (5%)
    }

    // Generate each rock in the pile
    for (const rock of preset.rocks) {
      const sprite = rockSprites[rock.sizeIdx % rockSprites.length];
      const scaleMin = sprite.scaleRange?.[0] ?? 1;
      const scaleMax = sprite.scaleRange?.[1] ?? 1;
      const randomScale = scaleMin + this.rng.next() * (scaleMax - scaleMin);
      const finalScale = rock.scale * randomScale;

      // Add some randomness to preset positions
      const jitterX = (this.rng.next() - 0.5) * 4;
      const jitterZ = (this.rng.next() - 0.5) * 4;

      const rockX = baseX + offsetX + rock.dx + jitterX;
      const rockZ = baseZ + offsetZ + rock.dz + jitterZ;
      const rockY = this.getHeightAtPosition(rockX, rockZ);

      lines.push(...this.generateSpriteEntity(sprite, rockX, rockY, rockZ, finalScale));
    }

    return lines;
  }

  /**
   * Get sprite definitions (inline for now, could load from JSON)
   */
  private getSpriteDefinitions(): Record<
    string,
    Array<{
      id: string;
      file: string;
      width: number;
      height: number;
      scaleRange?: [number, number];
      shadow?: boolean;
    }>
  > {
    return {
      rocks: [
        {
          id: "rock_1",
          file: "sprites/rock_1.png",
          width: 32,
          height: 25,
          scaleRange: [0.6, 1.0],
          shadow: false,
        },
        {
          id: "rock_2",
          file: "sprites/rock_2.png",
          width: 24,
          height: 18,
          scaleRange: [0.5, 0.9],
          shadow: false,
        },
        {
          id: "rock_3",
          file: "sprites/rock_3.png",
          width: 28,
          height: 20,
          scaleRange: [0.6, 1.0],
          shadow: false,
        },
      ],
      trees: [
        {
          id: "tree_1",
          file: "sprites/tree_1.png",
          width: 48,
          height: 64,
          scaleRange: [0.8, 1.2],
          shadow: true,
        },
        {
          id: "tree_2",
          file: "sprites/tree_2.png",
          width: 44,
          height: 60,
          scaleRange: [0.7, 1.1],
          shadow: true,
        },
      ],
      grass: [
        {
          id: "grass_1",
          file: "sprites/grass_1.png",
          width: 20,
          height: 16,
          scaleRange: [0.5, 0.9],
          shadow: false,
        },
        {
          id: "grass_2",
          file: "sprites/grass_2.png",
          width: 22,
          height: 18,
          scaleRange: [0.5, 0.8],
          shadow: false,
        },
      ],
    };
  }

  /**
   * Generate a sprite entity (misc_sprite for NetRadiant compatibility)
   */
  private generateSpriteEntity(
    sprite: { id: string; file: string; width: number; height: number; shadow?: boolean },
    x: number,
    y: number,
    z: number,
    scale: number,
  ): string[] {
    const lines: string[] = [];

    lines.push(`// entity ${this.entityCount++}`);
    lines.push("{");
    lines.push(`"classname" "misc_sprite"`);
    lines.push(`"origin" "${x.toFixed(1)} ${z.toFixed(1)} ${y.toFixed(1)}"`);
    lines.push(`"sprite" "${sprite.file}"`);
    lines.push(`"width" "${sprite.width.toFixed(1)}"`);
    lines.push(`"height" "${sprite.height.toFixed(1)}"`);
    lines.push(`"scale" "${scale.toFixed(2)}"`);
    lines.push(`"billboard" "1"`);
    lines.push(`"shadow" "${sprite.shadow ? "1" : "0"}"`);
    lines.push(`"anchor" "bottom-center"`);
    lines.push("}");

    return lines;
  }

  /**
   * Generate worldspawn entity with terrain cells and roads
   */
  private generateWorldspawn(): string[] {
    const lines: string[] = [];
    const { width, depth, cellSize } = this.config;

    lines.push(`// entity ${this.entityCount++}`);
    lines.push("{");
    lines.push(`"classname" "worldspawn"`);
    lines.push(`"message" "${this.config.mapName}"`);
    lines.push(`"camera_mode" "perspective"`);
    lines.push(`"camera_height" "800"`);
    lines.push(`"area_id" "${this.config.areaId}"`);
    lines.push(`"area_tier" "${this.config.areaTier}"`);

    const halfW = width / 2;
    const halfD = depth / 2;

    // Generate terrain - patches only for clean unified ground
    if (this.config.terrainOnly) {
      lines.push(...this.generatePatchOnlyTerrain(halfW, halfD, cellSize));
    } else {
      // City mode with roads - use old system
      lines.push(...this.generateBrush(-halfW, -halfD, -48, halfW, halfD, -32, this.colors.ground, "base ground"));
      if (this.config.optimization.mergeFlatBrushes) {
        lines.push(...this.generateOptimizedTerrain(halfW, halfD, cellSize));
      } else {
        lines.push(...this.generateUnoptimizedTerrain(halfW, halfD, cellSize));
      }
      lines.push(...this.generateRoadMarkings());
      lines.push(...this.generateCurbs());
    }

    lines.push("}");
    return lines;
  }

  /**
   * Generate terrain using LARGE patches with many vertices
   *
   * Quake-style: 128x128 unit patches with 9x9 vertices
   * Each vertex Z coordinate is sampled from heightmap
   */
  private generatePatchOnlyTerrain(halfW: number, halfD: number, _cellSize: number): string[] {
    const lines: string[] = [];

    // Generate pond locations first (if enabled)
    if (this.config.ponds.enabled) {
      this.generatePondLocations(halfW, halfD);
    }

    // Use 128-unit patches (Quake standard)
    const patchSize = 128;
    const patchesX = Math.ceil(this.config.width / patchSize);
    const patchesY = Math.ceil(this.config.depth / patchSize);

    // LAYER 1: Generate all terrain as grass base
    for (let py = 0; py < patchesY; py++) {
      for (let px = 0; px < patchesX; px++) {
        const x1 = -halfW + px * patchSize;
        const y1 = -halfD + py * patchSize;
        const x2 = Math.min(x1 + patchSize, halfW);
        const y2 = Math.min(y1 + patchSize, halfD);

        // All base terrain is grass - use procedural terrain texture
        lines.push(
          ...this.generateLargePatch(
            x1,
            y1,
            x2,
            y2,
            halfW,
            halfD,
            null,
            "grass",
            null,
            this.getTerrainTexture("grass"),
          ),
        );
      }
    }

    // LAYER 2: Generate rounded dirt blob patches on top
    lines.push(...this.generateDirtBlobs(halfW, halfD));

    // LAYER 3: Generate flat water patches for each pond
    if (this.config.ponds.enabled) {
      lines.push(...this.generatePondWaterPatches(halfW, halfD));
    }

    return lines;
  }

  /**
   * Generate organic rounded dirt blob patches
   */
  private generateDirtBlobs(halfW: number, halfD: number): string[] {
    const lines: string[] = [];
    const typeNoise = new PerlinNoise((this.config.seed ?? 42) + 1000);

    // Find dirt blob centers using noise peaks
    const gridStep = 100;
    const blobs: Array<{ x: number; y: number; radius: number }> = [];

    for (let y = -halfD + gridStep; y < halfD - gridStep; y += gridStep) {
      for (let x = -halfW + gridStep; x < halfW - gridStep; x += gridStep) {
        const noiseVal = typeNoise.octaveNoise(x * 0.01, y * 0.01, 2, 0.5);

        if (noiseVal > 0.6) {
          const radius = 50 + noiseVal * 80;
          blobs.push({ x, y, radius });
        }
      }
    }

    for (const blob of blobs) {
      lines.push(...this.generateRoundedDirtPatch(blob, halfW, halfD));
    }

    return lines;
  }

  /**
   * Generate a single rounded dirt patch
   */
  private generateRoundedDirtPatch(
    blob: { x: number; y: number; radius: number },
    halfW: number,
    halfD: number,
  ): string[] {
    const lines: string[] = [];
    const tex = this.getTerrainTexture("dirt");
    const resolution = 9;

    lines.push(`// patch ${this.patchCount++} - dirt blob`);
    lines.push("{");
    lines.push("patchDef2");
    lines.push("{");
    lines.push(tex);
    lines.push(`( ${resolution} ${resolution} 0 0 0 )`);
    lines.push("(");

    // Generate circular dirt patch with height offset that increases toward center
    // Edge vertices are slightly above terrain, center vertices are higher
    // This creates a gentle dome shape that won't Z-fight
    for (let row = 0; row < resolution; row++) {
      const rowVertices: string[] = [];
      const t_row = row / (resolution - 1);

      for (let col = 0; col < resolution; col++) {
        const t_col = col / (resolution - 1);
        // Map to -1 to 1 range
        const nx = t_col * 2 - 1;
        const ny = t_row * 2 - 1;

        // Distance from center (0 at center, 1 at corners, ~0.7 at edge midpoints)
        const dist = Math.sqrt(nx * nx + ny * ny);

        // Circular falloff for radius (1 at center, 0 at edge)
        const radiusFalloff = Math.max(0, 1 - dist);

        // Effective position uses circular falloff for organic shape
        const effectiveRadius = blob.radius * radiusFalloff ** 0.4;
        const x = blob.x + nx * effectiveRadius;
        const y = blob.y + ny * effectiveRadius;

        // Height offset: minimum 5 at edges, maximum 12 at center
        // This ensures ALL vertices are above the grass terrain
        const heightOffset = 5 + 7 * radiusFalloff;
        const z = this.sampleHeightAt(x, y, halfW, halfD) + heightOffset;

        const u = t_col;
        const v = t_row;

        rowVertices.push(`( ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(2)} ${u.toFixed(2)} ${v.toFixed(2)} )`);
      }

      lines.push(`( ${rowVertices.join(" ")} )`);
    }

    lines.push(")");
    lines.push("}");
    lines.push("}");

    return lines;
  }

  /**
   * Generate pond locations based on density
   */
  private generatePondLocations(halfW: number, halfD: number): void {
    this.pondLocations = [];

    const { ponds, density } = this.config;
    const mapArea = this.config.width * this.config.depth;
    const pondCount = Math.max(2, Math.floor((mapArea / 100000) * density.ponds * 5));

    console.log(`Generating ${pondCount} ponds (density: ${density.ponds}, area: ${mapArea})`);

    for (let i = 0; i < pondCount; i++) {
      const margin = ponds.maxRadius + 50;
      const x = -halfW + margin + this.rng.next() * (this.config.width - margin * 2);
      const y = -halfD + margin + this.rng.next() * (this.config.depth - margin * 2);
      const radius = ponds.minRadius + this.rng.next() * (ponds.maxRadius - ponds.minRadius);

      let overlaps = false;
      for (const existing of this.pondLocations) {
        const dist = Math.sqrt((x - existing.x) ** 2 + (y - existing.y) ** 2);
        if (dist < radius + existing.radius + 32) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        this.pondLocations.push({ x, y, radius });
        console.log(`  Pond ${this.pondLocations.length}: (${x.toFixed(0)}, ${y.toFixed(0)}) r=${radius.toFixed(0)}`);
      }
    }
    console.log(`Created ${this.pondLocations.length} ponds`);
  }

  /**
   * Generate flat water patches for all ponds
   */
  private generatePondWaterPatches(halfW: number, halfD: number): string[] {
    const lines: string[] = [];
    const { ponds } = this.config;

    for (const pond of this.pondLocations) {
      // First generate the sandy shoreline ring (slightly larger than water)
      lines.push(...this.generatePondShoreline(pond, halfW, halfD));

      // Then generate water on top
      const baseHeight = this.sampleBaseHeightAt(pond.x, pond.y, halfW, halfD);
      const waterZ = baseHeight - ponds.waterLevel + 3; // 3 units above edge terrain
      console.log(`  Pond water at Z=${waterZ.toFixed(1)} (base terrain: ${baseHeight.toFixed(1)})`);
      lines.push(...this.generatePondWaterPatch(pond, halfW, halfD, waterZ));
    }

    return lines;
  }

  /**
   * Generate sandy shoreline patch around a pond
   * Uses circular shape that matches the water edge
   */
  private generatePondShoreline(
    pond: { x: number; y: number; radius: number },
    halfW: number,
    halfD: number,
  ): string[] {
    const lines: string[] = [];
    const tex = this.getTerrainTexture("sand");
    const resolution = 9;

    // Shoreline extends beyond water to cover terrain edge
    const shorelineScale = 1.25;

    lines.push(`// patch ${this.patchCount++} - pond shoreline`);
    lines.push("{");
    lines.push("patchDef2");
    lines.push("{");
    lines.push(tex);
    lines.push(`( ${resolution} ${resolution} 0 0 0 )`);
    lines.push("(");

    // Use circular shape - corners pull inward toward center
    for (let row = 0; row < resolution; row++) {
      const rowVertices: string[] = [];
      const t_row = row / (resolution - 1);

      for (let col = 0; col < resolution; col++) {
        const t_col = col / (resolution - 1);
        const nx = t_col * 2 - 1; // -1 to 1
        const ny = t_row * 2 - 1; // -1 to 1

        // Calculate distance from center and normalize to circular shape
        const dist = Math.sqrt(nx * nx + ny * ny);
        // Clamp distance to 1 to make it circular (corners get pulled in)
        const clampedDist = Math.min(dist, 1);
        // Normalize direction
        const dirX = dist > 0.001 ? nx / dist : 0;
        const dirY = dist > 0.001 ? ny / dist : 0;

        // Position on circle
        const x = pond.x + dirX * clampedDist * pond.radius * shorelineScale;
        const y = pond.y + dirY * clampedDist * pond.radius * shorelineScale;

        // Sample terrain height and add larger offset to avoid Z-fighting
        const z = this.sampleHeightAt(x, y, halfW, halfD) + 8;
        const u = t_col;
        const v = t_row;

        rowVertices.push(`( ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(2)} ${u.toFixed(2)} ${v.toFixed(2)} )`);
      }

      lines.push(`( ${rowVertices.join(" ")} )`);
    }

    lines.push(")");
    lines.push("}");
    lines.push("}");

    return lines;
  }

  /**
   * Generate a single flat water patch for a pond
   */
  private generatePondWaterPatch(
    pond: { x: number; y: number; radius: number },
    _halfW: number,
    _halfD: number,
    waterLevel: number,
  ): string[] {
    const lines: string[] = [];
    const tex = this.getTerrainTexture("water");
    const resolution = 9;

    lines.push(`// patch ${this.patchCount++} - pond water`);
    lines.push("{");
    lines.push("patchDef2");
    lines.push("{");
    lines.push(tex);
    lines.push(`( ${resolution} ${resolution} 0 0 0 )`);
    lines.push("(");

    for (let row = 0; row < resolution; row++) {
      const rowVertices: string[] = [];
      const t_row = row / (resolution - 1);

      for (let col = 0; col < resolution; col++) {
        const t_col = col / (resolution - 1);
        const nx = t_col * 2 - 1;
        const ny = t_row * 2 - 1;
        const x = pond.x + nx * pond.radius * 0.9;
        const y = pond.y + ny * pond.radius * 0.9;
        const z = waterLevel;
        const u = t_col;
        const v = t_row;

        rowVertices.push(`( ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(2)} ${u.toFixed(2)} ${v.toFixed(2)} )`);
      }

      lines.push(`( ${rowVertices.join(" ")} )`);
    }

    lines.push(")");
    lines.push("}");
    lines.push("}");

    return lines;
  }

  /**
   * Check if a position is inside any pond
   */
  private isInPond(worldX: number, worldY: number): boolean {
    if (!this.config.ponds.enabled || this.pondLocations.length === 0) {
      return false;
    }

    for (const pond of this.pondLocations) {
      const dx = worldX - pond.x;
      const dy = worldY - pond.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < pond.radius * 1.1) {
        // Slightly larger to keep sprites away from edge
        return true;
      }
    }
    return false;
  }

  /**
   * Get pond depression at a world position
   */
  private getPondDepression(worldX: number, worldY: number): number {
    if (!this.config.ponds.enabled || this.pondLocations.length === 0) {
      return 0;
    }

    const { ponds } = this.config;

    for (const pond of this.pondLocations) {
      const dx = worldX - pond.x;
      const dy = worldY - pond.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < pond.radius) {
        const normalizedDist = dist / pond.radius;
        const falloff = (1 + Math.cos(normalizedDist * Math.PI)) / 2;
        return -(ponds.maxDepth * falloff + ponds.waterLevel);
      }
    }

    return 0;
  }

  /**
   * Sample base terrain height without pond depression
   */
  private sampleBaseHeightAt(worldX: number, worldY: number, halfW: number, halfD: number): number {
    const { width, depth, elevation } = this.config;

    if (elevation.heightmap) {
      const hm = elevation.heightmap;
      const u = (worldX + halfW) / width;
      const v = (worldY + halfD) / depth;
      const uClamped = Math.max(0, Math.min(1, u));
      const vClamped = Math.max(0, Math.min(1, v));
      const px = uClamped * (hm.width - 1);
      const py = vClamped * (hm.height - 1);
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(x0 + 1, hm.width - 1);
      const y1 = Math.min(y0 + 1, hm.height - 1);
      const fx = px - x0;
      const fy = py - y0;
      const h00 = hm.data[y0]?.[x0] ?? 0;
      const h10 = hm.data[y0]?.[x1] ?? 0;
      const h01 = hm.data[y1]?.[x0] ?? 0;
      const h11 = hm.data[y1]?.[x1] ?? 0;
      const h0 = h00 * (1 - fx) + h10 * fx;
      const h1 = h01 * (1 - fx) + h11 * fx;
      const normalizedHeight = h0 * (1 - fy) + h1 * fy;
      return normalizedHeight * elevation.maxHeight;
    }

    const noiseVal = this.noise.octaveNoise(
      worldX * elevation.frequency,
      worldY * elevation.frequency,
      elevation.octaves,
      elevation.persistence,
    );
    return noiseVal * elevation.maxHeight;
  }

  /**
   * Sample height (Z) at any world position (X, Y)
   * Uses the heightmap data directly for full resolution
   */
  private sampleHeightAt(worldX: number, worldY: number, halfW: number, halfD: number): number {
    let height = this.sampleBaseHeightAt(worldX, worldY, halfW, halfD);
    height += this.getPondDepression(worldX, worldY);
    return height;
  }

  /**
   * Generate a LARGE terrain patch where each vertex samples the heightmap
   * This creates complex terrain geometry from a single patch
   *
   * Quake .map format: ( X Y Z U V )
   * - X, Y = horizontal position
   * - Z = height (vertical)
   * - U, V = texture coordinates
   */
  private generateLargePatch(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    halfW: number,
    halfD: number,
    color: RGB | null,
    cellType: CellType,
    flatHeight: number | null = null, // If set, all vertices use this height (for water)
    textureName: string | null = null, // If set, use this texture instead of color
  ): string[] {
    const lines: string[] = [];
    const tex = textureName || (color ? this.colorToTexture(color) : "terrain_grass");
    const res = this.config.patchResolution || 5;
    const resolution = Math.max(3, res % 2 === 0 ? res + 1 : res);

    lines.push(`// patch ${this.patchCount++} - ${cellType}`);
    lines.push("{");
    lines.push("patchDef2");
    lines.push("{");
    lines.push(tex);
    lines.push(`( ${resolution} ${resolution} 0 0 0 )`);
    lines.push("(");

    // Generate vertices in Quake format: ( X Y Z U V )
    // Rows iterate over X, columns iterate over Y
    for (let row = 0; row < resolution; row++) {
      const rowVertices: string[] = [];
      const t_row = row / (resolution - 1);
      const x = x1 + t_row * (x2 - x1);

      for (let col = 0; col < resolution; col++) {
        const t_col = col / (resolution - 1);
        const y = y1 + t_col * (y2 - y1);

        // Sample height (Z) at this vertex's world position
        const z = flatHeight !== null ? flatHeight : this.sampleHeightAt(x, y, halfW, halfD);

        // UV coordinates for texturing
        const u = t_col * 2 - 1; // Range roughly -1 to 1
        const v = t_row * 2 - 1;

        rowVertices.push(`( ${x} ${y} ${z} ${u.toFixed(1)} ${v.toFixed(1)} )`);
      }

      lines.push(`( ${rowVertices.join(" ")} )`);
    }

    lines.push(")");
    lines.push("}");
    lines.push("}");

    return lines;
  }

  /**
   * Generate curbs - raised edges between road and sidewalk
   */
  private generateCurbs(): string[] {
    const lines: string[] = [];
    const { width, depth, blockSize, roadWidth, curbHeight } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;
    const halfRoad = roadWidth / 2;
    const curbWidth = 4; // Width of curb

    // Horizontal road curbs (along Z axis roads)
    for (let roadZ = -halfD; roadZ <= halfD; roadZ += blockSize) {
      // North curb (positive Z side of road)
      lines.push(
        ...this.generateBrush(
          -halfW,
          roadZ + halfRoad,
          -16,
          halfW,
          roadZ + halfRoad + curbWidth,
          -16 + curbHeight,
          this.colors.curb,
          "curb h north",
        ),
      );
      // South curb (negative Z side of road)
      lines.push(
        ...this.generateBrush(
          -halfW,
          roadZ - halfRoad - curbWidth,
          -16,
          halfW,
          roadZ - halfRoad,
          -16 + curbHeight,
          this.colors.curb,
          "curb h south",
        ),
      );
    }

    // Vertical road curbs (along X axis roads)
    for (let roadX = -halfW; roadX <= halfW; roadX += blockSize) {
      // East curb (positive X side of road)
      lines.push(
        ...this.generateBrush(
          roadX + halfRoad,
          -halfD,
          -16,
          roadX + halfRoad + curbWidth,
          halfD,
          -16 + curbHeight,
          this.colors.curb,
          "curb v east",
        ),
      );
      // West curb (negative X side of road)
      lines.push(
        ...this.generateBrush(
          roadX - halfRoad - curbWidth,
          -halfD,
          -16,
          roadX - halfRoad,
          halfD,
          -16 + curbHeight,
          this.colors.curb,
          "curb v west",
        ),
      );
    }

    return lines;
  }

  /**
   * Generate terrain WITHOUT optimization (one brush/patch per cell)
   */
  private generateUnoptimizedTerrain(halfW: number, halfD: number, cellSize: number): string[] {
    const lines: string[] = [];
    const tolerance = this.config.optimization.flatTolerance;

    for (let row = 0; row < this.gridRows - 1; row++) {
      for (let col = 0; col < this.gridCols - 1; col++) {
        const x1 = -halfW + col * cellSize;
        const z1 = -halfD + row * cellSize;
        const x2 = x1 + cellSize;
        const z2 = z1 + cellSize;

        const cellType = this.cellTypes[row][col];
        const h00 = this.heightMap[row][col];
        const h10 = this.heightMap[row][col + 1];
        const h01 = this.heightMap[row + 1][col];
        const h11 = this.heightMap[row + 1][col + 1];

        const avgHeight = (h00 + h10 + h01 + h11) / 4;
        const maxDiff = Math.max(
          Math.abs(h00 - avgHeight),
          Math.abs(h10 - avgHeight),
          Math.abs(h01 - avgHeight),
          Math.abs(h11 - avgHeight),
        );
        const isFlat = maxDiff < tolerance;
        const color = this.getCellColor(cellType);

        if (isFlat || cellType === "road_h" || cellType === "road_v" || cellType === "intersection") {
          const height = cellType.startsWith("road") || cellType === "intersection" ? 0 : avgHeight;
          lines.push(...this.generateTerrainBrush(x1, z1, x2, z2, height, color, cellType));
        } else {
          lines.push(...this.generateTerrainPatch(x1, z1, x2, z2, h00, h10, h01, h11, color, cellType));
        }
      }
    }
    return lines;
  }

  /**
   * Generate terrain WITH optimization (merge adjacent flat cells)
   * Uses a greedy algorithm to find rectangular regions of same type/height
   */
  private generateOptimizedTerrain(halfW: number, halfD: number, cellSize: number): string[] {
    const lines: string[] = [];
    const tolerance = this.config.optimization.flatTolerance;
    const maxMerge = Math.floor(this.config.optimization.maxMergeSize / cellSize);

    // Track which cells have been processed
    const processed: boolean[][] = [];
    for (let row = 0; row < this.gridRows; row++) {
      processed[row] = new Array(this.gridCols).fill(false);
    }

    // First pass: generate patches for sloped terrain (can't merge these)
    for (let row = 0; row < this.gridRows - 1; row++) {
      for (let col = 0; col < this.gridCols - 1; col++) {
        const cellType = this.cellTypes[row][col];
        const h00 = this.heightMap[row][col];
        const h10 = this.heightMap[row][col + 1];
        const h01 = this.heightMap[row + 1][col];
        const h11 = this.heightMap[row + 1][col + 1];

        const avgHeight = (h00 + h10 + h01 + h11) / 4;
        const maxDiff = Math.max(
          Math.abs(h00 - avgHeight),
          Math.abs(h10 - avgHeight),
          Math.abs(h01 - avgHeight),
          Math.abs(h11 - avgHeight),
        );
        const isFlat = maxDiff < tolerance;
        const isRoad = cellType === "road_h" || cellType === "road_v" || cellType === "intersection";

        if (!isFlat && !isRoad) {
          // Generate patch for sloped cell
          const x1 = -halfW + col * cellSize;
          const z1 = -halfD + row * cellSize;
          const x2 = x1 + cellSize;
          const z2 = z1 + cellSize;
          const color = this.getCellColor(cellType);
          lines.push(...this.generateTerrainPatch(x1, z1, x2, z2, h00, h10, h01, h11, color, cellType));
          processed[row][col] = true;
        }
      }
    }

    // Second pass: merge flat cells using greedy rectangle finding
    for (let row = 0; row < this.gridRows - 1; row++) {
      for (let col = 0; col < this.gridCols - 1; col++) {
        if (processed[row][col]) continue;

        const cellType = this.cellTypes[row][col];
        const baseHeight = this.getCellAverageHeight(row, col);
        const isRoad = cellType === "road_h" || cellType === "road_v" || cellType === "intersection";
        const height = isRoad ? 0 : baseHeight;

        // Find maximum rectangle of same type and similar height
        let maxCol = col;
        let maxRow = row;

        // Expand horizontally first
        while (
          maxCol < this.gridCols - 1 &&
          maxCol - col < maxMerge &&
          !processed[row][maxCol] &&
          this.canMergeCell(row, maxCol, cellType, height, tolerance, isRoad)
        ) {
          maxCol++;
        }

        // Then expand vertically
        let canExpandDown = true;
        while (canExpandDown && maxRow < this.gridRows - 1 && maxRow - row < maxMerge) {
          // Check if entire row can be merged
          for (let c = col; c < maxCol; c++) {
            if (processed[maxRow + 1][c] || !this.canMergeCell(maxRow + 1, c, cellType, height, tolerance, isRoad)) {
              canExpandDown = false;
              break;
            }
          }
          if (canExpandDown) maxRow++;
        }

        // Mark cells as processed
        for (let r = row; r <= maxRow; r++) {
          for (let c = col; c < maxCol; c++) {
            processed[r][c] = true;
          }
        }

        // Generate merged brush
        const x1 = -halfW + col * cellSize;
        const z1 = -halfD + row * cellSize;
        const x2 = -halfW + maxCol * cellSize;
        const z2 = -halfD + (maxRow + 1) * cellSize;
        const color = this.getCellColor(cellType);

        const mergedCells = (maxCol - col) * (maxRow - row + 1);
        const comment = mergedCells > 1 ? `${cellType} (${mergedCells} cells merged)` : cellType;
        lines.push(...this.generateTerrainBrush(x1, z1, x2, z2, height, color, comment as CellType));
      }
    }

    return lines;
  }

  /**
   * Check if a cell can be merged with a region
   */
  private canMergeCell(
    row: number,
    col: number,
    targetType: CellType,
    targetHeight: number,
    tolerance: number,
    isRoad: boolean,
  ): boolean {
    if (row >= this.gridRows - 1 || col >= this.gridCols - 1) return false;

    const cellType = this.cellTypes[row][col];
    if (cellType !== targetType) return false;

    const avgHeight = this.getCellAverageHeight(row, col);
    const height = isRoad ? 0 : avgHeight;

    // Check if heights are similar enough
    if (Math.abs(height - targetHeight) > tolerance) return false;

    // Check if cell is flat
    const h00 = this.heightMap[row][col];
    const h10 = this.heightMap[row][col + 1];
    const h01 = this.heightMap[row + 1][col];
    const h11 = this.heightMap[row + 1][col + 1];
    const maxDiff = Math.max(
      Math.abs(h00 - avgHeight),
      Math.abs(h10 - avgHeight),
      Math.abs(h01 - avgHeight),
      Math.abs(h11 - avgHeight),
    );

    return maxDiff < tolerance || isRoad;
  }

  /**
   * Get average height of a cell
   */
  private getCellAverageHeight(row: number, col: number): number {
    const h00 = this.heightMap[row][col];
    const h10 = this.heightMap[row][col + 1];
    const h01 = this.heightMap[row + 1][col];
    const h11 = this.heightMap[row + 1][col + 1];
    return (h00 + h10 + h01 + h11) / 4;
  }

  /**
   * Get color for a cell type
   */
  private getCellColor(cellType: CellType): RGB {
    switch (cellType) {
      case "road_h":
      case "road_v":
      case "intersection":
        return this.colors.road;
      case "sidewalk":
        return this.colors.sidewalk;
      case "grass":
        return this.colors.grass;
      case "water":
        return this.colors.water;
      default:
        return this.colors.ground;
    }
  }

  /**
   * Generate a flat terrain brush
   */
  private generateTerrainBrush(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    height: number,
    color: RGB,
    cellType: CellType,
  ): string[] {
    const baseZ = -16;
    const topZ = baseZ + height;
    const thickness = 8;

    return this.generateBrush(x1, z1, topZ - thickness, x2, z2, topZ, color, cellType);
  }

  /**
   * Generate a sloped terrain patch (patchDef2) with configurable resolution
   * Resolution must be odd (3, 5, 7, 9, etc.)
   *
   * Edge vertices are sampled from the heightmap to ensure adjacent patches align perfectly.
   * Interior vertices get noise-based displacement for organic shapes.
   */
  private generateTerrainPatch(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    h00: number,
    h10: number,
    h01: number,
    h11: number,
    color: RGB,
    cellType: CellType,
  ): string[] {
    const lines: string[] = [];
    const tex = this.colorToTexture(color);
    const baseZ = -16;
    const res = this.config.patchResolution || 3;

    // Ensure resolution is odd and at least 3
    const resolution = Math.max(3, res % 2 === 0 ? res + 1 : res);

    // Noise for organic vertex displacement (only for interior vertices)
    const cellSize = x2 - x1;
    const jitterScale = cellSize * 0.15; // Max displacement as fraction of cell size

    lines.push(`// patch ${this.patchCount++} - ${cellType}`);
    lines.push("{");
    lines.push("patchDef2");
    lines.push("{");
    lines.push(tex);
    lines.push(`( ${resolution} ${resolution} 0 0 0 )`);
    lines.push("(");

    // Generate rows of vertices
    for (let row = 0; row < resolution; row++) {
      const rowVertices: string[] = [];
      const t_row = row / (resolution - 1); // 0 to 1
      const isEdgeRow = row === 0 || row === resolution - 1;

      for (let col = 0; col < resolution; col++) {
        const t_col = col / (resolution - 1); // 0 to 1
        const isEdgeCol = col === 0 || col === resolution - 1;
        const isEdge = isEdgeRow || isEdgeCol;

        // Base position
        let x = x1 + t_col * (x2 - x1);
        let z = z1 + t_row * (z2 - z1);

        // Add jitter to interior vertices only (edges must align with neighbors)
        if (!isEdge) {
          // Use deterministic noise based on world position
          const noiseX = this.noise.noise(x * 0.1, z * 0.1);
          const noiseZ = this.noise.noise(x * 0.1 + 100, z * 0.1 + 100);
          x += noiseX * jitterScale;
          z += noiseZ * jitterScale;
        }

        const u = t_col; // UV u coordinate
        const v = t_row; // UV v coordinate

        // Bilinear interpolation of height from corner values
        // Use original t values for height to maintain smooth surface
        const h = this.bilinearInterpolate(h00, h10, h01, h11, t_col, t_row);

        rowVertices.push(`( ${x} ${z} ${baseZ + h} ${u} ${v} )`);
      }

      lines.push(`( ${rowVertices.join(" ")} )`);
    }

    lines.push(")");
    lines.push("}");
    lines.push("}");

    return lines;
  }

  /**
   * Bilinear interpolation between four corner values
   * t_x: 0 = left edge, 1 = right edge
   * t_y: 0 = top edge, 1 = bottom edge
   */
  private bilinearInterpolate(
    h00: number,
    h10: number, // top-left, top-right
    h01: number,
    h11: number, // bottom-left, bottom-right
    t_x: number,
    t_y: number,
  ): number {
    const top = h00 * (1 - t_x) + h10 * t_x;
    const bottom = h01 * (1 - t_x) + h11 * t_x;
    return top * (1 - t_y) + bottom * t_y;
  }

  /**
   * Generate road center line markings
   */
  private generateRoadMarkings(): string[] {
    const lines: string[] = [];
    const { width, depth, blockSize } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;
    const lineWidth = 4;
    const lineHeight = 2;

    // Horizontal road center lines
    for (let roadZ = -halfD; roadZ <= halfD; roadZ += blockSize) {
      lines.push(
        ...this.generateBrush(
          -halfW,
          roadZ - lineWidth / 2,
          -16,
          halfW,
          roadZ + lineWidth / 2,
          -16 + lineHeight,
          this.colors.roadLine,
          "road line h",
        ),
      );
    }

    // Vertical road center lines
    for (let roadX = -halfW; roadX <= halfW; roadX += blockSize) {
      lines.push(
        ...this.generateBrush(
          roadX - lineWidth / 2,
          -halfD,
          -16,
          roadX + lineWidth / 2,
          halfD,
          -16 + lineHeight,
          this.colors.roadLine,
          "road line v",
        ),
      );
    }

    return lines;
  }

  /**
   * Generate a box brush in brushDef format
   */
  private generateBrush(
    x1: number,
    z1: number,
    y1: number,
    x2: number,
    z2: number,
    y2: number,
    color: RGB,
    comment?: string,
  ): string[] {
    const lines: string[] = [];
    const tex = this.colorToTexture(color);
    const texDark = this.colorToTexture(this.darkenColor(color, 0.8));
    const texMid = this.colorToTexture(this.darkenColor(color, 0.9));

    // UV matrix (standard)
    const uv = "( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) )";

    lines.push(`// brush ${this.brushCount++}${comment ? ` - ${comment}` : ""}`);
    lines.push("{");
    lines.push("brushDef");
    lines.push("{");

    // Top face (Y = y2) - Note: In our coordinate system, Y is up
    lines.push(`( ${x1} ${z1} ${y2} ) ( ${x1} ${z2} ${y2} ) ( ${x2} ${z1} ${y2} ) ${uv} ${tex} 0 0 0`);

    // Bottom face (Y = y1)
    lines.push(`( ${x1} ${z2} ${y1} ) ( ${x1} ${z1} ${y1} ) ( ${x2} ${z2} ${y1} ) ${uv} ${texDark} 0 0 0`);

    // Front face (Z = z1)
    lines.push(`( ${x1} ${z1} ${y2} ) ( ${x2} ${z1} ${y2} ) ( ${x1} ${z1} ${y1} ) ${uv} ${texMid} 0 0 0`);

    // Back face (Z = z2)
    lines.push(`( ${x2} ${z2} ${y2} ) ( ${x1} ${z2} ${y2} ) ( ${x2} ${z2} ${y1} ) ${uv} ${texMid} 0 0 0`);

    // Left face (X = x1)
    lines.push(`( ${x1} ${z2} ${y2} ) ( ${x1} ${z1} ${y2} ) ( ${x1} ${z2} ${y1} ) ${uv} ${texMid} 0 0 0`);

    // Right face (X = x2)
    lines.push(`( ${x2} ${z1} ${y2} ) ( ${x2} ${z2} ${y2} ) ( ${x2} ${z1} ${y1} ) ${uv} ${texMid} 0 0 0`);

    lines.push("}");
    lines.push("}");

    return lines;
  }

  /**
   * Generate player start entity
   */
  private generatePlayerStart(): string[] {
    return [`// entity ${this.entityCount++}`, "{", '"classname" "info_player_start"', '"origin" "0 0 100"', "}"];
  }

  /**
   * Generate lights for the map
   */
  private generateLights(): string[] {
    const lines: string[] = [];
    const { width, depth } = this.config;

    // For terrain-only mode, use directional sun light to show geometry
    if (this.config.terrainOnly) {
      // Directional sun light - angled to cast shadows and show terrain relief
      lines.push(`// entity ${this.entityCount++}`);
      lines.push("{");
      lines.push('"classname" "light_sun"');
      lines.push(`"origin" "${width * 0.3} ${-depth * 0.3} 800"`);
      lines.push('"light" "400"');
      lines.push('"range" "3000"');
      lines.push('"_color" "1.0 0.95 0.85"'); // Warm sunlight
      lines.push('"angle" "45"'); // Sun angle
      lines.push('"direction" "-0.5 0.5 -0.7"'); // Angled direction for shadows
      lines.push("}");

      // Ambient fill light - softer, from opposite side
      lines.push(`// entity ${this.entityCount++}`);
      lines.push("{");
      lines.push('"classname" "light_ambient"');
      lines.push(`"origin" "${-width * 0.2} ${depth * 0.2} 600"`);
      lines.push('"light" "150"');
      lines.push('"range" "2500"');
      lines.push('"_color" "0.7 0.8 1.0"'); // Cool sky fill
      lines.push("}");

      // Ground bounce light
      lines.push(`// entity ${this.entityCount++}`);
      lines.push("{");
      lines.push('"classname" "light"');
      lines.push('"origin" "0 0 50"');
      lines.push('"light" "100"');
      lines.push('"range" "2000"');
      lines.push('"_color" "0.4 0.5 0.3"'); // Green ground bounce
      lines.push("}");
    } else {
      // Standard overhead light for city maps
      lines.push(`// entity ${this.entityCount++}`);
      lines.push("{");
      lines.push('"classname" "light"');
      lines.push('"origin" "0 0 500"');
      lines.push('"light" "300"');
      lines.push('"range" "2000"');
      lines.push('"_color" "1 0.98 0.95"');
      lines.push("}");
    }

    return lines;
  }

  /**
   * Generate street lamps along roads
   */
  private generateStreetLamps(): string[] {
    const lines: string[] = [];
    const { width, depth, blockSize, roadWidth } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;

    let lampId = 1;

    // Place lamps at intersections
    const numBlocksX = Math.floor(width / blockSize);
    const numBlocksZ = Math.floor(depth / blockSize);

    for (let i = 0; i <= numBlocksX; i++) {
      for (let j = 0; j <= numBlocksZ; j++) {
        const x = -halfW + i * blockSize;
        const z = -halfD + j * blockSize;

        // Skip if outside bounds
        if (Math.abs(x) > halfW - 20 || Math.abs(z) > halfD - 20) continue;

        // Place lamp at corner of intersection
        const offsetX = roadWidth / 2 + 10;
        const offsetZ = roadWidth / 2 + 10;

        // Randomly place 1-4 lamps at intersection corners
        const corners = [
          { x: x + offsetX, z: z + offsetZ },
          { x: x - offsetX, z: z + offsetZ },
          { x: x + offsetX, z: z - offsetZ },
          { x: x - offsetX, z: z - offsetZ },
        ];

        for (const corner of corners) {
          if (this.rng.bool(0.6)) {
            // 60% chance per corner
            lines.push(...this.generateStreetLamp(corner.x, corner.z, lampId++));
          }
        }
      }
    }

    return lines;
  }

  /**
   * Generate a single street lamp entity
   */
  private generateStreetLamp(x: number, z: number, id: number): string[] {
    const fadeTime = this.rng.float(2, 5).toFixed(1);
    const r = this.rng.int(240, 255);
    const g = this.rng.int(180, 220);
    const b = this.rng.int(80, 120);

    return [
      `// entity ${this.entityCount++}`,
      "{",
      '"classname" "street_lamp"',
      `"targetname" "lamp_${id}"`,
      `"origin" "${x} ${z} 50"`,
      '"light" "150"',
      '"range" "120"',
      `"_color" "${r} ${g} ${b}"`,
      `"fadeTime" "${fadeTime}"`,
      '"bulbSize" "3"',
      "}",
    ];
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private colorToTexture(color: RGB): string {
    return `color_${color[0]}_${color[1]}_${color[2]}`;
  }

  /**
   * Get terrain texture name for procedural textures
   * These are generated at runtime by TerrainTextureGenerator
   */
  private getTerrainTexture(type: "grass" | "water" | "rock" | "dirt" | "sand"): string {
    return `terrain_${type}`;
  }

  private darkenColor(color: RGB, factor: number): RGB {
    return [Math.round(color[0] * factor), Math.round(color[1] * factor), Math.round(color[2] * factor)];
  }
}

// ============================================================================
// CLI Entry Point (for running with ts-node or similar)
// ============================================================================

export function generateMap(config: Partial<MapGeneratorConfig> = {}): string {
  const generator = new MapGenerator(config);
  return generator.generate();
}

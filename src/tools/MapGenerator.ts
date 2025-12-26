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

// ============================================================================
// Types
// ============================================================================

export type RGB = [number, number, number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BiomeType = 'urban' | 'suburban' | 'rural' | 'industrial';

export interface BiomeColors {
  ground: RGB;
  groundAlt: RGB;      // Alternative ground color for variety
  grass: RGB;
  road: RGB;
  roadLine: RGB;
  sidewalk: RGB;
  curb: RGB;
  water: RGB;
  dirt: RGB;
}

export interface MapGeneratorConfig {
  // Map dimensions
  width: number;          // Total width in units (default: 800)
  depth: number;          // Total depth in units (default: 800)
  
  // Grid settings
  blockSize: number;      // Size of each city block (default: 200)
  cellSize: number;       // Size of terrain cells for elevation (default: 32)
  
  // Road settings
  roadWidth: number;      // Width of main roads (default: 80)
  sideRoadWidth: number;  // Width of side roads (default: 60)
  sidewalkWidth: number;  // Width of sidewalks (default: 16)
  curbHeight: number;     // Height of curbs (default: 4)
  
  // Elevation settings
  elevation: {
    enabled: boolean;
    maxHeight: number;    // Maximum hill height (default: 40)
    frequency: number;    // Noise frequency (default: 0.015)
    octaves: number;      // Noise octaves (default: 3)
    persistence: number;  // Noise persistence (default: 0.5)
    flattenRoads: boolean; // Keep roads flat (default: true)
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
    water: number;        // Chance of water features
  };
  
  // Optimization settings
  optimization: {
    mergeFlatBrushes: boolean;  // Merge adjacent flat brushes of same type
    maxMergeSize: number;       // Max size of merged brush (default: 128)
    flatTolerance: number;      // Height diff tolerance for "flat" (default: 2)
  };
  
  // Generation options
  seed?: number;          // Random seed for reproducibility
  
  // Map metadata
  mapName: string;
  areaId: string;
  areaTier: string;
}

// Grid cell types
export type CellType = 'ground' | 'grass' | 'road_h' | 'road_v' | 'intersection' | 'sidewalk' | 'water' | 'building';

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
    ground: [60, 55, 50],       // Dark concrete
    groundAlt: [55, 50, 45],
    grass: [70, 100, 50],       // Sparse grass
    road: [45, 45, 50],         // Dark asphalt
    roadLine: [200, 180, 50],   // Yellow
    sidewalk: [130, 125, 120],  // Concrete
    curb: [110, 105, 100],
    water: [40, 80, 120],       // Dark blue
    dirt: [80, 70, 55],
  },
  suburban: {
    ground: [90, 75, 55],       // Light dirt
    groundAlt: [85, 70, 50],
    grass: [80, 130, 50],       // Lush grass
    road: [50, 50, 55],         // Asphalt
    roadLine: [220, 200, 60],   // Bright yellow
    sidewalk: [140, 135, 130],  // Light concrete
    curb: [120, 115, 110],
    water: [60, 120, 160],      // Blue
    dirt: [100, 85, 60],
  },
  rural: {
    ground: [100, 85, 60],      // Dirt
    groundAlt: [95, 80, 55],
    grass: [90, 140, 55],       // Wild grass
    road: [90, 80, 65],         // Dirt road
    roadLine: [180, 160, 50],   // Faded yellow
    sidewalk: [110, 100, 85],   // Gravel path
    curb: [100, 90, 75],
    water: [70, 130, 170],      // Clear blue
    dirt: [110, 95, 70],
  },
  industrial: {
    ground: [50, 50, 55],       // Dark concrete
    groundAlt: [45, 45, 50],
    grass: [60, 90, 45],        // Sparse, dull grass
    road: [40, 40, 45],         // Dark asphalt
    roadLine: [180, 160, 40],   // Faded yellow
    sidewalk: [100, 95, 90],    // Worn concrete
    curb: [80, 75, 70],
    water: [35, 60, 80],        // Murky water
    dirt: [70, 65, 55],
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
  elevation: {
    enabled: true,
    maxHeight: 30,
    frequency: 0.015,
    octaves: 3,
    persistence: 0.5,
    flattenRoads: true,
  },
  biome: 'suburban',
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
  },
  optimization: {
    mergeFlatBrushes: true,
    maxMergeSize: 128,
    flatTolerance: 2,
  },
  mapName: "Generated Map",
  areaId: "generated",
  areaTier: "suburbs",
};

// ============================================================================
// Seeded Random Number Generator
// ============================================================================

class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  // Simple LCG random
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
  
  // Random integer in range [min, max]
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  // Random float in range [min, max]
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  
  // Random boolean with probability
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
}

// ============================================================================
// Perlin Noise (simplified 2D implementation)
// ============================================================================

class PerlinNoise {
  private permutation: number[];
  
  constructor(seed: number) {
    // Generate permutation table from seed
    const rng = new SeededRandom(seed);
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }
    // Shuffle
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }
    // Duplicate for overflow
    this.permutation = [...this.permutation, ...this.permutation];
  }
  
  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  
  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }
  
  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  
  /**
   * Get noise value at (x, y) - returns value in range [-1, 1]
   */
  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    
    const u = this.fade(x);
    const v = this.fade(y);
    
    const A = this.permutation[X] + Y;
    const B = this.permutation[X + 1] + Y;
    
    return this.lerp(
      this.lerp(
        this.grad(this.permutation[A], x, y),
        this.grad(this.permutation[B], x - 1, y),
        u
      ),
      this.lerp(
        this.grad(this.permutation[A + 1], x, y - 1),
        this.grad(this.permutation[B + 1], x - 1, y - 1),
        u
      ),
      v
    );
  }
  
  /**
   * Get octave noise (multiple frequencies combined)
   * Returns value in range [0, 1]
   */
  octaveNoise(x: number, y: number, octaves: number = 3, persistence: number = 0.5): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    
    // Normalize to [0, 1]
    return (total / maxValue + 1) / 2;
  }
}

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
        } else if (cellType === 'road_h' || cellType === 'road_v' || cellType === 'intersection') {
          // Roads are flat
          this.heightMap[row][col] = elevation.flattenRoads ? 0 : this.getNoiseHeight(worldX, worldZ);
        } else if (cellType === 'sidewalk') {
          // Sidewalks slightly raised
          this.heightMap[row][col] = elevation.flattenRoads ? 4 : this.getNoiseHeight(worldX, worldZ) + 4;
        } else {
          // Natural terrain
          this.heightMap[row][col] = this.getNoiseHeight(worldX, worldZ);
        }
      }
    }
  }
  
  /**
   * Get noise-based height at world position
   */
  private getNoiseHeight(x: number, z: number): number {
    const { elevation } = this.config;
    const noiseVal = this.noise.octaveNoise(
      x * elevation.frequency,
      z * elevation.frequency,
      elevation.octaves,
      elevation.persistence
    );
    return noiseVal * elevation.maxHeight;
  }
  
  /**
   * Determine cell type based on position
   */
  private getCellType(
    x: number, z: number,
    blockSize: number, roadWidth: number,
    halfW: number, halfD: number
  ): CellType {
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
      return 'intersection';
    } else if (onHorizontalRoad) {
      return 'road_h';
    } else if (onVerticalRoad) {
      return 'road_v';
    }
    
    // Check sidewalk (adjacent to road)
    const sidewalkWidth = this.config.sidewalkWidth;
    for (let roadZ = -halfD; roadZ <= halfD; roadZ += blockSize) {
      if (Math.abs(z - roadZ) < halfRoad + sidewalkWidth && Math.abs(z - roadZ) >= halfRoad) {
        return 'sidewalk';
      }
    }
    for (let roadX = -halfW; roadX <= halfW; roadX += blockSize) {
      if (Math.abs(x - roadX) < halfRoad + sidewalkWidth && Math.abs(x - roadX) >= halfRoad) {
        return 'sidewalk';
      }
    }
    
    // Default to grass/ground
    return this.rng.bool(0.7) ? 'grass' : 'ground';
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
    lines.push('');
    
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
    
    return lines.join('\n');
  }
  
  /**
   * Generate sprite entities from manifest
   */
  private generateSprites(): string[] {
    const lines: string[] = [];
    const { width, depth, cellSize } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;
    
    // Load sprite definitions (we'll read from a simple inline definition for now)
    // In production, this would read from sprites.json
    const spriteDefinitions = this.getSpriteDefinitions();
    
    // Place sprites on grass/ground cells
    for (let row = 0; row < this.gridRows - 1; row++) {
      for (let col = 0; col < this.gridCols - 1; col++) {
        const cellType = this.cellTypes[row][col];
        
        // Only place on grass or ground
        if (cellType !== 'grass' && cellType !== 'ground') continue;
        
        // Get cell center position
        const x = -halfW + (col + 0.5) * cellSize;
        const z = -halfD + (row + 0.5) * cellSize;
        const y = this.getCellAverageHeight(row, col);
        
        // Random chance to place a sprite
        const category = this.config.features.rocks ? 'rocks' : 'vegetation';
        const density = category === 'rocks' 
          ? this.config.density.rocks 
          : this.config.density.vegetation;
        
        if (this.rng.next() > density) continue;
        
        // Pick a random sprite from the category
        const sprites = spriteDefinitions[category];
        if (!sprites || sprites.length === 0) continue;
        
        const sprite = sprites[Math.floor(this.rng.next() * sprites.length)];
        
        // Random offset within cell (avoid edges)
        const offsetX = (this.rng.next() - 0.5) * cellSize * 0.6;
        const offsetZ = (this.rng.next() - 0.5) * cellSize * 0.6;
        
        // Random scale
        const scaleMin = sprite.scaleRange?.[0] ?? 1;
        const scaleMax = sprite.scaleRange?.[1] ?? 1;
        const scale = scaleMin + this.rng.next() * (scaleMax - scaleMin);
        
        lines.push(...this.generateSpriteEntity(
          sprite,
          x + offsetX,
          y,
          z + offsetZ,
          scale
        ));
      }
    }
    
    return lines;
  }
  
  /**
   * Get sprite definitions (inline for now, could load from JSON)
   */
  private getSpriteDefinitions(): Record<string, Array<{
    id: string;
    file: string;
    width: number;
    height: number;
    scaleRange?: [number, number];
    shadow?: boolean;
  }>> {
    return {
      rocks: [
        {
          id: 'rock_1',
          file: 'sprites/rock_1.png',
          width: 48,
          height: 38,
          scaleRange: [0.8, 1.2],
          shadow: true,
        },
        {
          id: 'rock_2',
          file: 'sprites/rock_2.png',
          width: 36,
          height: 28,
          scaleRange: [0.7, 1.1],
          shadow: true,
        },
      ],
      vegetation: [],
    };
  }
  
  /**
   * Generate a sprite entity (misc_sprite for NetRadiant compatibility)
   */
  private generateSpriteEntity(
    sprite: { id: string; file: string; width: number; height: number; shadow?: boolean },
    x: number, y: number, z: number,
    scale: number
  ): string[] {
    const lines: string[] = [];
    
    lines.push(`// entity ${this.entityCount++}`);
    lines.push('{');
    lines.push(`"classname" "misc_sprite"`);
    lines.push(`"origin" "${x.toFixed(1)} ${z.toFixed(1)} ${y.toFixed(1)}"`);
    lines.push(`"sprite" "${sprite.file}"`);
    lines.push(`"width" "${sprite.width.toFixed(1)}"`);
    lines.push(`"height" "${sprite.height.toFixed(1)}"`);
    lines.push(`"scale" "${scale.toFixed(2)}"`);
    lines.push(`"billboard" "1"`);
    lines.push(`"shadow" "${sprite.shadow ? '1' : '0'}"`);
    lines.push(`"anchor" "bottom-center"`);
    lines.push('}');
    
    return lines;
  }
  
  /**
   * Generate worldspawn entity with terrain cells and roads
   */
  private generateWorldspawn(): string[] {
    const lines: string[] = [];
    const { width, depth, cellSize } = this.config;
    
    lines.push(`// entity ${this.entityCount++}`);
    lines.push('{');
    lines.push(`"classname" "worldspawn"`);
    lines.push(`"message" "${this.config.mapName}"`);
    lines.push(`"camera_mode" "perspective"`);
    lines.push(`"camera_height" "800"`);
    lines.push(`"area_id" "${this.config.areaId}"`);
    lines.push(`"area_tier" "${this.config.areaTier}"`);
    
    const halfW = width / 2;
    const halfD = depth / 2;
    
    // Base ground plane (below everything)
    lines.push(...this.generateBrush(
      -halfW, -halfD, -48,
      halfW, halfD, -32,
      this.colors.ground,
      "base ground"
    ));
    
    // Generate terrain with optimization
    if (this.config.optimization.mergeFlatBrushes) {
      lines.push(...this.generateOptimizedTerrain(halfW, halfD, cellSize));
    } else {
      lines.push(...this.generateUnoptimizedTerrain(halfW, halfD, cellSize));
    }
    
    // Generate road center lines
    lines.push(...this.generateRoadMarkings());
    
    lines.push('}');
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
          Math.abs(h11 - avgHeight)
        );
        const isFlat = maxDiff < tolerance;
        const color = this.getCellColor(cellType);
        
        if (isFlat || cellType === 'road_h' || cellType === 'road_v' || cellType === 'intersection') {
          const height = cellType.startsWith('road') || cellType === 'intersection' ? 0 : avgHeight;
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
          Math.abs(h11 - avgHeight)
        );
        const isFlat = maxDiff < tolerance;
        const isRoad = cellType === 'road_h' || cellType === 'road_v' || cellType === 'intersection';
        
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
        const isRoad = cellType === 'road_h' || cellType === 'road_v' || cellType === 'intersection';
        const height = isRoad ? 0 : baseHeight;
        
        // Find maximum rectangle of same type and similar height
        let maxCol = col;
        let maxRow = row;
        
        // Expand horizontally first
        while (maxCol < this.gridCols - 1 && 
               maxCol - col < maxMerge &&
               !processed[row][maxCol] &&
               this.canMergeCell(row, maxCol, cellType, height, tolerance, isRoad)) {
          maxCol++;
        }
        
        // Then expand vertically
        let canExpandDown = true;
        while (canExpandDown && 
               maxRow < this.gridRows - 1 && 
               maxRow - row < maxMerge) {
          // Check if entire row can be merged
          for (let c = col; c < maxCol; c++) {
            if (processed[maxRow + 1][c] || 
                !this.canMergeCell(maxRow + 1, c, cellType, height, tolerance, isRoad)) {
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
    row: number, col: number, 
    targetType: CellType, targetHeight: number, 
    tolerance: number, isRoad: boolean
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
      Math.abs(h11 - avgHeight)
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
      case 'road_h':
      case 'road_v':
      case 'intersection':
        return this.colors.road;
      case 'sidewalk':
        return this.colors.sidewalk;
      case 'grass':
        return this.colors.grass;
      case 'water':
        return this.colors.water;
      default:
        return this.colors.ground;
    }
  }
  
  /**
   * Generate a flat terrain brush
   */
  private generateTerrainBrush(
    x1: number, z1: number,
    x2: number, z2: number,
    height: number,
    color: RGB,
    cellType: CellType
  ): string[] {
    const baseZ = -16;
    const topZ = baseZ + height;
    const thickness = 8;
    
    return this.generateBrush(
      x1, z1, topZ - thickness,
      x2, z2, topZ,
      color,
      cellType
    );
  }
  
  /**
   * Generate a sloped terrain patch (patchDef2)
   */
  private generateTerrainPatch(
    x1: number, z1: number,
    x2: number, z2: number,
    h00: number, h10: number,
    h01: number, h11: number,
    color: RGB,
    cellType: CellType
  ): string[] {
    const lines: string[] = [];
    const tex = this.colorToTexture(color);
    const baseZ = -16;
    
    // 3x3 control points for bezier patch
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const hMid = (h00 + h10 + h01 + h11) / 4;
    const hTop = (h00 + h10) / 2;
    const hBottom = (h01 + h11) / 2;
    const hLeft = (h00 + h01) / 2;
    const hRight = (h10 + h11) / 2;
    
    lines.push(`// patch ${this.patchCount++} - ${cellType}`);
    lines.push('{');
    lines.push('patchDef2');
    lines.push('{');
    lines.push(tex);
    lines.push('( 3 3 0 0 0 )');
    lines.push('(');
    
    // Row 0 (z1 - front)
    lines.push(`( ( ${x1} ${z1} ${baseZ + h00} 0 0 ) ( ${midX} ${z1} ${baseZ + hTop} 0.5 0 ) ( ${x2} ${z1} ${baseZ + h10} 1 0 ) )`);
    
    // Row 1 (midZ - middle)
    lines.push(`( ( ${x1} ${midZ} ${baseZ + hLeft} 0 0.5 ) ( ${midX} ${midZ} ${baseZ + hMid} 0.5 0.5 ) ( ${x2} ${midZ} ${baseZ + hRight} 1 0.5 ) )`);
    
    // Row 2 (z2 - back)
    lines.push(`( ( ${x1} ${z2} ${baseZ + h01} 0 1 ) ( ${midX} ${z2} ${baseZ + hBottom} 0.5 1 ) ( ${x2} ${z2} ${baseZ + h11} 1 1 ) )`);
    
    lines.push(')');
    lines.push('}');
    lines.push('}');
    
    return lines;
  }
  
  /**
   * Generate road center line markings
   */
  private generateRoadMarkings(): string[] {
    const lines: string[] = [];
    const { width, depth, blockSize, roadWidth } = this.config;
    const halfW = width / 2;
    const halfD = depth / 2;
    const lineWidth = 4;
    const lineHeight = 2;
    
    // Horizontal road center lines
    for (let roadZ = -halfD; roadZ <= halfD; roadZ += blockSize) {
      lines.push(...this.generateBrush(
        -halfW, roadZ - lineWidth / 2, -16,
        halfW, roadZ + lineWidth / 2, -16 + lineHeight,
        this.colors.roadLine,
        "road line h"
      ));
    }
    
    // Vertical road center lines
    for (let roadX = -halfW; roadX <= halfW; roadX += blockSize) {
      lines.push(...this.generateBrush(
        roadX - lineWidth / 2, -halfD, -16,
        roadX + lineWidth / 2, halfD, -16 + lineHeight,
        this.colors.roadLine,
        "road line v"
      ));
    }
    
    return lines;
  }
  
  /**
   * Generate a road segment with center line
   */
  private generateRoad(
    x1: number, z1: number,
    x2: number, z2: number,
    direction: 'horizontal' | 'vertical'
  ): string[] {
    const lines: string[] = [];
    const colors = this.colors;
    
    // Road surface (slightly above ground)
    lines.push(...this.generateBrush(
      x1, z1, -16,
      x2, z2, -14,
      colors.road,
      `road ${direction}`
    ));
    
    // Center line
    const lineWidth = 4;
    if (direction === 'horizontal') {
      const centerZ = (z1 + z2) / 2;
      lines.push(...this.generateBrush(
        x1, centerZ - lineWidth / 2, -14,
        x2, centerZ + lineWidth / 2, -12,
        colors.roadLine,
        "center line"
      ));
    } else {
      const centerX = (x1 + x2) / 2;
      lines.push(...this.generateBrush(
        centerX - lineWidth / 2, z1, -14,
        centerX + lineWidth / 2, z2, -12,
        colors.roadLine,
        "center line"
      ));
    }
    
    return lines;
  }
  
  /**
   * Generate a sidewalk with curb
   */
  private generateSidewalk(
    x1: number, z1: number,
    x2: number, z2: number
  ): string[] {
    const lines: string[] = [];
    const colors = this.colors;
    const { curbHeight } = this.config;
    
    // Sidewalk surface (raised)
    lines.push(...this.generateBrush(
      x1, z1, -16,
      x2, z2, -16 + curbHeight,
      colors.sidewalk,
      "sidewalk"
    ));
    
    return lines;
  }
  
  /**
   * Generate a box brush in brushDef format
   */
  private generateBrush(
    x1: number, z1: number, y1: number,
    x2: number, z2: number, y2: number,
    color: RGB,
    comment?: string
  ): string[] {
    const lines: string[] = [];
    const tex = this.colorToTexture(color);
    const texDark = this.colorToTexture(this.darkenColor(color, 0.8));
    const texMid = this.colorToTexture(this.darkenColor(color, 0.9));
    
    // UV matrix (standard)
    const uv = '( ( 0.03125 0 -0 ) ( -0 0.03125 0 ) )';
    
    lines.push(`// brush ${this.brushCount++}${comment ? ` - ${comment}` : ''}`);
    lines.push('{');
    lines.push('brushDef');
    lines.push('{');
    
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
    
    lines.push('}');
    lines.push('}');
    
    return lines;
  }
  
  /**
   * Generate a bezier patch (patchDef2) for curved surfaces
   */
  private generatePatch(
    controlPoints: Vec3[][],
    color: RGB,
    comment?: string
  ): string[] {
    const lines: string[] = [];
    const tex = this.colorToTexture(color);
    
    const height = controlPoints.length;
    const width = controlPoints[0]?.length || 0;
    
    lines.push(`// patch${comment ? ` - ${comment}` : ''}`);
    lines.push('{');
    lines.push('patchDef2');
    lines.push('{');
    lines.push(tex);
    lines.push(`( ${width} ${height} 0 0 0 )`);
    lines.push('(');
    
    for (const row of controlPoints) {
      const rowStr = row.map(p => `( ${p.x} ${p.z} ${p.y} 0 0 )`).join(' ');
      lines.push(`( ${rowStr} )`);
    }
    
    lines.push(')');
    lines.push('}');
    lines.push('}');
    
    return lines;
  }
  
  /**
   * Generate player start entity
   */
  private generatePlayerStart(): string[] {
    return [
      `// entity ${this.entityCount++}`,
      '{',
      '"classname" "info_player_start"',
      '"origin" "0 0 100"',
      '}',
    ];
  }
  
  /**
   * Generate ambient lights
   */
  private generateLights(): string[] {
    const lines: string[] = [];
    
    // Main ambient light
    lines.push(`// entity ${this.entityCount++}`);
    lines.push('{');
    lines.push('"classname" "light"');
    lines.push('"origin" "0 0 300"');
    lines.push('"light" "150"');
    lines.push('"range" "1000"');
    lines.push('"_color" "1 0.95 0.9"');
    lines.push('}');
    
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
          if (this.rng.bool(0.6)) { // 60% chance per corner
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
      '{',
      '"classname" "street_lamp"',
      `"targetname" "lamp_${id}"`,
      `"origin" "${x} ${z} 50"`,
      '"light" "150"',
      '"range" "120"',
      `"_color" "${r} ${g} ${b}"`,
      `"fadeTime" "${fadeTime}"`,
      '"bulbSize" "3"',
      '}',
    ];
  }
  
  // ============================================================================
  // Utility Methods
  // ============================================================================
  
  private colorToTexture(color: RGB): string {
    return `color_${color[0]}_${color[1]}_${color[2]}`;
  }
  
  private darkenColor(color: RGB, factor: number): RGB {
    return [
      Math.round(color[0] * factor),
      Math.round(color[1] * factor),
      Math.round(color[2] * factor),
    ];
  }
}

// ============================================================================
// CLI Entry Point (for running with ts-node or similar)
// ============================================================================

export function generateMap(config: Partial<MapGeneratorConfig> = {}): string {
  const generator = new MapGenerator(config);
  return generator.generate();
}

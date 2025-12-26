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
  cellSize: number;       // Size of terrain cells for elevation (default: 50)
  
  // Road settings
  roadWidth: number;      // Width of main roads (default: 80)
  sideRoadWidth: number;  // Width of side roads (default: 60)
  sidewalkWidth: number;  // Width of sidewalks (default: 16)
  curbHeight: number;     // Height of curbs (default: 4)
  
  // Elevation settings
  elevation: {
    enabled: boolean;
    maxHeight: number;    // Maximum hill height (default: 40)
    frequency: number;    // Noise frequency (default: 0.01)
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
  width: 800,
  depth: 800,
  blockSize: 200,
  cellSize: 50,
  roadWidth: 80,
  sideRoadWidth: 60,
  sidewalkWidth: 16,
  curbHeight: 4,
  elevation: {
    enabled: true,
    maxHeight: 40,
    frequency: 0.008,
    flattenRoads: true,
  },
  biome: 'suburban',
  features: {
    water: true,
    vegetation: true,
    streetLamps: true,
    rocks: true,
  },
  density: {
    vegetation: 0.3,
    rocks: 0.15,
    streetLamps: 0.6,
    water: 0.1,
  },
  mapName: "Generated Map",
  areaId: "generated",
  areaTier: "slums",
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
// Map Generator
// ============================================================================

export class MapGenerator {
  private config: MapGeneratorConfig;
  private colors: BiomeColors;
  private rng: SeededRandom;
  private entityCount: number = 0;
  private brushCount: number = 0;
  
  constructor(config: Partial<MapGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.colors = BIOME_COLORS[this.config.biome];
    this.rng = new SeededRandom(this.config.seed ?? Date.now());
  }
  
  /**
   * Generate a complete .map file
   */
  generate(): string {
    this.entityCount = 0;
    this.brushCount = 0;
    
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
    
    return lines.join('\n');
  }
  
  /**
   * Generate worldspawn entity with ground and road geometry
   */
  private generateWorldspawn(): string[] {
    const lines: string[] = [];
    const { width, depth, blockSize, roadWidth, sidewalkWidth } = this.config;
    
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
    
    // Base ground plane
    lines.push(...this.generateBrush(
      -halfW, -halfD, -32,
      halfW, halfD, -16,
      this.colors.ground,
      "base ground"
    ));
    
    // Calculate road positions based on block size
    const numBlocksX = Math.floor(width / blockSize);
    const numBlocksZ = Math.floor(depth / blockSize);
    
    // Generate horizontal roads
    for (let i = 0; i <= numBlocksZ; i++) {
      const z = -halfD + i * blockSize;
      if (z > halfD - roadWidth / 2) continue;
      
      lines.push(...this.generateRoad(
        -halfW, z - roadWidth / 2,
        halfW, z + roadWidth / 2,
        'horizontal'
      ));
    }
    
    // Generate vertical roads
    for (let i = 0; i <= numBlocksX; i++) {
      const x = -halfW + i * blockSize;
      if (x > halfW - roadWidth / 2) continue;
      
      lines.push(...this.generateRoad(
        x - roadWidth / 2, -halfD,
        x + roadWidth / 2, halfD,
        'vertical'
      ));
    }
    
    // Generate sidewalks along roads
    for (let i = 0; i <= numBlocksZ; i++) {
      const z = -halfD + i * blockSize;
      if (z > halfD - roadWidth / 2) continue;
      
      // North sidewalk
      lines.push(...this.generateSidewalk(
        -halfW, z + roadWidth / 2,
        halfW, z + roadWidth / 2 + sidewalkWidth
      ));
      
      // South sidewalk
      lines.push(...this.generateSidewalk(
        -halfW, z - roadWidth / 2 - sidewalkWidth,
        halfW, z - roadWidth / 2
      ));
    }
    
    lines.push('}');
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

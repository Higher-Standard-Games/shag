# Map Generator Specification

## Overview

A procedural map generator that creates `.map` files with textured terrain, roads, and decorations. The generator should produce visually interesting outdoor environments suitable for the game.

## Goals

1. **Textured terrain** - Support real textures, not just solid colors
2. **Road networks** - Realistic road layouts with intersections
3. **Natural elements** - Grass, dirt, rocks, water
4. **Decorations** - Plants, trees, props, street furniture
5. **Build zones** - Pre-placed areas for player building
6. **Reproducible** - Seed-based generation for consistent results

---

## Terrain Types & Textures

### Ground Layers (bottom to top)

| Layer | Description | Texture Examples | Height |
|-------|-------------|------------------|--------|
| **Base** | Solid foundation | `dirt_dark`, `rock_base` | -32 to -16 |
| **Ground** | Main walkable surface | `grass`, `dirt`, `sand`, `concrete` | -16 to 0 |
| **Road** | Vehicle/pedestrian paths | `asphalt`, `cobblestone`, `gravel` | -14 to -12 |
| **Sidewalk** | Raised pedestrian areas | `concrete_light`, `brick_path` | -12 to -8 |
| **Curb** | Road edges | `concrete_curb` | -12 to -8 |

### Texture Definitions

```typescript
interface TerrainTexture {
  id: string;              // Unique identifier
  file: string;            // Texture file path (or color_R_G_B for solid)
  scale: number;           // UV scale (default: 0.03125)
  variants?: string[];     // Alternative textures for variety
  blendable?: boolean;     // Can blend with adjacent textures
}
```

### Default Texture Set

```typescript
const TEXTURES = {
  // Ground
  grass: { file: "textures/terrain/grass_01", scale: 0.0625 },
  grass_dry: { file: "textures/terrain/grass_dry", scale: 0.0625 },
  dirt: { file: "textures/terrain/dirt_01", scale: 0.0625 },
  dirt_dark: { file: "color_45_40_35", scale: 0.03125 },
  sand: { file: "textures/terrain/sand_01", scale: 0.0625 },
  
  // Roads
  asphalt: { file: "textures/roads/asphalt_01", scale: 0.03125 },
  asphalt_cracked: { file: "textures/roads/asphalt_cracked", scale: 0.03125 },
  cobblestone: { file: "textures/roads/cobblestone_01", scale: 0.0625 },
  gravel: { file: "textures/roads/gravel_01", scale: 0.0625 },
  
  // Road markings
  road_line_yellow: { file: "color_200_180_50", scale: 0.03125 },
  road_line_white: { file: "color_240_240_240", scale: 0.03125 },
  crosswalk: { file: "textures/roads/crosswalk", scale: 0.03125 },
  
  // Sidewalks
  concrete: { file: "textures/terrain/concrete_01", scale: 0.03125 },
  concrete_light: { file: "color_140_135_130", scale: 0.03125 },
  brick_path: { file: "textures/terrain/brick_path", scale: 0.0625 },
  
  // Natural
  rock: { file: "textures/terrain/rock_01", scale: 0.0625 },
  rock_mossy: { file: "textures/terrain/rock_mossy", scale: 0.0625 },
  water: { file: "textures/terrain/water_01", scale: 0.125 },
};
```

---

## Generation Layers

### 1. Terrain Grid

The map is divided into a grid of cells. Each cell has:
- **Type**: ground, road, water, building_footprint
- **Elevation**: height offset
- **Texture**: which texture to use
- **Biome**: affects texture selection (urban, rural, industrial)

```typescript
interface GridCell {
  x: number;
  z: number;
  type: CellType;
  elevation: number;
  texture: string;
  biome: BiomeType;
}

type CellType = 
  | 'ground'
  | 'road_h'        // Horizontal road
  | 'road_v'        // Vertical road
  | 'intersection'  // Road crossing
  | 'sidewalk'
  | 'water'
  | 'building';

type BiomeType = 'urban' | 'suburban' | 'rural' | 'industrial';
```

### 2. Road Network

Roads are generated using a grid-based approach:

```
┌─────────┬─────────┬─────────┐
│  Block  │  Block  │  Block  │
│         │         │         │
├────═════╪═════════╪═════────┤  ← Road
│  Block  │  Block  │  Block  │
│         │         │         │
├────═════╪═════════╪═════────┤  ← Road
│  Block  │  Block  │  Block  │
│         │         │         │
└─────────┴─────────┴─────────┘
     ↑         ↑         ↑
   Roads    Roads     Roads
```

**Road Features:**
- Main roads (wider, 2 lanes)
- Side streets (narrower, 1 lane)
- Intersections with proper geometry
- Center lines and edge lines
- Crosswalks at intersections
- Curbs and gutters

### 3. Decorations & Props

Placed after terrain generation:

| Category | Items | Placement Rules |
|----------|-------|-----------------|
| **Street Furniture** | Lamps, benches, trash cans | Along sidewalks, at corners |
| **Vegetation** | Grass patches, bushes, trees | On ground cells, not roads |
| **Rocks** | Small rocks, boulders | Scattered on ground, edges |
| **Props** | Crates, barrels, signs | Near buildings, intersections |

### 4. Build Zones

Pre-defined areas where players can place objects:

```typescript
interface BuildZoneConfig {
  type: 'plant' | 'growlight' | 'equipment' | 'decoration';
  minPerBlock: number;
  maxPerBlock: number;
  spacing: number;      // Minimum distance between zones
  validCells: CellType[]; // Which cell types can have this zone
}
```

---

## Configuration Schema

```typescript
interface MapGeneratorConfig {
  // Dimensions
  width: number;           // Map width in units
  depth: number;           // Map depth in units
  
  // Grid
  blockSize: number;       // City block size
  cellSize: number;        // Individual cell size for detail
  
  // Roads
  mainRoadWidth: number;   // Primary road width
  sideRoadWidth: number;   // Secondary road width
  sidewalkWidth: number;   // Sidewalk width
  
  // Textures
  textures: {
    ground: string | string[];    // Random selection if array
    road: string | string[];
    sidewalk: string | string[];
    roadLine: string;
  };
  
  // Biome
  biome: BiomeType;
  
  // Features
  features: {
    streetLamps: boolean;
    vegetation: boolean;
    rocks: boolean;
    buildZones: boolean;
  };
  
  // Density (0-1)
  density: {
    vegetation: number;
    rocks: number;
    props: number;
    streetLamps: number;
  };
  
  // Randomization
  seed?: number;
  
  // Metadata
  mapName: string;
  areaId: string;
  areaTier: string;
}
```

---

## Output Format

The generator outputs a `.map` file with:

1. **Header** - Layer definition
2. **Worldspawn** - Contains all terrain brushes
3. **Entities** - Lights, props, triggers, build zones

### Brush Types Used

| Type | Use Case |
|------|----------|
| `brushDef` | Flat surfaces, boxes, walls |
| `patchDef2` | Curved surfaces, ramps, terrain blending |

### Entity Types Generated

| Entity | Purpose |
|--------|---------|
| `info_player_start` | Player spawn |
| `light` | Ambient lighting |
| `street_lamp` | Street lighting |
| `build_zone` | Player building areas |
| `prop_static` | Decorative objects |
| `info_vegetation` | Plants/trees (if supported) |

---

## Features

| Feature | Status |
|---------|--------|
| Basic grid generation | ✅ |
| Brush output format | ✅ |
| Road network | ✅ |
| Street lamps | ✅ |
| Perlin noise elevation | ✅ |
| Bezier patches for slopes | ✅ |
| Brush merging optimization | ✅ |
| JSON configuration | ✅ |
| Terrain elevation variation | ✅ |
| Dirt blob patches | ✅ |
| Rock sprites | ✅ |
| Pond generation | ✅ |
| Sandy shorelines | ✅ |
| Water patches | ✅ |
| Street furniture | ✅ |
| Vegetation sprites | ✅ |
| 4 biome presets | ✅ |
| CLI with options | ✅ |

---

## Configuration Reference

All parameters can be set via the `MapGeneratorConfig` interface or the JSON config file at `src/tools/mapgen.config.json`.

### Dimensions

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `width` | number | 400 | Map width in units |
| `depth` | number | 400 | Map depth in units |
| `cellSize` | number | 32 | Terrain cell size (smaller = more detail, more geometry) |
| `blockSize` | number | 200 | City block size (distance between roads) |

### Roads

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `roadWidth` | number | 80 | Main road width |
| `sideRoadWidth` | number | 60 | Side road width |
| `sidewalkWidth` | number | 16 | Sidewalk width |
| `curbHeight` | number | 4 | Curb height above road |

### Elevation

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `elevation.enabled` | boolean | true | Enable terrain elevation |
| `elevation.maxHeight` | number | 30 | Maximum hill height |
| `elevation.frequency` | number | 0.015 | Noise frequency (lower = larger hills) |
| `elevation.octaves` | number | 3 | Noise octaves (more = more detail) |
| `elevation.persistence` | number | 0.5 | Octave amplitude falloff |
| `elevation.flattenRoads` | boolean | true | Keep roads at elevation 0 |

### Optimization

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `optimization.mergeFlatBrushes` | boolean | true | Merge adjacent flat cells into larger brushes |
| `optimization.maxMergeSize` | number | 128 | Maximum merged brush size |
| `optimization.flatTolerance` | number | 2 | Height difference tolerance for "flat" |

**Optimization Results (400x400 map, 32-unit cells):**
- Without optimization: 116 brushes
- With optimization: 32 brushes (72% reduction)

### Biome

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `biome` | string | "suburban" | Biome preset: `urban`, `suburban`, `rural`, `industrial` |

### Features

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `features.water` | boolean | false | Generate water features |
| `features.vegetation` | boolean | true | Generate vegetation sprites (trees, grass) |
| `features.streetLamps` | boolean | true | Generate street lamps |
| `features.rocks` | boolean | true | Generate rock sprites |

### Density

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `density.vegetation` | number | 0.3 | Vegetation density (0-1) |
| `density.rocks` | number | 0.15 | Rock density (0-1) |
| `density.streetLamps` | number | 0.6 | Street lamp density (0-1) |
| `density.water` | number | 0.1 | Water feature probability |
| `density.ponds` | number | 0.3 | Pond density (0-1), affects number of ponds |

### Ponds

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ponds.enabled` | boolean | false | Enable pond generation |
| `ponds.waterLevel` | number | 10 | Base water level offset |
| `ponds.maxDepth` | number | 30 | Maximum pond depression depth |
| `ponds.minRadius` | number | 64 | Minimum pond radius |
| `ponds.maxRadius` | number | 192 | Maximum pond radius |

**Pond Features:**
- Terrain depressions using cosine falloff
- Flat water surface patches
- Sandy shoreline rings around each pond
- Vegetation/rocks automatically avoid pond areas

### Output

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mapName` | string | "Generated Map" | Display name in game |
| `areaId` | string | "generated" | Area identifier |
| `areaTier` | string | "suburbs" | Area tier for game logic |
| `seed` | number | Date.now() | Random seed for reproducibility |

---

## Example Usage

```typescript
import { MapGenerator } from './tools/MapGenerator';

const generator = new MapGenerator({
  width: 400,
  depth: 400,
  blockSize: 200,
  cellSize: 32,
  biome: 'suburban',
  seed: 42,
  elevation: {
    enabled: true,
    maxHeight: 30,
    frequency: 0.015,
    octaves: 3,
    persistence: 0.5,
    flattenRoads: true,
  },
  optimization: {
    mergeFlatBrushes: true,
    maxMergeSize: 128,
    flatTolerance: 2,
  },
  features: {
    streetLamps: true,
    vegetation: false,
    rocks: false,
    water: false,
  },
  mapName: "Terrain Test",
  areaId: "terrain_test",
  areaTier: "suburbs",
});

const mapContent = generator.generate();
fs.writeFileSync('public/maps/generated/terrain_test.map', mapContent);
```

### CLI Usage

```bash
# Generate terrain-only map with ponds
npx vite-node src/tools/generate-map.ts --name my_map --terrainOnly --width 1024 --depth 1024 --ponds 0.4 --vegetation 0.1 --rocks 0.05 --seed 42

# CLI Options:
#   --name <string>       Output filename (without .map)
#   --width <number>      Map width in units
#   --depth <number>      Map depth in units
#   --seed <number>       Random seed for reproducibility
#   --biome <string>      Biome: urban, suburban, rural, industrial
#   --terrainOnly         Generate terrain patches only (no roads)
#   --ponds <number>      Pond density 0-1 (enables ponds)
#   --vegetation <number> Vegetation density 0-1
#   --rocks <number>      Rock density 0-1
```

---

## Decided Features

1. **Textures** - Use solid colors (`color_R_G_B`) for fast iteration. Real textures can be added later.
2. **Vegetation** - Sprite-based (billboards). See Sprite Art Specifications below.
3. **Water** - Blue brush geometry. Transparency is a nice-to-have for later.
4. **Elevation** - Yes! Hills and slopes using bezier patches for smooth terrain.
5. **Buildings** - Leave empty blocks. Buildings will be added as models later.
6. **Biomes** - Configurable styles (urban, suburban, rural, industrial).

---

## Sprite Art Specifications

For vegetation sprites, we need billboard images with transparency.

### Required Sprites

| Sprite | Size | Description | Variants |
|--------|------|-------------|----------|
| `grass_tuft` | 64x64 | Small grass clump | 3-4 |
| `grass_tall` | 64x128 | Tall grass/reeds | 2-3 |
| `bush_small` | 128x128 | Small bush | 2-3 |
| `bush_large` | 256x256 | Large bush | 2 |
| `tree_small` | 256x512 | Small tree | 2-3 |
| `tree_large` | 512x512 | Large tree | 2 |
| `flower_wild` | 64x64 | Wildflowers | 3-4 |
| `rock_small` | 64x64 | Small rock | 3-4 |
| `rock_medium` | 128x128 | Medium rock | 2-3 |

### Art Style Guidelines

- **Format**: PNG with transparency
- **Style**: Match existing game art (slightly stylized, not photorealistic)
- **Colors**: 
  - Grass: Various greens (#4a7c23, #5d8a2f, #3d6b1a)
  - Rocks: Grays and browns (#6b6b6b, #8a7d6b, #5c5c5c)
  - Flowers: Colorful accents (#e74c3c, #f1c40f, #9b59b6)
- **Shading**: Simple, cel-shaded look with clear outlines optional
- **Anchor**: Bottom-center (sprites are placed at ground level)

### Sprite Entity Format

```
{
"classname" "sprite_vegetation"
"origin" "x y z"
"sprite" "sprites/vegetation/grass_tuft_01"
"scale" "1.0"
"billboard" "1"
}
```

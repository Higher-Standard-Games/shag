/**
 * Quick test for the map generator
 * Run with: npx vite-node src/tools/test-generator.ts
 */

import * as fs from "fs";
import * as path from "path";
import { createHeightmapData } from "./HeightmapGenerator";
import { MapGenerator, type MapGeneratorConfig } from "./MapGenerator";

// Ensure output directory exists
const outputDir = path.join(__dirname, "../../public/maps/generated");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Generate terrain test map with 32-unit cells and optimization
console.log("\n=== Generating terrain_test.map (optimized, 32-unit cells) ===");
const terrainConfig: Partial<MapGeneratorConfig> = {
  width: 400,
  depth: 400,
  blockSize: 200,
  cellSize: 32,
  biome: "suburban",
  seed: 42,
  terrainOnly: false, // Include roads and curbs
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
    water: false,
    vegetation: true,
    streetLamps: true,
    rocks: true,
  },
  density: {
    vegetation: 0.4,
    rocks: 0.15,
    streetLamps: 0.6,
    water: 0.1,
    ponds: 0.3,
  },
  mapName: "Terrain Test",
  areaId: "terrain_test",
  areaTier: "suburbs",
};

const terrainTest = new MapGenerator(terrainConfig);
const terrainContent = terrainTest.generate();
const terrainPath = path.join(outputDir, "terrain_test.map");
fs.writeFileSync(terrainPath, terrainContent);

// Count brushes and patches
const brushCount = (terrainContent.match(/brushDef/g) || []).length;
const patchCount = (terrainContent.match(/patchDef2/g) || []).length;
console.log(`  Output: ${terrainPath}`);
console.log(`  Size: ${terrainContent.length} bytes, ${terrainContent.split("\n").length} lines`);
console.log(`  Geometry: ${brushCount} brushes, ${patchCount} patches`);

// Generate comparison without optimization
console.log("\n=== Generating terrain_unoptimized.map (no merging) ===");
const unoptConfig: Partial<MapGeneratorConfig> = {
  ...terrainConfig,
  optimization: {
    mergeFlatBrushes: false,
    maxMergeSize: 128,
    flatTolerance: 2,
  },
  mapName: "Terrain Unoptimized",
  areaId: "terrain_unopt",
};

const unoptTest = new MapGenerator(unoptConfig);
const unoptContent = unoptTest.generate();
const unoptPath = path.join(outputDir, "terrain_unoptimized.map");
fs.writeFileSync(unoptPath, unoptContent);

const unoptBrushes = (unoptContent.match(/brushDef/g) || []).length;
const unoptPatches = (unoptContent.match(/patchDef2/g) || []).length;
console.log(`  Output: ${unoptPath}`);
console.log(`  Size: ${unoptContent.length} bytes, ${unoptContent.split("\n").length} lines`);
console.log(`  Geometry: ${unoptBrushes} brushes, ${unoptPatches} patches`);

// Calculate savings
const sizeSaved = unoptContent.length - terrainContent.length;
const brushesSaved = unoptBrushes - brushCount;
console.log(`\n=== Optimization Results ===`);
console.log(
  `  Brushes reduced: ${unoptBrushes} → ${brushCount} (${brushesSaved} fewer, ${Math.round((brushesSaved / unoptBrushes) * 100)}% reduction)`,
);
console.log(`  File size reduced: ${unoptContent.length} → ${terrainContent.length} bytes (${sizeSaved} bytes saved)`);

// ============================================================================
// Generate heightmap-based terrain
// ============================================================================
console.log("\n=== Generating terrain_heightmap.map (using hill heightmap) ===");

// Create a hill heightmap
const heightmapData = createHeightmapData("perlin", 64, 64, 12345);

const heightmapConfig: Partial<MapGeneratorConfig> = {
  width: 1024, // Larger map for more terrain
  depth: 1024,
  blockSize: 512,
  cellSize: 128, // 128-unit patches (Quake standard)
  biome: "suburban",
  seed: 42,
  terrainOnly: true, // Pure terrain, no roads/blocks
  elevation: {
    enabled: true,
    maxHeight: 128, // 128 units = real hills (stair is 16 units)
    frequency: 0.015,
    octaves: 3,
    persistence: 0.5,
    flattenRoads: false, // Not needed in terrain-only mode
    heightmap: heightmapData, // Use the generated heightmap!
  },
  optimization: {
    mergeFlatBrushes: true,
    maxMergeSize: 128,
    flatTolerance: 2,
  },
  patchResolution: 9, // 9x9 vertices per patch - creates detailed terrain from few patches
  features: {
    water: true, // Enable water ponds
    vegetation: true,
    streetLamps: false,
    rocks: true,
  },
  density: {
    vegetation: 0.05, // Reduced to see terrain geometry
    rocks: 0.02, // Reduced to see terrain geometry
    streetLamps: 0.6,
    water: 0.1,
    ponds: 0.3,
  },
  mapName: "Heightmap Terrain",
  areaId: "terrain_heightmap",
  areaTier: "suburbs",
};

const heightmapTest = new MapGenerator(heightmapConfig);
const heightmapContent = heightmapTest.generate();
const heightmapPath = path.join(outputDir, "terrain_heightmap.map");
fs.writeFileSync(heightmapPath, heightmapContent);

const hmBrushes = (heightmapContent.match(/brushDef/g) || []).length;
const hmPatches = (heightmapContent.match(/patchDef2/g) || []).length;
console.log(`  Output: ${heightmapPath}`);
console.log(`  Size: ${heightmapContent.length} bytes, ${heightmapContent.split("\n").length} lines`);
console.log(`  Geometry: ${hmBrushes} brushes, ${hmPatches} patches`);
console.log(`  Heightmap: ${heightmapData.width}x${heightmapData.height} pixels, multiHill preset`);

console.log("\nDone! Maps generated in public/maps/generated/");

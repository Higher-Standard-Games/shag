/**
 * Quick test for the map generator
 * Run with: npx vite-node src/tools/test-generator.ts
 */

import { MapGenerator, MapGeneratorConfig } from './MapGenerator';
import * as fs from 'fs';
import * as path from 'path';

// Ensure output directory exists
const outputDir = path.join(__dirname, '../../public/maps/generated');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Generate terrain test map with 32-unit cells and optimization
console.log('\n=== Generating terrain_test.map (optimized, 32-unit cells) ===');
const terrainConfig: Partial<MapGeneratorConfig> = {
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
  mapName: "Terrain Test",
  areaId: "terrain_test",
  areaTier: "suburbs",
};

const terrainTest = new MapGenerator(terrainConfig);
const terrainContent = terrainTest.generate();
const terrainPath = path.join(outputDir, 'terrain_test.map');
fs.writeFileSync(terrainPath, terrainContent);

// Count brushes and patches
const brushCount = (terrainContent.match(/brushDef/g) || []).length;
const patchCount = (terrainContent.match(/patchDef2/g) || []).length;
console.log(`  Output: ${terrainPath}`);
console.log(`  Size: ${terrainContent.length} bytes, ${terrainContent.split('\n').length} lines`);
console.log(`  Geometry: ${brushCount} brushes, ${patchCount} patches`);

// Generate comparison without optimization
console.log('\n=== Generating terrain_unoptimized.map (no merging) ===');
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
const unoptPath = path.join(outputDir, 'terrain_unoptimized.map');
fs.writeFileSync(unoptPath, unoptContent);

const unoptBrushes = (unoptContent.match(/brushDef/g) || []).length;
const unoptPatches = (unoptContent.match(/patchDef2/g) || []).length;
console.log(`  Output: ${unoptPath}`);
console.log(`  Size: ${unoptContent.length} bytes, ${unoptContent.split('\n').length} lines`);
console.log(`  Geometry: ${unoptBrushes} brushes, ${unoptPatches} patches`);

// Calculate savings
const sizeSaved = unoptContent.length - terrainContent.length;
const brushesSaved = unoptBrushes - brushCount;
console.log(`\n=== Optimization Results ===`);
console.log(`  Brushes reduced: ${unoptBrushes} → ${brushCount} (${brushesSaved} fewer, ${Math.round(brushesSaved/unoptBrushes*100)}% reduction)`);
console.log(`  File size reduced: ${unoptContent.length} → ${terrainContent.length} bytes (${sizeSaved} bytes saved)`);

console.log('\nDone! Maps generated in public/maps/generated/');

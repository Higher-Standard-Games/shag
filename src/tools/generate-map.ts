#!/usr/bin/env node

/**
 * Terrain Map Generator
 *
 * Usage:
 *   npx vite-node src/tools/generate-map.ts [options]
 *
 * Options:
 *   --name <name>         Output filename (default: generated_map)
 *   --width <n>           Map width in units (default: 1024)
 *   --depth <n>           Map depth in units (default: 1024)
 *   --cellSize <n>        Patch size in units (default: 128)
 *   --maxHeight <n>       Maximum terrain height (default: 128)
 *   --seed <n>            Random seed (default: random)
 *   --terrainOnly         Generate terrain only, no roads (default: false)
 *   --heightmap <preset>  Heightmap preset: perlin, hill, multiHill, valley (default: perlin)
 *   --biome <type>        Biome type: suburban, urban, industrial (default: suburban)
 *   --water               Enable water features (default: false)
 *   --vegetation <n>      Vegetation density 0-1 (default: 0.1)
 *   --rocks <n>           Rock density 0-1 (default: 0.05)
 *   --help                Show this help message
 *
 * Examples:
 *   npm run generate:map -- --name my_terrain --width 2048 --maxHeight 200
 *   npm run generate:map -- --terrainOnly --heightmap multiHill --water
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHeightmapData } from "./HeightmapGenerator";
import { MapGenerator, type MapGeneratorConfig } from "./MapGenerator";

// Parse command line arguments
function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = argv[i + 1];

      // Check if it's a boolean flag (no value or next arg is also a flag)
      if (!nextArg || nextArg.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = nextArg;
        i++; // Skip the value
      }
    }
  }

  return args;
}

function showHelp(): void {
  console.log(`
Terrain Map Generator

Usage:
  npx vite-node src/tools/generate-map.ts [options]
  npm run generate-map -- [options]

Options:
  --name <name>         Output filename (default: generated_map)
  --width <n>           Map width in units (default: 1024)
  --depth <n>           Map depth in units (default: 1024)
  --cellSize <n>        Patch size in units (default: 128)
  --maxHeight <n>       Maximum terrain height (default: 128)
  --seed <n>            Random seed (default: random)
  --terrainOnly         Generate terrain only, no roads
  --heightmap <preset>  Heightmap preset: perlin, hill, multiHill, valley (default: perlin)
  --biome <type>        Biome type: suburban, urban, industrial (default: suburban)
  --water               Enable water features
  --vegetation <n>      Vegetation density 0-1 (default: 0.1)
  --rocks <n>           Rock density 0-1 (default: 0.05)
  --ponds <n>           Pond density 0-1 (default: 0, disabled)
  --patchRes <n>        Patch vertex resolution: 3, 5, 7, 9 (default: 9)
  --help                Show this help message

Examples:
  npm run generate-map -- --name my_terrain --width 2048 --maxHeight 200
  npm run generate-map -- --terrainOnly --heightmap multiHill --water
  npm run generate-map -- --width 512 --depth 512 --seed 12345 --vegetation 0.2
`);
}

function main(): void {
  const args = parseArgs();

  // Show help if requested
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Parse options with defaults
  const name = String(args.name || "generated_map");
  const width = parseInt(String(args.width || "1024"), 10);
  const depth = parseInt(String(args.depth || "1024"), 10);
  const cellSize = parseInt(String(args.cellSize || "128"), 10);
  const maxHeight = parseInt(String(args.maxHeight || "128"), 10);
  const seed = args.seed ? parseInt(String(args.seed), 10) : Math.floor(Math.random() * 100000);
  const terrainOnly = Boolean(args.terrainOnly);
  const heightmapPreset = String(args.heightmap || "perlin") as "perlin" | "hill" | "multiHill" | "valley";
  const biome = String(args.biome || "suburban") as "suburban" | "urban" | "industrial";
  const water = Boolean(args.water);
  const vegetation = parseFloat(String(args.vegetation || "0.1"));
  const rocks = parseFloat(String(args.rocks || "0.05"));
  const patchRes = parseInt(String(args.patchRes || "9"), 10);
  const ponds = args.ponds !== undefined ? parseFloat(String(args.ponds)) : 0;

  console.log("\n=== Terrain Map Generator ===");
  console.log(`  Name:        ${name}`);
  console.log(`  Size:        ${width}x${depth} units`);
  console.log(`  Cell Size:   ${cellSize} units`);
  console.log(`  Max Height:  ${maxHeight} units`);
  console.log(`  Seed:        ${seed}`);
  console.log(`  Terrain Only: ${terrainOnly}`);
  console.log(`  Heightmap:   ${heightmapPreset}`);
  console.log(`  Biome:       ${biome}`);
  console.log(`  Water:       ${water}`);
  console.log(`  Vegetation:  ${vegetation}`);
  console.log(`  Rocks:       ${rocks}`);
  console.log(`  Ponds:       ${ponds > 0 ? ponds : "disabled"}`);
  console.log(`  Patch Res:   ${patchRes}x${patchRes}`);
  console.log("");

  // Ensure output directory exists
  const outputDir = path.join(__dirname, "../../public/maps/generated");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate heightmap
  console.log(`Generating ${heightmapPreset} heightmap...`);
  const heightmapData = createHeightmapData(heightmapPreset, 64, 64, seed);

  // Build config
  const config: Partial<MapGeneratorConfig> = {
    width,
    depth,
    blockSize: Math.max(width, depth) / 2,
    cellSize,
    biome,
    seed,
    terrainOnly,
    patchResolution: patchRes,
    elevation: {
      enabled: true,
      maxHeight,
      frequency: 0.015,
      octaves: 3,
      persistence: 0.5,
      flattenRoads: !terrainOnly,
      heightmap: heightmapData,
    },
    optimization: {
      mergeFlatBrushes: true,
      maxMergeSize: 128,
      flatTolerance: 2,
    },
    features: {
      water,
      vegetation: vegetation > 0,
      streetLamps: !terrainOnly,
      rocks: rocks > 0,
    },
    density: {
      vegetation,
      rocks,
      streetLamps: 0.6,
      water: 0.1,
      ponds,
    },
    ponds: {
      enabled: ponds > 0,
      waterLevel: 10,
      maxDepth: 30,
      minRadius: 64,
      maxRadius: 192,
    },
    mapName: name,
    areaId: name.toLowerCase().replace(/\s+/g, "_"),
    areaTier: "suburbs",
  };

  // Generate map
  console.log("Generating map...");
  const generator = new MapGenerator(config);
  const content = generator.generate();

  // Write output
  const outputPath = path.join(outputDir, `${name}.map`);
  fs.writeFileSync(outputPath, content);

  // Stats
  const brushCount = (content.match(/brushDef/g) || []).length;
  const patchCount = (content.match(/patchDef2/g) || []).length;
  const lineCount = content.split("\n").length;

  console.log("\n=== Generation Complete ===");
  console.log(`  Output:   ${outputPath}`);
  console.log(`  Size:     ${content.length} bytes, ${lineCount} lines`);
  console.log(`  Geometry: ${brushCount} brushes, ${patchCount} patches`);
  console.log("");
}

main();

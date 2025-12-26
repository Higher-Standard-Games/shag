/**
 * CLI script to generate a procedural map
 * 
 * Usage: npx ts-node scripts/generate-map.ts [output-path] [options]
 * 
 * Options:
 *   --width=N      Map width (default: 800)
 *   --depth=N      Map depth (default: 800)
 *   --block=N      Block size (default: 200)
 *   --seed=N       Random seed
 *   --name=S       Map name
 */

import * as fs from 'fs';
import * as path from 'path';
import { MapGenerator, MapGeneratorConfig } from '../src/tools/MapGenerator';

// Parse command line arguments
const args = process.argv.slice(2);
let outputPath = 'public/maps/generated/test.map';
const config: Partial<MapGeneratorConfig> = {};

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    switch (key) {
      case 'width':
        config.width = parseInt(value, 10);
        break;
      case 'depth':
        config.depth = parseInt(value, 10);
        break;
      case 'block':
        config.blockSize = parseInt(value, 10);
        break;
      case 'seed':
        config.seed = parseInt(value, 10);
        break;
      case 'name':
        config.mapName = value;
        config.areaId = value.toLowerCase().replace(/\s+/g, '_');
        break;
    }
  } else {
    outputPath = arg;
  }
}

// Generate the map
console.log('Generating map with config:', config);
const generator = new MapGenerator(config);
const mapContent = generator.generate();

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write the map file
fs.writeFileSync(outputPath, mapContent);
console.log(`Map generated: ${outputPath}`);
console.log(`Size: ${mapContent.length} bytes, ${mapContent.split('\n').length} lines`);

/**
 * Quick test for the map generator
 * Run with: npx ts-node src/tools/test-generator.ts
 */

import { MapGenerator } from './MapGenerator';
import * as fs from 'fs';
import * as path from 'path';

// Test different biomes
const biomes = ['urban', 'suburban', 'rural', 'industrial'] as const;

for (const biome of biomes) {
  console.log(`\nGenerating ${biome} map...`);
  
  const generator = new MapGenerator({
    width: 600,
    depth: 600,
    blockSize: 200,
    biome: biome,
    seed: 12345,
    mapName: `Test ${biome.charAt(0).toUpperCase() + biome.slice(1)}`,
    areaId: `test_${biome}`,
    areaTier: biome === 'urban' ? 'downtown' : biome === 'industrial' ? 'industrial' : 'suburbs',
  });
  
  const mapContent = generator.generate();
  
  // Ensure output directory exists
  const outputDir = path.join(__dirname, '../../public/maps/generated');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputPath = path.join(outputDir, `test_${biome}.map`);
  fs.writeFileSync(outputPath, mapContent);
  
  console.log(`  Output: ${outputPath}`);
  console.log(`  Size: ${mapContent.length} bytes, ${mapContent.split('\n').length} lines`);
}

console.log('\nDone! Maps generated in public/maps/generated/');

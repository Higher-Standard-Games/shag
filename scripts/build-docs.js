/**
 * Build API documentation with version from version.txt
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read version from version.txt
const versionPath = join(rootDir, 'src/engine/version.txt');
const version = readFileSync(versionPath, 'utf-8').trim();

console.log(`Building SHAG Engine API docs v${version}...`);

// Run typedoc with version injected via --name option
const cmd = `npx typedoc --name "SHAG Engine API - v${version}"`;

try {
  execSync(cmd, { 
    cwd: rootDir, 
    stdio: 'inherit' 
  });
  console.log(`\nAPI documentation generated successfully!`);
  console.log(`Open docs/api/index.html to view.`);
} catch (error) {
  process.exit(1);
}

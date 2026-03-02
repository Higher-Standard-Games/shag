/**
 * Generate pk3_manifest.json from PK3 files in public/data/
 * 
 * Usage: node scripts/generate-pk3-manifest.js
 * 
 * The PK3Index needs a manifest file to discover PK3 files in the browser
 * (since browsers can't list directory contents).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../public/data');
const MANIFEST_PATH = path.join(DATA_DIR, 'pk3_manifest.json');

// Find all .pk3 files
const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.pk3'))
    .sort();

const manifest = { files };

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Generated ${MANIFEST_PATH}: ${files.length} PK3 files`);

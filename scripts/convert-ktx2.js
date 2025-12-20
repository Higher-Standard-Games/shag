/**
 * KTX2 Texture Conversion Script
 * 
 * Converts PNG/JPG textures to KTX2 format for GPU-compressed textures.
 * This significantly reduces VRAM usage and improves mobile performance.
 * 
 * Requirements:
 * - Install KTX-Software from: https://github.com/KhronosGroup/KTX-Software/releases
 * - Add 'toktx' to your PATH, or set KTX_TOOLS_PATH environment variable
 * 
 * Usage:
 *   npm run build:textures           # Convert all textures
 *   npm run build:textures -- --clean # Clean and reconvert all
 * 
 * Compression modes:
 * - ETC1S: Best for color textures (albedo, sprites) - smaller files
 * - UASTC: Best for normal maps, metallic/roughness - higher quality
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { basename, dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
  // Source directory for textures
  sourceDir: join(__dirname, '..', 'public', 'textures'),
  
  // Output directory for KTX2 files (same structure as source)
  outputDir: join(__dirname, '..', 'public', 'textures-ktx2'),
  
  // File extensions to convert
  extensions: ['.png', '.jpg', '.jpeg', '.webp'],
  
  // Files/patterns to skip (normal maps, metallic maps use UASTC)
  uastcPatterns: ['_normal', '_norm', '_n.', '_metallic', '_roughness', '_mr.', '_ao.'],
  
  // toktx path (uses PATH by default, or KTX_TOOLS_PATH env var)
  toktxPath: process.env.KTX_TOOLS_PATH ? join(process.env.KTX_TOOLS_PATH, 'toktx') : 'toktx',
};

// ANSI colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logError(message) {
  console.error(`${colors.red}ERROR: ${message}${colors.reset}`);
}

/**
 * Check if toktx is available
 */
function checkToktx() {
  try {
    execSync(`${CONFIG.toktxPath} --version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine if a texture should use UASTC (high quality) compression
 */
function shouldUseUastc(filePath) {
  const lowerPath = filePath.toLowerCase();
  return CONFIG.uastcPatterns.some(pattern => lowerPath.includes(pattern));
}

/**
 * Get all texture files recursively from a directory
 */
function getTextureFiles(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }
  
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      getTextureFiles(fullPath, files);
    } else if (CONFIG.extensions.includes(extname(entry).toLowerCase())) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Convert a single texture to KTX2
 */
function convertTexture(sourcePath) {
  const relativePath = relative(CONFIG.sourceDir, sourcePath);
  const outputPath = join(CONFIG.outputDir, relativePath.replace(/\.[^.]+$/, '.ktx2'));
  const outputDirPath = dirname(outputPath);
  
  // Create output directory if needed
  if (!existsSync(outputDirPath)) {
    mkdirSync(outputDirPath, { recursive: true });
  }
  
  // Check if output already exists and is newer than source
  if (existsSync(outputPath)) {
    const sourceTime = statSync(sourcePath).mtimeMs;
    const outputTime = statSync(outputPath).mtimeMs;
    if (outputTime > sourceTime) {
      log(`  SKIP: ${relativePath} (up to date)`, 'dim');
      return { skipped: true };
    }
  }
  
  // Determine compression mode
  const useUastc = shouldUseUastc(sourcePath);
  
  // Build toktx command
  // --t2 = output KTX2 format
  // --encode basis = use Basis Universal compression
  // --bcmp = BasisLZ/ETC1S compression (smaller, good for color)
  // --uastc = UASTC compression (higher quality, good for normal maps)
  // --zcmp = add Zstandard supercompression (smaller files)
  // --genmipmap = generate mipmaps
  const compressionArgs = useUastc 
    ? '--t2 --encode uastc --uastc_quality 2 --zcmp 19'
    : '--t2 --encode etc1s --clevel 4 --qlevel 192';
  
  const command = `${CONFIG.toktxPath} ${compressionArgs} --genmipmap "${outputPath}" "${sourcePath}"`;
  
  try {
    execSync(command, { stdio: 'pipe' });
    const mode = useUastc ? 'UASTC' : 'ETC1S';
    log(`  DONE: ${relativePath} (${mode})`, 'green');
    return { converted: true, mode };
  } catch (error) {
    logError(`Failed to convert ${relativePath}: ${error.message}`);
    return { error: true };
  }
}

/**
 * Clean all KTX2 files
 */
function cleanOutput() {
  if (!existsSync(CONFIG.outputDir)) {
    return;
  }
  
  log('Cleaning KTX2 output directory...', 'yellow');
  
  const ktx2Files = [];
  function findKtx2(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        findKtx2(fullPath);
      } else if (extname(entry).toLowerCase() === '.ktx2') {
        ktx2Files.push(fullPath);
      }
    }
  }
  
  findKtx2(CONFIG.outputDir);
  
  for (const file of ktx2Files) {
    unlinkSync(file);
  }
  
  log(`Cleaned ${ktx2Files.length} KTX2 files`, 'yellow');
}

/**
 * Main conversion function
 */
function main() {
  const args = process.argv.slice(2);
  const shouldClean = args.includes('--clean');
  
  log('\n=== KTX2 Texture Conversion ===\n', 'cyan');
  
  // Check for toktx
  if (!checkToktx()) {
    logError('toktx not found! Please install KTX-Software:');
    log('  https://github.com/KhronosGroup/KTX-Software/releases', 'yellow');
    log('\nAfter installing, either:', 'dim');
    log('  1. Add the bin folder to your PATH', 'dim');
    log('  2. Set KTX_TOOLS_PATH environment variable', 'dim');
    process.exit(1);
  }
  
  log(`Source: ${CONFIG.sourceDir}`, 'dim');
  log(`Output: ${CONFIG.outputDir}`, 'dim');
  log('');
  
  // Clean if requested
  if (shouldClean) {
    cleanOutput();
  }
  
  // Get all texture files
  const textureFiles = getTextureFiles(CONFIG.sourceDir);
  
  if (textureFiles.length === 0) {
    log('No texture files found to convert.', 'yellow');
    log('Place PNG/JPG files in: public/textures/', 'dim');
    return;
  }
  
  log(`Found ${textureFiles.length} texture(s) to process:\n`, 'cyan');
  
  // Convert each texture
  let converted = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const file of textureFiles) {
    const result = convertTexture(file);
    if (result.converted) converted++;
    else if (result.skipped) skipped++;
    else if (result.error) errors++;
  }
  
  // Summary
  log('\n=== Summary ===', 'cyan');
  log(`  Converted: ${converted}`, 'green');
  log(`  Skipped:   ${skipped}`, 'dim');
  if (errors > 0) {
    log(`  Errors:    ${errors}`, 'red');
  }
  log('');
}

main();

/**
 * Build a loose KTX2 sidecar cache from the effective Quake PK3 filesystem.
 *
 * The browser reads public/data/ktx2cache/manifest.json and prefers a listed
 * sidecar before falling back to the original PK3 texture. PK3 archives are
 * indexed in alphabetical order so later packages override earlier packages,
 * matching PK3Loader.
 *
 * Requirements:
 * - Khronos KTX-Software 5.x (`ktx`) or legacy `toktx`
 * - KTX_TOOLS_PATH may point at the executable or its containing directory
 *
 * Usage:
 *   npm run tools:textures
 *   npm run tools:textures:audit
 *   npm run tools:textures:clean
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import JSZip from "jszip";
import { PNG } from "pngjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const SOURCE_DIR = join(REPO_ROOT, "public", "data");
const OUTPUT_DIR = join(SOURCE_DIR, "ktx2cache");
const MANIFEST_PATH = join(OUTPUT_DIR, "manifest.json");
const GENERATOR_VERSION = 2;
const SOURCE_EXTENSIONS = new Set([".tga", ".png", ".jpg", ".jpeg"]);
const EXTENSION_PRIORITY = new Map([
  [".tga", 4],
  [".png", 3],
  [".jpg", 2],
  [".jpeg", 1],
]);
const UASTC_PATTERNS = ["_normal", "_norm", "_n.", "_bump", "_height", "_metallic", "_roughness", "_mr.", "_ao."];
const NORMAL_PATTERNS = ["_normal", "_norm", "_n.", "_bump"];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const shouldClean = args.has("--clean");

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function stripTextureExtension(value) {
  return value.replace(/\.(tga|png|jpe?g)$/i, "");
}

function isTexturePath(value) {
  return SOURCE_EXTENSIONS.has(extname(value).toLowerCase());
}

function isUastc(value) {
  const lower = value.toLowerCase();
  return UASTC_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isNormalMap(value) {
  const lower = value.toLowerCase();
  return NORMAL_PATTERNS.some((pattern) => lower.includes(pattern));
}

function assertSafeOutputDirectory() {
  const expected = "public/data/ktx2cache";
  const actual = normalizePath(relative(REPO_ROOT, OUTPUT_DIR));
  if (actual !== expected || !isAbsolute(OUTPUT_DIR)) {
    throw new Error(`Refusing to clean unexpected output directory: ${OUTPUT_DIR}`);
  }
}

function cleanOutput() {
  assertSafeOutputDirectory();
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
}

function toolCandidates() {
  const configured = process.env.KTX_TOOLS_PATH;
  const executableNames = process.platform === "win32" ? ["ktx.exe", "toktx.exe"] : ["ktx", "toktx"];
  if (!configured) return executableNames;
  if (!existsSync(configured) || !statSync(configured).isDirectory()) {
    return [configured];
  }
  return executableNames.map((name) => join(configured, name));
}

function findKtxTool() {
  for (const command of toolCandidates()) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", shell: false });
    if (!result.error && result.status === 0) {
      return {
        command,
        kind: basename(command).toLowerCase().startsWith("toktx") ? "toktx" : "ktx",
        version: (result.stdout || result.stderr || "unknown").trim(),
      };
    }
  }
  return null;
}

async function indexEffectiveTextures() {
  const packageNames = readdirSync(SOURCE_DIR)
    .filter((name) => name.toLowerCase().endsWith(".pk3"))
    .sort((a, b) => a.localeCompare(b));
  const exactFiles = new Map();

  for (const packageName of packageNames) {
    const packagePath = join(SOURCE_DIR, packageName);
    const zip = await JSZip.loadAsync(readFileSync(packagePath));
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !isTexturePath(entry.name)) continue;
      const path = normalizePath(entry.name);
      exactFiles.set(path, {
        packageName,
        packagePath,
        entryName: entry.name,
        path,
        size: entry._data?.uncompressedSize ?? 0,
        date: entry.date?.toISOString?.() ?? "",
      });
    }
  }

  const selected = new Map();
  for (const source of exactFiles.values()) {
    const canonicalPath = stripTextureExtension(source.path);
    const existing = selected.get(canonicalPath);
    const priority = EXTENSION_PRIORITY.get(extname(source.path)) ?? 0;
    const existingPriority = existing ? EXTENSION_PRIORITY.get(extname(existing.path)) ?? 0 : -1;
    if (!existing || priority > existingPriority) {
      selected.set(canonicalPath, { ...source, canonicalPath });
    }
  }

  return { packageNames, selected };
}

function decodeTga(buffer, sourceName) {
  if (buffer.length < 18) throw new Error(`TGA header is truncated: ${sourceName}`);
  const idLength = buffer[0];
  const colorMapType = buffer[1];
  const imageType = buffer[2];
  const colorMapFirst = buffer.readUInt16LE(3);
  const colorMapLength = buffer.readUInt16LE(5);
  const colorMapDepth = buffer[7];
  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  const bitsPerPixel = buffer[16];
  const descriptor = buffer[17];
  const bytesPerPixel = bitsPerPixel / 8;
  const colorMapped = imageType === 1 || imageType === 9;
  const grayscale = imageType === 3 || imageType === 11;
  const rle = imageType === 9 || imageType === 10 || imageType === 11;

  if (
    ![1, 2, 3, 9, 10, 11].includes(imageType) ||
    (colorMapped ? colorMapType !== 1 : colorMapType !== 0) ||
    width === 0 ||
    height === 0
  ) {
    throw new Error(`Unsupported TGA layout in ${sourceName}`);
  }
  if (
    (colorMapped && (!Number.isInteger(bytesPerPixel) || ![1, 2].includes(bytesPerPixel))) ||
    (grayscale && ![1, 2].includes(bytesPerPixel)) ||
    (!colorMapped && !grayscale && ![3, 4].includes(bytesPerPixel))
  ) {
    throw new Error(`Unsupported TGA pixel depth ${bitsPerPixel} in ${sourceName}`);
  }

  const rgba = Buffer.alloc(width * height * 4);
  let offset = 18 + idLength;
  const palette = [];
  if (colorMapped) {
    if (colorMapLength === 0 || ![15, 16, 24, 32].includes(colorMapDepth)) {
      throw new Error(`Unsupported TGA color map depth ${colorMapDepth} in ${sourceName}`);
    }
    const colorMapBytes = Math.ceil(colorMapDepth / 8);
    for (let i = 0; i < colorMapLength; i++) {
      if (offset + colorMapBytes > buffer.length) throw new Error(`TGA color map is truncated: ${sourceName}`);
      if (colorMapDepth === 15 || colorMapDepth === 16) {
        const packed = buffer.readUInt16LE(offset);
        palette.push([
          Math.round((((packed >> 10) & 0x1f) * 255) / 31),
          Math.round((((packed >> 5) & 0x1f) * 255) / 31),
          Math.round(((packed & 0x1f) * 255) / 31),
          colorMapDepth === 16 ? ((packed & 0x8000) !== 0 ? 255 : 0) : 255,
        ]);
      } else {
        palette.push([
          buffer[offset + 2],
          buffer[offset + 1],
          buffer[offset],
          colorMapDepth === 32 ? buffer[offset + 3] : 255,
        ]);
      }
      offset += colorMapBytes;
    }
  }
  let pixelIndex = 0;
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;

  function readPixel() {
    if (offset + bytesPerPixel > buffer.length) throw new Error(`TGA pixel data is truncated: ${sourceName}`);
    let pixel;
    if (colorMapped) {
      const colorIndex = bytesPerPixel === 1 ? buffer[offset] : buffer.readUInt16LE(offset);
      pixel = palette[colorIndex - colorMapFirst];
      if (!pixel) throw new Error(`TGA color index ${colorIndex} is outside the palette: ${sourceName}`);
    } else if (grayscale) {
      const value = buffer[offset];
      pixel = [value, value, value, bytesPerPixel === 2 ? buffer[offset + 1] : 255];
    } else {
      pixel = [buffer[offset + 2], buffer[offset + 1], buffer[offset], bytesPerPixel === 4 ? buffer[offset + 3] : 255];
    }
    offset += bytesPerPixel;
    return pixel;
  }

  function writePixel(pixel) {
    const sourceY = Math.floor(pixelIndex / width);
    const sourceX = pixelIndex % width;
    const x = rightOrigin ? width - 1 - sourceX : sourceX;
    const y = topOrigin ? sourceY : height - 1 - sourceY;
    const target = (y * width + x) * 4;
    rgba[target] = pixel[0];
    rgba[target + 1] = pixel[1];
    rgba[target + 2] = pixel[2];
    rgba[target + 3] = pixel[3];
    pixelIndex++;
  }

  while (pixelIndex < width * height) {
    if (!rle) {
      writePixel(readPixel());
      continue;
    }
    if (offset >= buffer.length) throw new Error(`TGA RLE stream is truncated: ${sourceName}`);
    const packet = buffer[offset++];
    const count = (packet & 0x7f) + 1;
    if ((packet & 0x80) !== 0) {
      const pixel = readPixel();
      for (let i = 0; i < count && pixelIndex < width * height; i++) writePixel(pixel);
    } else {
      for (let i = 0; i < count && pixelIndex < width * height; i++) writePixel(readPixel());
    }
  }

  return { width, height, data: rgba };
}

function decodeSourceToPng(buffer, sourcePath) {
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  let image;
  if (isPng) {
    image = PNG.sync.read(buffer);
  } else if (isJpeg) {
    image = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
  } else {
    image = decodeTga(buffer, sourcePath);
  }
  return PNG.sync.write({ width: image.width, height: image.height, data: Buffer.from(image.data) });
}

function runEncoder(tool, inputPath, outputPath, sourcePath) {
  const uastc = isUastc(sourcePath);
  const normal = isNormalMap(sourcePath);
  let commandArgs;
  if (tool.kind === "ktx") {
    const majorVersion = Number(/v?(\d+)\./.exec(tool.version)?.[1] ?? 4);
    commandArgs = [
      "create",
      "--format",
      uastc ? "R8G8B8A8_UNORM" : "R8G8B8A8_SRGB",
      "--encode",
      uastc ? (majorVersion >= 5 ? "uastc-ldr-4x4" : "uastc") : "basis-lz",
      ...(uastc ? ["--uastc-quality", "2", "--zstd", "19"] : ["--clevel", "4", "--qlevel", "192"]),
      ...(normal ? ["--normalize"] : []),
      "--generate-mipmap",
      "--mipmap-wrap",
      "wrap",
      inputPath,
      outputPath,
    ];
  } else {
    commandArgs = [
      "--t2",
      "--encode",
      uastc ? "uastc" : "etc1s",
      ...(uastc ? ["--uastc_quality", "2", "--zcmp", "19"] : ["--clevel", "4", "--qlevel", "192"]),
      "--genmipmap",
      outputPath,
      inputPath,
    ];
  }
  execFileSync(tool.command, commandArgs, { stdio: "pipe" });
  return uastc ? "uastc" : "etc1s";
}

function readPreviousManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    return manifest.generatorVersion === GENERATOR_VERSION ? manifest : null;
  } catch {
    return null;
  }
}

async function convertTextures(selected, tool) {
  const previous = readPreviousManifest();
  const textures = {};
  const grouped = new Map();
  for (const source of selected.values()) {
    if (!grouped.has(source.packageName)) grouped.set(source.packageName, []);
    grouped.get(source.packageName).push(source);
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "shag-ktx2-"));
  let converted = 0;
  let skipped = 0;
  let errors = 0;
  let tempIndex = 0;
  const total = selected.size;

  try {
    for (const sources of grouped.values()) {
      const zip = await JSZip.loadAsync(readFileSync(sources[0].packagePath));
      for (const source of sources) {
        const outputFile = `${source.canonicalPath}.ktx2`;
        const outputPath = join(OUTPUT_DIR, ...outputFile.split("/"));
        const sourceSignature = `${source.packageName}:${source.path}:${source.size}:${source.date}`;
        const previousEntry = previous?.textures?.[source.canonicalPath];
        if (previousEntry?.source === sourceSignature && existsSync(outputPath)) {
          textures[source.canonicalPath] = previousEntry;
          skipped++;
          continue;
        }

        try {
          const entry = zip.file(source.entryName);
          if (!entry) throw new Error("PK3 entry disappeared while converting");
          const sourceBuffer = await entry.async("nodebuffer");
          const safeIndex = tempIndex++;
          const pngPath = join(temporaryDirectory, `${safeIndex}.png`);
          const encodedPath = join(temporaryDirectory, `${safeIndex}.ktx2`);
          writeFileSync(pngPath, decodeSourceToPng(sourceBuffer, source.path));
          mkdirSync(dirname(outputPath), { recursive: true });
          const mode = runEncoder(tool, pngPath, encodedPath, source.path);
          copyFileSync(encodedPath, outputPath);
          textures[source.canonicalPath] = {
            file: outputFile,
            source: sourceSignature,
            mode,
          };
          converted++;
        } catch (error) {
          errors++;
          console.error(`[KTX2] Failed ${source.path} from ${source.packageName}: ${error.message}`);
        }

        const processed = converted + skipped + errors;
        if (processed % 50 === 0 || processed === total) {
          console.log(`[KTX2] Progress ${processed}/${total} (converted ${converted}, skipped ${skipped}, errors ${errors})`);
        }
      }
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  return { textures, converted, skipped, errors };
}

async function main() {
  if (!existsSync(SOURCE_DIR)) throw new Error(`PK3 source directory not found: ${SOURCE_DIR}`);
  if (shouldClean) cleanOutput();

  console.log("[KTX2] Indexing effective PK3 texture filesystem...");
  const { packageNames, selected } = await indexEffectiveTextures();
  console.log(`[KTX2] ${packageNames.length} PK3s, ${selected.size} unique source textures`);

  const modeCounts = { etc1s: 0, uastc: 0 };
  for (const path of selected.keys()) modeCounts[isUastc(path) ? "uastc" : "etc1s"]++;
  console.log(`[KTX2] Plan: ${modeCounts.etc1s} ETC1S, ${modeCounts.uastc} UASTC`);
  if (dryRun) return;

  const tool = findKtxTool();
  if (!tool) {
    throw new Error(
      "Khronos KTX tools not found. Install KTX-Software 5.x or set KTX_TOOLS_PATH. Use --dry-run to audit only.",
    );
  }
  console.log(`[KTX2] Encoder: ${tool.kind} (${tool.version})`);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const result = await convertTextures(selected, tool);
  const manifest = {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    encoder: { kind: tool.kind, version: tool.version },
    textures: result.textures,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[KTX2] Converted ${result.converted}, skipped ${result.skipped}, errors ${result.errors}`);
  console.log(`[KTX2] Manifest: ${MANIFEST_PATH}`);
  if (result.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[KTX2] ${error.message}`);
  process.exitCode = 1;
});

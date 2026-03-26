/**
 * KTX1Loader - Parse KTX v1 texture files for WebGL
 *
 * KTX (Khronos Texture) v1 is a container format for GPU-compressed textures.
 * Supports DXT/S3TC, ETC, ASTC formats via WebGL extensions.
 *
 * When GPU compressed texture support is missing, falls back to a software
 * DXT1/DXT3/DXT5 decoder that converts to RGBA on load.
 *
 * @see https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/
 */

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";

// KTX1 file header structure
const KTX_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const KTX_HEADER_SIZE = 64;

// Common OpenGL internal formats
const GL_FORMATS = {
  // DXT/S3TC (most common on desktop)
  COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0,
  COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f1,
  COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f2,
  COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f3,

  // ETC (common on mobile)
  COMPRESSED_RGB8_ETC2: 0x9274,
  COMPRESSED_RGBA8_ETC2_EAC: 0x9278,
  ETC1_RGB8_OES: 0x8d64,

  // ASTC (modern mobile)
  COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93b0,
  COMPRESSED_RGBA_ASTC_8x8_KHR: 0x93b7,

  // Uncompressed
  RGB: 0x1907,
  RGBA: 0x1908,
  LUMINANCE: 0x1909,
  LUMINANCE_ALPHA: 0x190a,
};

export interface KTX1Header {
  glType: number;
  glTypeSize: number;
  glFormat: number;
  glInternalFormat: number;
  glBaseInternalFormat: number;
  pixelWidth: number;
  pixelHeight: number;
  pixelDepth: number;
  numberOfArrayElements: number;
  numberOfFaces: number;
  numberOfMipmapLevels: number;
  bytesOfKeyValueData: number;
}

export interface KTX1MipLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface KTX1ParseResult {
  header: KTX1Header;
  mipLevels: KTX1MipLevel[];
  isCompressed: boolean;
  formatName: string;
}

/**
 * Parse a KTX1 file from ArrayBuffer
 */
export function parseKTX1(data: ArrayBuffer): KTX1ParseResult {
  const view = new DataView(data);
  const uint8 = new Uint8Array(data);

  // Verify identifier
  for (let i = 0; i < 12; i++) {
    if (uint8[i] !== KTX_IDENTIFIER[i]) {
      throw new Error("Invalid KTX1 file: bad identifier");
    }
  }

  // Check endianness (offset 12)
  const endianness = view.getUint32(12, true);
  const littleEndian = endianness === 0x04030201;

  // Parse header
  const header: KTX1Header = {
    glType: view.getUint32(16, littleEndian),
    glTypeSize: view.getUint32(20, littleEndian),
    glFormat: view.getUint32(24, littleEndian),
    glInternalFormat: view.getUint32(28, littleEndian),
    glBaseInternalFormat: view.getUint32(32, littleEndian),
    pixelWidth: view.getUint32(36, littleEndian),
    pixelHeight: view.getUint32(40, littleEndian),
    pixelDepth: view.getUint32(44, littleEndian),
    numberOfArrayElements: view.getUint32(48, littleEndian),
    numberOfFaces: view.getUint32(52, littleEndian),
    numberOfMipmapLevels: view.getUint32(56, littleEndian),
    bytesOfKeyValueData: view.getUint32(60, littleEndian),
  };

  // Determine if compressed
  const isCompressed = header.glType === 0;

  // Get format name
  const formatName = getFormatName(header.glInternalFormat);

  // Parse mip levels
  const mipLevels: KTX1MipLevel[] = [];
  let offset = KTX_HEADER_SIZE + header.bytesOfKeyValueData;

  const numMips = Math.max(1, header.numberOfMipmapLevels);
  let width = header.pixelWidth;
  let height = header.pixelHeight;

  for (let level = 0; level < numMips; level++) {
    if (offset + 4 > data.byteLength) {
      console.warn(`[KTX1Loader] Truncated KTX: no room for mip ${level} size header`);
      break;
    }
    const imageSize = view.getUint32(offset, littleEndian);
    offset += 4;

    // Bounds check: ensure we have enough data for this mip level
    if (offset + imageSize > data.byteLength) {
      console.warn(
        `[KTX1Loader] Truncated KTX: mip ${level} needs ${imageSize} bytes at offset ${offset}, but buffer is only ${data.byteLength} bytes`,
      );
      break;
    }

    const levelData = new Uint8Array(data, offset, imageSize);
    mipLevels.push({
      width,
      height,
      data: levelData,
    });

    // Align to 4 bytes
    offset += imageSize;
    offset = (offset + 3) & ~3;

    // Next mip size
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }

  return {
    header,
    mipLevels,
    isCompressed,
    formatName,
  };
}

/**
 * Get human-readable format name
 */
function getFormatName(glInternalFormat: number): string {
  const names: Record<number, string> = {
    [GL_FORMATS.COMPRESSED_RGB_S3TC_DXT1_EXT]: "DXT1 (RGB)",
    [GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT1_EXT]: "DXT1 (RGBA)",
    [GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT3_EXT]: "DXT3",
    [GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT5_EXT]: "DXT5",
    [GL_FORMATS.COMPRESSED_RGB8_ETC2]: "ETC2 (RGB)",
    [GL_FORMATS.COMPRESSED_RGBA8_ETC2_EAC]: "ETC2 (RGBA)",
    [GL_FORMATS.ETC1_RGB8_OES]: "ETC1",
    [GL_FORMATS.COMPRESSED_RGBA_ASTC_4x4_KHR]: "ASTC 4x4",
    [GL_FORMATS.COMPRESSED_RGBA_ASTC_8x8_KHR]: "ASTC 8x8",
    [GL_FORMATS.RGB]: "RGB (uncompressed)",
    [GL_FORMATS.RGBA]: "RGBA (uncompressed)",
  };
  return names[glInternalFormat] || `Unknown (0x${glInternalFormat.toString(16)})`;
}

/**
 * Check if WebGL supports a given compressed format
 */
export function isFormatSupported(engine: AbstractEngine, glInternalFormat: number): boolean {
  const gl = (engine as any)._gl as WebGL2RenderingContext;
  if (!gl) return false;

  // Check for S3TC (DXT) support
  if (
    glInternalFormat >= GL_FORMATS.COMPRESSED_RGB_S3TC_DXT1_EXT &&
    glInternalFormat <= GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT5_EXT
  ) {
    const ext = gl.getExtension("WEBGL_compressed_texture_s3tc");
    return !!ext;
  }

  // Check for ETC support
  if (glInternalFormat === GL_FORMATS.ETC1_RGB8_OES) {
    const ext = gl.getExtension("WEBGL_compressed_texture_etc1");
    return !!ext;
  }

  if (
    glInternalFormat === GL_FORMATS.COMPRESSED_RGB8_ETC2 ||
    glInternalFormat === GL_FORMATS.COMPRESSED_RGBA8_ETC2_EAC
  ) {
    const ext = gl.getExtension("WEBGL_compressed_texture_etc");
    return !!ext;
  }

  // Check for ASTC support
  if (glInternalFormat >= GL_FORMATS.COMPRESSED_RGBA_ASTC_4x4_KHR && glInternalFormat <= 0x93bd) {
    // ASTC range
    const ext = gl.getExtension("WEBGL_compressed_texture_astc");
    return !!ext;
  }

  return false;
}

// ══════════════════════════════════════════════════════════════════════
//  Software DXT Decompression (on-load fallback for any GPU)
// ══════════════════════════════════════════════════════════════════════

function canSoftwareDecode(format: number): boolean {
  return (
    format === GL_FORMATS.COMPRESSED_RGB_S3TC_DXT1_EXT ||
    format === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT1_EXT ||
    format === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT3_EXT ||
    format === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT5_EXT ||
    format === GL_FORMATS.ETC1_RGB8_OES
  );
}

/**
 * Decompress a DXT1 4×4 block (8 bytes) into RGBA output buffer
 */
function decompressDXT1Block(block: Uint8Array, out: Uint8Array, outOff: number, stride: number): void {
  const c0 = block[0] | (block[1] << 8);
  const c1 = block[2] | (block[3] << 8);

  // Expand RGB565 → 8-bit
  const r0 = (((c0 >> 11) & 0x1f) * 255) / 31;
  const g0 = (((c0 >> 5) & 0x3f) * 255) / 63;
  const b0 = ((c0 & 0x1f) * 255) / 31;
  const r1 = (((c1 >> 11) & 0x1f) * 255) / 31;
  const g1 = (((c1 >> 5) & 0x3f) * 255) / 63;
  const b1 = ((c1 & 0x1f) * 255) / 31;

  // Build 4-color palette
  const pal = new Uint8Array(16);
  pal[0] = r0;
  pal[1] = g0;
  pal[2] = b0;
  pal[3] = 255;
  pal[4] = r1;
  pal[5] = g1;
  pal[6] = b1;
  pal[7] = 255;
  if (c0 > c1) {
    pal[8] = (2 * r0 + r1) / 3;
    pal[9] = (2 * g0 + g1) / 3;
    pal[10] = (2 * b0 + b1) / 3;
    pal[11] = 255;
    pal[12] = (r0 + 2 * r1) / 3;
    pal[13] = (g0 + 2 * g1) / 3;
    pal[14] = (b0 + 2 * b1) / 3;
    pal[15] = 255;
  } else {
    pal[8] = (r0 + r1) / 2;
    pal[9] = (g0 + g1) / 2;
    pal[10] = (b0 + b1) / 2;
    pal[11] = 255;
    pal[12] = 0;
    pal[13] = 0;
    pal[14] = 0;
    pal[15] = 0; // transparent black
  }

  // 32 bits of 2-bit indices
  const lookup = block[4] | (block[5] << 8) | (block[6] << 16) | ((block[7] << 24) >>> 0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const ci = (lookup >> ((row * 4 + col) * 2)) & 3;
      const o = outOff + row * stride + col * 4;
      out[o] = pal[ci * 4];
      out[o + 1] = pal[ci * 4 + 1];
      out[o + 2] = pal[ci * 4 + 2];
      out[o + 3] = pal[ci * 4 + 3];
    }
  }
}

/**
 * ETC1 modifier table (from Khronos spec Table 3.17.2)
 */
const ETC1_MODIFIER_TABLE = [
  [2, 8],
  [5, 17],
  [9, 29],
  [13, 42],
  [18, 60],
  [24, 80],
  [33, 106],
  [47, 183],
];

/**
 * Decompress an ETC1 4×4 block (8 bytes) into RGBA output buffer
 */
function decompressETC1Block(block: Uint8Array, out: Uint8Array, outOff: number, stride: number): void {
  // Big-endian read of the 8 bytes
  const high = (block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3];
  const low = (block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7];

  // ETC1 spec bit numbering: bits 63..32 are in `high` (bit 63 = high bit 31, bit 32 = high bit 0)
  // Diff bit = bit 33 = high bit 1
  // Flip bit = bit 32 = high bit 0
  const diffBit = (high >> 1) & 1;
  const flipBit = high & 1;

  // Table codeword 1 (sub-block 0): bits 39-37 = high bits 7-5
  // Table codeword 2 (sub-block 1): bits 36-34 = high bits 4-2
  const tableIdx0 = (high >> 5) & 7;
  const tableIdx1 = (high >> 2) & 7;

  let r0: number, g0: number, b0: number;
  let r1: number, g1: number, b1: number;

  if (diffBit) {
    // Differential mode: 5-bit base + 3-bit signed delta
    const br = (high >> 27) & 0x1f;
    const bg = (high >> 19) & 0x1f;
    const bb = (high >> 11) & 0x1f;
    const dr = (high >> 24) & 0x07;
    const dg = (high >> 16) & 0x07;
    const db = (high >> 8) & 0x07;
    // Sign-extend 3-bit
    const sdr = dr >= 4 ? dr - 8 : dr;
    const sdg = dg >= 4 ? dg - 8 : dg;
    const sdb = db >= 4 ? db - 8 : db;
    r0 = (br << 3) | (br >> 2);
    g0 = (bg << 3) | (bg >> 2);
    b0 = (bb << 3) | (bb >> 2);
    const r1_5 = br + sdr;
    const g1_5 = bg + sdg;
    const b1_5 = bb + sdb;
    r1 = (r1_5 << 3) | (r1_5 >> 2);
    g1 = (g1_5 << 3) | (g1_5 >> 2);
    b1 = (b1_5 << 3) | (b1_5 >> 2);
  } else {
    // Individual mode: two independent 4-bit colors
    const r0_4 = (high >> 28) & 0xf;
    const g0_4 = (high >> 20) & 0xf;
    const b0_4 = (high >> 12) & 0xf;
    const r1_4 = (high >> 24) & 0xf;
    const g1_4 = (high >> 16) & 0xf;
    const b1_4 = (high >> 8) & 0xf;
    r0 = (r0_4 << 4) | r0_4;
    g0 = (g0_4 << 4) | g0_4;
    b0 = (b0_4 << 4) | b0_4;
    r1 = (r1_4 << 4) | r1_4;
    g1 = (g1_4 << 4) | g1_4;
    b1 = (b1_4 << 4) | b1_4;
  }

  // Decode each pixel
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      // ETC1 spec: pixel indices are stored in column-major order (col*4 + row)
      const pixelIdx = col * 4 + row;
      // MSB in low bits 16..31, LSB in low bits 0..15
      const msb = (low >> (pixelIdx + 16)) & 1;
      const lsb = (low >> pixelIdx) & 1;
      const modIdx = (msb << 1) | lsb;

      // Determine which sub-block this pixel belongs to
      let inSubBlock0: boolean;
      if (flipBit) {
        // Flip: top 2 rows = sub-block 0, bottom 2 = sub-block 1
        inSubBlock0 = row < 2;
      } else {
        // No flip: left 2 cols = sub-block 0, right 2 = sub-block 1
        inSubBlock0 = col < 2;
      }

      const baseR = inSubBlock0 ? r0 : r1;
      const baseG = inSubBlock0 ? g0 : g1;
      const baseB = inSubBlock0 ? b0 : b1;
      const tableEntry = ETC1_MODIFIER_TABLE[inSubBlock0 ? tableIdx0 : tableIdx1];

      // Per ETC1 spec Table 3.17.2:
      // modIdx 0 (msb=0,lsb=0) = +small, 1 (msb=0,lsb=1) = +large,
      // 2 (msb=1,lsb=0) = -small, 3 (msb=1,lsb=1) = -large
      let modifier: number;
      if (modIdx === 0) modifier = tableEntry[0];
      else if (modIdx === 1) modifier = tableEntry[1];
      else if (modIdx === 2) modifier = -tableEntry[0];
      else modifier = -tableEntry[1];

      const o = outOff + row * stride + col * 4;
      out[o] = Math.max(0, Math.min(255, baseR + modifier));
      out[o + 1] = Math.max(0, Math.min(255, baseG + modifier));
      out[o + 2] = Math.max(0, Math.min(255, baseB + modifier));
      out[o + 3] = 255; // ETC1 is opaque
    }
  }
}

/**
 * Decompress a DXT5 4×4 block (16 bytes) into RGBA output buffer.
 * Bytes 0-7: interpolated alpha block. Bytes 8-15: DXT1 color block.
 */
function decompressDXT5Block(block: Uint8Array, out: Uint8Array, outOff: number, stride: number): void {
  const a0 = block[0],
    a1 = block[1];
  const alphas = new Uint8Array(8);
  alphas[0] = a0;
  alphas[1] = a1;
  if (a0 > a1) {
    for (let i = 0; i < 6; i++) alphas[i + 2] = ((6 - i) * a0 + (i + 1) * a1) / 7;
  } else {
    for (let i = 0; i < 4; i++) alphas[i + 2] = ((4 - i) * a0 + (i + 1) * a1) / 5;
    alphas[6] = 0;
    alphas[7] = 255;
  }

  // 48-bit alpha index packed into two 24-bit groups
  const alphaBits = [block[2] | (block[3] << 8) | (block[4] << 16), block[5] | (block[6] << 8) | (block[7] << 16)];

  // Decode color from DXT1 sub-block
  decompressDXT1Block(block.subarray(8, 16), out, outOff, stride);

  // Overwrite alpha channel from interpolated values
  for (let i = 0; i < 16; i++) {
    const row = i >> 2,
      col = i & 3;
    const grp = i < 8 ? 0 : 1;
    const bitIdx = (i < 8 ? i : i - 8) * 3;
    const ai = (alphaBits[grp] >> bitIdx) & 7;
    out[outOff + row * stride + col * 4 + 3] = alphas[ai];
  }
}

/**
 * Software-decode an entire DXT mip level → RGBA Uint8Array
 */
function softwareDecodeMip(data: Uint8Array, width: number, height: number, format: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  const stride = width * 4;
  const isDXT1 =
    format === GL_FORMATS.COMPRESSED_RGB_S3TC_DXT1_EXT || format === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT1_EXT;
  const isDXT5 = format === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT5_EXT;
  const isDXT3 = format === GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT3_EXT;
  const isETC1 = format === GL_FORMATS.ETC1_RGB8_OES;
  const blockSize = isDXT1 || isETC1 ? 8 : 16;

  let srcOff = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const block = data.subarray(srcOff, srcOff + blockSize);
      const outOff = by * 4 * stride + bx * 4 * 4;

      if (isDXT1) {
        decompressDXT1Block(block, rgba, outOff, stride);
      } else if (isDXT5) {
        decompressDXT5Block(block, rgba, outOff, stride);
      } else if (isDXT3) {
        // DXT3: explicit 4-bit alpha + DXT1 color
        decompressDXT1Block(block.subarray(8, 16), rgba, outOff, stride);
        for (let i = 0; i < 16; i++) {
          const row = i >> 2,
            col = i & 3;
          const nibble = i & 1 ? block[i >> 1] >> 4 : block[i >> 1] & 0xf;
          rgba[outOff + row * stride + col * 4 + 3] = nibble * 17;
        }
      } else if (isETC1) {
        decompressETC1Block(block, rgba, outOff, stride);
      }
      srcOff += blockSize;
    }
  }
  return rgba;
}

// ══════════════════════════════════════════════════════════════════════
//  Texture creation
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a BabylonJS texture from KTX1 data.
 *
 * Strategy:
 * 1. If GPU supports the compressed format → upload directly (fastest)
 * 2. If it's DXT but no GPU ext → software-decompress to RGBA on load
 * 3. Uncompressed KTX → upload raw data
 * 4. Unknown compressed → return null
 */
export function createTextureFromKTX1(
  engine: AbstractEngine,
  ktx: KTX1ParseResult,
  name: string,
): InternalTexture | null {
  // ── Uncompressed KTX ───────────────────────────────────────────
  if (!ktx.isCompressed) {
    if (ktx.mipLevels.length > 0) {
      const mip = ktx.mipLevels[0];
      const baseFmt = ktx.header.glBaseInternalFormat;
      const pixelCount = mip.width * mip.height;

      // Always convert to RGBA before upload to avoid WebGL format/alignment issues.
      // Some Babylon.js code paths internally expect RGBA-sized buffers even when
      // TEXTUREFORMAT_RGB is specified, causing "ArrayBufferView not big enough" errors.
      let rgba: Uint8Array;

      if (baseFmt === GL_FORMATS.RGBA && mip.data.length >= pixelCount * 4) {
        // Already RGBA — use directly
        rgba = mip.data;
      } else if (baseFmt === GL_FORMATS.RGB) {
        // RGB (3 bytes/pixel) → RGBA (4 bytes/pixel): add alpha=255
        rgba = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          rgba[i * 4] = mip.data[i * 3];
          rgba[i * 4 + 1] = mip.data[i * 3 + 1];
          rgba[i * 4 + 2] = mip.data[i * 3 + 2];
          rgba[i * 4 + 3] = 255;
        }
        console.log(`[KTX1Loader] Converted RGB→RGBA: ${name} (${mip.width}x${mip.height})`);
      } else if (baseFmt === GL_FORMATS.LUMINANCE) {
        // Luminance (1 byte/pixel) → RGBA
        rgba = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          const v = mip.data[i];
          rgba[i * 4] = v;
          rgba[i * 4 + 1] = v;
          rgba[i * 4 + 2] = v;
          rgba[i * 4 + 3] = 255;
        }
        console.log(`[KTX1Loader] Converted LUMINANCE→RGBA: ${name} (${mip.width}x${mip.height})`);
      } else if (baseFmt === GL_FORMATS.LUMINANCE_ALPHA) {
        // Luminance+Alpha (2 bytes/pixel) → RGBA
        rgba = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          const v = mip.data[i * 2];
          const a = mip.data[i * 2 + 1];
          rgba[i * 4] = v;
          rgba[i * 4 + 1] = v;
          rgba[i * 4 + 2] = v;
          rgba[i * 4 + 3] = a;
        }
        console.log(`[KTX1Loader] Converted LUMINANCE_ALPHA→RGBA: ${name} (${mip.width}x${mip.height})`);
      } else {
        // Unknown format — try as RGBA, may fail but better than crashing silently
        console.warn(
          `[KTX1Loader] Unknown uncompressed format 0x${baseFmt.toString(16)} for ${name}, attempting as RGBA`,
        );
        rgba = mip.data;
      }

      const internalTexture = engine.createRawTexture(
        rgba,
        mip.width,
        mip.height,
        Constants.TEXTUREFORMAT_RGBA,
        false,
        false,
        Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
        null,
        Constants.TEXTURETYPE_UNSIGNED_BYTE,
      );
      internalTexture.isReady = true;
      console.log(`[KTX1Loader] Uncompressed texture: ${name} (${mip.width}x${mip.height})`);
      return internalTexture;
    }
    return null;
  }

  const fmt = ktx.header.glInternalFormat;
  const gl = (engine as any)._gl as WebGL2RenderingContext;

  // ── Path 1: GPU supports compressed format → upload directly ───
  if (gl && isFormatSupported(engine, fmt)) {
    const internalTexture = engine.createRawTexture(
      null,
      ktx.header.pixelWidth,
      ktx.header.pixelHeight,
      Constants.TEXTUREFORMAT_RGBA,
      false,
      false,
      Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
      null,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );

    gl.bindTexture(gl.TEXTURE_2D, (internalTexture as any)._webGLTexture);
    for (let level = 0; level < ktx.mipLevels.length; level++) {
      const mip = ktx.mipLevels[level];
      gl.compressedTexImage2D(gl.TEXTURE_2D, level, fmt, mip.width, mip.height, 0, mip.data);
    }
    if (ktx.mipLevels.length > 1) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);

    internalTexture.isReady = true;
    internalTexture.width = ktx.header.pixelWidth;
    internalTexture.height = ktx.header.pixelHeight;
    console.log(
      `[KTX1Loader] GPU compressed: ${name} (${ktx.formatName}, ${ktx.header.pixelWidth}x${ktx.header.pixelHeight}, ${ktx.mipLevels.length} mips)`,
    );
    return internalTexture;
  }

  // ── Path 2: Software decode DXT → RGBA ─────────────────────────
  if (canSoftwareDecode(fmt)) {
    console.log(`[KTX1Loader] Software decoding ${ktx.formatName} → RGBA: ${name}`);
    const mip = ktx.mipLevels[0];
    const rgba = softwareDecodeMip(mip.data, mip.width, mip.height, fmt);

    // KTX stores pixel data bottom-to-top (OpenGL convention).
    // Babylon.js createRawTexture with invertY=false expects top-to-bottom.
    // Flip rows so texture aligns correctly with model UVs.
    const rowBytes = mip.width * 4;
    const halfH = mip.height >> 1;
    const rowBuf = new Uint8Array(rowBytes);
    for (let y = 0; y < halfH; y++) {
      const topOff = y * rowBytes;
      const botOff = (mip.height - 1 - y) * rowBytes;
      rowBuf.set(rgba.subarray(topOff, topOff + rowBytes));
      rgba.set(rgba.subarray(botOff, botOff + rowBytes), topOff);
      rgba.set(rowBuf, botOff);
    }

    const internalTexture = engine.createRawTexture(
      rgba,
      mip.width,
      mip.height,
      Constants.TEXTUREFORMAT_RGBA,
      true,
      false, // generateMipMaps=true since we only upload mip 0
      Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
      null,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    internalTexture.isReady = true;
    console.log(`[KTX1Loader] Software decoded: ${name} (${ktx.formatName} → RGBA, ${mip.width}x${mip.height})`);
    return internalTexture;
  }

  // ── Path 3: Unsupported ────────────────────────────────────────
  console.warn(`[KTX1Loader] Cannot decode: ${ktx.formatName} for ${name}`);
  return null;
}

export { GL_FORMATS };

/**
 * KTX1Loader - Parse KTX v1 textures for Babylon's rendering backends
 *
 * KTX (Khronos Texture) v1 is a container format for GPU-compressed textures.
 * Uses negotiated Babylon capabilities for DXT/S3TC, ETC and ASTC formats.
 *
 * When GPU compressed texture support is missing, falls back to a software
 * DXT1/DXT3/DXT5 decoder that converts to RGBA on load.
 *
 * @see https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/
 */

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";
import { reduceTexturePixels } from "./TextureReduction";

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
  ALPHA: 0x1906,
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
  /** Original container retained by Babylon for upload and context recovery. */
  source: ArrayBuffer;
  littleEndian: boolean;
  header: KTX1Header;
  mipLevels: KTX1MipLevel[];
  isCompressed: boolean;
  formatName: string;
}

/** Repack the retained chain so native upload/context recovery cannot restore discarded mips. */
export function reduceKTX1MipChain(data: ArrayBuffer, level: number): ArrayBuffer {
  if (level <= 0) return data;
  const parsed = parseKTX1(data);
  const wanted = level >= 8 ? parsed.mipLevels.length - 1 : Math.round(level);
  const first = Math.min(wanted, parsed.mipLevels.length - 1);
  const levels = parsed.mipLevels.slice(first);
  const prefix = KTX_HEADER_SIZE + parsed.header.bytesOfKeyValueData;
  const result = new Uint8Array(prefix + levels.reduce((sum, mip) => sum + 4 + Math.ceil(mip.data.length / 4) * 4, 0));
  result.set(new Uint8Array(data, 0, prefix));
  const view = new DataView(result.buffer);
  view.setUint32(36, levels[0].width, parsed.littleEndian);
  view.setUint32(40, levels[0].height, parsed.littleEndian);
  view.setUint32(56, levels.length, parsed.littleEndian);
  let offset = prefix;
  for (const mip of levels) {
    view.setUint32(offset, mip.data.length, parsed.littleEndian);
    result.set(mip.data, offset + 4);
    offset += 4 + Math.ceil(mip.data.length / 4) * 4;
  }
  return result.buffer;
}

/** Split a six-face KTX1 into validated 2D faces, retaining each authored mip chain. */
export function parseKTX1CubeFaces(data: ArrayBuffer): KTX1ParseResult[] {
  if (data.byteLength < 64) throw new Error("Truncated KTX1 cube header");
  const source = new DataView(data);
  const endian = source.getUint32(12, true);
  if (endian !== 0x04030201 && endian !== 0x01020304) throw new Error("Invalid KTX1 cube byte order");
  const little = endian === 0x04030201;
  if (source.getUint32(52, little) !== 6 || source.getUint32(36, little) !== source.getUint32(40, little))
    throw new Error("KTX1 cube requires six square faces");
  const levels = Math.max(1, source.getUint32(56, little));
  if (levels > 32) throw new Error("Invalid KTX1 cube mip count");
  const headerSize = 64 + source.getUint32(60, little);
  if (headerSize > data.byteLength) throw new Error("Truncated KTX1 cube metadata");
  const chunks: Uint8Array[][] = Array.from({ length: 6 }, () => []);
  let offset = headerSize;
  for (let level = 0; level < levels; level++) {
    if (offset + 4 > data.byteLength) throw new Error("Truncated KTX1 cube mip size");
    const size = source.getUint32(offset, little);
    const sizeBytes = new Uint8Array(data, offset, 4);
    offset += 4;
    for (const face of chunks) {
      if (offset + size > data.byteLength) throw new Error("Truncated KTX1 cube face");
      const padded = Math.ceil(size / 4) * 4;
      if (offset + padded > data.byteLength) throw new Error("Truncated KTX1 cube padding");
      face.push(sizeBytes, new Uint8Array(data, offset, padded));
      offset += padded;
    }
  }
  return chunks.map((face) => {
    const buffer = new Uint8Array(headerSize + face.reduce((sum, chunk) => sum + chunk.length, 0));
    buffer.set(new Uint8Array(data, 0, headerSize));
    new DataView(buffer.buffer).setUint32(52, 1, little);
    let cursor = headerSize;
    for (const chunk of face) {
      buffer.set(chunk, cursor);
      cursor += chunk.length;
    }
    return parseKTX1(buffer.buffer);
  });
}

/**
 * Parse a KTX1 file from ArrayBuffer
 */
export function parseKTX1(data: ArrayBuffer): KTX1ParseResult {
  if (data.byteLength < KTX_HEADER_SIZE) throw new Error("Invalid KTX1 file: truncated header");
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
  if (endianness !== 0x04030201 && endianness !== 0x01020304) throw new Error("Invalid KTX1 byte order");
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
  if (
    !header.pixelWidth ||
    !header.pixelHeight ||
    header.pixelDepth ||
    header.numberOfArrayElements ||
    header.numberOfFaces !== 1
  ) {
    throw new Error("KTX1 loader requires a non-array 2D texture with one face");
  }
  if (isCompressed && (header.glFormat !== 0 || header.glTypeSize !== 1)) {
    throw new Error("Invalid compressed KTX1 type/format");
  }
  const fullMipCount = Math.floor(Math.log2(Math.max(header.pixelWidth, header.pixelHeight))) + 1;
  if (header.numberOfMipmapLevels > fullMipCount) throw new Error("Invalid KTX1 mip count");

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
      if (!isCompressed && mipLevels.length) break; // Legacy raw files may omit trailing mips; only mip 0 is uploaded.
      throw new Error(`Truncated KTX1: missing mip ${level} size`);
    }
    const imageSize = view.getUint32(offset, littleEndian);
    offset += 4;

    // Bounds check: ensure we have enough data for this mip level
    if (offset + imageSize > data.byteLength) {
      if (!isCompressed && mipLevels.length) break;
      throw new Error(`Truncated KTX1: incomplete mip ${level}`);
    }
    const block = isCompressed ? compressedBlock(header.glInternalFormat) : null;
    if (block && imageSize !== Math.ceil(width / block.width) * Math.ceil(height / block.height) * block.bytes) {
      throw new Error(`Invalid KTX1 compressed payload size at mip ${level}`);
    }

    const levelData = new Uint8Array(data, offset, imageSize);
    mipLevels.push({
      width,
      height,
      data: levelData,
    });

    // Align to 4 bytes
    offset += imageSize;
    offset = Math.ceil(offset / 4) * 4;

    // Next mip size
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }

  return {
    source: data,
    littleEndian,
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
    [GL_FORMATS.ALPHA]: "Alpha (uncompressed)",
    [GL_FORMATS.RGB]: "RGB (uncompressed)",
    [GL_FORMATS.RGBA]: "RGBA (uncompressed)",
  };
  return names[glInternalFormat] || `Unknown (0x${glInternalFormat.toString(16)})`;
}

/**
 * Check negotiated format support without reaching into a WebGL context.
 */
export function isFormatSupported(engine: AbstractEngine, glInternalFormat: number): boolean {
  const caps = engine.getCaps();

  // Check for S3TC (DXT) support
  if (
    glInternalFormat >= GL_FORMATS.COMPRESSED_RGB_S3TC_DXT1_EXT &&
    glInternalFormat <= GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT5_EXT
  ) {
    return !!caps.s3tc;
  }

  // Check for ETC support
  if (glInternalFormat === GL_FORMATS.ETC1_RGB8_OES) {
    // Babylon's WebGPU uploader maps ETC1 blocks to its ETC2 RGB format.
    return !!caps.etc1 || (engine.isWebGPU && !!caps.etc2);
  }

  if (
    glInternalFormat === GL_FORMATS.COMPRESSED_RGB8_ETC2 ||
    glInternalFormat === GL_FORMATS.COMPRESSED_RGBA8_ETC2_EAC
  ) {
    return !!caps.etc2;
  }

  // Check for ASTC support
  if (glInternalFormat >= GL_FORMATS.COMPRESSED_RGBA_ASTC_4x4_KHR && glInternalFormat <= 0x93bd) {
    // ASTC range
    return !!caps.astc;
  }

  return false;
}

function compressedBlock(format: number): { width: number; height: number; bytes: number } | null {
  if (format >= 0x83f0 && format <= 0x83f3) return { width: 4, height: 4, bytes: format <= 0x83f1 ? 8 : 16 };
  if (format === 0x8d64 || format === 0x9274) return { width: 4, height: 4, bytes: 8 };
  if (format === 0x9278) return { width: 4, height: 4, bytes: 16 };
  const astc = [
    [4, 4],
    [5, 4],
    [5, 5],
    [6, 5],
    [6, 6],
    [8, 5],
    [8, 6],
    [8, 8],
    [10, 5],
    [10, 6],
    [10, 8],
    [10, 10],
    [12, 10],
    [12, 12],
  ][format - 0x93b0];
  return astc ? { width: astc[0], height: astc[1], bytes: 16 } : null;
}

function canUploadCompressed(engine: AbstractEngine, ktx: KTX1ParseResult): boolean {
  if (!ktx.littleEndian || !isFormatSupported(engine, ktx.header.glInternalFormat)) return false;
  const { pixelWidth: width, pixelHeight: height } = ktx.header;
  // WebGL2 mip chains use texStorage2D + compressedTexSubImage2D, which ETC1
  // does not support. Without ETC2 to stand in, decode ETC1 chains in software.
  if (ktx.header.glInternalFormat === GL_FORMATS.ETC1_RGB8_OES && ktx.mipLevels.length > 1 && !engine.getCaps().etc2)
    return false;
  // Babylon 9's native KTX1 uploader halves mip dimensions without flooring.
  // Keep NPOT mip chains on the software/fallback path.
  if (ktx.mipLevels.length > 1 && (!Number.isInteger(Math.log2(width)) || !Number.isInteger(Math.log2(height))))
    return false;
  const block = compressedBlock(ktx.header.glInternalFormat);
  // WebGPU compressed base extents must be block-aligned.
  return !engine.isWebGPU || (!!block && width % block.width === 0 && height % block.height === 0);
}

/**
 * ETC2 RGB8 decodes ETC1 blocks unchanged. Babylon's WebGL2 uploader allocates
 * mip chains with texStorage2D and fills them with compressedTexSubImage2D;
 * ETC1 supports neither, so the upload fails and the texture samples black
 * (seen on Apple GPUs, the desktop devices that expose ETC). Relabel the
 * container as ETC2 so both backends take the same supported path.
 */
function asETC2Source(engine: AbstractEngine, ktx: KTX1ParseResult): ArrayBuffer {
  if (ktx.header.glInternalFormat !== GL_FORMATS.ETC1_RGB8_OES || !engine.getCaps().etc2) return ktx.source;
  const source = ktx.source.slice(0);
  new DataView(source).setUint32(28, GL_FORMATS.COMPRESSED_RGB8_ETC2, ktx.littleEndian);
  return source;
}

async function uploadCompressed(engine: AbstractEngine, ktx: KTX1ParseResult, name: string): Promise<InternalTexture> {
  const fullMipCount = Math.floor(Math.log2(Math.max(ktx.header.pixelWidth, ktx.header.pixelHeight))) + 1;
  // Partial chains cannot be safely sampled with a mip filter on all backends.
  const noMipmap = ktx.mipLevels.length !== fullMipCount || fullMipCount === 1;
  let texture: InternalTexture | undefined;
  try {
    return await new Promise<InternalTexture>((resolve, reject) => {
      texture = engine.createTexture(
        `data:${name}`,
        noMipmap,
        false,
        null,
        noMipmap ? Constants.TEXTURE_BILINEAR_SAMPLINGMODE : Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
        resolve,
        (message, error) => reject(error ?? new Error(message ?? `KTX1 upload failed: ${name}`)),
        asETC2Source(engine, ktx),
        undefined,
        undefined,
        ".ktx",
      );
    });
  } catch (error) {
    texture?.dispose();
    throw error;
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Software DXT Decompression (on-load fallback for any GPU)
// ══════════════════════════════════════════════════════════════════════

export function canSoftwareDecode(format: number): boolean {
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
 * Software-decode an entire compressed mip level → RGBA Uint8Array.
 *
 * Exported because callers that need pixels rather than a GPU texture — the
 * skybox assembles six faces into one cube itself — would otherwise have to
 * reimplement this, and a second ETC1 decoder is a second chance to get the
 * bit layout wrong.
 */
export function softwareDecodeMip(data: Uint8Array, width: number, height: number, format: number): Uint8Array {
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
export async function createTextureFromKTX1(
  engine: AbstractEngine,
  ktx: KTX1ParseResult,
  name: string,
  reduction = 0,
): Promise<InternalTexture | null> {
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
      } else if (baseFmt === GL_FORMATS.ALPHA) {
        // Legacy GL_ALPHA samples as white with the stored alpha value.
        // Expanding explicitly also works on WebGPU, which has no GL_ALPHA
        // upload format and otherwise receives an undersized RGBA buffer.
        rgba = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          rgba[i * 4] = 255;
          rgba[i * 4 + 1] = 255;
          rgba[i * 4 + 2] = 255;
          rgba[i * 4 + 3] = mip.data[i];
        }
        console.log(`[KTX1Loader] Converted ALPHA→RGBA: ${name} (${mip.width}x${mip.height})`);
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

      const reduced = reduceTexturePixels(rgba, mip.width, mip.height, reduction);
      const internalTexture = engine.createRawTexture(
        reduced.pixels,
        reduced.width,
        reduced.height,
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
  if (reduction === 0 && canUploadCompressed(engine, ktx)) {
    try {
      return await uploadCompressed(engine, ktx, name);
    } catch (error) {
      console.warn(`[KTX1Loader] Compressed upload failed for ${name}; trying software decode`, error);
    }
  }

  // Software decode remains available when the device or native uploader
  // cannot use this container. Unsupported formats return null for PK3 fallback.
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

    const reduced = reduceTexturePixels(rgba, mip.width, mip.height, reduction);
    const internalTexture = engine.createRawTexture(
      reduced.pixels,
      reduced.width,
      reduced.height,
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

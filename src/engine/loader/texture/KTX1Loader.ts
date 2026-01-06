/**
 * KTX1Loader - Parse KTX v1 texture files for WebGL
 * 
 * KTX (Khronos Texture) v1 is a container format for GPU-compressed textures.
 * Supports DXT/S3TC, ETC, ASTC formats via WebGL extensions.
 * 
 * @see https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/
 */

import { Engine } from "@babylonjs/core/Engines/engine";
import { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";
import { Constants } from "@babylonjs/core/Engines/constants";

// KTX1 file header structure
const KTX_IDENTIFIER = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x31, 0x31, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
const KTX_HEADER_SIZE = 64;

// Common OpenGL internal formats
const GL_FORMATS = {
  // DXT/S3TC (most common on desktop)
  COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83F0,
  COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83F1,
  COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83F2,
  COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83F3,
  
  // ETC (common on mobile)
  COMPRESSED_RGB8_ETC2: 0x9274,
  COMPRESSED_RGBA8_ETC2_EAC: 0x9278,
  ETC1_RGB8_OES: 0x8D64,
  
  // ASTC (modern mobile)
  COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93B0,
  COMPRESSED_RGBA_ASTC_8x8_KHR: 0x93B7,
  
  // Uncompressed
  RGB: 0x1907,
  RGBA: 0x1908,
  LUMINANCE: 0x1909,
  LUMINANCE_ALPHA: 0x190A,
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
    const imageSize = view.getUint32(offset, littleEndian);
    offset += 4;
    
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
export function isFormatSupported(engine: Engine, glInternalFormat: number): boolean {
  const gl = engine.getRenderingCanvas()?.getContext("webgl2") || 
             engine.getRenderingCanvas()?.getContext("webgl");
  if (!gl) return false;
  
  // Check for S3TC (DXT) support
  if (glInternalFormat >= GL_FORMATS.COMPRESSED_RGB_S3TC_DXT1_EXT &&
      glInternalFormat <= GL_FORMATS.COMPRESSED_RGBA_S3TC_DXT5_EXT) {
    const ext = gl.getExtension("WEBGL_compressed_texture_s3tc");
    return !!ext;
  }
  
  // Check for ETC support
  if (glInternalFormat === GL_FORMATS.ETC1_RGB8_OES) {
    const ext = gl.getExtension("WEBGL_compressed_texture_etc1");
    return !!ext;
  }
  
  if (glInternalFormat === GL_FORMATS.COMPRESSED_RGB8_ETC2 ||
      glInternalFormat === GL_FORMATS.COMPRESSED_RGBA8_ETC2_EAC) {
    const ext = gl.getExtension("WEBGL_compressed_texture_etc");
    return !!ext;
  }
  
  // Check for ASTC support
  if (glInternalFormat >= GL_FORMATS.COMPRESSED_RGBA_ASTC_4x4_KHR &&
      glInternalFormat <= 0x93BD) { // ASTC range
    const ext = gl.getExtension("WEBGL_compressed_texture_astc");
    return !!ext;
  }
  
  return false;
}

/**
 * Create a BabylonJS texture from KTX1 data
 */
export function createTextureFromKTX1(
  engine: Engine,
  ktx: KTX1ParseResult,
  name: string
): InternalTexture | null {
  if (!ktx.isCompressed) {
    console.warn(`[KTX1Loader] Uncompressed KTX not yet supported: ${name}`);
    return null;
  }
  
  if (!isFormatSupported(engine, ktx.header.glInternalFormat)) {
    console.warn(`[KTX1Loader] Format not supported: ${ktx.formatName} for ${name}`);
    return null;
  }
  
  // Create internal texture
  const internalTexture = engine.createRawTexture(
    null,
    ktx.header.pixelWidth,
    ktx.header.pixelHeight,
    Constants.TEXTUREFORMAT_RGBA,
    false, // generateMipMaps
    false, // invertY
    Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
    null,  // compression
    Constants.TEXTURETYPE_UNSIGNED_BYTE
  );
  
  // Upload compressed data
  const gl = (engine as any)._gl as WebGL2RenderingContext;
  
  gl.bindTexture(gl.TEXTURE_2D, (internalTexture as any)._webGLTexture);
  
  for (let level = 0; level < ktx.mipLevels.length; level++) {
    const mip = ktx.mipLevels[level];
    gl.compressedTexImage2D(
      gl.TEXTURE_2D,
      level,
      ktx.header.glInternalFormat,
      mip.width,
      mip.height,
      0,
      mip.data
    );
  }
  
  // Set texture parameters
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
  
  console.log(`[KTX1Loader] Created texture: ${name} (${ktx.formatName}, ${ktx.header.pixelWidth}x${ktx.header.pixelHeight}, ${ktx.mipLevels.length} mips)`);
  
  return internalTexture;
}

export { GL_FORMATS };

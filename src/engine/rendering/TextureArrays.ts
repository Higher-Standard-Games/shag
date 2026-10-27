import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Copies same-shaped 2D textures into one 2D texture array, on the GPU where
 * the backend allows it.
 *
 * WebGPU copies every mip of every texture, compressed or not. WebGL2 copies
 * an uncompressed texture's top level through a framebuffer and builds the
 * array's mips; it cannot read a compressed texture back, so a compressed
 * layer comes from the mip data captured while the texture was uploaded
 * ({@link captureCompressedUploads}). A texture the backend cannot copy has
 * no shape, and stays a texture of its own.
 */
interface CapturedLevel {
  width: number;
  height: number;
  data: ArrayBufferView;
}

/** BC7 (BPTC) and the other formats whose data WebGL2 can only take as uploaded */
const COMPRESSED_FORMATS = new Set([
  0x8e8c, // COMPRESSED_RGBA_BPTC_UNORM (BC7)
  0x8e8d, // COMPRESSED_SRGB_ALPHA_BPTC_UNORM
  0x83f0, // COMPRESSED_RGB_S3TC_DXT1
  0x83f1, // COMPRESSED_RGBA_S3TC_DXT1
  0x83f2, // COMPRESSED_RGBA_S3TC_DXT3
  0x83f3, // COMPRESSED_RGBA_S3TC_DXT5
  0x93b0, // COMPRESSED_RGBA_ASTC_4x4
  0x9274, // COMPRESSED_RGB8_ETC2
  0x9278, // COMPRESSED_RGBA8_ETC2_EAC
]);

const captured = new Map<InternalTexture, CapturedLevel[]>();

type UploadCompressed = (
  texture: InternalTexture,
  internalFormat: number,
  width: number,
  height: number,
  data: ArrayBufferView,
  faceIndex?: number,
  lod?: number,
) => void;

/**
 * Keep the mip data of compressed textures uploaded until `stop()`, so WebGL2
 * can put them in arrays; `stop()` lets all of it go. WebGPU copies on the GPU
 * and needs none.
 */
export function captureCompressedUploads(engine: AbstractEngine): { stop: () => void } {
  if (engine.isWebGPU) return { stop: () => {} };
  const target = engine as unknown as { _uploadCompressedDataToTextureDirectly?: UploadCompressed };
  const upload = target._uploadCompressedDataToTextureDirectly;
  if (typeof upload !== "function") return { stop: () => {} };
  const own = Object.getOwnPropertyDescriptor(target, "_uploadCompressedDataToTextureDirectly");
  target._uploadCompressedDataToTextureDirectly = function (
    this: unknown,
    texture,
    internalFormat,
    width,
    height,
    data,
    faceIndex = 0,
    lod = 0,
  ) {
    if (faceIndex === 0) {
      const levels = captured.get(texture) ?? [];
      levels[lod] = { width, height, data };
      captured.set(texture, levels);
    }
    return upload.call(this, texture, internalFormat, width, height, data, faceIndex, lod);
  };
  return {
    stop: () => {
      captured.clear();
      if (own) Object.defineProperty(target, "_uploadCompressedDataToTextureDirectly", own);
      else delete target._uploadCompressedDataToTextureDirectly;
    },
  };
}

function fullMipCount(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/** Levels a WebGL2 array would hold for this texture, or 0 when it cannot be copied. */
function webglLevels(internal: InternalTexture): number {
  if (!COMPRESSED_FORMATS.has(internal.format))
    return internal.generateMipMaps ? fullMipCount(internal.width, internal.height) : 1;
  const levels = captured.get(internal);
  if (!levels?.length) return 0;
  for (let level = 0; level < levels.length; level++) {
    const data = levels[level];
    if (
      !data ||
      data.width !== Math.max(1, internal.width >> level) ||
      data.height !== Math.max(1, internal.height >> level)
    )
      return 0;
  }
  return levels.length;
}

/**
 * What a texture must share with the others in its array, or null when it
 * cannot join one: size, format, type, mips and colour space.
 */
export function textureArrayShape(texture: BaseTexture, engine: AbstractEngine): string | null {
  // A headless engine has no device to copy with
  if (!engine.isWebGPU && !(engine as unknown as Partial<WebGLCopyEngine>)._gl) return null;
  const internal = texture.getInternalTexture();
  if (!internal?.isReady || internal.isCube || internal.is3D || internal.is2DArray || internal.depth > 1) return null;
  if (internal._useSRGBBuffer) return null;
  const levels = engine.isWebGPU ? webgpuLevels(internal) : webglLevels(internal);
  if (!levels) return null;
  return [internal.width, internal.height, internal.format, internal.type, levels, internal.invertY].join("x");
}

/**
 * One array holding `textures` as layers, in order, sampled as the first one
 * is. All must share a {@link textureArrayShape}. Null when the copy fails.
 */
export function createTextureArray(textures: BaseTexture[], scene: Scene, name: string): BaseTexture | null {
  const engine = scene.getEngine();
  const first = textures[0]?.getInternalTexture();
  if (!first || textures.length === 0) return null;
  const sources = textures.map((texture) => texture.getInternalTexture()!);
  const internal = engine.isWebGPU ? copyWebGPU(engine, sources) : copyWebGL(engine, sources);
  if (!internal) return null;
  const array = new BaseTexture(scene, internal);
  const sample = textures[0];
  array.name = name;
  array.wrapU = sample.wrapU;
  array.wrapV = sample.wrapV;
  array.anisotropicFilteringLevel = sample.anisotropicFilteringLevel;
  array.gammaSpace = sample.gammaSpace;
  array.hasAlpha = sample.hasAlpha;
  return array;
}

interface WebGPUCopyEngine {
  _device: {
    createCommandEncoder(): {
      copyTextureToTexture(source: object, destination: object, size: object): void;
      finish(): unknown;
    };
    queue: { submit(buffers: unknown[]): void };
  };
  flushFramebuffer?: () => void;
}

const underlying = (texture: InternalTexture) =>
  (texture as unknown as { _hardwareTexture?: { underlyingResource?: unknown } })._hardwareTexture?.underlyingResource;

/**
 * Levels of a WebGPU texture, from the GPU texture itself: Babylon's own count
 * reads 1 for a texture whose mips it generated after creation.
 */
function webgpuLevels(internal: InternalTexture): number {
  return (underlying(internal) as { mipLevelCount?: number } | undefined)?.mipLevelCount ?? 1;
}

function copyWebGPU(engine: AbstractEngine, sources: InternalTexture[]): InternalTexture | null {
  const first = sources[0];
  const levels = webgpuLevels(first);
  const compressed = COMPRESSED_FORMATS.has(first.format);
  const internal = engine.createRawTexture2DArray(
    null,
    first.width,
    first.height,
    sources.length,
    first.format,
    // Babylon allocates the mip levels only for a texture that has mips
    levels > 1,
    first.invertY,
    first.samplingMode,
    null,
    first.type,
    0,
    levels,
  );
  internal.generateMipMaps = levels > 1;
  const destination = underlying(internal);
  const gpu = engine as unknown as WebGPUCopyEngine;
  if (!destination || sources.some((source) => !underlying(source))) {
    internal.dispose();
    return null;
  }
  // Uploads still queued for the sources go first
  gpu.flushFramebuffer?.();
  const encoder = gpu._device.createCommandEncoder();
  sources.forEach((source, layer) => {
    for (let level = 0; level < levels; level++) {
      let width = Math.max(1, first.width >> level);
      let height = Math.max(1, first.height >> level);
      // Compressed copies cover whole 4x4 blocks
      if (compressed) {
        width = Math.ceil(width / 4) * 4;
        height = Math.ceil(height / 4) * 4;
      }
      encoder.copyTextureToTexture(
        { texture: underlying(source), mipLevel: level },
        { texture: destination, mipLevel: level, origin: { x: 0, y: 0, z: layer } },
        { width, height, depthOrArrayLayers: 1 },
      );
    }
  });
  gpu._device.queue.submit([encoder.finish()]);
  return internal;
}

interface WebGLCopyEngine {
  _gl: WebGL2RenderingContext;
  _currentFramebuffer: WebGLFramebuffer | null;
  _bindTextureDirectly(target: number, texture: InternalTexture | null, forTextureDataUpdate?: boolean): boolean;
  _getSamplingParameters(samplingMode: number, generateMipMaps: boolean): { min: number; mag: number };
}

function copyWebGL(engine: AbstractEngine, sources: InternalTexture[]): InternalTexture | null {
  const first = sources[0];
  const webgl = engine as unknown as WebGLCopyEngine;
  const gl = webgl._gl;
  const compressed = COMPRESSED_FORMATS.has(first.format);
  const levels = webglLevels(first);
  const internal = engine.createRawTexture2DArray(
    null,
    first.width,
    first.height,
    sources.length,
    compressed ? 5 : first.format,
    false,
    false,
    first.samplingMode,
    null,
    first.type,
  );
  const target = gl.TEXTURE_2D_ARRAY;
  webgl._bindTextureDirectly(target, internal, true);
  if (compressed) {
    // Every level from the captured uploads, all layers at once
    for (let level = 0; level < levels; level++) {
      const parts = sources.map((source) => captured.get(source)![level].data);
      const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
      const data = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        data.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), offset);
        offset += part.byteLength;
      }
      const { width, height } = captured.get(first)![level];
      gl.compressedTexImage3D(target, level, first.format, width, height, sources.length, 0, data);
    }
    gl.texParameteri(target, gl.TEXTURE_MAX_LEVEL, levels - 1);
  } else {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    sources.forEach((source, layer) => {
      gl.framebufferTexture2D(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        underlying(source) as WebGLTexture,
        0,
      );
      gl.copyTexSubImage3D(target, 0, 0, 0, layer, 0, 0, first.width, first.height);
    });
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, webgl._currentFramebuffer);
    gl.deleteFramebuffer(framebuffer);
    if (levels > 1) gl.generateMipmap(target);
  }
  internal.generateMipMaps = levels > 1;
  // The source's filtering over the mips already there: Babylon's sampling update would generate them
  const filters = webgl._getSamplingParameters(first.samplingMode, levels > 1);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filters.mag);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filters.min);
  internal.samplingMode = first.samplingMode;
  webgl._bindTextureDirectly(target, null);
  internal.isReady = true;
  return internal;
}

/**
 * Package images to pixels in the browser, for thumbnails and the textured
 * preview: TGA through the engine's pixel decoder, GPU-compressed KTX1
 * through its software decoder, uncompressed 8-bit KTX expanded directly,
 * and everything else through createImageBitmap. Pixels are RGBA, top row
 * first.
 */

import { canSoftwareDecode, parseKTX1, softwareDecodeMip } from "../loader/texture/KTX1Loader";
import { decodeTGAPixels } from "../loader/texture/TgaDecoder";

const GL_UNSIGNED_BYTE = 0x1401;
const GL_ALPHA = 0x1906;
const GL_RGB = 0x1907;
const GL_RGBA = 0x1908;
const GL_LUMINANCE = 0x1909;
const GL_LUMINANCE_ALPHA = 0x190a;
const CHANNELS: Record<number, number> = {
  [GL_ALPHA]: 1,
  [GL_LUMINANCE]: 1,
  [GL_LUMINANCE_ALPHA]: 2,
  [GL_RGB]: 3,
  [GL_RGBA]: 4,
};

/**
 * RGBA for an uncompressed 8-bit KTX mip (alpha masks, luminance-alpha grates
 * and wires, plain RGB/RGBA); null for any other layout.
 */
export function expandUncompressed(
  data: Uint8Array,
  pixels: number,
  glType: number,
  glFormat: number,
): Uint8Array | null {
  const channels = CHANNELS[glFormat];
  if (glType !== GL_UNSIGNED_BYTE || !channels || data.length < pixels * channels) return null;
  const rgba = new Uint8Array(pixels * 4);
  for (let pixel = 0, src = 0, dst = 0; pixel < pixels; pixel++, src += channels, dst += 4) {
    if (glFormat === GL_ALPHA) {
      rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = 255;
      rgba[dst + 3] = data[src];
    } else if (channels <= 2) {
      rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = data[src];
      rgba[dst + 3] = channels === 2 ? data[src + 1] : 255;
    } else {
      rgba[dst] = data[src];
      rgba[dst + 1] = data[src + 1];
      rgba[dst + 2] = data[src + 2];
      rgba[dst + 3] = channels === 4 ? data[src + 3] : 255;
    }
  }
  return rgba;
}

/**
 * A single-face KTX1 as an ImageData from the smallest mip that still has
 * `minSize` pixels on its longer side (much cheaper than level 0), with level
 * 0's size, which is what alignment needs. Null for cubemaps and layouts the
 * software decoder can't read.
 */
export function ktxImage(
  bytes: ArrayBuffer,
  minSize = Number.POSITIVE_INFINITY,
): {
  image: ImageData;
  width: number;
  height: number;
} | null {
  const ktx = parseKTX1(bytes);
  const format = ktx.header.glInternalFormat;
  if (!ktx.mipLevels.length || ktx.header.numberOfFaces !== 1) return null;
  const mip =
    [...ktx.mipLevels].reverse().find((level) => Math.max(level.width, level.height) >= minSize) ?? ktx.mipLevels[0];
  const rgba = canSoftwareDecode(format)
    ? softwareDecodeMip(mip.data, mip.width, mip.height, format)
    : expandUncompressed(mip.data, mip.width * mip.height, ktx.header.glType, ktx.header.glFormat);
  if (!rgba) return null;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(rgba.byteLength));
  pixels.set(rgba);
  return {
    image: new ImageData(pixels, mip.width, mip.height),
    width: ktx.header.pixelWidth,
    height: ktx.header.pixelHeight,
  };
}

/** Any package image as a bitmap, with level 0's size (a KTX may decode from a smaller mip). */
export async function imageBitmap(
  path: string,
  bytes: ArrayBuffer,
  minSize?: number,
): Promise<{ bitmap: ImageBitmap; width: number; height: number } | null> {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "ktx") {
    const ktx = ktxImage(bytes, minSize);
    if (!ktx) return null;
    return { bitmap: await createImageBitmap(ktx.image), width: ktx.width, height: ktx.height };
  }
  if (extension === "tga") {
    const { width, height, pixels } = decodeTGAPixels(bytes);
    return { bitmap: await createImageBitmap(new ImageData(pixels, width, height)), width, height };
  }
  const bitmap = await createImageBitmap(new Blob([bytes]));
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/** The preview's texture size cap: plenty for a 3D pane, and bounded GPU memory for big maps. */
export const PREVIEW_MAX_SIZE = 512;

/** RGBA pixels for the textured preview, scaled down to fit PREVIEW_MAX_SIZE. */
export async function previewPixels(
  path: string,
  bytes: ArrayBuffer,
): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
  const decoded = await imageBitmap(path, bytes, PREVIEW_MAX_SIZE);
  if (!decoded) return null;
  const { bitmap } = decoded;
  const fit = Math.min(1, PREVIEW_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * fit));
  const height = Math.max(1, Math.round(bitmap.height * fit));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height).data;
  return { pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height };
}

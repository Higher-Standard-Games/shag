/**
 * Browser wiring for TextureThumbnails: package bytes from PK3Loader, versions
 * from PK3Index, decoding with createImageBitmap (TGA through the engine's
 * pixel decoder, skipping its PNG re-encode; ETC1/DXT KTX through its software
 * decoder), and an IndexedDB store.
 */

import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { canSoftwareDecode, parseKTX1, softwareDecodeMip } from "../loader/texture/KTX1Loader";
import { decodeTGAPixels } from "../loader/texture/TgaDecoder";
import { type StoredThumbnail, TextureThumbnails, type ThumbnailDeps, type ThumbnailStore } from "./TextureThumbnails";

export const THUMBNAIL_SIZE = 96;

async function sourceBitmap(path: string, bytes: ArrayBuffer): Promise<ImageBitmap> {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "tga") {
    const { width, height, pixels } = decodeTGAPixels(bytes);
    return createImageBitmap(new ImageData(pixels, width, height));
  }
  return createImageBitmap(new Blob([bytes]));
}

/**
 * A GPU-compressed KTX1 through the engine's software decoder, from the
 * smallest mip that still covers the thumbnail (much cheaper than level 0).
 * The size reported is level 0's, which is what alignment needs.
 */
async function ktxBitmap(bytes: ArrayBuffer): Promise<{ bitmap: ImageBitmap; width: number; height: number } | null> {
  const ktx = parseKTX1(bytes);
  const format = ktx.header.glInternalFormat;
  if (!ktx.mipLevels.length || ktx.header.numberOfFaces !== 1) return null; // cubemaps aren't face textures
  const mip =
    [...ktx.mipLevels].reverse().find((level) => Math.max(level.width, level.height) >= THUMBNAIL_SIZE) ??
    ktx.mipLevels[0];
  const rgba = canSoftwareDecode(format)
    ? softwareDecodeMip(mip.data, mip.width, mip.height, format)
    : expandUncompressed(mip.data, mip.width * mip.height, ktx.header.glType, ktx.header.glFormat);
  if (!rgba) return null;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(rgba.byteLength));
  pixels.set(rgba);
  const bitmap = await createImageBitmap(new ImageData(pixels, mip.width, mip.height));
  return { bitmap, width: ktx.header.pixelWidth, height: ktx.header.pixelHeight };
}

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
function expandUncompressed(data: Uint8Array, pixels: number, glType: number, glFormat: number): Uint8Array | null {
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

/** Fits the image in a THUMBNAIL_SIZE square, keeping its aspect ratio. */
async function decode(path: string, bytes: ArrayBuffer): Promise<{ blob: Blob; width: number; height: number } | null> {
  let bitmap: ImageBitmap | null;
  let width: number;
  let height: number;
  if (path.toLowerCase().endsWith(".ktx")) {
    const ktx = await ktxBitmap(bytes);
    if (!ktx) return null;
    ({ bitmap, width, height } = ktx);
  } else {
    bitmap = await sourceBitmap(path, bytes);
    if (!bitmap) return null;
    ({ width, height } = bitmap);
  }
  const fit = Math.min(1, THUMBNAIL_SIZE / Math.max(width, height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * fit)), Math.max(1, Math.round(height * fit)));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  return { blob, width, height };
}

const DB_NAME = "shagged-thumbnails";
const STORE = "thumbs";

/** IndexedDB, opened lazily; every failure (private mode, quota) degrades to no cache. */
function indexedDbStore(): ThumbnailStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>) =>
    open().then(
      (database) =>
        new Promise<T>((resolve, reject) => {
          const request = body(database.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
    );
  return {
    get: (key) => run<StoredThumbnail | undefined>("readonly", (store) => store.get(key)),
    put: (key, value) => run("readwrite", (store) => store.put(value, key)).then(() => undefined),
  };
}

function versionOf(path: string): string {
  const index = PK3Index.getInstance();
  const pk3 = index.findFile(path);
  const entry = pk3 ? index.getPackages().find((pkg) => pkg.pk3 === pk3) : undefined;
  return `${pk3 ?? "?"}:${entry?.size ?? "?"}:${entry?.timestamp ?? "?"}`;
}

export function browserThumbnailDeps(): ThumbnailDeps {
  const loader = PK3Loader.getInstance();
  return {
    readFile: (path) => loader.getFile(path),
    versionOf,
    decode,
    store: typeof indexedDB === "undefined" ? undefined : indexedDbStore(),
  };
}

export function createBrowserThumbnails(): TextureThumbnails {
  return new TextureThumbnails(browserThumbnailDeps());
}

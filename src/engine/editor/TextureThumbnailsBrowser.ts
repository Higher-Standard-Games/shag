/**
 * Browser wiring for TextureThumbnails: package bytes from PK3Loader, versions
 * from PK3Index, decoding through TexturePixels (from the smallest KTX mip
 * that covers a thumbnail), and an IndexedDB store.
 */

import { PK3Index } from "../loader/pk3/PK3Index";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { imageBitmap } from "./TexturePixels";
import { type StoredThumbnail, TextureThumbnails, type ThumbnailDeps, type ThumbnailStore } from "./TextureThumbnails";

export const THUMBNAIL_SIZE = 96;

/** Fits the image in a THUMBNAIL_SIZE square, keeping its aspect ratio. */
async function decode(path: string, bytes: ArrayBuffer): Promise<{ blob: Blob; width: number; height: number } | null> {
  const decoded = await imageBitmap(path, bytes, THUMBNAIL_SIZE);
  if (!decoded) return null;
  const { bitmap, width, height } = decoded;
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

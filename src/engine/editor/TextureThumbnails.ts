import { logRejection } from "../core/AsyncErrors";
/**
 * Texture browser thumbnails: decoded from package bytes on demand, kept in a
 * small in-memory LRU and in IndexedDB (keyed by path and package version, so a
 * changed PK3 refreshes). Requests made in one burst (one render of the visible
 * tiles) form a batch; the newest batch runs first, in request order, so tiles a
 * mapper just scrolled to fill top to bottom before ones already scrolled past. Each thumbnail also
 * carries its source image's size, which a texture assignment records as
 * FaceMaterial.size.
 */

export interface Thumbnail {
  /** Object URL of the small preview image. */
  url: string;
  /** Source image width and height in texels. */
  width: number;
  height: number;
}

export interface StoredThumbnail {
  blob: Blob;
  width: number;
  height: number;
  version: string;
}

export interface ThumbnailStore {
  get(key: string): Promise<StoredThumbnail | undefined>;
  put(key: string, value: StoredThumbnail): Promise<void>;
}

export interface ThumbnailDeps {
  readFile(path: string): Promise<ArrayBuffer | null>;
  /** Changes whenever the package holding the path changes. */
  versionOf(path: string): string;
  /** A small preview blob plus the source size; null when the format has no preview (KTX). */
  decode(path: string, bytes: ArrayBuffer): Promise<{ blob: Blob; width: number; height: number } | null>;
  store?: ThumbnailStore;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

interface Job {
  path: string;
  batch: number;
  resolve: (thumb: Thumbnail | null) => void;
}

export class TextureThumbnails {
  private readonly memory = new Map<string, Thumbnail | null>();
  private readonly inFlight = new Map<string, Promise<Thumbnail | null>>();
  private readonly queue: Job[] = [];
  private running = 0;
  private disposed = false;
  private batch = 0;
  private batchOpen = false;
  private readonly toUrl: (blob: Blob) => string;
  private readonly revoke: (url: string) => void;

  constructor(
    private readonly deps: ThumbnailDeps,
    private readonly options: { concurrency?: number; memoryLimit?: number } = {},
  ) {
    this.toUrl = deps.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.revoke = deps.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
  }

  /** A thumbnail for an image path in the packages; null when it has none. */
  request(path: string): Promise<Thumbnail | null> {
    if (this.memory.has(path)) {
      const hit = this.memory.get(path)!;
      this.memory.delete(path); // refresh LRU position
      this.memory.set(path, hit);
      return Promise.resolve(hit);
    }
    const running = this.inFlight.get(path);
    if (running) return running;
    if (!this.batchOpen) {
      // Everything requested before the next microtask joins this batch; then work starts.
      this.batch++;
      this.batchOpen = true;
      queueMicrotask(() => {
        this.batchOpen = false;
        this.pump();
      });
    }
    const batch = this.batch;
    const promise = new Promise<Thumbnail | null>((resolve) => {
      this.queue.push({ path, batch, resolve });
    }).finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, promise);
    return promise;
  }

  /** Drops a request that hasn't started (its tile scrolled away); it resolves to null. */
  cancel(path: string): void {
    const index = this.queue.findIndex((job) => job.path === path);
    if (index >= 0) this.queue.splice(index, 1)[0].resolve(null);
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.queue.splice(0)) job.resolve(null);
    for (const thumb of this.memory.values()) if (thumb) this.revoke(thumb.url);
    this.memory.clear();
  }

  private pump(): void {
    const limit = this.options.concurrency ?? 6;
    while (!this.disposed && this.running < limit && this.queue.length) {
      // Newest batch first; within a batch, request order.
      const newest = Math.max(...this.queue.map((item) => item.batch));
      const job = this.queue.splice(
        this.queue.findIndex((item) => item.batch === newest),
        1,
      )[0];
      this.running++;
      this.load(job.path)
        .catch(() => null)
        .then((thumb) => {
          this.running--;
          job.resolve(this.remember(job.path, thumb));
          this.pump();
        })
        .catch(logRejection("TextureThumbnails"));
    }
  }

  private async load(path: string): Promise<Thumbnail | null> {
    const version = this.deps.versionOf(path);
    const stored = await this.deps.store?.get(path).catch(() => undefined);
    if (stored && stored.version === version) {
      return { url: this.toUrl(stored.blob), width: stored.width, height: stored.height };
    }
    const bytes = await this.deps.readFile(path);
    if (!bytes) return null;
    const decoded = await this.deps.decode(path, bytes);
    if (!decoded) return null;
    await this.deps.store?.put(path, { ...decoded, version }).catch(() => undefined);
    return { url: this.toUrl(decoded.blob), width: decoded.width, height: decoded.height };
  }

  /** Keeps results (failures too, so a broken image isn't decoded again) within the memory limit. */
  private remember(path: string, thumb: Thumbnail | null): Thumbnail | null {
    if (this.disposed) {
      if (thumb) this.revoke(thumb.url);
      return null;
    }
    this.memory.set(path, thumb);
    const limit = this.options.memoryLimit ?? 600;
    while (this.memory.size > limit) {
      const [oldestPath, oldest] = this.memory.entries().next().value as [string, Thumbnail | null];
      this.memory.delete(oldestPath);
      if (oldest) this.revoke(oldest.url);
    }
    return thumb;
  }
}

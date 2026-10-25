import JSZip from "jszip";
import { background } from "../../core/AsyncErrors";
import { devLog } from "../../core/DevLog";
import { readAssetBuffer } from "./AssetRequest";
import { PackageDownload } from "./PackageDownload";
import { fetchPk3, pk3MirrorBase } from "./Pk3Mirror";

export type PackagePriority = "background" | "foreground";
interface Job {
  key: string;
  url: string;
  filename: string;
  hash?: string;
  priority: PackagePriority;
  promise: Promise<JSZip>;
  resolve: (zip: JSZip) => void;
  reject: (error: unknown) => void;
  started: boolean;
}
type PackageIdentity = Pick<Job, "key" | "url" | "filename" | "hash">;
const CACHE_NAME = "shag-packages-v1";
const DISK_BUDGET = 512 * 1024 * 1024;
const MEMORY_BUDGET = 128 * 1024 * 1024;
const STORAGE_TIMEOUT_MS = 1000;

/** CacheStorage is optional and its promises cannot be cancelled by the browser API. */
async function storageOperation<T>(work: Promise<T>, timeoutMs = STORAGE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Package storage timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Application-owned archive acquisition. Reading an archive never mounts it. */
export class PackageStore {
  static readonly shared = new PackageStore();
  private hashes = new Map<string, string>();
  private jobs = new Map<string, Job>();
  private memory = new Map<string, { zip: JSZip; size: number; bytes: ArrayBuffer; persisted: boolean }>();
  private diskQueue = new Map<string, { cache: Cache; job: PackageIdentity }>();
  private writing = false;
  private storageUnavailableUntil = 0;
  private cacheOpening: Promise<Cache | null> | null = null;
  private running = 0;
  private backgroundRunning = 0;
  private foregroundScopes = 0;
  paused = false;

  private absolute(url: string): URL {
    return new URL(url, typeof location === "undefined" ? "http://pk3.local/" : location.href);
  }

  register(url: string, hash: string): void {
    const source = this.absolute(url);
    source.search = "";
    source.hash = "";
    this.hashes.set(source.href, hash);
  }

  registerSnapshot(entries: readonly { path: string; sha256?: string }[]): void {
    this.hashes.clear();
    for (const entry of entries) if (entry.sha256) this.register(entry.path, entry.sha256);
  }

  private identity(url: string): { key: string; hash?: string } {
    const source = this.absolute(url);
    source.hash = "";
    const base = new URL(source);
    base.search = "";
    const hash = this.hashes.get(base.href);
    // pk3v is the loader's index timestamp. Content identity takes precedence.
    if (hash) source.searchParams.delete("pk3v");
    return { key: `${source.href}${hash ? `#${hash}` : ""}`, hash };
  }

  sourceKey(url: string): string {
    return this.identity(url).key;
  }

  acquire(url: string, filename: string, priority: PackagePriority = "foreground", refresh = false): Promise<JSZip> {
    const { key, hash } = this.identity(url);
    if (!refresh) {
      const cached = this.memory.get(key);
      if (cached) {
        this.memory.delete(key);
        this.memory.set(key, cached);
        if (!cached.persisted)
          background(
            this.cache().then((cache) => {
              if (cache) this.queuePersistence(cache, { key, hash, url, filename });
            }),
            "PackageStore persistence repair",
          );
        devLog(`[PackageStore] memory: ${filename}`);
        return Promise.resolve(cached.zip);
      }
      const pending = this.jobs.get(key);
      if (pending) {
        if (priority === "foreground" && !pending.started) pending.priority = priority;
        this.pump();
        return pending.promise;
      }
    }
    let resolve!: Job["resolve"];
    let reject!: Job["reject"];
    const promise = new Promise<JSZip>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const job: Job = { key, hash, url, filename, priority, promise, resolve, reject, started: false };
    // Explicit reloads have independent work and cannot reuse an older response.
    const jobKey = refresh ? `${key}#refresh-${++this.refreshId}` : key;
    this.jobs.set(jobKey, job);
    background(this.runQueued(jobKey, job, refresh), "PackageStore");
    return promise;
  }
  private refreshId = 0;
  private cacheWrites: Promise<void> = Promise.resolve();

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pump();
  }

  /** A map load owns this lease, not the lobby view. Existing bodies continue. */
  foregroundScope(): () => void {
    this.foregroundScopes++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.foregroundScopes--;
      this.pump();
    };
  }

  /** Remove obsolete optional work before it starts. Active bodies finish. */
  dropQueuedBackground(): void {
    for (const [key, job] of this.jobs) {
      if (!job.started && job.priority === "background") {
        this.jobs.delete(key);
        job.reject(new Error("Background preparation superseded"));
        this.wake.get(job)?.();
        this.wake.delete(job);
      }
    }
  }

  get pendingCount(): number {
    return this.jobs.size;
  }

  private wake = new Map<Job, () => void>();
  private async runQueued(key: string, job: Job, refresh: boolean): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wake.set(job, resolve);
      this.pump();
    });
    if (this.jobs.get(key) !== job) return;
    const backgroundJob = job.priority === "background";
    try {
      const zip = await this.read(job, refresh);
      job.resolve(zip);
    } catch (error) {
      job.reject(error);
    } finally {
      if (this.jobs.get(key) === job) this.jobs.delete(key);
      this.running--;
      if (backgroundJob) this.backgroundRunning--;
      this.pump();
    }
  }

  private pump(): void {
    const queued = [...this.jobs.values()].filter((job) => !job.started && this.wake.has(job));
    queued.sort((a, b) => Number(a.priority === "background") - Number(b.priority === "background"));
    for (const job of queued) {
      if (this.running >= 2) break;
      if (job.priority === "background" && (this.paused || this.foregroundScopes > 0 || this.backgroundRunning >= 1))
        continue;
      job.started = true;
      this.running++;
      if (job.priority === "background") this.backgroundRunning++;
      this.wake.get(job)!();
      this.wake.delete(job);
    }
  }

  private async cache(): Promise<Cache | null> {
    if (typeof caches === "undefined" || Date.now() < this.storageUnavailableUntil) return null;
    this.cacheOpening ??= storageOperation(caches.open(CACHE_NAME))
      .catch(() => {
        this.storageUnavailableUntil = Date.now() + 30000;
        return null;
      })
      .finally(() => {
        this.cacheOpening = null;
      });
    return this.cacheOpening;
  }

  private cacheUrl(job: PackageIdentity): string {
    const url = this.absolute(job.url);
    url.search = `shag-content=${job.hash}`;
    url.hash = "";
    return url.href;
  }

  private async validate(bytes: ArrayBuffer, hash?: string): Promise<JSZip> {
    if (hash) {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const actual = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
      if (actual !== hash) throw new Error("Package content does not match published SHA-256");
    }
    return JSZip.loadAsync(bytes);
  }

  private remember(job: Job, zip: JSZip, bytes: ArrayBuffer, persisted = false): void {
    const size = bytes.byteLength;
    if (!job.hash || size > MEMORY_BUDGET) return;
    this.memory.delete(job.key);
    this.memory.set(job.key, { zip, size, bytes, persisted });
    let total = [...this.memory.values()].reduce((sum, item) => sum + item.size, 0);
    for (const [key, item] of this.memory) {
      if (total <= MEMORY_BUDGET) break;
      this.memory.delete(key);
      total -= item.size;
    }
  }

  /** Queue only identities; compressed bodies remain owned by the bounded memory cache. */
  private queuePersistence(cache: Cache, job: PackageIdentity): void {
    if (!this.memory.has(job.key) || this.memory.get(job.key)?.persisted) return;
    const { key, url, filename, hash } = job;
    this.diskQueue.set(key, { cache, job: { key, url, filename, hash } });
    if (this.writing) return;
    this.writing = true;
    this.cacheWrites = (async () => {
      try {
        while (this.diskQueue.size) {
          const [key, item] = this.diskQueue.entries().next().value!;
          this.diskQueue.delete(key);
          const entry = this.memory.get(key);
          if (!entry || Date.now() < this.storageUnavailableUntil) {
            devLog(`[PackageStore] disk deferred/unavailable: ${item.job.filename}`);
            continue;
          }
          entry.persisted = await this.persist(item.cache, item.job, entry.bytes);
          devLog(`[PackageStore] ${entry.persisted ? "persisted" : "disk unavailable"}: ${item.job.filename}`);
        }
      } finally {
        this.writing = false;
      }
    })();
    background(this.cacheWrites, "PackageStore persistence");
  }

  private async persist(cache: Cache, job: PackageIdentity, bytes: ArrayBuffer): Promise<boolean> {
    try {
      if (bytes.byteLength > DISK_BUDGET) return false;
      const url = this.cacheUrl(job);
      let total = bytes.byteLength;
      const entries = await storageOperation(cache.keys());
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].url === url) continue;
        const response = await storageOperation(cache.match(entries[i]));
        const size = Number(response?.headers.get("content-length") ?? DISK_BUDGET);
        if (total + size > DISK_BUDGET) await storageOperation(cache.delete(entries[i]));
        else total += size;
      }
      await storageOperation(
        cache.put(url, new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } })),
        5000,
      );
      return true;
    } catch {
      /* Storage denial/quota must never prevent playing. */
      return false;
    }
  }

  private async read(job: Job, refresh: boolean): Promise<JSZip> {
    const cache = job.hash ? await this.cache() : null;
    if (cache && !refresh) {
      try {
        const response = await storageOperation(cache.match(this.cacheUrl(job)));
        if (response) {
          const bytes = await storageOperation(response.arrayBuffer());
          const zip = await this.validate(bytes, job.hash);
          this.remember(job, zip, bytes, true);
          devLog(`[PackageStore] disk: ${job.filename}`);
          return zip;
        }
      } catch {
        this.storageUnavailableUntil = Date.now() + 30000;
        background(
          storageOperation(cache.delete(this.cacheUrl(job))).catch(() => false),
          "PackageStore cache repair",
        );
      }
    }
    const progress = new PackageDownload(job.filename);
    let mirror = pk3MirrorBase();
    try {
      for (let attempt = 0; ; attempt++) {
        progress.reset();
        let retryable = true;
        try {
          let requestUrl = job.url;
          if (job.hash) {
            const url = this.absolute(job.url);
            url.searchParams.delete("pk3v");
            url.searchParams.set("sha256", job.hash);
            requestUrl = `${job.url.split(/[?#]/)[0]}${url.search}`;
          }
          const { response, source } = await fetchPk3(requestUrl, mirror);
          if (source === "mirror") mirror = null;
          if (!response.ok) {
            background(response.body?.cancel(), "PackageStore");
            retryable = response.status >= 500 || response.status === 408 || response.status === 429;
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          progress.response(response);
          const bytes = await readAssetBuffer(response, undefined, undefined, (loaded) => progress.update(loaded));
          progress.phase = "Preparing";
          const zip = await this.validate(bytes, job.hash);
          this.remember(job, zip, bytes);
          if (cache) this.queuePersistence(cache, job);
          devLog(`[PackageStore] network (${source}): ${job.filename}, ${bytes.byteLength} bytes`);
          return zip;
        } catch (error) {
          if (!retryable || attempt >= 2) throw new Error(`Could not load ${job.filename}: ${String(error)}`);
          mirror = null;
          progress.phase = "Retrying";
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      progress.finish();
    }
  }
}

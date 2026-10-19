/** Active HTTP package transfers, shared by startup and map-loading screens. */
export type PackageDownloadPhase = "Connecting" | "Downloading" | "Preparing" | "Retrying";

const active = new Set<PackageDownload>();

export class PackageDownload {
  loaded = 0;
  total: number | null = null;
  phase: PackageDownloadPhase = "Connecting";
  private samples: Array<{ time: number; bytes: number }> = [];
  private lastProgressAt = 0;

  constructor(readonly filename: string) {
    this.reset();
    active.add(this);
  }

  static getActive(): readonly PackageDownload[] {
    return [...active];
  }

  reset(): void {
    this.loaded = 0;
    this.total = null;
    this.phase = "Connecting";
    this.samples = [{ time: performance.now(), bytes: 0 }];
    this.lastProgressAt = performance.now();
  }

  response(response: Response): void {
    // Fetch exposes decoded bytes; compressed Content-Length is not comparable.
    const encoding = response.headers.get("content-encoding");
    const length = Number(response.headers.get("content-length"));
    this.total = (!encoding || encoding === "identity") && Number.isFinite(length) && length > 0 ? length : null;
    this.phase = "Downloading";
    this.samples = [{ time: performance.now(), bytes: 0 }];
  }

  update(loaded: number): void {
    this.loaded = loaded;
    if (this.total !== null && loaded > this.total) this.total = null;
    const now = performance.now();
    this.lastProgressAt = now;
    const last = this.samples[this.samples.length - 1];
    if (now - last.time >= 100) this.samples.push({ time: now, bytes: loaded });
    while (this.samples.length > 1 && this.samples[1].time <= now - 2000) this.samples.shift();
  }

  bytesPerSecond(): number {
    if (this.phase !== "Downloading") return 0;
    const now = performance.now();
    if (now - this.lastProgressAt >= 2000) return 0;
    while (this.samples.length > 1 && this.samples[1].time <= now - 2000) this.samples.shift();
    const first = this.samples[0];
    // An idle connection reaches zero instead of keeping its last speed forever.
    return (this.loaded - first.bytes) / Math.max(0.25, (now - first.time) / 1000);
  }

  finish(): void {
    active.delete(this);
  }
}

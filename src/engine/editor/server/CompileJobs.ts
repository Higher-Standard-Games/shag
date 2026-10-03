import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { type BuildQuality, buildRecipe } from "./BuildRecipe";
import type { CompilerConfig } from "./CompilerConfig";
import { MapConflictError, type MapStore } from "./MapStore";
import { checkModelAssets } from "./ModelAssetPreflight";

export type CompileState = "queued" | "running" | "failed" | "compiled";
export type CompileStage = "queued" | "makebsp" | "makelight" | "verify" | "done";

export interface CompileJob {
  id: string;
  mapName: string;
  revision: number;
  quality: BuildQuality;
  sourceHash: string;
  state: CompileState;
  stage: CompileStage;
  logs: string[];
  buildId: string | null;
  runtimeMapName: null;
}

export type ToolRunner = (binary: string, args: string[], cwd: string, log: (text: string) => void) => Promise<number>;

export const runTool: ToolRunner = (binary, args, cwd, log) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, shell: false, windowsHide: true, timeout: 30 * 60 * 1000 });
    child.stdout.on("data", (chunk: Buffer) => log(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => log(chunk.toString("utf8")));
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });

/** One process owns the queue. Every job receives its own immutable source workspace. */
export class CompileJobs {
  private readonly jobs = new Map<string, CompileJob>();
  private readonly bySource = new Map<string, string>();
  private readonly completions = new Map<string, Promise<void>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: MapStore,
    private readonly config: CompilerConfig,
    private readonly jobsRoot: string,
    private readonly runner: ToolRunner = runTool,
  ) {}

  get available(): boolean {
    return this.config.available;
  }

  get unavailableReason(): string | null {
    return this.config.reason;
  }

  get defaultQuality(): BuildQuality {
    return this.config.defaultQuality;
  }

  get(id: string): CompileJob | null {
    const job = this.jobs.get(id);
    return job ? { ...job, logs: [...job.logs] } : null;
  }

  async request(mapName: string, revision: number, quality: BuildQuality): Promise<CompileJob> {
    if (!this.config.available || !this.config.makebspBin || !this.config.makelightBin || !this.config.toolchainRoot) {
      throw new Error(this.config.reason ?? "Compiler is unavailable");
    }
    const saved = await this.store.load(mapName);
    if (!saved) throw new Error("Saved map was not found");
    if (saved.revision !== revision)
      throw new MapConflictError(`Map revision is ${saved.revision}; expected ${revision}`);
    const key = `${mapName}:${revision}:${saved.sourceHash}:${quality}`;
    const prior = this.bySource.get(key);
    if (prior && this.jobs.get(prior)?.state !== "failed") return this.get(prior)!;
    const job: CompileJob = {
      id: randomUUID(),
      mapName,
      revision,
      quality,
      sourceHash: saved.sourceHash,
      state: "queued",
      stage: "queued",
      logs: [],
      buildId: null,
      runtimeMapName: null,
    };
    this.jobs.set(job.id, job);
    this.bySource.set(key, job.id);
    const completion = this.queue.then(() => this.execute(job, saved.source));
    this.completions.set(job.id, completion);
    this.queue = completion.catch(() => undefined);
    return this.get(job.id)!;
  }

  async wait(id: string): Promise<CompileJob | null> {
    await this.completions.get(id);
    return this.get(id);
  }

  private log(job: CompileJob, text: string): void {
    job.logs.push(
      ...text
        .slice(-64_000)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.slice(0, 2_000)),
    );
    if (job.logs.length > 100) job.logs.splice(0, job.logs.length - 100);
  }

  private async execute(job: CompileJob, source: string): Promise<void> {
    try {
      await checkModelAssets(source, this.config.mediaRoot);
      const toolchainRoot = this.config.toolchainRoot!;
      const workspace = path.join(this.jobsRoot, job.id);
      await mkdir(workspace, { recursive: true });
      const mapFile = path.join(workspace, `${job.mapName}.map`);
      await writeFile(mapFile, source, "utf8");
      const recipe = buildRecipe(job.quality, this.config.mediaRoot, mapFile);
      job.state = "running";
      job.stage = "makebsp";
      this.log(job, "MakeBSP started");
      const bspExit = await this.runner(this.config.makebspBin!, recipe.bsp, toolchainRoot, (line) =>
        this.log(job, line),
      );
      if (bspExit !== 0) throw new Error(`MakeBSP exited with code ${bspExit}`);
      job.stage = "makelight";
      this.log(job, "MakeLight started");
      const lightExit = await this.runner(this.config.makelightBin!, recipe.light, toolchainRoot, (line) =>
        this.log(job, line),
      );
      if (lightExit !== 0) throw new Error(`MakeLight exited with code ${lightExit}`);
      job.stage = "verify";
      const file = await open(path.join(workspace, `${job.mapName}.bsp`), "r");
      try {
        const header = new Uint8Array(8);
        const { bytesRead } = await file.read(header, 0, 8, 0);
        if (
          bytesRead !== 8 ||
          new TextDecoder("ascii").decode(header.subarray(0, 4)) !== "FBSP" ||
          new DataView(header.buffer).getInt32(4, true) !== 1
        ) {
          throw new Error("Compiler output is not FBSP v1");
        }
      } finally {
        await file.close();
      }
      job.state = "compiled";
      job.stage = "done";
      job.buildId = job.id;
      this.log(job, "Compiled FBSP v1; runtime delivery is pending");
    } catch (error) {
      job.state = "failed";
      this.log(job, error instanceof Error ? error.message : String(error));
    }
  }
}

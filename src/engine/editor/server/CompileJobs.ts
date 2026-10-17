import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type BuildQuality, buildRecipe } from "./BuildRecipe";
import { type CompileDiagnostics, CompileTranscript, emptyDiagnostics } from "./CompileDiagnostics";
import type { CompilerConfig } from "./CompilerConfig";
import { MapConflictError, type MapStore } from "./MapStore";
import { checkModelAssets } from "./ModelAssetPreflight";
import { publishBuild } from "./PublishedBuild";

export type CompileState = "queued" | "running" | "failed" | "compiled" | "playable";
export type CompileStage = "queued" | "makebsp" | "makelight" | "verify" | "publish" | "done";

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
  runtimeMapName: string | null;
  packageName: string | null;
  bspHash: string | null;
  logPath: string;
  diagnostics: CompileDiagnostics;
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
    private readonly publishRoot?: string,
  ) {}

  get playableAvailable(): boolean {
    return this.available && !!this.publishRoot;
  }

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
    return job ? structuredClone(job) : null;
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
      packageName: null,
      bspHash: null,
      logPath: path.resolve(this.jobsRoot, "pending", "compile.log"),
      diagnostics: emptyDiagnostics(),
    };
    job.logPath = path.resolve(this.jobsRoot, job.id, "compile.log");
    await mkdir(path.dirname(job.logPath), { recursive: true });
    await writeFile(job.logPath, "", "utf8");
    await this.persist(job);
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

  private persist(job: CompileJob): void {
    const file = path.join(this.jobsRoot, job.id, "job.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(job, null, 2), "utf8");
    renameSync(`${file}.tmp`, file);
  }

  private async execute(job: CompileJob, source: string): Promise<void> {
    const transcript = new CompileTranscript(job.logPath, job.diagnostics, job.logs);
    let lastProgress = 0;
    const output = (text: string) => {
      transcript.append(text);
      if (Date.now() - lastProgress >= 250) {
        this.persist(job);
        lastProgress = Date.now();
      }
    };
    const stage = async (next: CompileStage) => {
      transcript.flush();
      job.stage = next;
      transcript.append(`\n[SHAGGED stage: ${next}]\n`);
      await this.persist(job);
    };
    try {
      await checkModelAssets(source, this.config.mediaRoot);
      const toolchainRoot = this.config.toolchainRoot!;
      const workspace = path.join(this.jobsRoot, job.id);
      await mkdir(workspace, { recursive: true });
      const mapFile = path.join(workspace, `${job.mapName}.map`);
      await writeFile(mapFile, source, "utf8");
      const recipe = buildRecipe(job.quality, this.config.mediaRoot, mapFile);
      job.state = "running";
      await stage("makebsp");
      transcript.append("MakeBSP started\n");
      const bspExit = await this.runner(this.config.makebspBin!, recipe.bsp, toolchainRoot, (line) => output(line));
      transcript.flush();
      if (bspExit !== 0) throw new Error(`MakeBSP exited with code ${bspExit}`);
      if (job.diagnostics.leak || job.diagnostics.missingAssets || job.diagnostics.errors)
        throw new Error("MakeBSP reported a leak, missing assets or errors; publication blocked");
      await stage("makelight");
      transcript.append("MakeLight started\n");
      const lightExit = await this.runner(this.config.makelightBin!, recipe.light, toolchainRoot, (line) =>
        output(line),
      );
      transcript.flush();
      if (lightExit !== 0) throw new Error(`MakeLight exited with code ${lightExit}`);
      if (job.diagnostics.leak || job.diagnostics.missingAssets || job.diagnostics.errors)
        throw new Error("MakeLight reported a leak, missing assets or errors; publication blocked");
      await stage("verify");
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
      job.buildId = job.id;
      transcript.append("Compiled FBSP v1\n");
      if (this.publishRoot) {
        await stage("publish");
        const bsp = await readFile(path.join(workspace, `${job.mapName}.bsp`));
        const published = await publishBuild(
          this.publishRoot,
          {
            mapName: job.mapName,
            buildId: job.id,
            sourceRevision: job.revision,
            sourceHash: job.sourceHash,
            quality: job.quality,
          },
          Uint8Array.from(bsp),
        );
        job.state = "playable";
        job.runtimeMapName = job.mapName;
        job.packageName = published.package;
        job.bspHash = published.bspHash;
        transcript.append(`Published ${published.package}\n`);
      } else transcript.append("Runtime delivery is not configured\n");
      await stage("done");
    } catch (error) {
      job.state = "failed";
      job.buildId = null;
      job.runtimeMapName = null;
      job.packageName = null;
      job.bspHash = null;
      transcript.append(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      transcript.flush();
      await this.persist(job);
    }
  }
}

/** Read only generated job paths; usable after the submitting process exits. */
export async function readCompileJob(jobsRoot: string, id: string): Promise<CompileJob | null> {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw new Error("Invalid compile job ID");
  try {
    return JSON.parse(await readFile(path.join(jobsRoot, id, "job.json"), "utf8")) as CompileJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readCompileLog(jobsRoot: string, id: string, offset = 0, limit = 32_768) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 65_536)
    throw new Error("Invalid compile log byte range");
  if (!(await readCompileJob(jobsRoot, id))) throw new Error("Compile job not found");
  const file = await open(path.join(jobsRoot, id, "compile.log"), "r");
  try {
    const size = (await file.stat()).size;
    const buffer = new Uint8Array(Math.min(limit, Math.max(0, size - offset)));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    return {
      offset,
      nextOffset: offset + bytesRead,
      size,
      text: new TextDecoder().decode(buffer.subarray(0, bytesRead)),
    };
  } finally {
    await file.close();
  }
}

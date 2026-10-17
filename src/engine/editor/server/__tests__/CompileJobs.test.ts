import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRecipe } from "../BuildRecipe";
import { CompileJobs, readCompileJob, readCompileLog, type ToolRunner } from "../CompileJobs";
import type { CompilerConfig } from "../CompilerConfig";
import { MapStore } from "../MapStore";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const config: CompilerConfig = {
  makebspBin: "makebsp",
  makelightBin: "makelight",
  mediaRoot: "/media root",
  toolchainRoot: "/toolchain",
  defaultQuality: "fast",
  available: true,
  reason: null,
};

describe("SHAGGED compile jobs", () => {
  it("retains split diagnostics and complete logs after progress evicts the tail; blocks publication", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-diagnostics-"));
    roots.push(root);
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    await store.save("arena", "source", 0);
    let calls = 0;
    const jobsRoot = path.join(root, "jobs");
    const jobs = new CompileJobs(
      store,
      config,
      jobsRoot,
      async (_binary, _args, _cwd, log) => {
        calls++;
        log("--- LoadModels ---\rWARNING: Could not lo");
        log("ad model models/missing.ase\n*** LEA");
        log("KED ***\n");
        for (let i = 0; i < 200; i++) log(`progress ${i}\r`);
        return 0;
      },
      path.join(root, "data"),
    );
    const job = (await jobs.wait((await jobs.request("arena", 1, "fast")).id))!;
    expect(job.state).toBe("failed");
    expect(job.packageName).toBeNull();
    expect(calls).toBe(1);
    expect(job.diagnostics).toMatchObject({ warnings: 1, missingAssets: 1, leak: true, phase: "LoadModels" });
    expect(job.logs.join("\n")).not.toContain("models/missing.ase");
    expect(await readFile(job.logPath, "utf8")).toContain("WARNING: Could not load model models/missing.ase");
    expect(await readCompileJob(jobsRoot, job.id)).toEqual(job);
    const page = await readCompileLog(jobsRoot, job.id, 0, 16);
    expect(page.nextOffset).toBe(16);
    expect(page.size).toBeGreaterThan(16);
    await expect(readCompileLog(jobsRoot, job.id, -1)).rejects.toThrow("Invalid");
    await expect(readCompileJob(jobsRoot, "../escape")).rejects.toThrow("Invalid");
  });

  it("uses isolated source, exact Washoi argv, and verifies the compiled FBSP header", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-jobs-"));
    roots.push(root);
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    await store.save("arena", "source", 0);
    const calls: Array<{ binary: string; args: string[]; cwd: string }> = [];
    const runner: ToolRunner = async (binary, args, cwd, log) => {
      calls.push({ binary, args, cwd });
      log("tool output\n");
      if (binary === "makelight") {
        const file = args.at(-1)!.replace(/\.map$/, ".bsp");
        const header = Buffer.alloc(8);
        header.write("FBSP", 0, "ascii");
        header.writeInt32LE(1, 4);
        await writeFile(file, Uint8Array.from(header));
      }
      return 0;
    };
    const jobs = new CompileJobs(store, config, path.join(root, "jobs"), runner);
    const started = await jobs.request("arena", 1, "fast");
    expect((await jobs.request("arena", 1, "fast")).id).toBe(started.id);
    const completed = await jobs.wait(started.id);
    expect(completed).toMatchObject({
      state: "compiled",
      stage: "done",
      revision: 1,
      buildId: started.id,
      runtimeMapName: null,
    });
    expect(calls.map((call) => call.binary)).toEqual(["makebsp", "makelight"]);
    expect(calls.map((call) => call.cwd)).toEqual(["/toolchain", "/toolchain"]);
    const mapFile = calls[0].args.at(-1)!;
    expect(calls[0].args).toEqual(buildRecipe("fast", config.mediaRoot, mapFile).bsp);
    expect(calls[1].args).toEqual(buildRecipe("fast", config.mediaRoot, mapFile).light);
    expect(completed?.logs).toContain("Compiled FBSP v1");
    expect(completed?.logs).toContain("Runtime delivery is not configured");
  });

  it("reports tool failure and permits retry without marking a build playable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-jobs-"));
    roots.push(root);
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    await store.save("arena", "source", 0);
    let exitCode = 7;
    const runner: ToolRunner = async () => exitCode;
    const jobs = new CompileJobs(store, config, path.join(root, "jobs"), runner);
    const first = await jobs.request("arena", 1, "default");
    expect(await jobs.wait(first.id)).toMatchObject({ state: "failed", buildId: null });
    exitCode = 0;
    const retry = await jobs.request("arena", 1, "default");
    expect(retry.id).not.toBe(first.id);
    expect((await jobs.wait(retry.id))?.state).toBe("failed");
    await expect(jobs.request("arena", 2, "default")).rejects.toThrow("revision is 1");
  });

  it("fails missing misc_model references before running MakeBSP", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-jobs-"));
    roots.push(root);
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    await store.save("arena", '{\n"classname" "misc_model"\n"model" "models/missing.md3"\n}\n', 0);
    let calls = 0;
    const jobs = new CompileJobs(store, { ...config, mediaRoot: root }, path.join(root, "jobs"), async () => {
      calls++;
      return 0;
    });
    const started = await jobs.request("arena", 1, "fast");
    const failed = await jobs.wait(started.id);
    expect(failed?.state).toBe("failed");
    expect(failed?.logs.join(" ")).toContain("models/missing.md3");
    expect(calls).toBe(0);
  });
});

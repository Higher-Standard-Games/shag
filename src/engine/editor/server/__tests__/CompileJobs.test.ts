import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRecipe } from "../BuildRecipe";
import { CompileJobs, type ToolRunner } from "../CompileJobs";
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
    expect(completed?.logs).toContain("Compiled FBSP v1; runtime delivery is pending");
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
});

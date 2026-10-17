import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { afterEach, expect, it } from "vitest";
import { buildFingerprint } from "../BuildFingerprint";
import type { CompilerConfig } from "../CompilerConfig";
import { withFileLock } from "../FileLock";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function root() {
  const dir = await mkdtemp(path.join(tmpdir(), "shagged-reliability-"));
  roots.push(dir);
  return dir;
}

it("waits for a surviving compiler process before recovering a dead owner's lease", async () => {
  const dir = await root(),
    lock = path.join(dir, "compile.lock");
  const module = pathToFileURL(path.resolve("src/engine/editor/server/FileLock.ts")).href;
  const native = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  const nativeExit = once(native, "exit");
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import {withFileLock} from ${JSON.stringify(module)}; await withFileLock(${JSON.stringify(lock)},async lease=>{lease.child(${native.pid});setInterval(()=>{},1000);process.send('locked');await new Promise(()=>{});});`,
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true },
  );
  const exit = once(child, "exit");
  try {
    await once(child, "message");
    let entered = false;
    const work = withFileLock(
      lock,
      async () => {
        entered = true;
        return 42;
      },
      5_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(entered).toBe(false);
    child.kill();
    await exit;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(entered).toBe(false);
    native.kill();
    await nativeExit;
    expect(await work).toBe(42);
    await expect(readFile(path.join(lock, "owner.json"))).rejects.toThrow();
  } finally {
    if (native.exitCode === null && native.signalCode === null) {
      native.kill();
      await nativeExit;
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exit;
    }
  }
}, 10_000);

it("does not steal a live lease and releases it when work fails", async () => {
  const lock = path.join(await root(), "compile.lock");
  await expect(
    withFileLock(lock, async () => {
      await expect(withFileLock(lock, async () => {}, 10)).rejects.toThrow("Timed out");
      throw new Error("work failed");
    }),
  ).rejects.toThrow("work failed");
  expect(await withFileLock(lock, async () => "released")).toBe("released");
});

it("fingerprints media, profiles, binaries and recipe without invalidating on published BSP-only packages", async () => {
  const dir = await root(),
    media = path.join(dir, "media"),
    tools = path.join(dir, "tools");
  await mkdir(media);
  await mkdir(path.join(tools, "makebspdata"), { recursive: true });
  const bsp = path.join(tools, "makebsp"),
    light = path.join(tools, "makelight"),
    profile = path.join(tools, "makebspdata", "washoi.json");
  await writeFile(bsp, "compiler1");
  await writeFile(light, "light1");
  await writeFile(profile, "profile1");
  await writeFile(path.join(media, "asset.tga"), "image1");
  const config: CompilerConfig = {
    makebspBin: bsp,
    makelightBin: light,
    toolchainRoot: tools,
    mediaRoot: media,
    defaultQuality: "fast",
    available: true,
    reason: null,
  };
  const first = await buildFingerprint(config, "fast");
  const zip = new JSZip();
  zip.file("maps/test.bsp", "compiled");
  await writeFile(path.join(media, "map_test_00001.pk3"), await zip.generateAsync({ type: "uint8array" }));
  await writeFile(path.join(media, "pk3_manifest.json"), "generated index");
  expect(await buildFingerprint(config, "fast")).toBe(first);
  await writeFile(path.join(media, "asset.tga"), "image2");
  const changedMedia = await buildFingerprint(config, "fast");
  expect(changedMedia).not.toBe(first);
  await writeFile(profile, "profile2");
  const changedProfile = await buildFingerprint(config, "fast");
  expect(changedProfile).not.toBe(changedMedia);
  await writeFile(bsp, "compiler2");
  const changedTool = await buildFingerprint(config, "fast");
  expect(changedTool).not.toBe(changedProfile);
  expect(await buildFingerprint(config, "release")).not.toBe(changedTool);
  zip.file("textures/extra.tga", "dependency");
  await writeFile(path.join(media, "map_test_00001.pk3"), await zip.generateAsync({ type: "uint8array" }));
  expect(await buildFingerprint(config, "fast")).not.toBe(changedTool);
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompilerConfig } from "../CompilerConfig";
import { clearGameCompilerProfile } from "../GameCompilerProfile";
import { registerTestCompilerProfile } from "./fixtures/TestCompilerProfile";

/**
 * A file rewritten with content of the same size inside one tick of the file
 * system's clock keeps size, times and inode. Simulated here by pinning the
 * times stat reports to the present.
 */
const pinned = BigInt(Date.now()) * 1_000_000n;
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (file: string, options?: { bigint?: boolean }) => {
      const info = await actual.stat(file, options as { bigint: true });
      if (!options?.bigint) return info;
      return Object.assign(info, { mtimeNs: pinned, ctimeNs: pinned });
    },
  };
});

const { buildFingerprint } = await import("../BuildFingerprint");

beforeEach(registerTestCompilerProfile);
afterEach(clearGameCompilerProfile);

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

it("reads a file again when it changed too close to its last hash for its stamp to tell", async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fingerprint-racy-"));
  const media = path.join(dir, "media");
  const tools = path.join(dir, "tools");
  await mkdir(media);
  await mkdir(tools);
  const bsp = path.join(tools, "makebsp");
  const light = path.join(tools, "makelight");
  await writeFile(bsp, "compiler");
  await writeFile(light, "light");
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
  await writeFile(path.join(media, "asset.tga"), "image2");
  expect(await buildFingerprint(config, "fast")).not.toBe(first);
});

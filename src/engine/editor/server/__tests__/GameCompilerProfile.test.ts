import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRecipe } from "../BuildRecipe";
import { localCompilerBin, resolveCompilerConfig } from "../CompilerConfig";
import { clearGameCompilerProfile } from "../GameCompilerProfile";
import { registerTestCompilerProfile } from "./fixtures/TestCompilerProfile";

let root: string | undefined;
afterEach(async () => {
  clearGameCompilerProfile();
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

describe("compiler game profile boundary", () => {
  it("reports a missing game and does not choose an implicit recipe", async () => {
    clearGameCompilerProfile();
    expect(await resolveCompilerConfig({}, {}, tmpdir(), tmpdir())).toMatchObject({
      available: false,
      reason: "No game compiler profile registered",
    });
    expect(() => buildRecipe("fast", "/media", "/map.map")).toThrow("No game compiler profile registered");
  });

  it("uses the supplied profile filename, local toolchain and recipe, then clears it", async () => {
    registerTestCompilerProfile();
    root = await mkdtemp(path.join(tmpdir(), "shagged-profile-boundary-"));
    await mkdir(path.join(root, "tools", "makebsp"), { recursive: true });
    await mkdir(path.join(root, "test-toolchain", "makebspdata"), { recursive: true });
    await mkdir(path.join(root, "public", "data"), { recursive: true });
    for (const tool of ["makebsp", "makelight"] as const)
      await writeFile(localCompilerBin(root, tool), "test", { mode: 0o755 });
    await writeFile(path.join(root, "test-toolchain", "makebspdata", "synthetic.json"), "{}");
    expect(await resolveCompilerConfig({}, {}, root, root)).toMatchObject({
      available: true,
      toolchainRoot: path.join(root, "test-toolchain"),
    });
    expect(await readFile(path.join(root, "tools", "makebsp", "makebspdata", "synthetic.json"), "utf8")).toBe("{}");
    expect(buildRecipe("release", "/media", "/map.map").bsp).toEqual([
      "-game",
      "synthetic",
      "-fs_basepath",
      "/media",
      "/map.map",
    ]);
    clearGameCompilerProfile();
    expect(() => buildRecipe("fast", "/media", "/map.map")).toThrow("No game compiler profile registered");
  });
});

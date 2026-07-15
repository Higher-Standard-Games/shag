/**
 * Asset preflight contract — QA-WO11 (step 3) proof.
 *
 * Verifies the exit-code-observable asset gate: a game dir with PK3 data passes,
 * an empty or missing dir fails with a clear problem. Uses real temp dirs.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countPk3Files, preflightGameAssets, resolveGameAssetDir } from "../_assetPreflight";

let tmp: string;
const originalGamePath = process.env.GAME_PATH;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-preflight-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalGamePath === undefined) {
    delete process.env.GAME_PATH;
  } else {
    process.env.GAME_PATH = originalGamePath;
  }
});

describe("preflightGameAssets", () => {
  it("passes when the dir contains at least one .pk3", () => {
    fs.writeFileSync(path.join(tmp, "map_test.pk3"), "not-a-real-pk3");
    fs.writeFileSync(path.join(tmp, "readme.txt"), "ignored");
    const result = preflightGameAssets(tmp);
    expect(result.ok).toBe(true);
    expect(result.pk3Count).toBe(1);
    expect(result.problems).toEqual([]);
  });

  it("fails when the dir exists but has no .pk3 files", () => {
    fs.writeFileSync(path.join(tmp, "readme.txt"), "no pk3 here");
    const result = preflightGameAssets(tmp);
    expect(result.ok).toBe(false);
    expect(result.pk3Count).toBe(0);
    expect(result.problems.join(" ")).toContain("No .pk3 files");
  });

  it("fails when the dir does not exist", () => {
    const missing = path.join(tmp, "does-not-exist");
    const result = preflightGameAssets(missing);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("not found");
  });
});

describe("countPk3Files", () => {
  it("counts only top-level .pk3 files", () => {
    fs.writeFileSync(path.join(tmp, "a.pk3"), "x");
    fs.writeFileSync(path.join(tmp, "b.pk3"), "x");
    fs.writeFileSync(path.join(tmp, "c.zip"), "x");
    expect(countPk3Files(tmp)).toBe(2);
  });

  it("returns 0 for a missing dir", () => {
    expect(countPk3Files(path.join(tmp, "nope"))).toBe(0);
  });
});

describe("resolveGameAssetDir", () => {
  it("honors the GAME_PATH override", () => {
    process.env.GAME_PATH = tmp;
    expect(resolveGameAssetDir()).toBe(tmp);
  });
});

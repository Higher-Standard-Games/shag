import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { botCalibration } from "../../shared/ranking/__tests__/_botCalibration";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-bot-registry-cli-"));
});
afterEach(() => {
  const target = path.resolve(dir);
  if (
    !target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) ||
    !path.basename(target).startsWith("shag-bot-registry-cli-")
  )
    throw new Error("Unsafe cleanup");
  fs.rmSync(target, { recursive: true, force: true });
});
function cli(...args: string[]) {
  return spawnSync(
    process.execPath,
    [path.resolve("node_modules/vite-node/vite-node.mjs"), "src/cli/ranking-references.ts", "--", ...args],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15000 },
  );
}
describe("operator bot calibration CLI", () => {
  it("checks a synthetic artifact, explicitly installs once, lists and refuses a changed version", () => {
    const players = PlayerStore.open(dir);
    const results = MatchResultStore.open(dir);
    results.close();
    players.close();
    const file = path.join(dir, "synthetic-fixture.json");
    const value = botCalibration();
    fs.writeFileSync(file, JSON.stringify(value));
    const check = cli("--check", file);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain('"valid": true');
    const install = cli("--install", file, "--data-dir", dir);
    expect(install.status, install.stderr).toBe(0);
    expect(install.stdout).toContain('"status":"registered"');
    const retry = cli("--install", file, "--data-dir", dir);
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stdout).toContain('"status":"duplicate"');
    const list = cli("--list", "--data-dir", dir);
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toContain(value.id);
    fs.writeFileSync(file, JSON.stringify({ ...value, mu: 12 }));
    const conflict = cli("--install", file, "--data-dir", dir);
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain("cannot be overwritten");
  }, 30000);
  it("does not create missing storage and rejects ambiguous actions or implicit target directories", () => {
    const absent = path.join(dir, "missing");
    const list = cli("--list", "--data-dir", absent);
    expect(list.status).toBe(1);
    expect(fs.existsSync(absent)).toBe(false);
    expect(cli("--list").status).toBe(1);
    expect(cli("--list", "--install", "never.json", "--data-dir", absent).status).toBe(1);
    expect(fs.existsSync(absent)).toBe(false);
  }, 30000);
});

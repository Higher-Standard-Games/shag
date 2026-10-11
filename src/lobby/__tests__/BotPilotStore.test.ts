import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { botReference } from "../../shared/ranking/__tests__/_botReference";
import type { BotPilot } from "../../shared/ranking/BotPilot";
import { isProvisional, type RatingMode } from "../../shared/ranking/RatingPolicy";
import { BotPilotStore } from "../BotPilotStore";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import { humanSnapshot } from "./_humanSnapshot";

describe("verified offline pilot export", () => {
  let dir: string, players: PlayerStore, results: MatchResultStore, sql: DatabaseSync, ids: number[];
  const now = Date.UTC(2026, 9, 11);
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-bot-pilot-"));
    players = PlayerStore.open(dir);
    ids = [players.create().account.id, players.create().account.id];
    results = MatchResultStore.open(dir);
    sql = new DatabaseSync(path.join(dir, "players.db"));
  });
  afterEach(() => {
    sql.close();
    results.close();
    players.close();
    const target = path.resolve(dir);
    if (
      !target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) ||
      !path.basename(target).startsWith("shag-bot-pilot-")
    )
      throw new Error("Unsafe test cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  });
  function anchors(mode: RatingMode, scope: "private" | "public" = "private") {
    for (let i = 0; i < 40; i++)
      results.ratings.ingest(
        humanSnapshot(`anchor-${mode}-${i}`, i % 2 ? [...ids].reverse() : ids, now + i * 2000, mode, scope),
      );
    expect(isProvisional(results.ratings.getRating(ids[0], mode, scope)!.state)).toBe(false);
  }
  function trial(mode: RatingMode, human = ids[0], name = "trial") {
    const result = humanSnapshot(name, [human, ids[1]], now + 100000, mode, "private");
    result.bots = 1;
    result.botReferenceChanged = false;
    result.mapDigest = "b".repeat(64);
    result.seats[1].accountId = null;
    result.seats[1].seatId = "bot";
    result.seats[1].botReference = botReference();
    result.startingRoster![1].accountId = null;
    result.startingRoster![1].isBot = true;
    result.startingRoster![1].botReference = botReference();
    return result;
  }
  it.each([
    "duel",
    "amphi",
    "ffa",
    "snd",
  ] as const)("exports complete %s trials using established pre-match human anchors", (mode) => {
    anchors(mode);
    results.ratings.ingest(trial(mode));
    const before = results.ratings.statistics();
    const pilot = new BotPilotStore(sql).export(mode);
    expect(pilot.trials).toHaveLength(1);
    expect(pilot.skipped).toEqual([]);
    expect(pilot.trials[0].groups.flatMap((g) => g.players).find((p) => p.kind === "human")).toMatchObject({
      state: { ratedMatches: 40 },
    });
    expect(pilot.trials[0].mapDigest).toBe("b".repeat(64));
    expect(results.ratings.statistics()).toEqual(before);
    expect(JSON.stringify(pilot)).not.toMatch(/tokenHash|ticket|secret|session/);
  });
  it("does not invent anchors, mix scopes or backfill pending matches", () => {
    anchors("duel", "public");
    results.ratings.ingest(trial("duel"));
    expect(new BotPilotStore(sql).export("duel").skipped[0].reason).toBe("established_human_anchor_unavailable");
    expect(new BotPilotStore(sql).export("duel", "public").trials).toHaveLength(1);
    expect(results.ratings.getRating(ids[0], "duel", "private")).toBeNull();
    expect(results.ratings.getResult("trial")!.receipt.ratingStatus).toBe("pending");
  });
  it("rejects a tampered journal and skips incomplete map identity", () => {
    anchors("duel");
    const input = trial("duel");
    delete input.mapDigest;
    results.ratings.ingest(input);
    expect(new BotPilotStore(sql).export("duel").skipped[0].reason).toBe("map_digest_unavailable");
    sql.exec("UPDATE rating_updates SET after_mu = after_mu + 1 WHERE sequence = 1");
    expect(() => new BotPilotStore(sql).export("duel")).toThrow();
  });
  it("runs export, draft analysis and explicitly reviewed artifact creation without live installation", () => {
    anchors("duel");
    results.ratings.ingest(trial("duel", ids[0], "trial-1"));
    results.ratings.ingest(trial("duel", ids[1], "trial-2"));
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [path.resolve("node_modules/vite-node/vite-node.mjs"), "src/cli/ranking-pilot.ts", "--", ...args],
        { cwd: process.cwd(), encoding: "utf8", timeout: 15000 },
      );
    const input = path.join(dir, "pilot.json"),
      report = path.join(dir, "analysis.json"),
      output = path.join(dir, "calibration.json");
    expect(run("--export", "--mode", "duel", "--data-dir", dir, "--output", input).status).toBe(0);
    const pilot = JSON.parse(fs.readFileSync(input, "utf8")) as BotPilot;
    expect(pilot.trials).toHaveLength(2);
    expect(run("--analyze", input, "--output", report).status).toBe(0);
    const args = [
      "--artifact",
      input,
      "--reference",
      pilot.references[0].id,
      "--id",
      "pilot-duel-v1",
      "--report",
      report,
      "--output",
      output,
    ];
    expect(run(...args).status).toBe(1);
    const approved = run(...args, "--reviewed");
    expect(approved.status, approved.stderr).toBe(0);
    expect(run(...args, "--reviewed").status).toBe(1);
    expect(JSON.parse(fs.readFileSync(output, "utf8")).evidence).toMatchObject({
      humans: 2,
      matches: 2,
      mapDigests: { wdm2: "b".repeat(64) },
    });
    expect(results.ratings.calibrations.list()).toEqual([]);
    expect(results.ratings.getResult("trial-1")!.receipt.ratingStatus).toBe("pending");
  }, 30000);
});

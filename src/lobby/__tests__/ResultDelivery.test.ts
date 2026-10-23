import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resultReport } from "../../engine/server/network/__tests__/_resultReport";
import { issueDropInSeat, issueMatchAdmission } from "../../engine/server/network/MatchAdmission";
import { signMatchResult } from "../../engine/server/network/MatchResultReport";
import { botReference } from "../../shared/ranking/__tests__/_botReference";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import { persistFinalResult } from "../ResultOutbox";

describe("private durable result outbox", () => {
  let dir: string, players: PlayerStore, results: MatchResultStore, sql: DatabaseSync, ids: number[];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-result-outbox-"));
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
      !path.basename(target).startsWith("shag-result-outbox-")
    )
      throw new Error("Unexpected outbox test cleanup path");
    fs.rmSync(target, { recursive: true, force: true });
  });
  function prepare(matchId = "delivery", bots = false) {
    const startedAt = Date.now() - 1000;
    const seats = ids.map((id, i) => ({
      lobbyPlayerId: String(id),
      accountId: bots && i === 1 ? null : id,
      name: `Seat ${i}`,
      team: i === 0 ? "udon" : "soba",
      isBot: bots && i === 1,
      ...(bots && i === 1 ? { botReference: botReference() } : {}),
    }));
    const { manifest } = issueMatchAdmission(matchId, seats, startedAt);
    const expected = { matchId, map: "wdm2", gametype: "duel", startedAt, admission: manifest };
    const context = {
      private: bots,
      ranked: !bots,
      bots: bots ? 1 : 0,
      botReferenceChanged: false,
      startingRoster: seats.map(({ accountId, isBot, team, botReference }) => ({
        accountId,
        isBot,
        team,
        ...(botReference ? { botReference } : {}),
      })),
    };
    const report = resultReport(
      {
        matchId,
        map: "wdm2",
        gametype: "duel",
        endedAt: Date.now(),
        participants: manifest.grants.map((g, i) => ({
          tokenHash: g.tokenHash,
          accountId: g.accountId,
          score: i === 0 ? 3 : 0,
          outcome: i === 0 ? "win" : "loss",
        })),
      },
      manifest,
    );
    const file = results.deliveries.prepare(expected, "private-secret", context);
    return { file, report, context, expected, line: signMatchResult(report, "private-secret") };
  }
  it("bounds live retries without starving later ready reports", () => {
    prepare("waiting-a");
    prepare("waiting-b");
    const ready = prepare("ready-c");
    persistFinalResult(ready.file, ready.line);
    expect(results.deliveries.retryAll(2)).toMatchObject({ waiting: 2, delivered: 0 });
    expect(results.deliveries.retryAll(2).delivered).toBe(1);
    expect(results.deliveries.retryAll(2).waiting).toBe(2);
  });
  it("previews cleanup and preserves active contexts and unresolved reports", () => {
    const now = Date.now(),
      old = now - 7200000;
    const closed = prepare("closed-empty"),
      active = prepare("active"),
      rejected = prepare("rejected");
    results.deliveries.closeMatch(closed.report.matchId, old);
    results.deliveries.closeMatch(rejected.report.matchId, old);
    persistFinalResult(rejected.file, signMatchResult(rejected.report, "wrong-secret"));
    const temp = `${closed.file}.0123456789abcdef.tmp`;
    fs.writeFileSync(temp, "partial");
    fs.utimesSync(temp, old / 1000, old / 1000);
    const unknown = path.join(path.dirname(temp), "unrelated.tmp");
    fs.writeFileSync(unknown, "keep");
    const preview = results.deliveries.cleanup(3600000, false, now);
    expect(preview.removedContexts).toEqual([closed.report.matchId]);
    expect(preview.removedFiles).toEqual([path.basename(temp)]);
    expect(results.deliveries.has(closed.report.matchId)).toBe(true);
    const info = results.deliveries.inspect();
    expect(JSON.stringify(info)).not.toMatch(/private-secret|tokenHash|admission/);
    expect(info.entries.find((entry) => entry.matchId === rejected.report.matchId)?.fileState).toBe("rejected");
    results.deliveries.cleanup(3600000, true, now);
    expect(results.deliveries.has(closed.report.matchId)).toBe(false);
    expect(results.deliveries.has(active.report.matchId)).toBe(true);
    expect(fs.existsSync(rejected.file)).toBe(true);
    expect(fs.existsSync(temp)).toBe(false);
    expect(fs.existsSync(unknown)).toBe(true);
    expect(() => results.deliveries.cleanup(1)).toThrow();
  });
  it("provides read-only CLI inspection and requires explicit cleanup application", () => {
    const context = prepare("maintenance");
    results.deliveries.closeMatch(context.report.matchId, Date.now() - 7200000);
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [path.resolve("node_modules/vite-node/vite-node.mjs"), "src/cli/ranking-delivery.ts", "--", ...args],
        { cwd: process.cwd(), encoding: "utf8", timeout: 15000 },
      );
    const info = run("--info", "--data-dir", dir);
    expect(info.status, info.stderr).toBe(0);
    expect(info.stdout).toContain("maintenance");
    expect(info.stdout).not.toContain("private-secret");
    expect(run("--cleanup", "--data-dir", dir, "--older-than-hours", "1").status).toBe(0);
    expect(results.deliveries.has(context.report.matchId)).toBe(true);
    expect(run("--cleanup", "--data-dir", dir, "--older-than-hours", "1", "--apply").status).toBe(0);
    expect(results.deliveries.has(context.report.matchId)).toBe(false);
    const missing = path.join(dir, "missing");
    expect(run("--info", "--data-dir", missing).status).toBe(1);
    expect(fs.existsSync(missing)).toBe(false);
  }, 30000);
  it("recovers a complete signed report after reopening, once, without rooms or demos", () => {
    const c = prepare();
    persistFinalResult(c.file, c.line);
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.deliveries.retryAll()).toEqual({ delivered: 1, waiting: 0, rejected: 0, failed: 0 });
    expect(fs.existsSync(c.file)).toBe(false);
    expect(results.deliveries.has(c.report.matchId)).toBe(false);
    expect(results.deliveries.retryAll().delivered).toBe(0);
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 1, updates: 2, ratings: 2 });
  });
  it("keeps a failed ingest for retry and acknowledges a committed duplicate after restart", () => {
    const c = prepare();
    persistFinalResult(c.file, c.line);
    sql.exec(
      "CREATE TRIGGER fail_delivery BEFORE INSERT ON rating_updates BEGIN SELECT RAISE(ABORT, 'temporary failure'); END",
    );
    expect(results.deliveries.retryAll().failed).toBe(1);
    expect(results.ratings.statistics().receipts).toBe(0);
    expect(fs.existsSync(c.file)).toBe(true);
    sql.exec("DROP TRIGGER fail_delivery");
    results.recordVerified(c.report, c.context); // Simulate death after commit but before acknowledgement.
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.deliveries.retryAll().delivered).toBe(1);
    expect(results.ratings.statistics()).toMatchObject({ receipts: 1, updates: 2 });
  });
  it("rejects forged, off-roster and changed reports without deleting evidence", () => {
    const c = prepare();
    persistFinalResult(c.file, signMatchResult(c.report, "wrong-secret"));
    expect(results.deliveries.retryAll().rejected).toBe(1);
    expect(fs.existsSync(c.file)).toBe(true);
    expect(() => persistFinalResult(c.file, c.line)).toThrow();
    fs.unlinkSync(c.file);
    const forged = structuredClone(c.report);
    forged.participants[0].accountId = ids[1];
    persistFinalResult(c.file, signMatchResult(forged, "private-secret"));
    expect(results.deliveries.retryAll().rejected).toBe(1);
    expect(results.statistics().totalMatches).toBe(0);
    expect(fs.readdirSync(path.dirname(c.file)).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
  it("waits for unfinished matches, never inventing a finish for a killed child", () => {
    const c = prepare();
    expect(results.deliveries.retryAll()).toEqual({ delivered: 0, waiting: 1, rejected: 0, failed: 0 });
    expect(results.statistics().totalMatches).toBe(0);
    expect(results.deliveries.has(c.report.matchId)).toBe(true);
    results.deliveries.acknowledge(c.report.matchId);
    expect(results.deliveries.has(c.report.matchId)).toBe(true);
  });
  it("preserves drop-in verification grants and latched bot changes across reopen", () => {
    const c = prepare("bot-change", true);
    const extra = issueDropInSeat({ accountId: ids[1], name: "Late", isBot: false, team: "soba" });
    results.deliveries.appendGrants(c.report.matchId, extra.grants);
    results.deliveries.markBotReferenceChanged(c.report.matchId);
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.deliveries.context(c.report.matchId)?.botReferenceChanged).toBe(true);
    const saved = JSON.parse(String(sql.prepare("SELECT expected FROM result_delivery").get()?.expected));
    expect(saved.admission.grants).toHaveLength(c.expected.admission.grants.length + extra.grants.length);
    persistFinalResult(c.file, c.line);
    expect(results.deliveries.retryAll().delivered).toBe(1);
    expect(results.ratings.getResult(c.report.matchId)?.receipt).toMatchObject({
      ratingStatus: "excluded",
      ratingReason: "bot_reference_changed",
    });
    // The human's record; the bot preset account keeps one too, unlisted.
    expect(results.leaderboard({ gametype: "duel", scope: "private", period: "all", offset: 0, limit: 10 }).total).toBe(
      1,
    );
  });
  it("excludes uncommitted bot skill after lost control but preserves an already committed bot receipt", () => {
    const c = prepare("control-lost", true);
    persistFinalResult(c.file, c.line);
    results.deliveries.loseBotControl();
    results.deliveries.retryAll();
    expect(results.ratings.getResult(c.report.matchId)?.receipt).toMatchObject({
      ratingStatus: "excluded",
      ratingReason: "bot_reference_changed",
    });
    const committed = prepare("committed", true);
    persistFinalResult(committed.file, committed.line);
    expect(results.recordVerified(committed.report, committed.context).ratingStatus).toBe("applied");
    results.deliveries.loseBotControl();
    expect(results.deliveries.retryAll().delivered).toBe(1);
    expect(results.ratings.getRating(ids[0], "duel", "private")?.state.ratedMatches).toBe(1);
  });
  it("survives killing the writing process after publication", async () => {
    const c = prepare("killed-writer");
    const helper = path.join(dir, "writer.ts");
    fs.writeFileSync(
      helper,
      `import { persistFinalResult } from ${JSON.stringify(path.resolve("src/lobby/ResultOutbox.ts").replace(/\\/g, "/"))};\npersistFinalResult(${JSON.stringify(c.file)}, ${JSON.stringify(c.line)});\nprocess.stdout.write("SAVED\\n");\nsetInterval(() => {}, 1000);`,
    );
    const child = spawn(process.execPath, [path.resolve("node_modules/vite-node/vite-node.mjs"), helper], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout!.on("data", read);
    try {
      await expect.poll(() => output, { timeout: 15000 }).toContain("SAVED");
      const exit = once(child, "exit");
      child.kill();
      await exit;
      results.close();
      results = MatchResultStore.open(dir);
      expect(results.deliveries.retryAll().delivered).toBe(1);
      expect(results.ratings.verifyReplay().updates).toBe(2);
    } finally {
      child.stdout!.off("data", read);
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }, 30000);
  it("recovers through the explicit offline CLI and refuses implicit or missing storage", () => {
    const c = prepare("offline-cli");
    persistFinalResult(c.file, c.line);
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [
          path.resolve("node_modules/vite-node/vite-node.mjs"),
          "src/games/fps/cli/lobby-server.ts",
          "--",
          "--results-recover",
          ...args,
        ],
        { cwd: process.cwd(), encoding: "utf8", timeout: 15000 },
      );
    expect(run().status).toBe(1);
    const missing = path.join(dir, "missing");
    expect(run("--data-dir", missing).status).toBe(1);
    expect(fs.existsSync(missing)).toBe(false);
    const recovered = run("--data-dir", dir);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(recovered.stdout).toContain('"delivered": 1');
    expect(recovered.stdout).not.toContain("private-secret");
    expect(results.ratings.getRating(ids[0], "duel", "public")?.state.ratedMatches).toBe(1);
  }, 30000);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { displayRating } from "../../shared/ranking/RatingPolicy";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import { humanSnapshot } from "./_humanSnapshot";

describe("career skill ladder reads", () => {
  const now = Date.UTC(2026, 9, 11);
  const day = 86400000;
  let dir: string, players: PlayerStore, results: MatchResultStore, sql: DatabaseSync, ids: number[];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-skill-board-"));
    players = PlayerStore.open(dir);
    ids = Array.from({ length: 4 }, () => players.create().account.id);
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
      !path.basename(target).startsWith("shag-skill-board-")
    )
      throw new Error("Unexpected skill test cleanup path");
    fs.rmSync(target, { recursive: true, force: true });
  });
  const board = (period: "all" | "month" = "all", offset = 0, limit = 100) =>
    results.skillLeaderboard({ gametype: "duel", period, offset, limit, accountId: ids[1], now });

  it("names a deleted account [deleted account] and keeps its standing", () => {
    const gone = players.create();
    results.ratings.ingest(humanSnapshot("before-delete", [gone.account.id, ids[1]], now));
    expect(players.deleteAccount(gone.account.id, gone.key)).toBe(true);
    expect(board("all").entries.find((entry) => entry.accountId === gone.account.id)).toMatchObject({
      name: "[deleted account]",
    });
  });

  it("filters monthly activity and records while preserving career skill and rated count", () => {
    results.ratings.ingest(humanSnapshot("old", ids.slice(0, 2), now - 31 * day));
    expect(board("all").total).toBe(2);
    expect(board("month")).toMatchObject({ entries: [], total: 0 });
    results.ratings.ingest(humanSnapshot("fresh", [ids[1], ids[2]], now));
    const all = board("all"),
      month = board("month");
    expect(all.total).toBe(3);
    expect(month.total).toBe(2);
    expect(month.entries.map((e) => e.accountId)).not.toContain(ids[0]);
    expect(month.localPlayerEntry).toMatchObject({
      ratedMatches: 2,
      wins: 1,
      losses: 0,
      rating: all.localPlayerEntry!.rating,
      conservativeScore: all.localPlayerEntry!.conservativeScore,
    });
    expect(all.localPlayerEntry).toMatchObject({ wins: 1, losses: 1 });
    expect(results.ratings.verifyReplay().consistent).toBe(true);
  });

  it("ranks full precision skill, independent of record counts or rounded ties, with stable pagination", () => {
    results.ratings.ingest(humanSnapshot("contest", ids.slice(0, 2), now));
    // Deliberately seed almost equal posterior scores to test SQL precision.
    // These are isolated query fixtures, not replayable result updates.
    sql.prepare("UPDATE ratings SET mu = ?, sigma = 2 WHERE account_id = ?").run(25, ids[0]);
    sql.prepare("UPDATE ratings SET mu = ?, sigma = 2 WHERE account_id = ?").run(25.00001, ids[1]);
    const first = board("all", 0, 1);
    expect(first.entries[0]).toMatchObject({ accountId: ids[1], rank: 1, wins: 0 });
    expect(board("all", 1, 1).entries[0]).toMatchObject({
      accountId: ids[0],
      rank: 2,
      wins: 1,
      rating: first.entries[0].rating,
    });
    sql.prepare("UPDATE ratings SET mu = 25").run();
    expect(board().entries.map((e) => [e.accountId, e.rank])).toEqual([
      [ids[0], 1],
      [ids[1], 1],
    ]);
  });

  it("returns no invented skill for records-only accounts and reports local exclusions", () => {
    results.record({
      matchId: "legacy",
      gametype: "duel",
      map: "wdm2",
      endedAt: now,
      participants: ids
        .slice(0, 2)
        .map((accountId, i) => ({ accountId, score: 1 - i, outcome: i === 0 ? "win" : "loss" })),
    });
    expect(board().total).toBe(0);
    const incomplete = humanSnapshot("interrupted", ids.slice(0, 2), now);
    incomplete.seats[0].participationInterrupted = true;
    results.ratings.ingest(incomplete);
    expect(board()).toMatchObject({ entries: [], total: 0, localProcessing: { excluded: 1 } });
    expect(board().localPlayerEntry).toBeUndefined();
  });

  it("serves skill explicitly without letting clients choose whose local row is returned", () => {
    results.ratings.ingest(humanSnapshot("wire", ids.slice(0, 2), now));
    const lobby = new LobbyServer(0, new GameServerSpawner(), { players, results });
    const sent: unknown[] = [];
    const player = {
      id: "reader",
      authenticated: true,
      accountId: ids[1],
      ws: { readyState: 1, send: (data: string) => sent.push(JSON.parse(data)) },
    };
    const handler = lobby as unknown as { handleMessage(p: typeof player, m: object): void };
    const query = {
      type: "leaderboard:get",
      requestId: "skill",
      gametype: "duel",
      period: "all",
      offset: 0,
      limit: 1,
      system: "trueskill",
      accountId: ids[0],
    };
    handler.handleMessage(player, query);
    const state = results.ratings.getRating(ids[1], "duel", "public")!.state;
    expect(sent.at(-1)).toMatchObject({
      system: "trueskill",
      policyVersion: "shag-trueskill-v1",
      total: 2,
      localPlayerRank: 2,
      localPlayerEntry: { playerId: String(ids[1]), rating: displayRating(state), provisional: true, ratedMatches: 1 },
    });
    handler.handleMessage(player, { ...query, requestId: "invalid", system: "elo" });
    expect(sent.at(-1)).toEqual({ type: "leaderboard:error", requestId: "invalid", reason: "invalid_query" });
    handler.handleMessage(player, { ...query, system: undefined, requestId: "records" });
    expect(sent.at(-1)).not.toHaveProperty("system");
  });

  it("validates the same bounded query for skill reads", () => {
    expect(() => results.skillLeaderboard({ gametype: "duel", period: "all", offset: -1, limit: 10 })).toThrow(
      "Invalid leaderboard",
    );
    expect(() => results.skillLeaderboard({ gametype: "duel", period: "all", offset: 0, limit: 101 })).toThrow(
      "Invalid leaderboard",
    );
  });
});

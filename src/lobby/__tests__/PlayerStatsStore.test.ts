import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { botReference } from "../../shared/ranking/__tests__/_botReference";
import { matchStats } from "../../shared/ranking/__tests__/_matchStats";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import { humanSnapshot } from "./_humanSnapshot";

describe("durable own-account gameplay stats", () => {
  let dir: string, players: PlayerStore, results: MatchResultStore, sql: DatabaseSync, ids: number[];
  const query = { gametype: "duel" as const, scope: "public" as const, period: "all" as const };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-player-stats-"));
    players = PlayerStore.open(dir);
    ids = Array.from({ length: 3 }, () => players.create().account.id);
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
      !path.basename(target).startsWith("shag-player-stats-")
    )
      throw new Error("Unsafe test cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  });
  function played(name: string, scope: "public" | "private" = "public", stats = true) {
    const snapshot = humanSnapshot(name, ids.slice(0, 2), Date.now() - 1000, "duel", scope);
    if (stats) for (const seat of snapshot.seats) seat.stats = matchStats();
    return snapshot;
  }
  it("commits stats once with ratings, preserves unknown coverage and reopens/replays", () => {
    const input = played("first");
    results.ratings.ingest(input);
    results.ratings.ingest(input);
    results.ratings.ingest(played("older", "public", false));
    results.ratings.ingest(played("private", "private"));
    expect(results.playerStats.summary(ids[0], query)).toMatchObject({
      matches: 2,
      wins: 2,
      statsMatches: 1,
      totals: { frags: 4, deaths: 2, damageGiven: 1234.5, plants: 1 },
      rating: { ratedMatches: 2 },
    });
    expect(results.playerStats.summary(ids[2], query)).toMatchObject({
      matches: 0,
      statsMatches: 0,
      totals: null,
      rating: null,
    });
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.ratings.verifyReplay().matches).toBe(3);
    expect(results.playerStats.history(ids[0], query).entries[0].stats).toBeNull();
    sql.exec("UPDATE ranking_stats SET stats = '{}' WHERE sequence = 1");
    expect(() => results.ratings.verifyReplay()).toThrow("stats diverged");
  });
  it("rolls stats back atomically when any stat insert fails", () => {
    sql.exec("CREATE TRIGGER fail_stats BEFORE INSERT ON ranking_stats BEGIN SELECT RAISE(ABORT,'failure'); END");
    expect(() => results.ratings.ingest(played("rollback"))).toThrow();
    expect(results.ratings.statistics().receipts).toBe(0);
    expect(results.playerStats.summary(ids[0], query).matches).toBe(0);
  });
  it("shows records, totals and the rating change for a bot game", () => {
    const input = played("bot", "private");
    input.bots = 1;
    input.botReferenceChanged = false;
    input.seats[1].accountId = null;
    input.seats[1].botReference = botReference();
    input.startingRoster![1].accountId = null;
    input.startingRoster![1].isBot = true;
    input.startingRoster![1].botReference = botReference();
    results.ratings.ingest(input);
    expect(results.playerStats.summary(ids[0], { ...query, scope: "private" })).toMatchObject({
      matches: 1,
      wins: 1,
      rating: { ratedMatches: 1 },
      totals: { frags: 4 },
    });
    const entry = results.playerStats.history(ids[0], { ...query, scope: "private" }).entries[0];
    expect(entry).toMatchObject({ ratingStatus: "applied" });
    expect(entry.ratingChange!.delta).toBeGreaterThan(0);
  });
  it("uses keyset history pages, saved rating changes and account/scope/mode isolation", () => {
    for (let i = 0; i < 4; i++) results.ratings.ingest(played(`m-${i}`));
    const first = results.playerStats.history(ids[0], query, 2);
    expect(first.entries.map((e) => e.matchId)).toEqual(["m-3", "m-2"]);
    expect(first.entries[0].ratingChange!.delta).toBe(
      first.entries[0].ratingChange!.after - first.entries[0].ratingChange!.before,
    );
    results.ratings.ingest(played("new"));
    const second = results.playerStats.history(ids[0], query, 2, first.nextBeforeSequence!);
    expect(second.entries.map((e) => e.matchId)).toEqual(["m-1", "m-0"]);
    expect(second.nextBeforeSequence).toBeNull();
    expect(results.playerStats.history(ids[2], query).entries).toEqual([]);
    expect(results.playerStats.history(ids[0], { ...query, scope: "private" }).entries).toEqual([]);
    expect(results.playerStats.history(ids[0], { ...query, gametype: "ffa" }).entries).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(/tokenHash|startingRoster|secret|ticket/);
    expect(() => results.playerStats.history(ids[0], query, 51)).toThrow();
  });
  it("derives stats/history ownership from authentication and bounds reads", async () => {
    results.ratings.ingest(played("owned"));
    const lobby = new LobbyServer(0, new GameServerSpawner(), { players, results });
    const sent: Array<Record<string, unknown>> = [];
    const player = {
      id: "reader",
      authenticated: true,
      isBot: false,
      accountId: ids[2],
      ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
    };
    const handle = (lobby as unknown as { handleMessage(p: typeof player, msg: object): void }).handleMessage.bind(
      lobby,
    );
    try {
      handle(player, { type: "stats:get", requestId: "summary", ...query, accountId: ids[0] });
      expect(sent.at(-1)).toMatchObject({ type: "stats:summary", data: { matches: 0, totals: null, rating: null } });
      handle(player, { type: "stats:history", requestId: "history", ...query, accountId: ids[0] });
      expect(sent.at(-1)).toMatchObject({ type: "stats:history_page", data: { entries: [] } });
      handle(player, { type: "stats:history", requestId: "large", ...query, limit: 51 });
      expect(sent.at(-1)).toMatchObject({ type: "stats:error", reason: "invalid_query" });
      player.authenticated = false;
      handle(player, { type: "stats:get", requestId: "unauth", ...query });
      expect(sent.at(-1)?.type).toBe("lobby:error");
    } finally {
      await lobby.stop();
    }
  });
  it("moves an old schema forward without backfilling legacy stats, and rejects missing current tables", () => {
    results.ratings.ingest(played("legacy", "public", false));
    results.close();
    sql.exec("DROP TABLE ranking_stats; UPDATE ranking_schema SET version = 1");
    results = MatchResultStore.open(dir);
    expect(sql.prepare("SELECT version FROM ranking_schema").get()?.version).toBe(3);
    expect(results.ratings.verifyReplay().matches).toBe(1);
    expect(results.playerStats.summary(ids[0], query)).toMatchObject({ matches: 1, statsMatches: 0, totals: null });
    sql.exec("DROP TABLE ranking_stats");
    expect(() => MatchResultStore.open(dir)).toThrow("Incomplete ranking stats");
  });
});

import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { resultReport } from "../../engine/server/network/__tests__/_resultReport";
import type { MatchResultReport } from "../../engine/server/network/MatchResultReport";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";
import { MatchResultStore, type RecordedMatch } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12);

function finalReport(report: Omit<MatchResultReport, "details">): MatchResultReport {
  return resultReport(report, {
    matchId: report.matchId,
    expiresAt: NOW + 1,
    grants: report.participants.map((player, index) => ({
      tokenHash: player.tokenHash,
      accountId: player.accountId,
      isBot: player.accountId === null,
      name: "Test player",
      team: index === 0 ? "udon" : "soba",
    })),
  });
}

describe("MatchResultStore", () => {
  let dir: string;
  let accounts: PlayerStore;
  let results: MatchResultStore;
  let ids: number[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-match-results-"));
    accounts = PlayerStore.open(dir);
    ids = [accounts.create().account.id, accounts.create().account.id, accounts.create().account.id];
    results = MatchResultStore.open(dir);
  });

  afterEach(() => {
    results.close();
    accounts.close();
    const target = path.resolve(dir);
    const tempRoot = path.resolve(os.tmpdir());
    if (!target.startsWith(`${tempRoot}${path.sep}`) || !path.basename(target).startsWith("shag-match-results-")) {
      throw new Error("Refusing to remove an unexpected results test directory");
    }
    fs.rmSync(target, { recursive: true, force: true });
  });

  function match(id: string, endedAt: number, a: "win" | "loss" | "draw", b: "win" | "loss" | "draw"): RecordedMatch {
    return {
      matchId: id,
      gametype: "amphi",
      map: "wamphi1",
      endedAt,
      participants: [
        { accountId: ids[0], outcome: a, score: a === "win" ? 3 : 0 },
        { accountId: ids[1], outcome: b, score: b === "win" ? 3 : 0 },
      ],
    };
  }

  const board = (scope?: "public" | "private") =>
    results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW, scope });

  it("counts tied FFA leaders as draws and lower placements as losses", () => {
    results.record({
      matchId: "ffa-tie",
      gametype: "ffa",
      map: "wdm2",
      endedAt: NOW,
      participants: [
        { accountId: ids[0], score: 5, outcome: "draw" },
        { accountId: ids[1], score: 5, outcome: "draw" },
        { accountId: ids[2], score: 1, outcome: "loss" },
      ],
    });
    expect(
      results.leaderboard({ gametype: "ffa", period: "all", offset: 0, limit: 10, now: NOW }).entries,
    ).toMatchObject([
      { accountId: ids[0], draws: 1, losses: 0 },
      { accountId: ids[1], draws: 1, losses: 0 },
      { accountId: ids[2], draws: 0, losses: 1 },
    ]);
    expect(() => results.record({ ...match("mixed-amphi", NOW, "draw", "loss") })).toThrow(
      "Inconsistent match outcomes",
    );
  });

  it("diagnoses an aborted started match without recording wins or draws", () => {
    const spawner = new GameServerSpawner();
    const lobby = new LobbyServer(0, spawner, { players: accounts, results });
    const running = lobby as unknown as {
      matchToLobby: Map<string, string>;
      matchRecords: Map<string, { ranked: boolean; private: boolean; bots: number }>;
    };
    running.matchToLobby.set("aborted", "room");
    running.matchRecords.set("aborted", { ranked: true, private: false, bots: 0 });
    const report = finalReport({
      matchId: "aborted",
      gametype: "amphi",
      map: "wamphi1",
      endedAt: NOW,
      participants: [
        { tokenHash: "first", accountId: ids[0], outcome: "draw", score: 0 },
        { tokenHash: "second", accountId: ids[1], outcome: "draw", score: 0 },
      ],
    });
    report.details.completion = "aborted";
    for (const player of report.participants) player.outcome = null;
    for (const seat of report.details.seats) seat.placement = null;
    for (const team of report.details.teams) team.placement = null;
    spawner.onServerResult?.(report);
    expect(results.statistics().totalMatches).toBe(0);
    expect(results.ratings.getResult("aborted")?.receipt).toMatchObject({
      recordStatus: "excluded",
      recordReason: "aborted",
      ratingStatus: "excluded",
    });
    expect(results.ratings.getResult("aborted")?.snapshot.completion).toBe("aborted");
    expect(lobby.getResultDiagnostics().runtime.recent).toMatchObject([
      { status: "skipped", reason: "aborted", scope: "public" },
    ]);
  });

  it("reports durable scoped counts without exposing accounts or creating missing storage", () => {
    results.record(match("public", NOW - 1, "win", "loss"));
    results.record({ ...match("private", NOW, "draw", "draw"), private: true });
    const expected = {
      totalMatches: 2,
      totalParticipants: 4,
      boards: [
        { gametype: "amphi", scope: "public", matches: 1, accounts: 2, latestEndedAt: NOW - 1 },
        { gametype: "amphi", scope: "private", matches: 1, accounts: 2, latestEndedAt: NOW },
      ],
      latestResult: { matchId: "private", gametype: "amphi", map: "wamphi1", endedAt: NOW, scope: "private", bots: 0 },
    };
    expect(results.statistics()).toEqual(expected);
    expect(MatchResultStore.inspect(dir)).toEqual({
      status: "ready",
      file: path.join(dir, "players.db"),
      statistics: expected,
    });
    const missing = path.join(dir, "missing");
    expect(MatchResultStore.inspect(missing).status).toBe("missing_database");
    expect(fs.existsSync(missing)).toBe(false);
    const legacy = path.join(dir, "legacy");
    fs.mkdirSync(legacy);
    const file = path.join(legacy, "players.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE matches (id TEXT PRIMARY KEY)");
    db.close();
    const before = fs.readFileSync(file);
    expect(MatchResultStore.inspect(legacy).status).toBe("schema_unavailable");
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it("applies date windows independently to private results and excludes public-only accounts", () => {
    results.record(match("public", NOW, "win", "loss"));
    results.record({ ...match("old-private", NOW - 31 * DAY, "win", "loss"), private: true });
    results.record({
      matchId: "private-bot",
      gametype: "amphi",
      map: "wamphi1",
      endedAt: NOW,
      private: true,
      bots: 1,
      participants: [{ accountId: ids[2], outcome: "loss", score: 0 }],
    });
    expect(
      results.leaderboard({
        gametype: "amphi",
        period: "month",
        offset: 0,
        limit: 10,
        now: NOW,
        scope: "private",
        accountId: ids[0],
      }),
    ).toEqual({
      total: 1,
      entries: [{ rank: 1, accountId: ids[2], name: expect.any(String), wins: 0, losses: 1, draws: 0 }],
    });
    expect(board("private").total).toBe(3);
    expect(board().total).toBe(2);
  });

  it("keeps public and private rankings independent, including their order and local rows", () => {
    results.record(match("public", NOW, "win", "loss"));
    results.record({ ...match("private", NOW, "loss", "win"), private: true });
    expect(board().entries.map((row) => [row.accountId, row.wins, row.losses])).toEqual([
      [ids[0], 1, 0],
      [ids[1], 0, 1],
    ]);
    expect(board("private").entries.map((row) => [row.accountId, row.wins, row.losses])).toEqual([
      [ids[1], 1, 0],
      [ids[0], 0, 1],
    ]);
    const query = { gametype: "amphi", period: "all" as const, offset: 0, limit: 1, now: NOW, accountId: ids[0] };
    expect(results.leaderboard({ ...query, scope: "private" })).toMatchObject({
      total: 2,
      entries: [{ accountId: ids[1] }],
      localPlayerRank: 2,
      localPlayerEntry: { accountId: ids[0], wins: 0, losses: 1 },
    });
    expect(results.leaderboard({ ...query, scope: "public" })).toMatchObject({
      localPlayerRank: 1,
      localPlayerEntry: { wins: 1, losses: 0 },
    });
  });

  it("records a private match against bots with one account and any outcome, a loss included", () => {
    const vsBots = (id: string, outcome: "win" | "loss"): RecordedMatch => ({
      matchId: id,
      gametype: "amphi",
      map: "wamphi1",
      endedAt: NOW,
      participants: [{ accountId: ids[2], outcome, score: 1 }],
      private: true,
      bots: 1,
    });
    expect(results.record(vsBots("bots-won", "loss"))).toBe(true);
    expect(results.record(vsBots("bots-lost", "win"))).toBe(true);
    expect(board().entries.some((row) => row.accountId === ids[2])).toBe(false);
    expect(board("private").entries.find((row) => row.accountId === ids[2])).toMatchObject({ wins: 1, losses: 1 });
    expect(() => results.record({ ...vsBots("public-bots", "win"), private: false })).toThrow(
      "Bots play only in private matches",
    );
  });

  it("adds the new columns to an existing results table, its matches counted as public", () => {
    results.close();
    const file = path.join(dir, "players.db");
    const db = new DatabaseSync(file);
    db.exec("DROP TABLE match_participants; DROP TABLE matches");
    db.exec(`CREATE TABLE matches (id TEXT PRIMARY KEY, gametype TEXT NOT NULL, map TEXT NOT NULL, ended_at INTEGER NOT NULL);
      CREATE TABLE match_participants (match_id TEXT NOT NULL REFERENCES matches(id), account_id INTEGER NOT NULL REFERENCES players(id),
        outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'draw')), score INTEGER NOT NULL, PRIMARY KEY (match_id, account_id));`);
    db.prepare("INSERT INTO matches VALUES ('old', 'amphi', 'wamphi1', ?)").run(NOW);
    db.prepare("INSERT INTO match_participants VALUES ('old', ?, 'win', 3), ('old', ?, 'loss', 0)").run(ids[0], ids[1]);
    db.close();
    results = MatchResultStore.open(dir);
    expect(board().total).toBe(2);
    expect(results.record({ ...match("new-private", NOW, "win", "loss"), private: true })).toBe(true);
    expect(board().total).toBe(2);
    expect(board("private").entries[0]).toMatchObject({ accountId: ids[0], wins: 1 });
  });

  it("stores once, rolls back unknown accounts and survives reopening", () => {
    expect(results.record(match("match-a", NOW, "win", "loss"))).toBe(true);
    expect(results.record(match("match-a", NOW, "loss", "win"))).toBe(false);
    expect(() => results.record(match("impossible", NOW, "win", "draw"))).toThrow("Inconsistent match outcomes");
    expect(() =>
      results.record({
        ...match("invalid", NOW, "win", "loss"),
        participants: [
          { accountId: ids[0], outcome: "win", score: 3 },
          { accountId: 99999, outcome: "loss", score: 0 },
        ],
      }),
    ).toThrow();
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW }).total).toBe(2);
    expect(results.record(match("invalid", NOW, "win", "loss"))).toBe(true); // Rolled back, not poisoned.
  });

  it("links a demo only to the exact stored match, mode, map and recording time", () => {
    results.record(match("demo-match", NOW, "win", "loss"));
    expect(results.verifiedDemoAccounts("demo-match", "amphi", "wamphi1", NOW - 60_000)).toEqual(ids.slice(0, 2));
    expect(results.verifiedDemoAccounts("other", "amphi", "wamphi1", NOW - 60_000)).toEqual([]);
    expect(results.verifiedDemoAccounts("demo-match", "duel", "wamphi1", NOW - 60_000)).toEqual([]);
    expect(results.verifiedDemoAccounts("demo-match", "amphi", "wdm2", NOW - 60_000)).toEqual([]);
    expect(results.verifiedDemoAccounts("demo-match", "amphi", "wamphi1", NOW + 1)).toEqual([]);
  });

  it("accepts a spawned room's verified final report once and skips absent or bot-decided results", () => {
    const spawner = new GameServerSpawner();
    // A result belongs to an active room; standalone/dev servers cannot write ranks.
    const lobby = new LobbyServer(0, spawner, { players: accounts, results });
    // A running match carries both what room it belongs to and whether the roster
    // it started with was ranked (isRankedRoster); a result for either alone is
    // not a ranking.
    const running = lobby as unknown as {
      matchToLobby: Map<string, string>;
      matchRecords: Map<string, { ranked: boolean; private: boolean; bots: number }>;
    };
    const matches = running.matchToLobby;
    const report = finalReport({
      matchId: "room-result",
      gametype: "amphi",
      map: "wamphi1",
      endedAt: NOW,
      participants: [
        { tokenHash: "first", accountId: ids[0], outcome: "win" as const, score: 3 },
        { tokenHash: "second", accountId: ids[1], outcome: "loss" as const, score: 0 },
      ],
    });
    spawner.onServerResult?.(report);
    expect(results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW }).total).toBe(0);
    matches.set(report.matchId, "room-1");
    running.matchRecords.set(report.matchId, { ranked: true, private: false, bots: 0 });
    spawner.onServerResult?.({ ...report, participants: report.participants.map((p) => ({ ...p, outcome: "loss" })) });
    expect(results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW }).total).toBe(0);
    spawner.onServerResult?.(report);
    spawner.onServerResult?.(report);
    expect(results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW }).total).toBe(2);
  });

  it("keeps private bot wins and losses while rejecting an unranked public report", () => {
    const spawner = new GameServerSpawner();
    const lobby = new LobbyServer(0, spawner, { players: accounts, results });
    const running = lobby as unknown as {
      matchToLobby: Map<string, string>;
      matchRecords: Map<string, { ranked: boolean; private: boolean; bots: number }>;
    };
    for (const [index, outcome] of (["loss", "win", "draw"] as const).entries()) {
      const matchId = `private-bot-${index}`;
      running.matchToLobby.set(matchId, "private-room");
      running.matchRecords.set(matchId, { ranked: false, private: true, bots: 1 });
      const report = finalReport({
        matchId,
        gametype: "amphi",
        map: "wamphi1",
        endedAt: NOW,
        participants: [
          { tokenHash: "human", accountId: ids[0], outcome, score: outcome === "win" ? 3 : outcome === "loss" ? 0 : 1 },
          {
            tokenHash: "bot",
            accountId: null,
            outcome: outcome === "win" ? "loss" : outcome === "loss" ? "win" : "draw",
            score: outcome === "win" ? 0 : outcome === "loss" ? 3 : 1,
          },
        ],
      });
      spawner.onServerResult?.(report);
      spawner.onServerResult?.(report);
    }
    expect(board().total).toBe(0);
    expect(board("private").entries).toMatchObject([{ accountId: ids[0], wins: 1, losses: 1, draws: 1 }]);
    expect(results.ratings.statistics()).toMatchObject({ receipts: 3, seats: 6, ratings: 0 });
    expect(results.ratings.getResult("private-bot-0")?.receipt).toMatchObject({
      ratingStatus: "pending",
      ratingReason: "bot_reference_pending",
    });
    const publicId = "unranked-public";
    running.matchToLobby.set(publicId, "public-room");
    running.matchRecords.set(publicId, { ranked: false, private: false, bots: 0 });
    const publicMatch = match(publicId, NOW, "win", "loss");
    spawner.onServerResult?.(
      finalReport({
        ...publicMatch,
        participants: publicMatch.participants.map((player, index) => ({ ...player, tokenHash: `human-${index}` })),
      }),
    );
    expect(board("private").entries).toMatchObject([{ wins: 1, losses: 1, draws: 1 }]);
    spawner.onServerResultRejected?.("unverified");
    expect(lobby.getResultDiagnostics().runtime).toMatchObject({
      totals: { stored: 3, duplicate: 3, skipped: 1, rejected: 1, failed: 0 },
    });
    expect(lobby.getResultDiagnostics().runtime.recent.at(-2)).toMatchObject({
      reason: "public_roster_ineligible",
      scope: "public",
    });
    expect(lobby.getResultDiagnostics().runtime.recent.at(-1)).toMatchObject({
      reason: "verification_failed",
      status: "rejected",
    });
  });

  it("bounds ranking reads and derives the local rank from the authenticated account", () => {
    results.record(match("rank-read", NOW, "win", "loss"));
    const lobby = new LobbyServer(0, new GameServerSpawner(), { players: accounts, results });
    const sent: unknown[] = [];
    const player = {
      id: "reader",
      authenticated: true,
      accountId: ids[1],
      ws: { readyState: 1, send: (data: string) => sent.push(JSON.parse(data)) },
    };
    const handle = (lobby as unknown as { handleMessage: (p: typeof player, m: object) => void }).handleMessage.bind(
      lobby,
    );
    handle(player, {
      type: "leaderboard:get",
      requestId: "first",
      gametype: "amphi",
      period: "all",
      offset: 0,
      limit: 10,
      accountId: ids[0],
    });
    expect(sent.at(-1)).toMatchObject({
      type: "leaderboard:page",
      scope: "public",
      requestId: "first",
      total: 2,
      localPlayerRank: 2,
      localPlayerEntry: { playerId: String(ids[1]), rank: 2, wins: 0, losses: 1, draws: 0 },
      entries: [
        { playerId: String(ids[0]), rank: 1 },
        { playerId: String(ids[1]), rank: 2 },
      ],
    });
    results.record({ ...match("private-read", NOW, "loss", "win"), private: true });
    handle(player, {
      type: "leaderboard:get",
      requestId: "private",
      gametype: "amphi",
      period: "all",
      offset: 0,
      limit: 10,
      scope: "private",
    });
    expect(sent.at(-1)).toMatchObject({
      type: "leaderboard:page",
      scope: "private",
      localPlayerEntry: { playerId: String(ids[1]), wins: 1, losses: 0 },
    });
    handle(player, {
      type: "leaderboard:get",
      requestId: "bad_scope",
      gametype: "amphi",
      period: "all",
      offset: 0,
      limit: 10,
      scope: "combined",
    });
    expect(sent.at(-1)).toEqual({ type: "leaderboard:error", requestId: "bad_scope", reason: "invalid_query" });
    handle(player, {
      type: "leaderboard:get",
      requestId: "obsolete",
      gametype: "amphi",
      period: "all",
      offset: 0,
      limit: 10,
      includePrivate: true,
    });
    expect(sent.at(-1)).toEqual({ type: "leaderboard:error", requestId: "obsolete", reason: "invalid_query" });
    handle(player, {
      type: "leaderboard:get",
      requestId: "huge",
      gametype: "amphi",
      period: "all",
      offset: 0,
      limit: 101,
    });
    expect(sent.at(-1)).toEqual({ type: "leaderboard:error", requestId: "huge", reason: "invalid_query" });
    handle({ ...player, authenticated: false }, { type: "leaderboard:get", requestId: "unauth" });
    expect(sent.at(-1)).toEqual({ type: "lobby:error", error: "Not authenticated. Send auth message first." });
  });

  // Real lobby startup scans local demos and the socket must close cleanly;
  // this round trip can exceed Vitest's 10-second default on a populated install.
  it("serves an authenticated ranking page over a real lobby WebSocket", async () => {
    results.record(match("socket-read", NOW, "win", "loss"));
    const lobby = new LobbyServer(0, new GameServerSpawner(), { players: accounts, results });
    await lobby.start();
    const port = (lobby as unknown as { wss: { address(): { port: number } } }).wss.address().port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const receive = (type: string): Promise<Record<string, unknown>> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off("message", onMessage);
          reject(new Error(`Missing ${type}`));
        }, 3000);
        const onMessage = (data: WebSocket.RawData) => {
          const message = JSON.parse(data.toString());
          if (message.type !== type) return;
          clearTimeout(timer);
          socket.off("message", onMessage);
          resolve(message);
        };
        socket.on("message", onMessage);
      });
    try {
      await once(socket, "open");
      const unauth = receive("lobby:error");
      socket.send(
        JSON.stringify({
          type: "leaderboard:get",
          requestId: "before",
          gametype: "amphi",
          period: "all",
          offset: 0,
          limit: 10,
        }),
      );
      expect(await unauth).toMatchObject({ error: "Not authenticated. Send auth message first." });
      const welcome = receive("welcome");
      socket.send(JSON.stringify({ type: "auth" }));
      expect(await welcome).toMatchObject({ features: { leaderboard: true } });
      const page = receive("leaderboard:page");
      socket.send(
        JSON.stringify({
          type: "leaderboard:get",
          requestId: "ranking",
          gametype: "amphi",
          period: "all",
          offset: 0,
          limit: 10,
          accountId: ids[0],
        }),
      );
      const response = await page;
      expect(response).toMatchObject({ requestId: "ranking", total: 2 });
      expect((response.entries as Array<{ playerId: string; rank: number }>)[0]).toMatchObject({
        playerId: String(ids[0]),
        rank: 1,
      });
      expect(response.localPlayerRank).toBeUndefined(); // The forged accountId was ignored.
    } finally {
      socket.close();
      await lobby.stop();
    }
  }, 30_000);

  it("uses rolling 30 days, shared ranks, stable pages and current account names", () => {
    results.record(match("edge", NOW - 30 * DAY, "win", "loss"));
    results.record(match("reply", NOW - DAY, "loss", "win"));
    results.record(match("old", NOW - 30 * DAY - 1, "win", "loss"));
    results.record(match("future", NOW + 1, "win", "loss"));
    results.record({
      matchId: "draw",
      gametype: "amphi",
      map: "wda1",
      endedAt: NOW,
      participants: ids.map((accountId) => ({ accountId, outcome: "draw", score: 1 })),
    });
    accounts.rename(ids[0], "NewName");

    const month = results.leaderboard({
      gametype: "amphi",
      period: "month",
      offset: 1,
      limit: 1,
      accountId: ids[1],
      now: NOW,
    });
    expect(month.total).toBe(3);
    expect(month.entries).toMatchObject([{ rank: 1, accountId: ids[1], wins: 1, losses: 1, draws: 1 }]);
    expect(month.localPlayerRank).toBe(1);
    expect(month.localPlayerEntry).toMatchObject({
      accountId: ids[1],
      rank: 1,
      wins: 1,
      losses: 1,
      draws: 1,
    });
    expect(month.entries[0].accountId).toBe(ids[1]);
    const offPage = results.leaderboard({
      gametype: "amphi",
      period: "month",
      offset: 0,
      limit: 1,
      accountId: ids[1],
      now: NOW,
    });
    expect(offPage.entries[0].accountId).toBe(ids[0]);
    expect(offPage.localPlayerEntry).toMatchObject({ accountId: ids[1], rank: 1 }); // Shared rank, distinct row.
    const first = results.leaderboard({ gametype: "amphi", period: "month", offset: 0, limit: 1, now: NOW });
    expect(first.entries).toMatchObject([{ rank: 1, accountId: ids[0], name: "NewName" }]);
    const all = results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW });
    expect(all.entries[0]).toMatchObject({ accountId: ids[0], wins: 2 });
    expect(results.leaderboard({ gametype: "duel", period: "all", offset: 0, limit: 10, now: NOW })).toEqual({
      entries: [],
      total: 0,
    });
  });
});

import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";
import { MatchResultStore, type RecordedMatch } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12);

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
      rankedMatches: Map<string, boolean>;
    };
    const matches = running.matchToLobby;
    const report = {
      matchId: "room-result",
      gametype: "amphi",
      map: "wamphi1",
      endedAt: NOW,
      participants: [
        { tokenHash: "first", accountId: ids[0], outcome: "win" as const, score: 3 },
        { tokenHash: "second", accountId: ids[1], outcome: "loss" as const, score: 0 },
      ],
    };
    spawner.onServerResult?.(report);
    expect(results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW }).total).toBe(0);
    matches.set(report.matchId, "room-1");
    running.rankedMatches.set(report.matchId, true);
    spawner.onServerResult?.({ ...report, participants: report.participants.map((p) => ({ ...p, outcome: "loss" })) });
    expect(results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW }).total).toBe(0);
    spawner.onServerResult?.(report);
    spawner.onServerResult?.(report);
    expect(results.leaderboard({ gametype: "amphi", period: "all", offset: 0, limit: 10, now: NOW }).total).toBe(2);
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
      requestId: "first",
      total: 2,
      localPlayerRank: 2,
      localPlayerEntry: { playerId: String(ids[1]), rank: 2, wins: 0, losses: 1, draws: 0 },
      entries: [
        { playerId: String(ids[0]), rank: 1 },
        { playerId: String(ids[1]), rank: 2 },
      ],
    });
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

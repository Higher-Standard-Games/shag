import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { botReference } from "../../shared/ranking/__tests__/_botReference";
import type { RatingMode } from "../../shared/ranking/RatingPolicy";
import { botAccountName } from "../BotAccountStore";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import { canonicalSnapshot, type ResultSnapshot } from "../ResultSnapshot";

describe("private bot games rated through preset accounts", () => {
  let dir: string;
  let players: PlayerStore;
  let results: MatchResultStore;
  let sql: DatabaseSync;
  let ids: number[];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-bot-accounts-"));
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
      !path.basename(target).startsWith("shag-bot-accounts-")
    )
      throw new Error("Unsafe cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  });
  /** Humans on even seats, Medium bots on odd ones; the humans' side wins. */
  function match(mode: RatingMode = "duel", matchId = "bot-game"): ResultSnapshot {
    const count = mode === "snd" || mode === "ffa" ? 4 : 2;
    const ffa = mode === "ffa";
    const seats = Array.from({ length: count }, (_, i) => ({
      seatId: `seat-${i}`,
      accountId: i % 2 ? null : ids[i / 2],
      team: (ffa ? "ffa" : i < count / 2 ? "udon" : "soba") as "ffa" | "udon" | "soba",
      score: ffa ? count - i : i < count / 2 ? 3 : 0,
      outcome: (ffa ? i === 0 : i < count / 2) ? ("win" as const) : ("loss" as const),
      placement: ffa ? i + 1 : i < count / 2 ? 1 : 2,
      joinedAtTick: 10,
      leftAtTick: null,
      disconnected: false,
      forfeited: false,
      lateJoin: false,
      participationInterrupted: false,
      ...(i % 2 ? { botReference: botReference() } : {}),
    }));
    return canonicalSnapshot({
      version: 2,
      matchId,
      gametype: mode,
      map: "wdm2",
      scope: "private",
      bots: count / 2,
      botReferenceChanged: false,
      startedAt: 1000,
      endedAt: 2000,
      startedAtTick: 10,
      endedAtTick: 100,
      completion: "normal",
      teams: ffa
        ? []
        : [
            { id: "udon", score: 3, placement: 1 },
            { id: "soba", score: 0, placement: 2 },
          ],
      record: { status: "recorded", reason: "eligible" },
      seats: seats.map((p) => ({ ...p, teamsPlayed: [p.team] })),
      startingRoster: seats.map((p) => ({
        accountId: p.accountId,
        isBot: p.accountId === null,
        team: p.team,
        ...(p.botReference ? { botReference: p.botReference } : {}),
      })),
    });
  }
  const privateBoard = (mode: RatingMode = "duel", accountId?: number) =>
    results.skillLeaderboard({ gametype: mode, scope: "private", period: "all", offset: 0, limit: 10, accountId });

  it.each(["duel", "amphi", "snd", "ffa"] as const)("rates %s humans and the Medium account, and replays", (mode) => {
    const input = match(mode);
    expect(results.ratings.ingest(input)).toMatchObject({ ratingStatus: "applied", ratingReason: "eligible" });
    expect(results.ratings.ingest(input)).toMatchObject({ status: "duplicate", ratingStatus: "applied" });
    const bot = results.ratings.bots.get("medium");
    const humans = input.seats.flatMap((p) => (p.accountId === null ? [] : [p.accountId]));
    for (const id of [...humans, bot]) {
      expect(results.ratings.getRating(id, mode, "private")?.state.ratedMatches).toBe(1);
      expect(results.ratings.getRating(id, mode, "public")).toBeNull();
    }
    // The account's record is its first seat's.
    const seat = input.seats.find((p) => p.accountId === null)!;
    const row = privateBoard(mode).entries.find((e) => e.accountId === bot);
    expect(row?.name).toBe(botAccountName("medium"));
    expect(row?.bot).toBe(true);
    expect(
      privateBoard(mode)
        .entries.filter((e) => e.accountId !== bot)
        .every((e) => !e.bot),
    ).toBe(true);
    expect(row && (seat.outcome === "win" ? row.wins : row.losses)).toBe(1);
    results.close();
    results = MatchResultStore.open(dir);
    // A second Medium (S&D, FFA) plays fixed: only the first seat's account updates.
    expect(results.ratings.verifyReplay()).toEqual({
      consistent: true,
      matches: 1,
      updates: humans.length + 1,
      ratings: humans.length + 1,
    });
  });

  it("makes one keyless account per preset, named for it", () => {
    results.ratings.ingest(match("duel", "one"));
    results.ratings.ingest(match("duel", "two"));
    expect(results.ratings.bots.list()).toEqual([{ preset: "medium", accountId: results.ratings.bots.get("medium") }]);
    expect(sql.prepare("SELECT name FROM players WHERE id = ?").get(results.ratings.bots.get("medium"))?.name).toBe(
      "Bot · Medium",
    );
    expect(results.ratings.getRating(results.ratings.bots.get("medium"), "duel", "private")?.state.ratedMatches).toBe(
      2,
    );
  });

  it("rolls back every update, record and receipt if one update fails", () => {
    sql.exec(
      `CREATE TRIGGER fail_update BEFORE INSERT ON rating_updates WHEN NEW.account_id = ${ids[1]} BEGIN SELECT RAISE(ABORT, 'update-failure'); END`,
    );
    const input = match("snd");
    expect(() => results.ratings.ingest(input)).toThrow("update-failure");
    expect(results.ratings.statistics()).toMatchObject({ receipts: 0, seats: 0, ratings: 0, updates: 0 });
    expect(results.statistics().totalMatches).toBe(0);
    sql.exec("DROP TRIGGER fail_update");
    expect(results.ratings.ingest(input).ratingStatus).toBe("applied");
    expect(results.ratings.verifyReplay().updates).toBe(3);
  });

  it("excludes changed, missing and custom bots, keeping their records", () => {
    const changed = match("duel", "changed");
    changed.botReferenceChanged = true;
    expect(results.ratings.ingest(changed)).toMatchObject({
      ratingStatus: "excluded",
      ratingReason: "bot_reference_changed",
    });
    const absent = match("duel", "absent");
    delete absent.seats[1].botReference;
    for (const p of absent.startingRoster!) delete p.botReference;
    expect(results.ratings.ingest(absent)).toMatchObject({
      ratingStatus: "excluded",
      ratingReason: "bot_reference_missing",
    });
    const custom = match("duel", "custom");
    custom.seats[1].botReference!.preset = "custom";
    for (const p of custom.startingRoster!) if (p.botReference) p.botReference.preset = "custom";
    expect(results.ratings.ingest(custom)).toMatchObject({ ratingStatus: "excluded", ratingReason: "bot_custom" });
    expect(results.ratings.statistics().ratings).toBe(0);
    expect(results.leaderboard({ gametype: "duel", scope: "private", period: "all", offset: 0, limit: 10 }).total).toBe(
      2,
    );
  });

  it("rates the bot games a calibration-era store kept pending, on reopening", () => {
    results.ratings.ingest(match("duel", "waited"));
    // As schema 2 left it: the receipt pending, no ratings, no bot account.
    const medium = results.ratings.bots.get("medium");
    sql.exec("DELETE FROM rating_updates; DELETE FROM ratings");
    sql.prepare("DELETE FROM match_participants WHERE account_id = ?").run(medium);
    sql.exec(
      "UPDATE ranking_results SET rating_status = 'pending', rating_reason = 'bot_reference_pending', groups_json = NULL",
    );
    sql.exec("DROP TABLE bot_accounts");
    sql.prepare("DELETE FROM players WHERE id = ?").run(medium);
    sql.exec("UPDATE ranking_schema SET version = 2");
    sql.exec("CREATE TABLE bot_calibrations (id TEXT PRIMARY KEY)");
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.ratings.getResult("waited")?.receipt).toMatchObject({
      ratingStatus: "applied",
      ratingReason: "eligible",
    });
    const bot = results.ratings.bots.get("medium");
    expect(privateBoard("duel", ids[0])).toMatchObject({ total: 2, localPlayerEntry: { wins: 1, ratedMatches: 1 } });
    expect(privateBoard().entries.find((e) => e.accountId === bot)).toMatchObject({ losses: 1 });
    expect(results.ratings.verifyReplay()).toMatchObject({ consistent: true, matches: 1, updates: 2 });
    expect(sql.prepare("SELECT name FROM sqlite_master WHERE name = 'bot_calibrations'").get()).toBeUndefined();
  });

  it("fields the preset nearest the inviter's Private rating", () => {
    // No rating yet: Medium.
    expect(results.botPresetFor(ids[0], "duel")).toBe("medium");
    expect(results.botPresetFor(null, "duel")).toBe("medium");
    // Five wins over Medium push the human above it and Medium below: the
    // next bot is the one above Medium, in this mode only.
    for (const id of ["w1", "w2", "w3", "w4", "w5"]) results.ratings.ingest(match("duel", id));
    const human = results.ratings.getRating(ids[0], "duel", "private")!.state.mu;
    const medium = results.ratings.getRating(results.ratings.bots.get("medium"), "duel", "private")!.state.mu;
    expect(human).toBeGreaterThan(medium);
    expect(results.botPresetFor(ids[0], "duel")).toBe("hard");
    expect(results.botPresetFor(ids[0], "amphi")).toBe("medium");
    expect(results.botPresetFor(ids[0], "not-a-mode")).toBe("medium");
  });
});

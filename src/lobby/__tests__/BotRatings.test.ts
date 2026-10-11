import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { botCalibration } from "../../shared/ranking/__tests__/_botCalibration";
import { botReference } from "../../shared/ranking/__tests__/_botReference";
import { canonicalCalibration } from "../../shared/ranking/BotRatingReferences";
import type { RatingMode } from "../../shared/ranking/RatingPolicy";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import { canonicalSnapshot, type ResultSnapshot } from "../ResultSnapshot";

describe("transactional calibrated private bot ratings", () => {
  let dir: string;
  let players: PlayerStore;
  let results: MatchResultStore;
  let sql: DatabaseSync;
  let ids: number[];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-fixed-bots-"));
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
      !path.basename(target).startsWith("shag-fixed-bots-")
    )
      throw new Error("Unsafe cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  });
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
  it.each([
    "duel",
    "amphi",
    "snd",
    "ffa",
  ] as const)("applies %s only to private humans and replays with fixed references", (mode) => {
    const c = botCalibration(mode);
    expect(results.ratings.calibrations.register(c)).toBe("registered");
    const input = match(mode);
    expect(results.ratings.ingest(input)).toMatchObject({ ratingStatus: "applied", ratingReason: "eligible" });
    expect(results.ratings.ingest(input)).toMatchObject({ status: "duplicate", ratingStatus: "applied" });
    const humans = input.seats.filter((p) => p.accountId !== null);
    for (const p of humans) {
      expect(results.ratings.getRating(p.accountId!, mode, "private")?.state.ratedMatches).toBe(1);
      expect(results.ratings.getRating(p.accountId!, mode, "public")).toBeNull();
    }
    expect(results.ratings.calibrations.get(c.id)).toEqual(c);
    expect(results.ratings.statistics()).toMatchObject({
      calibrations: 1,
      ratings: humans.length,
      updates: humans.length,
    });
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.ratings.verifyReplay()).toEqual({
      consistent: true,
      matches: 1,
      updates: humans.length,
      ratings: humans.length,
    });
    const plan = JSON.parse(String(sql.prepare("SELECT groups_json FROM ranking_results").get()?.groups_json));
    expect(JSON.stringify(plan)).toContain(c.id);
    expect(JSON.stringify(plan)).toContain('"mu":10');
    expect(sql.prepare("SELECT COUNT(*) AS n FROM players").get()?.n).toBe(2);
  });
  it("keeps earlier pending receipts pending after registration, but applies new contests", () => {
    const input = match();
    expect(results.ratings.ingest(input).ratingStatus).toBe("pending");
    expect(
      results.skillLeaderboard({
        gametype: "duel",
        scope: "private",
        period: "all",
        offset: 0,
        limit: 10,
        accountId: ids[0],
      }),
    ).toMatchObject({
      entries: [],
      total: 0,
      localProcessing: { pending: 1, excluded: 0 },
    });
    results.ratings.calibrations.register(botCalibration());
    expect(results.ratings.ingest(input)).toMatchObject({ status: "duplicate", ratingStatus: "pending" });
    expect(results.ratings.ingest({ ...input, matchId: "new-game" }).ratingStatus).toBe("applied");
    expect(
      results.skillLeaderboard({
        gametype: "duel",
        scope: "private",
        period: "all",
        offset: 0,
        limit: 10,
        accountId: ids[0],
      }),
    ).toMatchObject({
      total: 1,
      localPlayerEntry: { ratedMatches: 1, provisional: true, wins: 2 },
      localProcessing: { pending: 1, excluded: 0 },
    });
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 1, updates: 1, ratings: 1 });
  });
  it("allows exact artifact retries and independent modes but refuses overwritten versions or strengths", () => {
    const c = botCalibration();
    results.ratings.calibrations.register(c);
    expect(results.ratings.calibrations.register(structuredClone(c))).toBe("duplicate");
    expect(() => results.ratings.calibrations.register({ ...c, mu: 11 })).toThrow("cannot be overwritten");
    expect(() => results.ratings.calibrations.register({ ...c, id: "revision", mu: 11 })).toThrow("new rating policy");
    expect(results.ratings.calibrations.register(botCalibration("snd"))).toBe("registered");
    expect(results.ratings.calibrations.get(c.id)).toEqual(c);
  });
  it("rolls back all human updates, records and receipt if the second human update fails", () => {
    results.ratings.calibrations.register(botCalibration("snd"));
    sql.exec(
      `CREATE TRIGGER fail_fixed_update BEFORE INSERT ON rating_updates WHEN NEW.account_id = ${ids[1]} BEGIN SELECT RAISE(ABORT, 'fixed-stage-failure'); END`,
    );
    const input = match("snd");
    expect(() => results.ratings.ingest(input)).toThrow("fixed-stage-failure");
    expect(results.ratings.statistics()).toMatchObject({
      receipts: 0,
      seats: 0,
      ratings: 0,
      updates: 0,
      calibrations: 1,
    });
    expect(results.statistics().totalMatches).toBe(0);
    sql.exec("DROP TRIGGER fail_fixed_update");
    expect(results.ratings.ingest(input).ratingStatus).toBe("applied");
    expect(results.ratings.verifyReplay().updates).toBe(2);
  });
  it("detects deleted or altered calibration states during replay", () => {
    const c = botCalibration();
    results.ratings.calibrations.register(c);
    results.ratings.ingest(match());
    sql
      .prepare("UPDATE bot_calibrations SET artifact = ? WHERE id = ?")
      .run(JSON.stringify(canonicalCalibration({ ...c, mu: 11 })), c.id);
    expect(() => results.ratings.verifyReplay()).toThrow("fixed references");
    sql.prepare("DELETE FROM bot_calibrations WHERE id = ?").run(c.id);
    expect(() => results.ratings.verifyReplay()).toThrow("fixed references");
  });
  it("keeps unpiloted maps, changed/missing identities and custom bots pending or excluded", () => {
    results.ratings.calibrations.register(botCalibration());
    const unknownMap = match("duel", "map");
    unknownMap.map = "other";
    expect(results.ratings.ingest(unknownMap).ratingStatus).toBe("pending");
    const changed = match("duel", "changed");
    changed.botReferenceChanged = true;
    expect(results.ratings.ingest(changed)).toMatchObject({
      ratingStatus: "excluded",
      ratingReason: "bot_reference_changed",
    });
    const absent = match("duel", "absent");
    delete absent.seats[1].botReference;
    expect(results.ratings.ingest(absent).ratingStatus).toBe("pending");
    const custom = match("duel", "custom");
    custom.seats[1].botReference!.preset = "custom";
    expect(results.ratings.ingest(custom).ratingStatus).toBe("pending");
    expect(results.ratings.statistics().ratings).toBe(0);
  });
});

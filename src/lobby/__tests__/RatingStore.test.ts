import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botReference } from "../../shared/ranking/__tests__/_botReference";
import { conservativeScore, initialRating, RATING_POLICY } from "../../shared/ranking/RatingPolicy";
import { rateMatch } from "../../shared/ranking/TrueSkillRating";
import { MatchResultStore } from "../MatchResultStore";
import { PlayerStore } from "../PlayerStore";
import { type AccountRatingGroup, RatingStore } from "../RatingStore";
import { canonicalSnapshot, type ResultSnapshot } from "../ResultSnapshot";

const NOW = Date.UTC(2026, 9, 11);

describe("fresh transactional rating journal", () => {
  let dir: string;
  let accounts: PlayerStore;
  let results: MatchResultStore;
  let sql: DatabaseSync;
  let ids: number[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-rating-journal-"));
    accounts = PlayerStore.open(dir);
    ids = Array.from({ length: 4 }, () => accounts.create().account.id);
    results = MatchResultStore.open(dir);
    sql = new DatabaseSync(path.join(dir, "players.db"));
    sql.exec("PRAGMA foreign_keys = ON");
  });
  afterEach(() => {
    sql.close();
    results.close();
    accounts.close();
    const target = path.resolve(dir);
    if (
      !target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) ||
      !path.basename(target).startsWith("shag-rating-journal-")
    )
      throw new Error("Refusing unexpected test cleanup target");
    fs.rmSync(target, { recursive: true, force: true });
  });

  function match(
    matchId = "first",
    mode: ResultSnapshot["gametype"] = "duel",
    scope: ResultSnapshot["scope"] = "public",
  ): ResultSnapshot {
    const ffa = mode === "ffa";
    return {
      version: 2,
      matchId,
      gametype: mode,
      map: "wdm2",
      scope,
      bots: 0,
      startedAt: NOW - 1000,
      endedAt: NOW,
      startedAtTick: 10,
      endedAtTick: 100,
      completion: "normal",
      teams: ffa
        ? []
        : [
            { id: "udon", score: 3, placement: 1 },
            { id: "soba", score: 0, placement: 2 },
          ],
      startingRoster: ids
        .slice(0, 2)
        .map((accountId, i) => ({ accountId, isBot: false, team: ffa ? "ffa" : i === 0 ? "udon" : "soba" })),
      seats: ids.slice(0, 2).map((accountId, i) => ({
        seatId: `seat-${accountId}`,
        accountId,
        outcome: i === 0 ? "win" : "loss",
        score: i === 0 ? 3 : 0,
        team: ffa ? "ffa" : i === 0 ? "udon" : "soba",
        teamsPlayed: [ffa ? "ffa" : i === 0 ? "udon" : "soba"],
        placement: i + 1,
        joinedAtTick: 10,
        leftAtTick: null,
        disconnected: false,
        forfeited: false,
        lateJoin: false,
        participationInterrupted: false,
      })),
      record: { status: "recorded", reason: "eligible" },
    };
  }
  function groups(): AccountRatingGroup[] {
    return [
      { rank: 1, accountIds: [ids[0]] },
      { rank: 2, accountIds: [ids[1]] },
    ];
  }

  it("retains trusted bot identity and changed-reference exclusions across reopen and duplicate delivery", () => {
    const snapshot = match("changed-bot", "duel", "private");
    snapshot.bots = 1;
    snapshot.botReferenceChanged = true;
    Object.assign(snapshot.startingRoster![1], { accountId: null, isBot: true, botReference: botReference() });
    Object.assign(snapshot.seats[1], { accountId: null, botReference: botReference() });
    expect(results.ratings.ingest(snapshot)).toMatchObject({
      recordStatus: "recorded",
      ratingStatus: "excluded",
      ratingReason: "bot_reference_changed",
    });
    results.close();
    results = MatchResultStore.open(dir);
    expect(results.ratings.getResult(snapshot.matchId)?.snapshot).toEqual(canonicalSnapshot(snapshot));
    expect(results.ratings.ingest(snapshot)).toMatchObject({
      status: "duplicate",
      ratingReason: "bot_reference_changed",
    });
    expect(results.ratings.statistics()).toMatchObject({ ratings: 0, updates: 0 });
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 0, updates: 0, ratings: 0 });
    // The human's record (a record needs no rating); the Medium account's is kept but not listed.
    expect(results.leaderboard({ gametype: "duel", scope: "private", period: "all", offset: 0, limit: 10 }).total).toBe(
      1,
    );
  });
  const tableCount = (table: string) => Number(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
  const board = (scope: "public" | "private" = "public") =>
    results.leaderboard({ gametype: "duel", scope, period: "all", offset: 0, limit: 10, now: NOW });
  function reopen() {
    results.close();
    results = MatchResultStore.open(dir);
  }

  it("initializes empty tables and pins a separate ranking schema/policy without changing account user_version", () => {
    expect(sql.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(sql.prepare("SELECT version FROM ranking_schema WHERE id = 1").get()?.version).toBe(3);
    expect(JSON.parse(String(sql.prepare("SELECT parameters FROM ranking_policies").get()?.parameters))).toEqual(
      RATING_POLICY,
    );
    expect(results.ratings.statistics()).toMatchObject({ receipts: 0, seats: 0, ratings: 0, updates: 0 });
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 0, updates: 0, ratings: 0 });
  });

  it("atomically stores a complete snapshot, seat rows, records, skill states and before/after journal", () => {
    const input = match();
    const receipt = results.ratings.ingest(input, { status: "applied", groups: groups() });
    expect(receipt).toMatchObject({ status: "stored", sequence: 1, recordStatus: "recorded", ratingStatus: "applied" });
    expect(results.ratings.getResult(input.matchId)?.snapshot).toEqual(canonicalSnapshot(input));
    expect([
      tableCount("ranking_seats"),
      tableCount("match_participants"),
      tableCount("ratings"),
      tableCount("rating_updates"),
    ]).toEqual([2, 2, 2, 2]);
    const expected = rateMatch(
      "duel",
      groups().map((g) => ({
        rank: g.rank,
        players: g.accountIds.map((id) => ({ playerId: String(id), state: initialRating() })),
      })),
    );
    for (const update of expected) {
      expect(results.ratings.getRating(Number(update.playerId), "duel", "public")).toMatchObject({
        state: update.after,
        lastSequence: 1,
      });
      expect(
        sql
          .prepare(
            "SELECT before_mu, before_sigma, before_matches, after_mu, after_sigma, after_matches, before_score, after_score FROM rating_updates WHERE account_id = ?",
          )
          .get(Number(update.playerId)),
      ).toEqual({
        before_mu: 25,
        before_sigma: 25 / 3,
        before_matches: 0,
        after_mu: update.after.mu,
        after_sigma: update.after.sigma,
        after_matches: 1,
        before_score: 0,
        after_score: conservativeScore(update.after),
      });
    }
    expect(board().entries).toMatchObject([
      { accountId: ids[0], wins: 1 },
      { accountId: ids[1], losses: 1 },
    ]);
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 1, updates: 2, ratings: 2 });
  });

  it("treats reordered copies as duplicates, before and after reopening", () => {
    const input = match();
    const first = results.ratings.ingest(input, { status: "applied", groups: groups() });
    const copy = structuredClone(input);
    copy.seats.reverse();
    copy.teams.reverse();
    copy.startingRoster!.reverse();
    expect(results.ratings.ingest(copy, { status: "applied", groups: groups().reverse() })).toEqual({
      ...first,
      status: "duplicate",
    });
    reopen();
    expect(results.ratings.ingest(copy)).toEqual({ ...first, status: "duplicate" });
    expect(results.ratings.ingest(match("second"), { status: "applied", groups: groups() }).sequence).toBe(2);
    expect(results.ratings.getRating(ids[0], "duel", "public")?.state.ratedMatches).toBe(2);
    expect(results.ratings.verifyReplay().updates).toBe(4);
  });

  it.each(["scope", "map", "roster", "time"])(
    "rejects changed %s under the same match ID without overwriting history",
    (field) => {
      const input = match();
      results.ratings.ingest(input, { status: "applied", groups: groups() });
      const copy = structuredClone(input);
      if (field === "scope") copy.scope = "private";
      if (field === "map") copy.map = "wdm12";
      if (field === "roster") {
        copy.seats[0].accountId = ids[2];
        copy.startingRoster![0].accountId = ids[2];
      }
      if (field === "time") copy.endedAt++;
      expect(() => results.ratings.ingest(copy)).toThrow("Conflicting result");
      expect(results.ratings.getResult(input.matchId)?.snapshot).toEqual(canonicalSnapshot(input));
      expect(results.ratings.verifyReplay().matches).toBe(1);
    },
  );

  it.each(["ranking_seats", "match_participants", "ratings", "rating_updates"])(
    "rolls every table back on a mid-transaction %s failure",
    (table) => {
      // Failing the second insert ensures the first row really was written before failure.
      sql.exec(
        `CREATE TRIGGER inject_failure BEFORE INSERT ON ${table} WHEN NEW.account_id = ${ids[1]} BEGIN SELECT RAISE(ABORT, 'injected SQL failure'); END`,
      );
      expect(() => results.ratings.ingest(match(), { status: "applied", groups: groups() })).toThrow(
        "injected SQL failure",
      );
      for (const table of [
        "ranking_results",
        "ranking_seats",
        "matches",
        "match_participants",
        "ratings",
        "rating_updates",
      ])
        expect(tableCount(table)).toBe(0);
      sql.exec("DROP TRIGGER inject_failure");
      reopen();
      expect(results.ratings.ingest(match(), { status: "applied", groups: groups() }).sequence).toBe(1);
      expect(results.ratings.verifyReplay().matches).toBe(1);
    },
  );

  it("rolls back an unknown account and accepts a corrected retry", () => {
    const input = match();
    input.seats[1].accountId = 987654;
    input.startingRoster![1].accountId = 987654;
    expect(() => results.ratings.ingest(input)).toThrow("FOREIGN KEY constraint failed");
    expect(tableCount("ranking_results")).toBe(0);
    expect(results.ratings.ingest(match()).status).toBe("stored");
  });

  it("keeps existing ratings unchanged if a later match transaction fails", () => {
    results.ratings.ingest(match(), { status: "applied", groups: groups() });
    const before = results.ratings.getRating(ids[0], "duel", "public");
    sql.exec(
      `CREATE TRIGGER inject_failure BEFORE INSERT ON rating_updates WHEN NEW.account_id = ${ids[1]} BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    );
    expect(() => results.ratings.ingest(match("failed"), { status: "applied", groups: groups() })).toThrow("injected");
    expect(results.ratings.getRating(ids[0], "duel", "public")).toEqual(before);
    expect(results.ratings.getResult("failed")).toBeNull();
    expect(board().entries[0].wins).toBe(1);
    expect(results.ratings.verifyReplay().matches).toBe(1);
  });

  it("recovers committed state after an isolated child dies with uncommitted writes", () => {
    results.ratings.ingest(match(), { status: "applied", groups: groups() });
    const before = results.ratings.getRating(ids[0], "duel", "public");
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import { DatabaseSync } from 'node:sqlite';
      import { writeSync } from 'node:fs';
      const db = new DatabaseSync(process.argv[1]);
      db.exec("BEGIN IMMEDIATE; UPDATE ratings SET mu = mu + 100; DELETE FROM rating_updates;");
      writeSync(1, 'uncommitted-writes-complete');
      process.kill(process.pid, 'SIGKILL');
    `,
        path.join(dir, "players.db"),
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.stdout).toContain("uncommitted-writes-complete");
    expect(child.status).not.toBe(0);
    reopen();
    expect(results.ratings.getRating(ids[0], "duel", "public")).toEqual(before);
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 1, updates: 2, ratings: 2 });
    expect(results.ratings.ingest(match()).status).toBe("duplicate");
  });

  it("audits one consistent read snapshot while another WAL connection commits a match", () => {
    results.ratings.ingest(match(), { status: "applied", groups: groups() });
    const writer = MatchResultStore.open(dir);
    const readerDb = (results as unknown as { db: DatabaseSync }).db;
    const prepare = readerDb.prepare.bind(readerDb);
    let committed = false;
    const spy = vi.spyOn(readerDb, "prepare").mockImplementation((query) => {
      if (query === "SELECT * FROM ranking_results ORDER BY sequence" && !committed) {
        committed = true;
        writer.ratings.ingest(match("concurrent"), { status: "applied", groups: groups() });
      }
      return prepare(query);
    });
    try {
      expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 1, updates: 2, ratings: 2 });
    } finally {
      spy.mockRestore();
      writer.close();
    }
    expect(committed).toBe(true);
    expect(results.ratings.getRating(ids[0], "duel", "public")?.state.ratedMatches).toBe(2);
    expect(results.ratings.verifyReplay().matches).toBe(2);
  });

  it("uses ingestion order, not result end time, when a late result arrives", () => {
    const newer = match("newer");
    newer.endedAt += 1000;
    const older = match("older");
    older.teams = [
      { id: "udon", score: 0, placement: 2 },
      { id: "soba", score: 3, placement: 1 },
    ];
    older.seats[0].score = 0;
    older.seats[0].placement = 2;
    older.seats[0].outcome = "loss";
    older.seats[1].score = 3;
    older.seats[1].placement = 1;
    older.seats[1].outcome = "win";
    const first = results.ratings.ingest(newer, { status: "applied", groups: groups() });
    const second = results.ratings.ingest(older, {
      status: "applied",
      groups: [
        { rank: 1, accountIds: [ids[1]] },
        { rank: 2, accountIds: [ids[0]] },
      ],
    });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    const state = results.ratings.getRating(ids[0], "duel", "public")!;
    expect(state.lastSequence).toBe(2);
    expect(state.endedAt).toBe(NOW);
    reopen();
    expect(results.ratings.verifyReplay().matches).toBe(2);
  });

  it("isolates both scopes and all four gametypes", () => {
    for (const mode of ["duel", "amphi", "ffa", "snd"] as const)
      for (const scope of ["public", "private"] as const) {
        results.ratings.ingest(match(`${mode}-${scope}`, mode, scope), { status: "applied", groups: groups() });
      }
    results.ratings.ingest(match("extra-private", "duel", "private"), { status: "applied", groups: groups() });
    for (const mode of ["duel", "amphi", "ffa", "snd"] as const)
      for (const scope of ["public", "private"] as const) {
        expect(results.ratings.getRating(ids[0], mode, scope)?.state.ratedMatches).toBe(
          mode === "duel" && scope === "private" ? 2 : 1,
        );
      }
    expect(results.ratings.getRating(ids[2], "duel", "private")).toBeNull();
    reopen();
    expect(results.ratings.verifyReplay()).toEqual({ consistent: true, matches: 9, updates: 18, ratings: 16 });
  });

  it("retains an excluded human receipt without inventing skill, and duplicates cannot activate it", () => {
    const receipt = results.ratings.ingest(match(), { status: "excluded", reason: "mode_adapter_pending" });
    expect(receipt).toMatchObject({ ratingStatus: "excluded", ratingReason: "mode_adapter_pending" });
    expect(board().total).toBe(2);
    expect(results.ratings.ingest(match(), { status: "applied", groups: groups() })).toMatchObject({
      status: "duplicate",
      ratingStatus: "excluded",
    });
    expect(tableCount("ratings")).toBe(0);
    expect(results.ratings.verifyReplay().matches).toBe(0);
  });

  it("rates a private bot game against the bot's preset account, keeping the seat's snapshot", () => {
    const input = match("bot", "duel", "private");
    input.bots = 1;
    input.botReferenceChanged = false;
    input.seats[0].accountId = null;
    input.seats[0].botReference = botReference();
    input.startingRoster![0] = { accountId: null, isBot: true, team: "udon", botReference: botReference() };
    expect(results.ratings.ingest(input)).toMatchObject({ ratingStatus: "applied", ratingReason: "eligible" });
    expect(results.ratings.getResult("bot")?.snapshot.seats[0].accountId).toBeNull();
    const bot = results.ratings.bots.get("medium");
    expect(results.ratings.getRating(bot, "duel", "private")?.state.ratedMatches).toBe(1);
    // Rated, but the board lists people only
    expect(board("private").entries.map((e) => e.accountId)).toEqual([ids[1]]);
    expect(results.ratings.verifyReplay()).toMatchObject({ consistent: true, matches: 1, updates: 2 });
  });

  it.each(["aborted", "public_roster_ineligible", "too_few_accounts"] as const)(
    "persists excluded %s receipts with no fabricated record or skill",
    (reason) => {
      const input = match();
      input.record = { status: "excluded", reason };
      if (reason === "aborted") {
        input.completion = "aborted";
        for (const s of input.seats) {
          s.placement = null;
          s.outcome = null;
        }
        for (const t of input.teams) t.placement = null;
      }
      expect(results.ratings.ingest(input)).toMatchObject({
        recordStatus: "excluded",
        recordReason: reason,
        ratingStatus: "excluded",
        ratingReason: reason,
      });
      expect(results.ratings.getResult(input.matchId)?.snapshot.completion).toBe(input.completion);
      expect(results.ratings.ingest(input).status).toBe("duplicate");
      expect([
        tableCount("ranking_results"),
        tableCount("ranking_seats"),
        tableCount("matches"),
        tableCount("ratings"),
      ]).toEqual([1, 2, 0, 0]);
      input.matchId = "illegal-application";
      expect(() => results.ratings.ingest(input, { status: "applied", groups: groups() })).toThrow("Excluded records");
    },
  );

  it.each(["missing", "duplicate", "unknown", "one_group", "empty", "bad_rank", "wrong_standings"])(
    "rejects %s rating groups without a partial receipt",
    (kind) => {
      const plan = groups();
      if (kind === "missing") plan[1].accountIds = [];
      if (kind === "duplicate") plan[1].accountIds = [ids[0], ids[1]];
      if (kind === "unknown") plan[1].accountIds = [ids[2]];
      if (kind === "one_group") {
        plan[0].accountIds.push(ids[1]);
        plan.pop();
      }
      if (kind === "empty") plan.push({ rank: 2, accountIds: [] });
      if (kind === "bad_rank") plan[1].rank = Number.NaN;
      if (kind === "wrong_standings") {
        plan[0].rank = 2;
        plan[1].rank = 1;
      }
      expect(() => results.ratings.ingest(match(), { status: "applied", groups: plan })).toThrow();
      expect(tableCount("ranking_results")).toBe(0);
      expect(tableCount("matches")).toBe(0);
    },
  );

  it("fails numerical underflow before storing any part of a new result", () => {
    results.ratings.ingest(match(), { status: "applied", groups: groups() });
    sql.prepare("UPDATE ratings SET mu = ?, sigma = 0.01 WHERE account_id = ?").run(-1000, ids[0]);
    sql.prepare("UPDATE ratings SET mu = ?, sigma = 0.01 WHERE account_id = ?").run(1000, ids[1]);
    expect(() => results.ratings.ingest(match("underflow"), { status: "applied", groups: groups() })).toThrow(
      "TrueSkill calculation failed",
    );
    expect(results.ratings.getResult("underflow")).toBeNull();
    expect(tableCount("matches")).toBe(1);
  });

  it.each(["journal", "state", "snapshot", "missing_journal", "policy", "seat", "record"])(
    "detects %s corruption during read-only replay",
    (kind) => {
      results.ratings.ingest(match(), { status: "applied", groups: groups() });
      if (kind === "journal") sql.exec("UPDATE rating_updates SET after_mu = after_mu + 1");
      if (kind === "state") sql.exec("UPDATE ratings SET mu = mu + 1");
      if (kind === "snapshot") sql.exec("UPDATE ranking_results SET snapshot = '{}' ");
      if (kind === "missing_journal") sql.prepare("DELETE FROM rating_updates WHERE account_id = ?").run(ids[0]);
      if (kind === "policy") sql.exec("UPDATE ranking_policies SET parameters = '{}'");
      if (kind === "seat") sql.exec("UPDATE ranking_seats SET score = score + 1");
      if (kind === "record") sql.exec("UPDATE match_participants SET score = score + 1");
      expect(() => results.ratings.verifyReplay()).toThrow();
      expect(tableCount("ranking_results")).toBe(1);
    },
  );

  it("does not upgrade an incompatible schema or overwrite a changed policy", () => {
    sql.exec("UPDATE ranking_schema SET version = 99");
    expect(() => new RatingStore(sql)).toThrow("Unsupported or incomplete ranking schema");
    expect(RatingStore.inspect(dir)).toMatchObject({ status: "unsupported_schema", version: 99 });
    sql.exec("UPDATE ranking_schema SET version = 1; UPDATE ranking_policies SET parameters = '{}'");
    expect(() => new RatingStore(sql)).toThrow("Stored rating policy differs");
    expect(sql.prepare("SELECT parameters FROM ranking_policies").get()?.parameters).toBe("{}");
  });

  it("never backfills old W/L/D rows into the fresh rating journal", () => {
    results.record({
      matchId: "old",
      gametype: "duel",
      map: "wdm2",
      endedAt: NOW,
      participants: [
        { accountId: ids[0], outcome: "win", score: 3 },
        { accountId: ids[1], outcome: "loss", score: 0 },
      ],
    });
    reopen();
    expect(board().total).toBe(2);
    expect(results.ratings.statistics()).toMatchObject({ receipts: 0, ratings: 0, updates: 0 });
    expect(results.ratings.verifyReplay().matches).toBe(0);
    expect(() => results.ratings.ingest(match("old"))).toThrow("historical import is unsupported");
    expect(tableCount("ranking_results")).toBe(0);
  });

  it("inspects and verifies read-only without changing the database", () => {
    results.ratings.ingest(match(), { status: "applied", groups: groups() });
    const before = sql.prepare("SELECT * FROM ranking_results").all();
    expect(RatingStore.inspect(dir, true)).toMatchObject({
      status: "ready",
      version: 3,
      receipts: 1,
      ratings: 2,
      updates: 2,
      replay: { consistent: true, matches: 1, updates: 2, ratings: 2 },
    });
    expect(sql.prepare("SELECT * FROM ranking_results").all()).toEqual(before);
    const missing = path.join(dir, "absent");
    expect(RatingStore.inspect(missing)).toMatchObject({ status: "missing_database" });
    expect(fs.existsSync(missing)).toBe(false);
    const old = path.join(dir, "account-only");
    fs.mkdirSync(old);
    const legacy = PlayerStore.open(old);
    legacy.close();
    const file = path.join(old, "players.db");
    const hash = createHash("sha256")
      .update(new Uint8Array(fs.readFileSync(file)))
      .digest("hex");
    expect(RatingStore.inspect(old)).toMatchObject({ status: "schema_unavailable" });
    expect(
      createHash("sha256")
        .update(new Uint8Array(fs.readFileSync(file)))
        .digest("hex"),
    ).toBe(hash);
  });
});

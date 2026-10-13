/** Node-only ranking journal. Its owner supplies the SAME connection as record storage. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type BotAccountRatingGroup,
  type BotPreset,
  botAccountSeats,
  botMatchRatingGroups,
} from "../shared/ranking/BotMatchRatingGroups";
import { rateWithFixedReferences } from "../shared/ranking/FixedReferenceRating";
import {
  conservativeScore,
  initialRating,
  RATING_POLICY,
  type RatingMode,
  type RatingState,
} from "../shared/ranking/RatingPolicy";
import type { RatingUpdate } from "../shared/ranking/TrueSkillRating";
import { BotAccountStore } from "./BotAccountStore";
import { canonicalSnapshot, type RecordExclusionReason, type ResultSnapshot } from "./ResultSnapshot";
import type { RankingScope } from "./types";

const SCHEMA_VERSION = 3;

export type { AccountRatingGroup } from "../shared/ranking/MatchRatingGroups";
export type RatingDecision =
  | { status: "excluded"; reason: string }
  | { status: "applied"; groups: BotAccountRatingGroup[] };
export interface ResultReceipt {
  status: "stored" | "duplicate";
  sequence: number;
  recordStatus: "recorded" | "excluded";
  recordReason: "eligible" | RecordExclusionReason;
  ratingStatus: "pending" | "excluded" | "applied";
  ratingReason: string;
}
export interface StoredRating {
  accountId: number;
  gametype: RatingMode;
  scope: RankingScope;
  state: RatingState;
  lastSequence: number;
  endedAt: number;
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function stateOf(row: Record<string, unknown>, prefix = ""): RatingState {
  return {
    policyVersion: String(row.policy_version),
    mu: Number(row[`${prefix}mu`]),
    sigma: Number(row[`${prefix}sigma`]),
    ratedMatches: Number(row[`${prefix}matches`]),
  };
}
function ratingOf(row: Record<string, unknown>): StoredRating {
  return {
    accountId: Number(row.account_id),
    gametype: String(row.gametype) as RatingMode,
    scope: String(row.scope) as RankingScope,
    state: stateOf(row),
    lastSequence: Number(row.last_sequence),
    endedAt: Number(row.ended_at),
  };
}
function receiptOf(row: Record<string, unknown>, status: ResultReceipt["status"]): ResultReceipt {
  return {
    status,
    sequence: Number(row.sequence),
    recordStatus: row.record_status as ResultReceipt["recordStatus"],
    recordReason: row.record_reason as ResultReceipt["recordReason"],
    ratingStatus: row.rating_status as ResultReceipt["ratingStatus"],
    ratingReason: String(row.rating_reason),
  };
}

export class RatingStore {
  readonly bots: BotAccountStore;
  constructor(
    private readonly db: DatabaseSync,
    initialize = true,
  ) {
    this.bots = new BotAccountStore(db);
    if (initialize) this.initialize();
  }

  private initialize(): void {
    const existing = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ranking_schema', 'ranking_results', 'ranking_seats', 'ranking_policies', 'ratings', 'rating_updates')",
      )
      .all();
    let previous = SCHEMA_VERSION;
    if (existing.length > 0) {
      previous = Number(this.db.prepare("SELECT version FROM ranking_schema WHERE id = 1").get()?.version);
      if (
        !existing.some((row) => row.name === "ranking_schema") ||
        ![1, 2, SCHEMA_VERSION].includes(previous) ||
        existing.length !== 6
      ) {
        throw new Error("Unsupported or incomplete ranking schema; no automatic reset or legacy import");
      }
      if (previous >= 2 && !this.db.prepare("SELECT name FROM sqlite_master WHERE name = 'ranking_stats'").get())
        throw new Error("Incomplete ranking stats schema");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ranking_schema (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS ranking_policies (version TEXT PRIMARY KEY, parameters TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ranking_results (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL UNIQUE,
          scope TEXT NOT NULL CHECK(scope IN ('public', 'private')),
          gametype TEXT NOT NULL CHECK(gametype IN ('duel', 'amphi', 'ffa', 'snd')),
          ended_at INTEGER NOT NULL, snapshot TEXT NOT NULL, digest TEXT NOT NULL,
          policy_version TEXT NOT NULL REFERENCES ranking_policies(version),
          record_status TEXT NOT NULL CHECK(record_status IN ('recorded', 'excluded')), record_reason TEXT NOT NULL,
          rating_status TEXT NOT NULL CHECK(rating_status IN ('pending', 'excluded', 'applied')), rating_reason TEXT NOT NULL,
          groups_json TEXT
        );
        CREATE TABLE IF NOT EXISTS ranking_seats (
          sequence INTEGER NOT NULL REFERENCES ranking_results(sequence), seat_id TEXT NOT NULL,
          account_id INTEGER REFERENCES players(id), team TEXT NOT NULL,
          teams_played TEXT NOT NULL, score INTEGER NOT NULL,
          outcome TEXT CHECK(outcome IN ('win', 'loss', 'draw')), placement INTEGER,
          joined_at_tick INTEGER NOT NULL, left_at_tick INTEGER, disconnected INTEGER NOT NULL,
          forfeited INTEGER NOT NULL, late_join INTEGER NOT NULL, PRIMARY KEY(sequence, seat_id), UNIQUE(sequence, account_id)
        );
        CREATE TABLE IF NOT EXISTS ratings (
          account_id INTEGER NOT NULL REFERENCES players(id), gametype TEXT NOT NULL, scope TEXT NOT NULL,
          policy_version TEXT NOT NULL REFERENCES ranking_policies(version), mu REAL NOT NULL, sigma REAL NOT NULL CHECK(sigma > 0),
          matches INTEGER NOT NULL CHECK(matches > 0), last_sequence INTEGER NOT NULL REFERENCES ranking_results(sequence),
          ended_at INTEGER NOT NULL, PRIMARY KEY(account_id, gametype, scope, policy_version)
        );
        CREATE TABLE IF NOT EXISTS rating_updates (
          sequence INTEGER NOT NULL REFERENCES ranking_results(sequence), account_id INTEGER NOT NULL REFERENCES players(id),
          gametype TEXT NOT NULL, scope TEXT NOT NULL, policy_version TEXT NOT NULL REFERENCES ranking_policies(version),
          before_mu REAL NOT NULL, before_sigma REAL NOT NULL, before_matches INTEGER NOT NULL,
          after_mu REAL NOT NULL, after_sigma REAL NOT NULL, after_matches INTEGER NOT NULL,
          before_score REAL NOT NULL, after_score REAL NOT NULL, PRIMARY KEY(sequence, account_id, policy_version)
        );
        CREATE INDEX IF NOT EXISTS ranking_results_pool ON ranking_results(gametype, scope, sequence);
        CREATE INDEX IF NOT EXISTS rating_updates_pool ON rating_updates(gametype, scope, policy_version, sequence);
        CREATE INDEX IF NOT EXISTS ratings_pool ON ratings(gametype, scope, policy_version);
        CREATE INDEX IF NOT EXISTS ranking_seats_account_sequence ON ranking_seats(account_id, sequence);
        CREATE INDEX IF NOT EXISTS rating_updates_account_pool ON rating_updates(account_id, gametype, scope, policy_version, sequence);
        CREATE TABLE IF NOT EXISTS ranking_stats (
          sequence INTEGER NOT NULL, seat_id TEXT NOT NULL, stats TEXT NOT NULL,
          PRIMARY KEY(sequence, seat_id),
          FOREIGN KEY(sequence, seat_id) REFERENCES ranking_seats(sequence, seat_id)
        );
      `);
      this.db.prepare("INSERT OR IGNORE INTO ranking_schema (id, version) VALUES (1, ?)").run(SCHEMA_VERSION);
      this.db.prepare("UPDATE ranking_schema SET version = ? WHERE id = 1").run(SCHEMA_VERSION);
      const parameters = JSON.stringify(RATING_POLICY);
      this.db
        .prepare("INSERT OR IGNORE INTO ranking_policies (version, parameters) VALUES (?, ?)")
        .run(RATING_POLICY.version, parameters);
      if (
        this.db.prepare("SELECT parameters FROM ranking_policies WHERE version = ?").get(RATING_POLICY.version)
          ?.parameters !== parameters
      )
        throw new Error("Stored rating policy differs from the pinned implementation");
      this.bots.initialize();
      // Schema 3 rates private bot games through preset accounts, where
      // schema 2 waited for calibrated references: rate every result again.
      if (previous < 3) this.rerate();
      this.db.exec("DROP TABLE IF EXISTS bot_calibrations");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Read-only operational inspection: never initializes, resets or backfills storage. */
  static inspect(dataDir: string, verify = false) {
    const file = path.join(dataDir, "players.db");
    if (!existsSync(file)) return { status: "missing_database" as const, file };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec("BEGIN");
      if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'ranking_schema'").get())
        return { status: "schema_unavailable" as const, file };
      const version = Number(db.prepare("SELECT version FROM ranking_schema WHERE id = 1").get()?.version);
      if (version !== SCHEMA_VERSION) return { status: "unsupported_schema" as const, file, version };
      const store = new RatingStore(db, false);
      return {
        status: "ready" as const,
        file,
        version,
        ...store.statistics(),
        ...(verify ? { replay: store.replay() } : {}),
      };
    } finally {
      db.close();
    }
  }

  statistics() {
    const count = (table: string) => Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
    const latest = this.db
      .prepare(
        "SELECT sequence, match_id, scope, gametype, record_status, record_reason, rating_status, rating_reason FROM ranking_results ORDER BY sequence DESC LIMIT 1",
      )
      .get();
    return {
      policyVersion: RATING_POLICY.version,
      botAccounts: this.bots.list().length,
      receipts: count("ranking_results"),
      seats: count("ranking_seats"),
      ratings: count("ratings"),
      updates: count("rating_updates"),
      processing: this.db
        .prepare(
          "SELECT scope, gametype, record_status, rating_status, rating_reason, COUNT(*) AS matches FROM ranking_results GROUP BY scope, gametype, record_status, rating_status, rating_reason ORDER BY scope, gametype, rating_status, rating_reason",
        )
        .all(),
      latest: latest
        ? {
            matchId: String(latest.match_id),
            scope: String(latest.scope),
            gametype: String(latest.gametype),
            ...receiptOf(latest, "stored"),
          }
        : null,
    };
  }

  getRating(accountId: number, gametype: RatingMode, scope: RankingScope): StoredRating | null {
    const row = this.db
      .prepare("SELECT * FROM ratings WHERE account_id = ? AND gametype = ? AND scope = ? AND policy_version = ?")
      .get(accountId, gametype, scope, RATING_POLICY.version);
    return row ? ratingOf(row) : null;
  }

  getResult(matchId: string) {
    const row = this.db.prepare("SELECT * FROM ranking_results WHERE match_id = ?").get(matchId);
    if (!row) return null;
    return { receipt: receiptOf(row, "stored"), snapshot: this.readSnapshot(row) };
  }

  private readSnapshot(row: Record<string, unknown>): ResultSnapshot {
    const snapshot = canonicalSnapshot(JSON.parse(String(row.snapshot)) as ResultSnapshot);
    if (
      digest(JSON.stringify(snapshot)) !== row.digest ||
      snapshot.matchId !== row.match_id ||
      snapshot.scope !== row.scope ||
      snapshot.gametype !== row.gametype ||
      snapshot.endedAt !== row.ended_at ||
      snapshot.record.status !== row.record_status ||
      snapshot.record.reason !== row.record_reason
    )
      throw new Error("Stored result snapshot failed integrity verification");
    return snapshot;
  }

  private verifyProjection(snapshot: ResultSnapshot, sequence: number): void {
    const seats = this.db.prepare("SELECT * FROM ranking_seats WHERE sequence = ?").all(sequence);
    const byId = new Map(seats.map((seat) => [String(seat.seat_id), seat]));
    if (seats.length !== snapshot.seats.length) throw new Error("Normalized result seats diverged from snapshot");
    if (
      Number(this.db.prepare("SELECT COUNT(*) AS n FROM ranking_stats WHERE sequence = ?").get(sequence)?.n) !==
      snapshot.seats.filter((s) => s.stats !== undefined).length
    )
      throw new Error("Normalized match stats diverged from snapshot");
    for (const seat of snapshot.seats) {
      const row = byId.get(seat.seatId);
      const expected = {
        account_id: seat.accountId,
        team: seat.team,
        teams_played: JSON.stringify(seat.teamsPlayed),
        score: seat.score,
        outcome: seat.outcome,
        placement: seat.placement,
        joined_at_tick: seat.joinedAtTick,
        left_at_tick: seat.leftAtTick,
        disconnected: Number(seat.disconnected),
        forfeited: Number(seat.forfeited),
        late_join: Number(seat.lateJoin),
      };
      if (!row || Object.entries(expected).some(([column, value]) => row[column] !== value))
        throw new Error("Normalized result seats diverged from snapshot");
      const stats = this.db
        .prepare("SELECT stats FROM ranking_stats WHERE sequence = ? AND seat_id = ?")
        .get(sequence, seat.seatId);
      if (
        (seat.stats === undefined && stats) ||
        (seat.stats !== undefined && stats?.stats !== JSON.stringify(seat.stats))
      )
        throw new Error("Normalized match stats diverged from snapshot");
    }
    const record = this.db.prepare("SELECT * FROM matches WHERE id = ?").get(snapshot.matchId);
    if (snapshot.record.status === "excluded") {
      if (record) throw new Error("Excluded result has record statistics");
      return;
    }
    if (
      !record ||
      record.gametype !== snapshot.gametype ||
      record.map !== snapshot.map ||
      record.ended_at !== snapshot.endedAt ||
      record.private !== Number(snapshot.scope === "private") ||
      record.bots !== snapshot.bots
    )
      throw new Error("Record metadata diverged from snapshot");
    const records = this.db
      .prepare("SELECT account_id, outcome, score FROM match_participants WHERE match_id = ?")
      .all(snapshot.matchId);
    const bots = this.botRecordSeats(snapshot, (preset) => this.bots.get(preset));
    const accounts = snapshot.seats.flatMap((seat) => {
      const accountId = seat.accountId ?? bots.get(seat.seatId) ?? null;
      return accountId === null ? [] : [{ ...seat, accountId }];
    });
    if (
      records.length !== accounts.length ||
      accounts.some(
        (seat) =>
          !records.some(
            (row) => row.account_id === seat.accountId && row.outcome === seat.outcome && row.score === seat.score,
          ),
      )
    )
      throw new Error("Record participants diverged from snapshot");
  }

  /** Appends in commit order. A duplicate cannot reinterpret or re-rate an earlier receipt. */
  ingest(input: ResultSnapshot, decision?: RatingDecision): ResultReceipt {
    const snapshot = canonicalSnapshot(input);
    const text = JSON.stringify(snapshot);
    const hash = digest(text);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db.prepare("SELECT parameters FROM ranking_policies WHERE version = ?").get(RATING_POLICY.version)
          ?.parameters !== JSON.stringify(RATING_POLICY)
      ) {
        throw new Error("Stored rating policy differs from the pinned implementation");
      }
      const prior = this.db.prepare("SELECT * FROM ranking_results WHERE match_id = ?").get(snapshot.matchId);
      if (prior) {
        if (prior.digest !== hash || prior.snapshot !== text)
          throw new Error("Conflicting result for an existing match ID");
        this.readSnapshot(prior);
        this.db.exec("COMMIT");
        return receiptOf(prior, "duplicate");
      }
      if (this.db.prepare("SELECT id FROM matches WHERE id = ?").get(snapshot.matchId)) {
        throw new Error("Existing record has no verified snapshot; historical import is unsupported");
      }
      const plan: RatingDecision = decision ?? botMatchRatingGroups(snapshot, (preset) => this.bots.ensure(preset));
      if (
        !["excluded", "applied"].includes(plan.status) ||
        (plan.status !== "applied" && (!plan.reason || plan.reason.length > 128))
      )
        throw new Error("Invalid rating decision");
      if (
        snapshot.record.status === "excluded" &&
        (plan.status !== "excluded" || plan.reason !== snapshot.record.reason)
      )
        throw new Error("Excluded records cannot update skill");
      const groups = plan.status === "applied" ? this.validateGroups(snapshot, plan.groups) : null;
      const updates = groups
        ? this.calculate(
            snapshot,
            groups,
            (id) => this.getRating(id, snapshot.gametype, snapshot.scope)?.state ?? initialRating(),
          )
        : [];
      const reason = plan.status === "applied" ? "eligible" : plan.reason;
      const sequence = Number(
        this.db
          .prepare(
            `INSERT INTO ranking_results (match_id, scope, gametype, ended_at, snapshot, digest, policy_version, record_status, record_reason, rating_status, rating_reason, groups_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            snapshot.matchId,
            snapshot.scope,
            snapshot.gametype,
            snapshot.endedAt,
            text,
            hash,
            RATING_POLICY.version,
            snapshot.record.status,
            snapshot.record.reason,
            plan.status,
            reason,
            groups ? JSON.stringify(groups) : null,
          ).lastInsertRowid,
      );
      const insertSeat = this.db.prepare(
        "INSERT INTO ranking_seats (sequence, seat_id, account_id, team, teams_played, score, outcome, placement, joined_at_tick, left_at_tick, disconnected, forfeited, late_join) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const seat of snapshot.seats)
        insertSeat.run(
          sequence,
          seat.seatId,
          seat.accountId,
          seat.team,
          JSON.stringify(seat.teamsPlayed),
          seat.score,
          seat.outcome,
          seat.placement,
          seat.joinedAtTick,
          seat.leftAtTick,
          Number(seat.disconnected),
          Number(seat.forfeited),
          Number(seat.lateJoin),
        );
      for (const seat of snapshot.seats)
        if (seat.stats !== undefined)
          this.db
            .prepare("INSERT INTO ranking_stats (sequence, seat_id, stats) VALUES (?, ?, ?)")
            .run(sequence, seat.seatId, JSON.stringify(seat.stats));
      if (snapshot.record.status === "recorded") this.insertRecords(snapshot);
      for (const update of updates) this.insertUpdate(snapshot, sequence, update);
      this.verifyProjection(snapshot, sequence);
      this.db.exec("COMMIT");
      return {
        status: "stored",
        sequence,
        recordStatus: snapshot.record.status,
        recordReason: snapshot.record.reason,
        ratingStatus: plan.status,
        ratingReason: reason,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private validateGroups(snapshot: ResultSnapshot, groups: BotAccountRatingGroup[]): BotAccountRatingGroup[] {
    if (snapshot.bots !== 0 || snapshot.seats.some((p) => p.accountId === null)) {
      const expected = botMatchRatingGroups(snapshot, (preset) => this.bots.get(preset));
      if (expected.status !== "applied" || JSON.stringify(groups) !== JSON.stringify(expected.groups))
        throw new Error("Bot skill updates require the preset accounts and eligible groups");
      return expected.groups;
    }
    if (groups.some((g) => g.bots?.length)) throw new Error("Human contests cannot seat fixed bots");
    const humans = new Set(snapshot.seats.map((p) => p.accountId));
    const seen = new Set<number>();
    const canonical = groups.map((group) => ({
      rank: group.rank,
      accountIds: [...group.accountIds].sort((a, b) => a - b),
    }));
    for (const group of canonical)
      for (const id of group.accountIds) {
        if (!Number.isSafeInteger(id) || !humans.has(id) || seen.has(id))
          throw new Error("Rating groups must contain every verified account exactly once");
        seen.add(id);
      }
    if (seen.size !== humans.size) throw new Error("Rating groups must contain every verified account exactly once");
    const ranks = new Map(canonical.flatMap((group) => group.accountIds.map((id) => [id, group.rank] as const)));
    for (const a of snapshot.seats)
      for (const b of snapshot.seats) {
        if (Math.sign(ranks.get(a.accountId!)! - ranks.get(b.accountId!)!) !== Math.sign(a.placement! - b.placement!)) {
          throw new Error("Rating group standings disagree with the verified result");
        }
      }
    return canonical.sort((a, b) => a.rank - b.rank || a.accountIds[0] - b.accountIds[0]);
  }

  private calculate(
    snapshot: ResultSnapshot,
    groups: BotAccountRatingGroup[],
    state: (id: number) => RatingState,
  ): RatingUpdate[] {
    return rateWithFixedReferences(
      snapshot.gametype,
      groups.map((g) => ({
        rank: g.rank,
        players: [
          ...g.accountIds.map((id) => ({ playerId: String(id), state: state(id) })),
          ...(g.bots ?? []).map((binding) => ({
            playerId: `bot:${binding.seatId}`,
            fixed: true,
            state: state(binding.accountId),
          })),
        ],
      })),
    );
  }

  private insertRecords(snapshot: ResultSnapshot): void {
    this.db
      .prepare("INSERT INTO matches (id, gametype, map, ended_at, private, bots) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        snapshot.matchId,
        snapshot.gametype,
        snapshot.map,
        snapshot.endedAt,
        Number(snapshot.scope === "private"),
        snapshot.bots,
      );
    const insert = this.db.prepare(
      "INSERT INTO match_participants (match_id, account_id, outcome, score) VALUES (?, ?, ?, ?)",
    );
    for (const seat of snapshot.seats)
      if (seat.accountId !== null) insert.run(snapshot.matchId, seat.accountId, seat.outcome, seat.score);
    this.insertBotRecords(snapshot, insert);
  }

  /** Bot seats whose record is their preset account's: the first of each preset with an outcome. */
  private botRecordSeats(snapshot: ResultSnapshot, accountFor: (preset: BotPreset) => number): Map<string, number> {
    if (snapshot.scope !== "private") return new Map();
    return botAccountSeats({ seats: snapshot.seats.filter((p) => p.outcome !== null) }, accountFor);
  }

  private insertBotRecords(snapshot: ResultSnapshot, insert: ReturnType<DatabaseSync["prepare"]>): void {
    for (const [seatId, accountId] of this.botRecordSeats(snapshot, (preset) => this.bots.ensure(preset))) {
      const seat = snapshot.seats.find((p) => p.seatId === seatId)!;
      insert.run(snapshot.matchId, accountId, seat.outcome, seat.score);
    }
  }

  /**
   * Rate every stored result again, in order, under the current rules. Runs in
   * initialize's transaction when the schema moves to bot accounts; the
   * snapshots are the source and stay as they are.
   */
  private rerate(): void {
    this.db.exec("DELETE FROM rating_updates");
    this.db.exec("DELETE FROM ratings");
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO match_participants (match_id, account_id, outcome, score) VALUES (?, ?, ?, ?)",
    );
    for (const row of this.db.prepare("SELECT * FROM ranking_results ORDER BY sequence").all()) {
      const sequence = Number(row.sequence);
      const snapshot = this.readSnapshot(row);
      if (snapshot.record.status === "recorded") this.insertBotRecords(snapshot, insert);
      const plan = botMatchRatingGroups(snapshot, (preset) => this.bots.ensure(preset));
      const updates =
        plan.status === "applied"
          ? this.calculate(
              snapshot,
              plan.groups,
              (id) => this.getRating(id, snapshot.gametype, snapshot.scope)?.state ?? initialRating(),
            )
          : [];
      this.db
        .prepare(
          "UPDATE ranking_results SET policy_version = ?, rating_status = ?, rating_reason = ?, groups_json = ? WHERE sequence = ?",
        )
        .run(
          RATING_POLICY.version,
          plan.status,
          plan.status === "applied" ? "eligible" : plan.reason,
          plan.status === "applied" ? JSON.stringify(plan.groups) : null,
          sequence,
        );
      for (const update of updates) this.insertUpdate(snapshot, sequence, update);
      this.verifyProjection(snapshot, sequence);
    }
  }

  private insertUpdate(snapshot: ResultSnapshot, sequence: number, update: RatingUpdate): void {
    const accountId = Number(update.playerId);
    this.db
      .prepare(
        `INSERT INTO ratings (account_id, gametype, scope, policy_version, mu, sigma, matches, last_sequence, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, gametype, scope, policy_version) DO UPDATE SET mu = excluded.mu, sigma = excluded.sigma, matches = excluded.matches, last_sequence = excluded.last_sequence, ended_at = excluded.ended_at`,
      )
      .run(
        accountId,
        snapshot.gametype,
        snapshot.scope,
        RATING_POLICY.version,
        update.after.mu,
        update.after.sigma,
        update.after.ratedMatches,
        sequence,
        snapshot.endedAt,
      );
    this.db
      .prepare(
        `INSERT INTO rating_updates (sequence, account_id, gametype, scope, policy_version, before_mu, before_sigma, before_matches, after_mu, after_sigma, after_matches, before_score, after_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sequence,
        accountId,
        snapshot.gametype,
        snapshot.scope,
        RATING_POLICY.version,
        update.before.mu,
        update.before.sigma,
        update.before.ratedMatches,
        update.after.mu,
        update.after.sigma,
        update.after.ratedMatches,
        conservativeScore(update.before),
        conservativeScore(update.after),
      );
  }

  /** Read-only replay of applied receipts; compares every journal entry and current pool state. */
  verifyReplay() {
    return this.verifiedRead(() => undefined).replay;
  }

  /** Read operational exports from the same WAL snapshot that passed replay. */
  verifiedRead<T>(read: () => T) {
    // A WAL read snapshot prevents a concurrent writer from creating a false
    // divergence between the receipt scan and the final state comparison.
    this.db.exec("BEGIN");
    try {
      const result = this.replay();
      const data = read();
      this.db.exec("COMMIT");
      return { replay: result, data };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private replay() {
    if (
      this.db.prepare("SELECT parameters FROM ranking_policies WHERE version = ?").get(RATING_POLICY.version)
        ?.parameters !== JSON.stringify(RATING_POLICY)
    )
      throw new Error("Replay policy differs from the pinned implementation");
    const states = new Map<string, StoredRating>();
    const key = (id: number, mode: RatingMode, scope: RankingScope) => `${id}:${mode}:${scope}`;
    let matches = 0;
    let count = 0;
    for (const row of this.db.prepare("SELECT * FROM ranking_results ORDER BY sequence").all()) {
      if (row.policy_version !== RATING_POLICY.version)
        throw new Error("Replay encountered an unsupported policy version");
      const snapshot = this.readSnapshot(row);
      this.verifyProjection(snapshot, Number(row.sequence));
      const journal = this.db
        .prepare("SELECT * FROM rating_updates WHERE sequence = ? ORDER BY account_id")
        .all(Number(row.sequence));
      if (row.rating_status !== "applied") {
        if (journal.length !== 0 || row.groups_json !== null) throw new Error("Non-applied result has rating updates");
        continue;
      }
      if (snapshot.record.status !== "recorded" || row.rating_reason !== "eligible")
        throw new Error("Ineligible result has rating updates");
      const groups = this.validateGroups(snapshot, JSON.parse(String(row.groups_json)) as BotAccountRatingGroup[]);
      const updates = this.calculate(
        snapshot,
        groups,
        (id) => states.get(key(id, snapshot.gametype, snapshot.scope))?.state ?? initialRating(),
      );
      if (updates.length !== journal.length) throw new Error("Replay journal is incomplete");
      const entries = new Map(journal.map((entry) => [Number(entry.account_id), entry]));
      for (const update of updates) {
        const id = Number(update.playerId);
        const entry = entries.get(id);
        if (
          !entry ||
          entry.gametype !== snapshot.gametype ||
          entry.scope !== snapshot.scope ||
          JSON.stringify(stateOf(entry, "before_")) !== JSON.stringify(update.before) ||
          JSON.stringify(stateOf(entry, "after_")) !== JSON.stringify(update.after) ||
          entry.before_score !== conservativeScore(update.before) ||
          entry.after_score !== conservativeScore(update.after)
        )
          throw new Error(`Rating journal diverged at sequence ${row.sequence}`);
        states.set(key(id, snapshot.gametype, snapshot.scope), {
          accountId: id,
          gametype: snapshot.gametype,
          scope: snapshot.scope,
          state: update.after,
          lastSequence: Number(row.sequence),
          endedAt: snapshot.endedAt,
        });
        count++;
      }
      matches++;
    }
    const current = this.db
      .prepare("SELECT * FROM ratings WHERE policy_version = ?")
      .all(RATING_POLICY.version)
      .map(ratingOf);
    if (
      current.length !== states.size ||
      this.db.prepare("SELECT COUNT(*) AS n FROM rating_updates").get()?.n !== count
    )
      throw new Error("Replay state or journal count diverged");
    for (const rating of current)
      if (JSON.stringify(rating) !== JSON.stringify(states.get(key(rating.accountId, rating.gametype, rating.scope))))
        throw new Error("Current rating state diverged from replay");
    return { consistent: true as const, matches, updates: count, ratings: current.length };
  }
}

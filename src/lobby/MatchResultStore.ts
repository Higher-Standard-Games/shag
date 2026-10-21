/**
 * Durable match results and ranking queries for verified player accounts.
 *
 * This is an internal store. Only the trusted game-server result path may call
 * record(); a display name or a client-reported winner is never proof of an
 * account's participation. The public leaderboard stays gated until that path
 * binds game seats to the lobby's authenticated account IDs.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { filterPlayerName } from "../engine/server/ChatFilter";
import type { MatchResultReport } from "../engine/server/network/MatchResultReport";
import type { BotPreset } from "../shared/ranking/BotMatchRatingGroups";
import { chooseBotPreset } from "../shared/ranking/BotPresetChoice";
import { displayRating, isProvisional, RATING_POLICY, type RatingMode } from "../shared/ranking/RatingPolicy";
import { PlayerStatsStore } from "./PlayerStatsStore";
import { RatingStore } from "./RatingStore";
import { ResultDeliveryStore } from "./ResultDeliveryStore";
import { normalizeResult, type ResultContext } from "./ResultSnapshot";
import type { RankingScope } from "./types";

export type MatchOutcome = "win" | "loss" | "draw";

function statistics(db: DatabaseSync) {
  const boards = db
    .prepare(`SELECT m.gametype, m.private, COUNT(DISTINCT m.id) AS matches,
    COUNT(DISTINCT mp.account_id) AS accounts, MAX(m.ended_at) AS latestEndedAt
    FROM matches m LEFT JOIN match_participants mp ON mp.match_id = m.id
    GROUP BY m.gametype, m.private ORDER BY m.gametype, m.private LIMIT 32`)
    .all()
    .map((row) => ({
      gametype: String(row.gametype),
      scope: row.private === 1 ? ("private" as const) : ("public" as const),
      matches: Number(row.matches),
      accounts: Number(row.accounts),
      latestEndedAt: Number(row.latestEndedAt),
    }));
  const latest = db
    .prepare("SELECT id, gametype, map, ended_at, private, bots FROM matches ORDER BY ended_at DESC, id DESC LIMIT 1")
    .get();
  return {
    totalMatches: Number(db.prepare("SELECT COUNT(*) AS n FROM matches").get()?.n ?? 0),
    totalParticipants: Number(db.prepare("SELECT COUNT(*) AS n FROM match_participants").get()?.n ?? 0),
    boards,
    latestResult: latest
      ? {
          matchId: String(latest.id),
          gametype: String(latest.gametype),
          map: String(latest.map),
          endedAt: Number(latest.ended_at),
          scope: latest.private === 1 ? ("private" as const) : ("public" as const),
          bots: Number(latest.bots),
        }
      : null,
  };
}

export interface RecordedMatch {
  matchId: string;
  gametype: string;
  map: string;
  endedAt: number;
  participants: Array<{ accountId: number; outcome: MatchOutcome; score: number }>;
  /** Played in a private lobby: friends, bots. Ranked apart from public matches. */
  private?: boolean;
  /** Bots that held seats. Only private lobbies have them. */
  bots?: number;
}

export interface RankingRow {
  rank: number;
  accountId: number;
  name: string;
  wins: number;
  losses: number;
  draws: number;
  rating?: number;
  conservativeScore?: number;
  provisional?: boolean;
  ratedMatches?: number;
  /** A bot preset's account, rated in the Private pools. */
  bot?: boolean;
}

export interface RankingPage {
  entries: RankingRow[];
  total: number;
  localPlayerRank?: number;
  localPlayerEntry?: RankingRow;
  system?: "trueskill";
  policyVersion?: string;
  localProcessing?: { excluded: number };
}

export interface RankingQuery {
  gametype: string;
  period: "month" | "all";
  offset: number;
  limit: number;
  accountId?: number;
  now?: number;
  scope?: RankingScope;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const RECORDS = `
  WITH records AS (
    SELECT p.id AS account_id, p.name,
      EXISTS (SELECT 1 FROM bot_accounts b WHERE b.account_id = p.id) AS bot,
      SUM(CASE WHEN mp.outcome = 'win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN mp.outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN mp.outcome = 'draw' THEN 1 ELSE 0 END) AS draws
    FROM match_participants mp
    JOIN matches m ON m.id = mp.match_id
    JOIN players p ON p.id = mp.account_id
    WHERE m.gametype = ? AND m.ended_at >= ? AND m.ended_at <= ? AND m.private = ?
    GROUP BY p.id
  )`;

// Bot preset accounts keep their ratings (humans are rated against them) but
// the boards list people only, so ranks count humans alone.
const RANKED = `${RECORDS}, ranked AS (
    SELECT *, RANK() OVER (ORDER BY wins DESC, losses ASC, draws DESC) AS rank
    FROM records WHERE bot = 0
  )
`;

// Periods select active accounts and record totals. Skill is always the current
// career posterior in this exact pool; rounded display values never sort it.
const SKILL_RANKED = `${RECORDS}, active AS (
    SELECT r.account_id, p.name, r.mu, r.sigma, r.matches AS rated_matches,
      EXISTS (SELECT 1 FROM bot_accounts b WHERE b.account_id = r.account_id) AS bot,
      COALESCE(records.wins, 0) AS wins, COALESCE(records.losses, 0) AS losses,
      COALESCE(records.draws, 0) AS draws, r.mu - ? * r.sigma AS skill_score
    FROM ratings r JOIN players p ON p.id = r.account_id
    LEFT JOIN records ON records.account_id = r.account_id
    WHERE r.gametype = ? AND r.scope = ? AND r.policy_version = ?
      AND (? = 'all' OR records.account_id IS NOT NULL)
  ), ranked AS (
    SELECT *, RANK() OVER (ORDER BY skill_score DESC) AS rank FROM active WHERE bot = 0
  )`;

function skillRowOf(row: Record<string, unknown>): RankingRow {
  const state = {
    policyVersion: RATING_POLICY.version,
    mu: Number(row.mu),
    sigma: Number(row.sigma),
    ratedMatches: Number(row.rated_matches),
  };
  return {
    ...rowOf(row),
    rating: displayRating(state),
    conservativeScore: Number(row.skill_score),
    provisional: isProvisional(state),
    ratedMatches: state.ratedMatches,
  };
}

function rowOf(row: Record<string, unknown>): RankingRow {
  return {
    rank: Number(row.rank),
    accountId: Number(row.account_id),
    name: filterPlayerName(String(row.name)),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
    ...(Number(row.bot) ? { bot: true } : {}),
  };
}

export class MatchResultStore {
  private readonly db: DatabaseSync;
  readonly ratings: RatingStore;
  readonly deliveries: ResultDeliveryStore;
  readonly playerStats: PlayerStatsStore;

  /** Diagnose a running installation without creating a database or migrating old results. */
  static inspect(dataDir: string) {
    const file = path.join(dataDir, "players.db");
    if (!existsSync(file)) return { status: "missing_database" as const, file };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const columns = new Set(
        db
          .prepare("PRAGMA table_info(matches)")
          .all()
          .map((row) => String(row.name)),
      );
      const participants = new Set(
        db
          .prepare("PRAGMA table_info(match_participants)")
          .all()
          .map((row) => String(row.name)),
      );
      if (
        !["id", "gametype", "map", "ended_at", "private", "bots"].every((name) => columns.has(name)) ||
        !["match_id", "account_id", "outcome", "score"].every((name) => participants.has(name))
      ) {
        return { status: "schema_unavailable" as const, file };
      }
      return { status: "ready" as const, file, statistics: statistics(db) };
    } finally {
      db.close();
    }
  }

  statistics() {
    return statistics(this.db);
  }

  /** Opens the same players.db as PlayerStore, after PlayerStore has migrated it. */
  static open(dataDir: string): MatchResultStore {
    return new MatchResultStore(path.join(dataDir, "players.db"));
  }

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        gametype TEXT NOT NULL,
        map TEXT NOT NULL,
        ended_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS match_participants (
        match_id TEXT NOT NULL REFERENCES matches(id),
        account_id INTEGER NOT NULL REFERENCES players(id),
        outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'draw')),
        score INTEGER NOT NULL,
        PRIMARY KEY (match_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS matches_mode_date ON matches(gametype, ended_at);
    `);
    // Columns added after the table first shipped: every match before them was public.
    const columns = new Set(
      this.db
        .prepare("PRAGMA table_info(matches)")
        .all()
        .map((row) => String(row.name)),
    );
    if (!columns.has("private")) this.db.exec("ALTER TABLE matches ADD COLUMN private INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("bots")) this.db.exec("ALTER TABLE matches ADD COLUMN bots INTEGER NOT NULL DEFAULT 0");
    try {
      this.ratings = new RatingStore(this.db);
      this.playerStats = new PlayerStatsStore(this.db, this);
      this.deliveries = new ResultDeliveryStore(this.db, file, (report, context) =>
        this.recordVerified(report, context),
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Trusted V2 path: full receipt and eligible record projection commit together. */
  recordVerified(report: MatchResultReport, context: ResultContext) {
    return this.ratings.ingest(normalizeResult(report, context));
  }

  /** Idempotent by match ID. Returns false when this match was already stored. */
  record(match: RecordedMatch): boolean {
    if (!match.matchId || !match.gametype || !match.map || !Number.isSafeInteger(match.endedAt)) {
      throw new Error("Invalid match metadata");
    }
    const ids = new Set<number>();
    // A match against bots has one account, and any outcome: losing to a bot is
    // a result. Without bots, results need both sides and must agree.
    const bots = match.bots ?? 0;
    if (!Number.isSafeInteger(bots) || bots < 0 || (bots > 0 && !match.private)) {
      throw new Error("Bots play only in private matches");
    }
    if (match.participants.length < (bots > 0 ? 1 : 2)) throw new Error("Ranked matches need two verified accounts");
    for (const player of match.participants) {
      if (
        !Number.isSafeInteger(player.accountId) ||
        player.accountId <= 0 ||
        !Number.isSafeInteger(player.score) ||
        !["win", "loss", "draw"].includes(player.outcome) ||
        ids.has(player.accountId)
      ) {
        throw new Error("Invalid match participant");
      }
      ids.add(player.accountId);
    }
    const wins = match.participants.filter((player) => player.outcome === "win").length;
    const losses = match.participants.filter((player) => player.outcome === "loss").length;
    const draws = match.participants.filter((player) => player.outcome === "draw").length;
    if (
      bots === 0 &&
      ((draws > 0 && (wins > 0 || (draws !== match.participants.length && (match.gametype !== "ffa" || draws < 2)))) ||
        (draws === 0 && (wins === 0 || losses === 0)))
    ) {
      throw new Error("Inconsistent match outcomes");
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO matches (id, gametype, map, ended_at, private, bots) VALUES (?, ?, ?, ?, ?, ?)")
        .run(match.matchId, match.gametype, match.map, match.endedAt, match.private ? 1 : 0, bots);
      if (inserted.changes === 0) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const add = this.db.prepare(
        "INSERT INTO match_participants (match_id, account_id, outcome, score) VALUES (?, ?, ?, ?)",
      );
      for (const player of match.participants) {
        add.run(match.matchId, player.accountId, player.outcome, player.score);
      }
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private validateLeaderboard(query: RankingQuery): number {
    const now = query.now ?? Date.now();
    if (
      !query.gametype ||
      (query.period !== "month" && query.period !== "all") ||
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(query.offset) ||
      query.offset < 0 ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      (query.scope !== undefined && query.scope !== "public" && query.scope !== "private")
    ) {
      throw new Error("Invalid leaderboard query");
    }
    return now;
  }

  /** Compatibility endpoint for older clients that only understand records. */
  leaderboard(query: RankingQuery): RankingPage {
    const now = this.validateLeaderboard(query);
    const args = [
      query.gametype,
      query.period === "month" ? now - THIRTY_DAYS_MS : 0,
      now,
      query.scope === "private" ? 1 : 0,
    ] as const;
    const entries = this.db
      .prepare(
        `${RANKED} SELECT * FROM ranked ORDER BY wins DESC, losses ASC, draws DESC, account_id ASC LIMIT ? OFFSET ?`,
      )
      .all(...args, query.limit, query.offset)
      .map(rowOf);
    const total = Number(this.db.prepare(`${RANKED} SELECT COUNT(*) AS total FROM ranked`).get(...args)?.total ?? 0);
    const local = query.accountId
      ? this.db.prepare(`${RANKED} SELECT * FROM ranked WHERE account_id = ?`).get(...args, query.accountId)
      : undefined;
    return {
      entries,
      total,
      ...(local ? { localPlayerRank: Number(local.rank), localPlayerEntry: rowOf(local) } : {}),
    };
  }

  skillLeaderboard(query: RankingQuery): RankingPage {
    const now = this.validateLeaderboard(query);
    const scope = query.scope ?? "public";
    const start = query.period === "month" ? now - THIRTY_DAYS_MS : 0;
    const args = [
      query.gametype,
      start,
      now,
      scope === "private" ? 1 : 0,
      RATING_POLICY.conservativeMultiplier,
      query.gametype,
      scope,
      RATING_POLICY.version,
      query.period,
    ] as const;
    this.db.exec("BEGIN");
    try {
      const entries = this.db
        .prepare(`${SKILL_RANKED} SELECT * FROM ranked ORDER BY skill_score DESC, account_id ASC LIMIT ? OFFSET ?`)
        .all(...args, query.limit, query.offset)
        .map(skillRowOf);
      const total = Number(this.db.prepare(`${SKILL_RANKED} SELECT COUNT(*) AS n FROM ranked`).get(...args)?.n ?? 0);
      const local = query.accountId
        ? this.db.prepare(`${SKILL_RANKED} SELECT * FROM ranked WHERE account_id = ?`).get(...args, query.accountId)
        : undefined;
      const processing = query.accountId
        ? this.db
            .prepare(`SELECT
        COUNT(DISTINCT CASE WHEN rr.rating_status = 'excluded' THEN rr.sequence END) AS excluded
        FROM ranking_results rr JOIN ranking_seats s ON s.sequence = rr.sequence
        WHERE s.account_id = ? AND rr.gametype = ? AND rr.scope = ? AND rr.policy_version = ?
          AND rr.ended_at >= ? AND rr.ended_at <= ?`)
            .get(query.accountId, query.gametype, scope, RATING_POLICY.version, start, now)
        : undefined;
      return {
        system: "trueskill",
        policyVersion: RATING_POLICY.version,
        entries,
        total,
        ...(local ? { localPlayerRank: Number(local.rank), localPlayerEntry: skillRowOf(local) } : {}),
        ...(processing ? { localProcessing: { excluded: Number(processing.excluded) } } : {}),
      };
    } finally {
      this.db.exec("ROLLBACK");
    }
  }

  /**
   * The bot preset to field against this account in a private room of this
   * mode: the one whose Private rating is nearest theirs.
   */
  botPresetFor(accountId: number | null, gametype: string): BotPreset {
    if (!(gametype in RATING_POLICY.drawProbability)) return "medium";
    const mode = gametype as RatingMode;
    const muOf = (id: number | null) =>
      id === null ? null : (this.ratings.getRating(id, mode, "private")?.state.mu ?? null);
    return chooseBotPreset(muOf(accountId), (preset) => muOf(this.ratings.bots.find(preset)));
  }

  /** Accounts proved by a stored result for this exact match, mode and map. */
  verifiedDemoAccounts(matchId: string, gametype: string, map: string, startedAt: number): number[] {
    if (!matchId || !gametype || !map || !Number.isSafeInteger(startedAt)) return [];
    return this.db
      .prepare(
        `SELECT mp.account_id FROM match_participants mp
         JOIN matches m ON m.id = mp.match_id
         WHERE m.id = ? AND m.gametype = ? AND m.map = ? AND m.ended_at >= ?`,
      )
      .all(matchId, gametype, map, startedAt)
      .map((row) => Number(row.account_id));
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Durable match results and ranking queries for verified player accounts.
 *
 * This is an internal store. Only the trusted game-server result path may call
 * record(); a display name or a client-reported winner is never proof of an
 * account's participation. The public leaderboard stays gated until that path
 * binds game seats to the lobby's authenticated account IDs.
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MatchOutcome = "win" | "loss" | "draw";

export interface RecordedMatch {
  matchId: string;
  gametype: string;
  map: string;
  endedAt: number;
  participants: Array<{ accountId: number; outcome: MatchOutcome; score: number }>;
}

export interface RankingRow {
  rank: number;
  accountId: number;
  name: string;
  wins: number;
  losses: number;
  draws: number;
}

export interface RankingPage {
  entries: RankingRow[];
  total: number;
  localPlayerRank?: number;
  localPlayerEntry?: RankingRow;
}

export interface RankingQuery {
  gametype: string;
  period: "month" | "all";
  offset: number;
  limit: number;
  accountId?: number;
  now?: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const RANKED = `
  WITH records AS (
    SELECT p.id AS account_id, p.name,
      SUM(CASE WHEN mp.outcome = 'win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN mp.outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN mp.outcome = 'draw' THEN 1 ELSE 0 END) AS draws
    FROM match_participants mp
    JOIN matches m ON m.id = mp.match_id
    JOIN players p ON p.id = mp.account_id
    WHERE m.gametype = ? AND m.ended_at >= ? AND m.ended_at <= ?
    GROUP BY p.id
  ), ranked AS (
    SELECT *, RANK() OVER (ORDER BY wins DESC, losses ASC, draws DESC) AS rank
    FROM records
  )
`;

function rowOf(row: Record<string, unknown>): RankingRow {
  return {
    rank: Number(row.rank),
    accountId: Number(row.account_id),
    name: String(row.name),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
  };
}

export class MatchResultStore {
  private readonly db: DatabaseSync;

  /** Opens the same players.db as PlayerStore, after PlayerStore has migrated it. */
  static open(dataDir: string): MatchResultStore {
    return new MatchResultStore(path.join(dataDir, "players.db"));
  }

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON");
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
  }

  /** Idempotent by match ID. Returns false when this match was already stored. */
  record(match: RecordedMatch): boolean {
    if (!match.matchId || !match.gametype || !match.map || !Number.isSafeInteger(match.endedAt)) {
      throw new Error("Invalid match metadata");
    }
    const ids = new Set<number>();
    if (match.participants.length < 2) throw new Error("Ranked matches need two verified accounts");
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
    if ((draws > 0 && draws !== match.participants.length) || (draws === 0 && (wins === 0 || losses === 0))) {
      throw new Error("Inconsistent match outcomes");
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO matches (id, gametype, map, ended_at) VALUES (?, ?, ?, ?)")
        .run(match.matchId, match.gametype, match.map, match.endedAt);
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

  leaderboard(query: RankingQuery): RankingPage {
    const now = query.now ?? Date.now();
    if (
      !query.gametype ||
      (query.period !== "month" && query.period !== "all") ||
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(query.offset) ||
      query.offset < 0 ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new Error("Invalid leaderboard query");
    }
    const args = [query.gametype, query.period === "month" ? now - THIRTY_DAYS_MS : 0, now] as const;
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

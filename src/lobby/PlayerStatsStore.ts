/** Authenticated own-account reads. Game stats never change rating eligibility. */
import type { DatabaseSync } from "node:sqlite";
import { canonicalMatchStats, type MatchStats } from "../shared/ranking/MatchStats";
import { displayRating, isProvisional, RATING_POLICY, type RatingMode } from "../shared/ranking/RatingPolicy";
import type { MatchResultStore } from "./MatchResultStore";
import type { RankingScope } from "./types";

export interface StatsQuery {
  gametype: RatingMode;
  scope: RankingScope;
  period: "all" | "month";
}
export interface StatsSummary extends StatsQuery {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  statsMatches: number;
  totals: Omit<MatchStats, "version"> | null;
  rating: { rank: number; value: number; provisional: boolean; ratedMatches: number } | null;
  pending: number;
  excluded: number;
}
export interface HistoryEntry {
  sequence: number;
  matchId: string;
  map: string;
  gametype: RatingMode;
  scope: RankingScope;
  startedAt: number;
  endedAt: number;
  completion: string;
  outcome: string | null;
  score: number;
  stats: MatchStats | null;
  recordStatus: string;
  recordReason: string;
  ratingStatus: string;
  ratingReason: string;
  ratingChange: { before: number; after: number; delta: number } | null;
}
export interface HistoryPage {
  gametype: RatingMode;
  scope: RankingScope;
  entries: HistoryEntry[];
  nextBeforeSequence: number | null;
}

export class PlayerStatsStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly results: MatchResultStore,
  ) {}
  private validate(accountId: number, query: Pick<StatsQuery, "gametype" | "scope">) {
    if (
      !Number.isSafeInteger(accountId) ||
      accountId < 1 ||
      !Object.keys(RATING_POLICY.drawProbability).includes(query.gametype) ||
      !["public", "private"].includes(query.scope)
    )
      throw new Error("Invalid player stats query");
  }
  summary(accountId: number, query: StatsQuery, now = Date.now()): StatsSummary {
    this.validate(accountId, query);
    if (!["all", "month"].includes(query.period) || !Number.isSafeInteger(now) || now < 0)
      throw new Error("Invalid stats period");
    const start = query.period === "month" ? now - 30 * 86400000 : 0;
    // One read snapshot keeps records, totals, processing and career skill consistent.
    this.db.exec("BEGIN");
    try {
      const keys = [
        "score",
        "frags",
        "teamFrags",
        "deaths",
        "damageGiven",
        "teamDamageGiven",
        "plants",
        "defuses",
        "activeTimeMs",
      ] as const;
      const sums = keys
        .map(
          (key) =>
            `COALESCE(SUM(CASE WHEN rr.record_status = 'recorded' THEN json_extract(st.stats, '$.${key}') ELSE 0 END), 0) AS ${key}`,
        )
        .join(", ");
      const row = this.db
        .prepare(`SELECT
        SUM(CASE WHEN rr.record_status = 'recorded' AND s.outcome = 'win' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN rr.record_status = 'recorded' AND s.outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN rr.record_status = 'recorded' AND s.outcome = 'draw' THEN 1 ELSE 0 END) AS draws,
        COUNT(CASE WHEN rr.record_status = 'recorded' AND st.stats IS NOT NULL THEN 1 END) AS stats_matches,
        COUNT(CASE WHEN rr.rating_status = 'pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN rr.rating_status = 'excluded' THEN 1 END) AS excluded, ${sums}
        FROM ranking_seats s JOIN ranking_results rr ON rr.sequence = s.sequence
        LEFT JOIN ranking_stats st ON st.sequence = s.sequence AND st.seat_id = s.seat_id
        WHERE s.account_id = ? AND rr.gametype = ? AND rr.scope = ? AND rr.ended_at >= ? AND rr.ended_at <= ?`)
        .get(accountId, query.gametype, query.scope, start, now)!;
      const wins = Number(row.wins ?? 0),
        losses = Number(row.losses ?? 0),
        draws = Number(row.draws ?? 0);
      const statsMatches = Number(row.stats_matches),
        pending = Number(row.pending),
        excluded = Number(row.excluded);
      const { version: _version, ...totals } = canonicalMatchStats({
        version: 1,
        ...Object.fromEntries(keys.map((key) => [key, Number(row[key])])),
      } as MatchStats);
      const state = this.results.ratings.getRating(accountId, query.gametype, query.scope)?.state;
      const rank = state
        ? Number(
            this.db
              .prepare(`SELECT 1 + COUNT(*) AS n FROM ratings WHERE gametype = ? AND scope = ? AND policy_version = ?
        AND mu - ? * sigma > ?`)
              .get(
                query.gametype,
                query.scope,
                RATING_POLICY.version,
                RATING_POLICY.conservativeMultiplier,
                state.mu - RATING_POLICY.conservativeMultiplier * state.sigma,
              )?.n,
          )
        : 0;
      return {
        ...query,
        matches: wins + losses + draws,
        wins,
        losses,
        draws,
        statsMatches,
        totals: statsMatches ? totals : null,
        rating: state
          ? { rank, value: displayRating(state), provisional: isProvisional(state), ratedMatches: state.ratedMatches }
          : null,
        pending,
        excluded,
      };
    } finally {
      this.db.exec("ROLLBACK");
    }
  }
  history(
    accountId: number,
    query: Pick<StatsQuery, "gametype" | "scope">,
    limit = 20,
    beforeSequence?: number,
  ): HistoryPage {
    this.validate(accountId, query);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (beforeSequence !== undefined && (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1))
    )
      throw new Error("Invalid history page");
    const rows = this.db
      .prepare(`SELECT rr.*, s.outcome, s.score, st.stats, u.before_mu, u.before_sigma, u.before_matches, u.after_mu, u.after_sigma, u.after_matches
      FROM ranking_results rr JOIN ranking_seats s ON s.sequence = rr.sequence
      LEFT JOIN ranking_stats st ON st.sequence = s.sequence AND st.seat_id = s.seat_id
      LEFT JOIN rating_updates u ON u.sequence = rr.sequence AND u.account_id = s.account_id AND u.policy_version = rr.policy_version
      WHERE s.account_id = ? AND rr.gametype = ? AND rr.scope = ? AND rr.sequence < ? ORDER BY rr.sequence DESC LIMIT ?`)
      .all(accountId, query.gametype, query.scope, beforeSequence ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const entries = rows.slice(0, limit).map((row) => {
      const snapshot = this.results.ratings.getResult(String(row.match_id))!.snapshot;
      let ratingChange: HistoryEntry["ratingChange"] = null;
      if (row.rating_status === "applied" && row.before_mu !== null && row.policy_version === RATING_POLICY.version) {
        const before = displayRating({
          policyVersion: RATING_POLICY.version,
          mu: Number(row.before_mu),
          sigma: Number(row.before_sigma),
          ratedMatches: Number(row.before_matches),
        });
        const after = displayRating({
          policyVersion: RATING_POLICY.version,
          mu: Number(row.after_mu),
          sigma: Number(row.after_sigma),
          ratedMatches: Number(row.after_matches),
        });
        ratingChange = { before, after, delta: after - before };
      }
      return {
        sequence: Number(row.sequence),
        matchId: snapshot.matchId,
        map: snapshot.map,
        ...query,
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt,
        completion: snapshot.completion,
        outcome: row.outcome as string | null,
        score: Number(row.score),
        stats: row.stats === null ? null : canonicalMatchStats(JSON.parse(String(row.stats))),
        recordStatus: String(row.record_status),
        recordReason: String(row.record_reason),
        ratingStatus: String(row.rating_status),
        ratingReason: String(row.rating_reason),
        ratingChange,
      };
    });
    return { ...query, entries, nextBeforeSequence: rows.length > limit ? entries[entries.length - 1].sequence : null };
  }
}

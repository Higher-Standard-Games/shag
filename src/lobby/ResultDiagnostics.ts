import type { RankingScope } from "./types";

export type ResultStatus = "stored" | "duplicate" | "skipped" | "rejected" | "failed";
export type ResultReason =
  | "stored"
  | "duplicate"
  | "verification_failed"
  | "storage_unavailable"
  | "unknown_match"
  | "missing_match_context"
  | "public_roster_ineligible"
  | "too_few_accounts"
  | "missing_winner_or_draw"
  | "store_error"
  | "aborted";

export interface ResultDiagnostic {
  matchId: string;
  status: ResultStatus;
  reason: ResultReason;
  observedAt: number;
  scope?: RankingScope;
  gametype?: string;
}

/** Process-local counters and a bounded history; contains no credentials or participants. */
export class ResultDiagnostics {
  private readonly totals: Record<ResultStatus, number> = {
    stored: 0,
    duplicate: 0,
    skipped: 0,
    rejected: 0,
    failed: 0,
  };
  private readonly recent: ResultDiagnostic[] = [];

  record(event: Omit<ResultDiagnostic, "observedAt">): ResultDiagnostic {
    const entry = {
      ...event,
      matchId: event.matchId.slice(0, 64),
      gametype: event.gametype?.slice(0, 32),
      observedAt: Date.now(),
    };
    this.totals[entry.status]++;
    this.recent.push(entry);
    if (this.recent.length > 32) this.recent.shift();
    return { ...entry };
  }

  snapshot() {
    return { totals: { ...this.totals }, recent: this.recent.map((entry) => ({ ...entry })) };
  }
}

/**
 * Private, authenticated fair-play line from a lobby match's game server.
 *
 * At the end of a match the game server sends the lobby one summary per
 * account that played: counters it computed from its own simulation (shots,
 * hits, impossible inputs, the view-speed histogram). Aggregates for the whole
 * match only, never raw input. The lobby keeps them for review, with bounded
 * retention (src/lobby/FairPlayStore.ts). Nothing acts on them automatically.
 *
 * Signed with the match's result secret like the result line, under its own
 * prefix and domain, so neither line can be passed off as the other.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdmissionManifest } from "./MatchAdmission";

export const FAIR_PLAY_PREFIX = "SHAG_FAIR_PLAY_V1 ";
/** Longest line the lobby reads; a summary is a few hundred bytes per account. */
export const FAIR_PLAY_MAX_LINE = 32_768;
/** Most counters one account's summary may carry. */
export const FAIR_PLAY_MAX_SIGNALS = 48;
const SIGNAL_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const DOMAIN = "fair-play.";

export interface FairPlayAccount {
  accountId: number;
  /** Counter name → value; whole, non-negative and finite. */
  signals: Record<string, number>;
}

export interface FairPlayReport {
  matchId: string;
  gametype: string;
  endedAt: number;
  accounts: FairPlayAccount[];
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(DOMAIN).update(payload).digest();
}

export function signFairPlayReport(report: FairPlayReport, secret: string): string {
  const payload = Buffer.from(JSON.stringify(report)).toString("base64url");
  return `${FAIR_PLAY_PREFIX}${payload}.${signature(payload, secret).toString("base64url")}`;
}

function validSignals(signals: unknown): signals is Record<string, number> {
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) return false;
  const entries = Object.entries(signals);
  if (entries.length > FAIR_PLAY_MAX_SIGNALS) return false;
  return entries.every(
    ([name, value]) => SIGNAL_NAME.test(name) && typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
}

/**
 * The report if the line is genuine and only names human accounts the match
 * admitted, each once; null otherwise.
 */
export function verifyFairPlayReport(
  line: string,
  secret: string,
  expected: { matchId: string; gametype: string; admission: AdmissionManifest },
): FairPlayReport | null {
  if (!line.startsWith(FAIR_PLAY_PREFIX) || line.length > FAIR_PLAY_MAX_LINE) return null;
  const parts = line.slice(FAIR_PLAY_PREFIX.length).split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const actual = Buffer.from(parts[1], "base64url");
  const wanted = signature(parts[0], secret);
  if (actual.length !== wanted.length || !timingSafeEqual(Uint8Array.from(actual), Uint8Array.from(wanted))) {
    return null;
  }
  try {
    const report = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as FairPlayReport;
    if (
      report.matchId !== expected.matchId ||
      report.matchId !== expected.admission.matchId ||
      report.gametype !== expected.gametype ||
      !Number.isSafeInteger(report.endedAt) ||
      !Array.isArray(report.accounts)
    )
      return null;
    const admitted = new Set(
      expected.admission.grants
        .filter((grant) => !grant.isBot && grant.accountId !== null)
        .map((grant) => grant.accountId),
    );
    const seen = new Set<number>();
    for (const account of report.accounts) {
      if (
        !Number.isSafeInteger(account?.accountId) ||
        !admitted.has(account.accountId) ||
        seen.has(account.accountId) ||
        !validSignals(account.signals)
      )
        return null;
      seen.add(account.accountId);
    }
    return report;
  } catch {
    return null;
  }
}

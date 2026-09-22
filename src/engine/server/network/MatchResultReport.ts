/** Private, authenticated child-server result line. Never sent to game clients. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdmissionManifest } from "./MatchAdmission";

export const RESULT_PREFIX = "SHAG_MATCH_RESULT_V1 ";

export interface MatchResultReport {
  matchId: string;
  gametype: string;
  map: string;
  endedAt: number;
  participants: Array<{
    tokenHash: string;
    accountId: number | null;
    outcome: "win" | "loss" | "draw";
    score: number;
  }>;
}

export function signMatchResult(report: MatchResultReport, secret: string): string {
  const payload = Buffer.from(JSON.stringify(report)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${RESULT_PREFIX}${payload}.${signature}`;
}

/** Fail closed on malformed, oversized, forged, or off-roster child output. */
export function verifyMatchResult(
  line: string,
  secret: string,
  expected: { matchId: string; map: string; gametype: string; startedAt: number; admission: AdmissionManifest },
  now = Date.now(),
): MatchResultReport | null {
  if (!line.startsWith(RESULT_PREFIX) || line.length > 16_384) return null;
  const parts = line.slice(RESULT_PREFIX.length).split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const actual = Buffer.from(parts[1], "base64url");
  const wanted = createHmac("sha256", secret).update(parts[0]).digest();
  if (actual.length !== wanted.length || !timingSafeEqual(Uint8Array.from(actual), Uint8Array.from(wanted)))
    return null;
  try {
    const report = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as MatchResultReport;
    if (
      report.matchId !== expected.matchId ||
      report.matchId !== expected.admission.matchId ||
      report.map !== expected.map ||
      report.gametype !== expected.gametype ||
      !Number.isSafeInteger(report.endedAt) ||
      report.endedAt < expected.startedAt ||
      report.endedAt > now + 5000 ||
      !Array.isArray(report.participants) ||
      report.participants.length < 2 ||
      report.participants.length > expected.admission.grants.length
    )
      return null;
    const grants = new Map(expected.admission.grants.map((grant) => [grant.tokenHash, grant]));
    const seenTokens = new Set<string>();
    const seenAccounts = new Set<number>();
    for (const player of report.participants) {
      const grant = grants.get(player?.tokenHash);
      if (
        !grant ||
        seenTokens.has(player.tokenHash) ||
        grant.accountId !== player.accountId ||
        !Number.isSafeInteger(player.score) ||
        !["win", "loss", "draw"].includes(player.outcome)
      )
        return null;
      if (player.accountId !== null) {
        if (grant.isBot || seenAccounts.has(player.accountId)) return null;
        seenAccounts.add(player.accountId);
      } else if (!grant.isBot) return null;
      seenTokens.add(player.tokenHash);
    }
    return report;
  } catch {
    return null;
  }
}

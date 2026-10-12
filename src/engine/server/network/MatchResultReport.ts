/** Private, authenticated child-server result line. Never sent to game clients. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { type BotReference, canonicalBotReference, sameBotReference } from "../../../shared/ranking/BotReference";
import { canonicalMatchStats, type MatchStats } from "../../../shared/ranking/MatchStats";
import type { AdmissionManifest } from "./MatchAdmission";

export const RESULT_PREFIX = "SHAG_MATCH_RESULT_V2 ";

export type ResultTeam = "ffa" | "udon" | "soba";
export type MatchCompletion = "normal" | "forfeit" | "aborted";

export interface PlayedSeatResult {
  stats?: MatchStats;
  botReference?: BotReference;
  seatId: string;
  tokenHash: string;
  team: ResultTeam;
  teamsPlayed: ResultTeam[];
  joinedAtTick: number;
  leftAtTick: number | null;
  disconnected: boolean;
  forfeited: boolean;
  lateJoin: boolean;
  /** Latched after a genuine mid-match departure; held reconnects/final forfeits are not interruptions. */
  participationInterrupted?: boolean;
  /** Competition rank: equal scores share a rank, including lower places. */
  placement: number | null;
}

export interface MatchResultDetails {
  version: 2;
  mapDigest?: string;
  startedAt: number;
  startedAtTick: number;
  endedAtTick: number;
  completion: MatchCompletion;
  teams: Array<{ id: "udon" | "soba"; score: number; placement: number | null }>;
  seats: PlayedSeatResult[];
}

export interface MatchResultReport {
  matchId: string;
  gametype: string;
  map: string;
  endedAt: number;
  participants: Array<{
    tokenHash: string;
    accountId: number | null;
    outcome: "win" | "loss" | "draw" | null;
    score: number;
  }>;
  details: MatchResultDetails;
}

export function scorePlacement(score: number, scores: readonly number[]): number {
  return 1 + scores.filter((other) => other > score).length;
}

function validDetails(
  report: MatchResultReport,
  expected: { startedAt: number; admission: AdmissionManifest },
): boolean {
  const details = report.details;
  if (
    !details ||
    details.version !== 2 ||
    (details.mapDigest !== undefined &&
      (typeof details.mapDigest !== "string" || !/^[0-9a-f]{64}$/.test(details.mapDigest))) ||
    !Number.isSafeInteger(details.startedAt) ||
    details.startedAt < expected.startedAt ||
    details.startedAt > report.endedAt ||
    !Number.isSafeInteger(details.startedAtTick) ||
    details.startedAtTick < 0 ||
    !Number.isSafeInteger(details.endedAtTick) ||
    details.endedAtTick < details.startedAtTick ||
    !["normal", "forfeit", "aborted"].includes(details.completion) ||
    !Array.isArray(details.seats) ||
    details.seats.length !== report.participants.length ||
    !Array.isArray(details.teams)
  )
    return false;
  const ffa = report.gametype === "ffa";
  if (!ffa && !["duel", "amphi", "snd"].includes(report.gametype)) return false;
  if (details.teams.length !== (ffa ? 0 : 2)) return false;
  const teams = new Map(details.teams.map((team) => [team.id, team]));
  if (!ffa && (!teams.has("udon") || !teams.has("soba"))) return false;
  const aborted = details.completion === "aborted";
  const forfeits = details.seats.filter((seat) => seat.forfeited);
  if (details.completion === "forfeit") {
    if (
      !["duel", "amphi"].includes(report.gametype) ||
      details.seats.length !== 2 ||
      forfeits.length !== 1 ||
      forfeits[0].leftAtTick === null ||
      !forfeits[0].disconnected ||
      details.seats.some((seat) => seat.lateJoin || seat.teamsPlayed.length !== 1) ||
      details.seats[0].team === details.seats[1].team
    )
      return false;
    const opponent = details.seats.find((seat) => !seat.forfeited)!;
    if (opponent.disconnected || opponent.leftAtTick !== null) return false;
  } else if (forfeits.length) return false;
  for (const team of details.teams) {
    if (!Number.isSafeInteger(team.score) || !["udon", "soba"].includes(team.id)) return false;
    const placement = aborted
      ? null
      : details.completion === "forfeit"
        ? team.id === forfeits[0].team
          ? 2
          : 1
        : scorePlacement(
            team.score,
            details.teams.map((other) => other.score),
          );
    if (team.placement !== placement) return false;
  }
  const grants = new Map(expected.admission.grants.map((grant) => [grant.tokenHash, grant]));
  const participants = new Map(report.participants.map((player) => [player.tokenHash, player]));
  const seen = new Set<string>();
  const seenTokens = new Set<string>();
  const scores = report.participants.map((player) => player.score);
  for (const seat of details.seats) {
    const grant = grants.get(seat.tokenHash);
    const player = participants.get(seat.tokenHash);
    try {
      if (seat.stats !== undefined) canonicalMatchStats(seat.stats);
      if (seat.botReference !== undefined) canonicalBotReference(seat.botReference);
      if (!sameBotReference(seat.botReference, grant?.botReference)) return false;
      if (seat.botReference !== undefined && !grant?.isBot) return false;
    } catch {
      return false;
    }
    if (
      !grant ||
      !player ||
      seat.seatId !== (grant.seatId ?? grant.tokenHash) ||
      seen.has(seat.seatId) ||
      seenTokens.has(seat.tokenHash) ||
      !(ffa ? seat.team === "ffa" : seat.team === "udon" || seat.team === "soba") ||
      !Array.isArray(seat.teamsPlayed) ||
      seat.teamsPlayed.length < 1 ||
      seat.teamsPlayed.length > (ffa ? 1 : 2) ||
      new Set(seat.teamsPlayed).size !== seat.teamsPlayed.length ||
      !seat.teamsPlayed.includes(seat.team) ||
      seat.teamsPlayed.some((team) => !(ffa ? team === "ffa" : team === "udon" || team === "soba")) ||
      !Number.isSafeInteger(seat.joinedAtTick) ||
      seat.joinedAtTick < details.startedAtTick ||
      seat.joinedAtTick > details.endedAtTick ||
      (seat.leftAtTick !== null &&
        (!Number.isSafeInteger(seat.leftAtTick) ||
          seat.leftAtTick < seat.joinedAtTick ||
          seat.leftAtTick > details.endedAtTick)) ||
      typeof seat.disconnected !== "boolean" ||
      typeof seat.forfeited !== "boolean" ||
      typeof seat.lateJoin !== "boolean" ||
      (seat.participationInterrupted !== undefined && typeof seat.participationInterrupted !== "boolean") ||
      seat.lateJoin !== seat.joinedAtTick > details.startedAtTick
    )
      return false;
    seen.add(seat.seatId);
    seenTokens.add(seat.tokenHash);
    const team = teams.get(seat.team as "udon" | "soba");
    if (!ffa && player.score !== team?.score) return false;
    const placement = aborted ? null : ffa ? scorePlacement(player.score, scores) : team!.placement;
    if (seat.placement !== placement) return false;
    const tiedTop = ffa
      ? scores.filter((score) => score === Math.max(...scores)).length > 1
      : details.teams.every((team) => team.placement === 1);
    const outcome = aborted ? null : placement === 1 ? (tiedTop ? "draw" : "win") : "loss";
    if (player.outcome !== outcome) return false;
  }
  return true;
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
      report.participants.length < 1 ||
      report.participants.length > expected.admission.grants.length
    )
      return null;
    const grants = new Map(expected.admission.grants.map((grant) => [grant.tokenHash, grant]));
    const seenTokens = new Set<string>();
    const seenAccounts = new Set<number>();
    const seenSeats = new Set<string>();
    for (const player of report.participants) {
      const grant = grants.get(player?.tokenHash);
      if (
        !grant ||
        seenTokens.has(player.tokenHash) ||
        seenSeats.has(grant.seatId ?? grant.tokenHash) ||
        grant.accountId !== player.accountId ||
        !Number.isSafeInteger(player.score) ||
        (player.outcome !== null && !["win", "loss", "draw"].includes(player.outcome))
      )
        return null;
      if (player.accountId !== null) {
        if (grant.isBot || seenAccounts.has(player.accountId)) return null;
        seenAccounts.add(player.accountId);
      } else if (!grant.isBot) return null;
      seenTokens.add(player.tokenHash);
      seenSeats.add(grant.seatId ?? grant.tokenHash);
    }
    if (!validDetails(report, expected) || (report.details!.completion !== "aborted" && report.participants.length < 2))
      return null;
    return report;
  } catch {
    return null;
  }
}

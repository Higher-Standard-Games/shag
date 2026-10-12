import type {
  MatchCompletion,
  MatchResultReport,
  PlayedSeatResult,
  ResultTeam,
} from "../engine/server/network/MatchResultReport";
import { type BotReference, canonicalBotReference } from "../shared/ranking/BotReference";
import { canonicalMatchStats } from "../shared/ranking/MatchStats";
import type { RatingMode } from "../shared/ranking/RatingPolicy";
import { normalizeTeamId } from "../shared/server/gametype";
import type { RankingScope } from "./types";

export type RecordExclusionReason =
  | "aborted"
  | "public_roster_ineligible"
  | "too_few_accounts"
  | "missing_winner_or_draw";
export interface ResultContext {
  private: boolean;
  ranked: boolean;
  bots: number;
  startingRoster?: Array<{ accountId: number | null; isBot: boolean; team: string; botReference?: BotReference }>;
  /** Latched by the authenticated bot service's lobby session after handoff. */
  botReferenceChanged?: boolean;
}
export interface ResultSnapshot {
  version: 2;
  matchId: string;
  gametype: RatingMode;
  map: string;
  mapDigest?: string;
  scope: RankingScope;
  bots: number;
  startedAt: number;
  endedAt: number;
  startedAtTick: number;
  endedAtTick: number;
  completion: MatchCompletion;
  teams: MatchResultReport["details"]["teams"];
  startingRoster: Array<{
    accountId: number | null;
    isBot: boolean;
    team: ResultTeam;
    botReference?: BotReference;
  }> | null;
  botReferenceChanged?: boolean;
  seats: Array<
    Omit<PlayedSeatResult, "tokenHash"> & {
      accountId: number | null;
      outcome: "win" | "loss" | "draw" | null;
      score: number;
    }
  >;
  record: { status: "recorded"; reason: "eligible" } | { status: "excluded"; reason: RecordExclusionReason };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function integer(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function placement(score: number, scores: number[]): number {
  return 1 + scores.filter((other) => other > score).length;
}
function teamOf(team: string, ffa: boolean): ResultTeam {
  const value = ffa ? "ffa" : normalizeTeamId(team);
  if (value === null || !["ffa", "udon", "soba"].includes(value)) throw new Error("Invalid result team");
  return value as ResultTeam;
}

/** Only call after the spawner has authenticated and verified the V2 report. */
export function normalizeResult(report: MatchResultReport, context: ResultContext): ResultSnapshot {
  const people = report.participants.filter((p) => p.accountId !== null && p.outcome !== null);
  const excluded: RecordExclusionReason | null =
    report.details.completion === "aborted"
      ? "aborted"
      : !context.private && (!context.ranked || context.bots > 0)
        ? "public_roster_ineligible"
        : people.length < (context.bots > 0 ? 1 : 2)
          ? "too_few_accounts"
          : context.bots === 0 && !people.some((p) => p.outcome === "win" || p.outcome === "draw")
            ? "missing_winner_or_draw"
            : null;
  const participants = new Map(report.participants.map((p) => [p.tokenHash, p]));
  const snapshot: ResultSnapshot = {
    version: 2,
    matchId: report.matchId,
    gametype: report.gametype as RatingMode,
    map: report.map,
    ...(report.details.mapDigest === undefined ? {} : { mapDigest: report.details.mapDigest }),
    scope: context.private ? "private" : "public",
    bots: context.bots,
    ...(context.botReferenceChanged === undefined ? {} : { botReferenceChanged: context.botReferenceChanged }),
    startedAt: report.details.startedAt,
    endedAt: report.endedAt,
    startedAtTick: report.details.startedAtTick,
    endedAtTick: report.details.endedAtTick,
    completion: report.details.completion,
    teams: report.details.teams,
    startingRoster:
      context.startingRoster?.map((p) => ({
        accountId: p.accountId,
        isBot: p.isBot,
        team: teamOf(p.team, report.gametype === "ffa"),
        ...(p.botReference === undefined ? {} : { botReference: canonicalBotReference(p.botReference) }),
      })) ?? null,
    seats: report.details.seats.map((seat) => {
      const p = participants.get(seat.tokenHash);
      if (!p) throw new Error("Result seat has no participant");
      return {
        seatId: seat.seatId,
        ...(seat.stats === undefined ? {} : { stats: canonicalMatchStats(seat.stats) }),
        ...(seat.botReference === undefined ? {} : { botReference: canonicalBotReference(seat.botReference) }),
        accountId: p.accountId,
        outcome: p.outcome,
        score: p.score,
        team: seat.team,
        teamsPlayed: seat.teamsPlayed,
        joinedAtTick: seat.joinedAtTick,
        leftAtTick: seat.leftAtTick,
        disconnected: seat.disconnected,
        forfeited: seat.forfeited,
        lateJoin: seat.lateJoin,
        ...(seat.participationInterrupted === undefined
          ? {}
          : { participationInterrupted: seat.participationInterrupted }),
        placement: seat.placement,
      };
    }),
    record: excluded ? { status: "excluded", reason: excluded } : { status: "recorded", reason: "eligible" },
  };
  return canonicalSnapshot(snapshot);
}

/** Validate persisted inputs too; whitelist fields so credentials/extra data never enter the journal. */
export function canonicalSnapshot(value: ResultSnapshot): ResultSnapshot {
  if (
    value.version !== 2 ||
    !["duel", "amphi", "ffa", "snd"].includes(value.gametype) ||
    !["public", "private"].includes(value.scope) ||
    typeof value.matchId !== "string" ||
    !value.matchId ||
    typeof value.map !== "string" ||
    !value.map ||
    (value.mapDigest !== undefined &&
      (typeof value.mapDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.mapDigest))) ||
    !integer(value.bots) ||
    !integer(value.startedAt) ||
    !integer(value.endedAt) ||
    value.endedAt < value.startedAt ||
    !integer(value.startedAtTick) ||
    !integer(value.endedAtTick) ||
    value.endedAtTick < value.startedAtTick ||
    !["normal", "forfeit", "aborted"].includes(value.completion) ||
    !Array.isArray(value.seats) ||
    value.seats.length < 1
  ) {
    throw new Error("Invalid result snapshot metadata");
  }
  const ffa = value.gametype === "ffa";
  if (value.botReferenceChanged !== undefined && typeof value.botReferenceChanged !== "boolean")
    throw new Error("Invalid bot reference change flag");
  const aborted = value.completion === "aborted";
  const ids = new Set<string>();
  const accounts = new Set<number>();
  const allowedTeams = ffa ? ["ffa"] : ["udon", "soba"];
  const seats = value.seats
    .map((p) => {
      if (
        typeof p.seatId !== "string" ||
        !p.seatId ||
        ids.has(p.seatId) ||
        (p.accountId !== null &&
          (!Number.isSafeInteger(p.accountId) || p.accountId <= 0 || accounts.has(p.accountId))) ||
        !Number.isSafeInteger(p.score) ||
        !allowedTeams.includes(p.team) ||
        !Array.isArray(p.teamsPlayed) ||
        p.teamsPlayed.length < 1 ||
        p.teamsPlayed.length > allowedTeams.length ||
        new Set(p.teamsPlayed).size !== p.teamsPlayed.length ||
        !p.teamsPlayed.includes(p.team) ||
        p.teamsPlayed.some((t) => !allowedTeams.includes(t)) ||
        !integer(p.joinedAtTick) ||
        p.joinedAtTick < value.startedAtTick ||
        p.joinedAtTick > value.endedAtTick ||
        (p.leftAtTick !== null &&
          (!integer(p.leftAtTick) || p.leftAtTick < p.joinedAtTick || p.leftAtTick > value.endedAtTick)) ||
        typeof p.disconnected !== "boolean" ||
        typeof p.forfeited !== "boolean" ||
        typeof p.lateJoin !== "boolean" ||
        (p.participationInterrupted !== undefined && typeof p.participationInterrupted !== "boolean") ||
        p.lateJoin !== p.joinedAtTick > value.startedAtTick ||
        (aborted
          ? p.outcome !== null || p.placement !== null
          : !["win", "loss", "draw"].includes(p.outcome ?? "") ||
            !Number.isSafeInteger(p.placement) ||
            p.placement! < 1)
      ) {
        throw new Error("Invalid result snapshot seat");
      }
      ids.add(p.seatId);
      if (p.botReference !== undefined && p.accountId !== null)
        throw new Error("Human result cannot carry a bot reference");
      if (p.accountId !== null) accounts.add(p.accountId);
      return {
        seatId: p.seatId,
        ...(p.stats === undefined ? {} : { stats: canonicalMatchStats(p.stats) }),
        ...(p.botReference === undefined ? {} : { botReference: canonicalBotReference(p.botReference) }),
        accountId: p.accountId,
        outcome: p.outcome,
        score: p.score,
        team: p.team,
        teamsPlayed: [...p.teamsPlayed].sort(compare),
        joinedAtTick: p.joinedAtTick,
        leftAtTick: p.leftAtTick,
        disconnected: p.disconnected,
        forfeited: p.forfeited,
        lateJoin: p.lateJoin,
        ...(p.participationInterrupted === undefined ? {} : { participationInterrupted: p.participationInterrupted }),
        placement: p.placement,
      };
    })
    .sort((a, b) => compare(a.seatId, b.seatId));
  if (seats.filter((p) => p.accountId === null).length > value.bots || (!aborted && seats.length < 2))
    throw new Error("Invalid result snapshot roster");
  const forfeits = seats.filter((p) => p.forfeited);
  if (
    value.completion === "forfeit"
      ? !["duel", "amphi"].includes(value.gametype) ||
        seats.length !== 2 ||
        forfeits.length !== 1 ||
        forfeits[0].leftAtTick === null ||
        !forfeits[0].disconnected ||
        seats.some((p) => p.lateJoin || p.teamsPlayed.length !== 1) ||
        seats[0].team === seats[1].team ||
        seats.some((p) => !p.forfeited && (p.disconnected || p.leftAtTick !== null))
      : forfeits.length !== 0
  )
    throw new Error("Invalid snapshot forfeit");
  if (!Array.isArray(value.teams) || value.teams.length !== (ffa ? 0 : 2)) throw new Error("Invalid snapshot teams");
  const teams = value.teams
    .map((t) => ({ id: t.id, score: t.score, placement: t.placement }))
    .sort((a, b) => compare(a.id, b.id));
  if (!ffa && (teams[0].id !== "soba" || teams[1].id !== "udon")) throw new Error("Invalid snapshot teams");
  for (const t of teams) {
    const rank = aborted
      ? null
      : value.completion === "forfeit"
        ? t.id === forfeits[0].team
          ? 2
          : 1
        : placement(
            t.score,
            teams.map((other) => other.score),
          );
    if (!Number.isSafeInteger(t.score) || t.placement !== rank) throw new Error("Inconsistent snapshot team standings");
  }
  const tiedTop = ffa
    ? seats.filter((p) => p.score === Math.max(...seats.map((s) => s.score))).length > 1
    : teams.every((t) => t.placement === 1);
  for (const p of seats) {
    const t = teams.find((t) => t.id === p.team);
    const rank = aborted
      ? null
      : ffa
        ? placement(
            p.score,
            seats.map((s) => s.score),
          )
        : t!.placement;
    if (
      (!ffa && p.score !== t?.score) ||
      p.placement !== rank ||
      p.outcome !== (aborted ? null : rank === 1 ? (tiedTop ? "draw" : "win") : "loss")
    )
      throw new Error("Inconsistent snapshot standings");
  }
  let startingRoster: ResultSnapshot["startingRoster"] = null;
  if (value.startingRoster !== null) {
    const seen = new Set<number>();
    startingRoster = value.startingRoster
      .map((p) => {
        if (
          typeof p.isBot !== "boolean" ||
          p.isBot !== (p.accountId === null) ||
          !allowedTeams.includes(p.team) ||
          (p.accountId !== null && (!Number.isSafeInteger(p.accountId) || p.accountId <= 0 || seen.has(p.accountId)))
        )
          throw new Error("Invalid snapshot starting roster");
        if (p.accountId !== null) seen.add(p.accountId);
        if (p.botReference !== undefined && !p.isBot) throw new Error("Human roster cannot carry a bot reference");
        return {
          accountId: p.accountId,
          isBot: p.isBot,
          team: p.team,
          ...(p.botReference === undefined ? {} : { botReference: canonicalBotReference(p.botReference) }),
        };
      })
      .sort(
        (a, b) =>
          (a.accountId ?? 0) - (b.accountId ?? 0) ||
          compare(a.team, b.team) ||
          compare(JSON.stringify(a.botReference ?? null), JSON.stringify(b.botReference ?? null)),
      );
    if (startingRoster.filter((p) => p.isBot).length !== value.bots)
      throw new Error("Inconsistent starting bot roster");
  }
  const excludedReasons: RecordExclusionReason[] = [
    "aborted",
    "public_roster_ineligible",
    "too_few_accounts",
    "missing_winner_or_draw",
  ];
  if (
    value.record.status === "recorded"
      ? value.record.reason !== "eligible" ||
        aborted ||
        (value.scope === "public" && value.bots > 0) ||
        accounts.size < (value.bots > 0 ? 1 : 2)
      : value.record.status !== "excluded" || !excludedReasons.includes(value.record.reason)
  )
    throw new Error("Invalid snapshot record decision");
  return {
    version: 2,
    matchId: value.matchId,
    gametype: value.gametype,
    map: value.map,
    ...(value.mapDigest === undefined ? {} : { mapDigest: value.mapDigest }),
    scope: value.scope,
    bots: value.bots,
    ...(value.botReferenceChanged === undefined ? {} : { botReferenceChanged: value.botReferenceChanged }),
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    startedAtTick: value.startedAtTick,
    endedAtTick: value.endedAtTick,
    completion: value.completion,
    teams,
    startingRoster,
    seats,
    record:
      value.record.status === "recorded"
        ? { status: "recorded", reason: "eligible" }
        : { status: "excluded", reason: value.record.reason },
  };
}

import type { RatingMode } from "./RatingPolicy";

type PlayedTeam = "ffa" | "udon" | "soba";

/** Structural input from a verified, normalized snapshot; no database or server imports. */
export interface MatchRatingInput {
  gametype: RatingMode;
  scope: "public" | "private";
  bots: number;
  botReferenceChanged?: boolean;
  completion: "normal" | "forfeit" | "aborted";
  startedAtTick: number;
  endedAtTick: number;
  record: { status: "recorded" | "excluded"; reason: string };
  startingRoster: readonly { accountId: number | null; isBot: boolean; team: PlayedTeam }[] | null;
  teams: readonly { id: "udon" | "soba"; placement: number | null }[];
  seats: readonly {
    accountId: number | null;
    team: PlayedTeam;
    teamsPlayed: readonly PlayedTeam[];
    joinedAtTick: number;
    leftAtTick: number | null;
    disconnected: boolean;
    forfeited: boolean;
    lateJoin: boolean;
    placement: number | null;
    /** Missing on older V2 reports: never assume full participation. */
    participationInterrupted?: boolean;
  }[];
}

export interface AccountRatingGroup {
  rank: number;
  accountIds: number[];
}

export type HumanRatingExclusion =
  | "starting_roster_unavailable"
  | "invalid_starting_roster"
  | "incomplete_roster"
  | "late_join"
  | "team_changed"
  | "participation_unknown"
  | "participation_interrupted"
  | "unsupported_forfeit"
  | "invalid_standings";

export type MatchRatingDecision =
  | { status: "excluded"; reason: string }
  | { status: "pending"; reason: "bot_reference_pending" }
  | { status: "applied"; groups: AccountRatingGroup[] };

/**
 * Conservative initial eligibility: the original humans played on unchanged
 * sides from the first Active tick. Reconnect-held entities still participate.
 * Ineligible human matches retain records; no partial-participation weights.
 */
export function matchRatingGroups(input: MatchRatingInput): MatchRatingDecision {
  const exclude = (reason: HumanRatingExclusion): MatchRatingDecision => ({ status: "excluded", reason });
  if (input.record.status === "excluded") return { status: "excluded", reason: input.record.reason };
  if (input.completion === "aborted") return { status: "excluded", reason: "aborted" };
  const hasBots =
    input.bots > 0 ||
    input.seats.some((seat) => seat.accountId === null) ||
    input.startingRoster?.some((seat) => seat.isBot);
  if (hasBots && input.scope === "private" && input.botReferenceChanged)
    return { status: "excluded", reason: "bot_reference_changed" };
  if (hasBots)
    return input.scope === "private"
      ? { status: "pending", reason: "bot_reference_pending" }
      : { status: "excluded", reason: "public_roster_ineligible" };
  if (!input.startingRoster) return exclude("starting_roster_unavailable");
  const allowedTeams = input.gametype === "ffa" ? ["ffa"] : ["udon", "soba"];
  const roster = new Map<number, PlayedTeam>();
  for (const player of input.startingRoster) {
    if (
      player.isBot ||
      player.accountId === null ||
      !Number.isSafeInteger(player.accountId) ||
      player.accountId <= 0 ||
      roster.has(player.accountId) ||
      !allowedTeams.includes(player.team)
    )
      return exclude("invalid_starting_roster");
    roster.set(player.accountId, player.team);
  }
  const duel = input.gametype === "duel" || input.gametype === "amphi";
  if (
    roster.size < 2 ||
    (duel && roster.size !== 2) ||
    (input.gametype !== "ffa" &&
      (!input.startingRoster.some((p) => p.team === "udon") || !input.startingRoster.some((p) => p.team === "soba")))
  )
    return exclude("invalid_starting_roster");
  if (input.seats.some((p) => p.lateJoin || p.joinedAtTick !== input.startedAtTick)) return exclude("late_join");
  const seen = new Set<number>();
  for (const seat of input.seats) {
    if (seat.accountId === null || !roster.has(seat.accountId) || seen.has(seat.accountId))
      return exclude("incomplete_roster");
    seen.add(seat.accountId);
    if (seat.team !== roster.get(seat.accountId) || seat.teamsPlayed.length !== 1 || seat.teamsPlayed[0] !== seat.team)
      return exclude("team_changed");
  }
  if (seen.size !== roster.size) return exclude("incomplete_roster");
  if (input.seats.some((p) => typeof p.participationInterrupted !== "boolean")) return exclude("participation_unknown");
  if (input.seats.some((p) => p.participationInterrupted)) return exclude("participation_interrupted");
  if (
    !Number.isSafeInteger(input.startedAtTick) ||
    !Number.isSafeInteger(input.endedAtTick) ||
    input.endedAtTick <= input.startedAtTick ||
    input.seats.some((p) => p.placement === null || !Number.isSafeInteger(p.placement) || p.placement < 1)
  )
    return exclude("invalid_standings");

  if (input.completion === "forfeit") {
    const losers = input.seats.filter((p) => p.forfeited);
    const winners = input.seats.filter((p) => !p.forfeited);
    if (
      !duel ||
      losers.length !== 1 ||
      winners.length !== 1 ||
      losers[0].placement !== 2 ||
      !losers[0].disconnected ||
      losers[0].leftAtTick === null ||
      losers[0].leftAtTick < input.startedAtTick ||
      losers[0].leftAtTick > input.endedAtTick ||
      winners[0].placement !== 1 ||
      winners[0].disconnected ||
      winners[0].leftAtTick !== null
    )
      return exclude("unsupported_forfeit");
  } else {
    if (input.seats.some((p) => p.forfeited)) return exclude("unsupported_forfeit");
    if (input.seats.some((p) => p.leftAtTick !== null)) return exclude("participation_interrupted");
  }

  let groups: AccountRatingGroup[];
  if (input.gametype === "ffa") {
    if (input.teams.length !== 0) return exclude("invalid_standings");
    groups = input.seats.map((p) => ({ rank: p.placement!, accountIds: [p.accountId!] }));
  } else {
    if (input.teams.length !== 2 || new Set(input.teams.map((team) => team.id)).size !== 2)
      return exclude("invalid_standings");
    groups = input.teams.map((team) => ({
      rank: team.placement!,
      accountIds: input.seats
        .filter((p) => p.team === team.id)
        .map((p) => p.accountId!)
        .sort((a, b) => a - b),
    }));
    if (
      groups.some((group) => group.accountIds.length === 0 || !Number.isSafeInteger(group.rank) || group.rank < 1) ||
      input.seats.some((p) => p.placement !== input.teams.find((t) => t.id === p.team)?.placement)
    )
      return exclude("invalid_standings");
  }
  const ranks = [...new Set(groups.map((group) => group.rank))].sort((a, b) => a - b);
  return {
    status: "applied",
    groups: groups
      .map((group) => ({ rank: ranks.indexOf(group.rank), accountIds: group.accountIds }))
      .sort((a, b) => a.rank - b.rank || a.accountIds[0] - b.accountIds[0]),
  };
}

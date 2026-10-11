import type { ResultSnapshot } from "../ResultSnapshot";

/** Synthetic, complete human contest for journal/query tests. Never a backfill. */
export function humanSnapshot(
  matchId: string,
  accounts: number[],
  endedAt = Date.now(),
  gametype: ResultSnapshot["gametype"] = "duel",
  scope: ResultSnapshot["scope"] = "public",
): ResultSnapshot {
  const ffa = gametype === "ffa";
  return {
    version: 2,
    matchId,
    gametype,
    scope,
    map: "wdm2",
    bots: 0,
    startedAt: endedAt - 1000,
    endedAt,
    startedAtTick: 10,
    endedAtTick: 100,
    completion: "normal",
    record: { status: "recorded", reason: "eligible" },
    startingRoster: accounts.map((accountId, i) => ({
      accountId,
      isBot: false,
      team: ffa ? "ffa" : i === 0 ? "udon" : "soba",
    })),
    teams: ffa
      ? []
      : [
          { id: "udon", score: 3, placement: 1 },
          { id: "soba", score: 0, placement: 2 },
        ],
    seats: accounts.map((accountId, i) => ({
      seatId: `seat-${accountId}`,
      accountId,
      team: ffa ? "ffa" : i === 0 ? "udon" : "soba",
      teamsPlayed: [ffa ? "ffa" : i === 0 ? "udon" : "soba"],
      score: ffa ? accounts.length - i : i === 0 ? 3 : 0,
      outcome: i === 0 ? "win" : "loss",
      placement: ffa ? i + 1 : i === 0 ? 1 : 2,
      joinedAtTick: 10,
      leftAtTick: null,
      disconnected: false,
      forfeited: false,
      lateJoin: false,
      participationInterrupted: false,
    })),
  };
}

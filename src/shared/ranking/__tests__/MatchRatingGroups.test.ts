import { describe, expect, it } from "vitest";
import { type MatchRatingInput, matchRatingGroups } from "../MatchRatingGroups";

type Fixture = Omit<MatchRatingInput, "seats" | "teams" | "startingRoster"> & {
  seats: MatchRatingInput["seats"][number][];
  teams: MatchRatingInput["teams"][number][];
  startingRoster: NonNullable<MatchRatingInput["startingRoster"]>[number][] | null;
};

function match(mode: MatchRatingInput["gametype"] = "duel", count = 2): Fixture {
  const ffa = mode === "ffa";
  const players = Array.from({ length: count }, (_, i) => ({
    accountId: i + 1,
    isBot: false,
    team: ffa ? ("ffa" as const) : i < Math.floor(count / 2) ? ("udon" as const) : ("soba" as const),
  }));
  return {
    gametype: mode,
    scope: "public",
    bots: 0,
    completion: "normal",
    startedAtTick: 10,
    endedAtTick: 100,
    record: { status: "recorded", reason: "eligible" },
    startingRoster: players,
    teams: ffa
      ? []
      : [
          { id: "udon", placement: 1 },
          { id: "soba", placement: 2 },
        ],
    seats: players.map((p, i) => ({
      accountId: p.accountId,
      team: p.team,
      teamsPlayed: [p.team],
      joinedAtTick: 10,
      leftAtTick: null,
      disconnected: false,
      forfeited: false,
      lateJoin: false,
      participationInterrupted: false,
      placement: ffa ? i + 1 : p.team === "udon" ? 1 : 2,
    })),
  };
}

describe("human mode rating decisions", () => {
  it.each(["duel", "amphi"] as const)("groups the original %s opponents from final team outcome", (mode) => {
    expect(matchRatingGroups(match(mode))).toEqual({
      status: "applied",
      groups: [
        { rank: 0, accountIds: [1] },
        { rank: 1, accountIds: [2] },
      ],
    });
    const draw = match(mode);
    draw.teams[1].placement = 1;
    draw.seats[1].placement = 1;
    expect(matchRatingGroups(draw)).toEqual({
      status: "applied",
      groups: [
        { rank: 0, accountIds: [1] },
        { rank: 0, accountIds: [2] },
      ],
    });
  });

  it.each(["public", "private"] as const)("applies eligible human games in %s", (scope) => {
    const input = match();
    input.scope = scope;
    expect(matchRatingGroups(input).status).toBe("applied");
  });

  it("groups five players per S&D side, using the final team result", () => {
    const input = match("snd", 10);
    expect(matchRatingGroups(input)).toEqual({
      status: "applied",
      groups: [
        { rank: 0, accountIds: [1, 2, 3, 4, 5] },
        { rank: 1, accountIds: [6, 7, 8, 9, 10] },
      ],
    });
    const extraStats = {
      ...input,
      seats: input.seats.map((s, i) => ({ ...s, frags: 999 - i, score: -999 + i, damageGiven: i * 123 })),
    };
    expect(matchRatingGroups(extraStats)).toEqual(matchRatingGroups(input));
  });

  it("supports uneven complete teams and team draws", () => {
    const input = match("snd", 3);
    expect(matchRatingGroups(input)).toEqual({
      status: "applied",
      groups: [
        { rank: 0, accountIds: [1] },
        { rank: 1, accountIds: [2, 3] },
      ],
    });
    input.teams[1].placement = 1;
    for (const p of input.seats) p.placement = 1;
    expect(matchRatingGroups(input)).toEqual({
      status: "applied",
      groups: [
        { rank: 0, accountIds: [1] },
        { rank: 0, accountIds: [2, 3] },
      ],
    });
  });

  it("rates all FFA places including tied leaders and lower tied groups", () => {
    const input = match("ffa", 5);
    input.seats.forEach((p, i) => {
      p.placement = [1, 1, 3, 3, 5][i];
    });
    expect(matchRatingGroups(input)).toEqual({
      status: "applied",
      groups: [0, 0, 1, 1, 2].map((rank, i) => ({ rank, accountIds: [i + 1] })),
    });
    for (const p of input.seats) p.placement = 1;
    expect(matchRatingGroups(input)).toEqual({
      status: "applied",
      groups: input.seats.map((p) => ({ rank: 0, accountIds: [p.accountId] })),
    });
  });

  it("is deterministic under reordered original roster, seats and team rows", () => {
    const input = match("snd", 10);
    const original = matchRatingGroups(input);
    input.startingRoster!.reverse();
    input.seats.reverse();
    input.teams.reverse();
    expect(matchRatingGroups(input)).toEqual(original);
    const frozen = match("ffa", 3);
    for (const p of frozen.seats) {
      Object.freeze(p.teamsPlayed);
      Object.freeze(p);
    }
    Object.freeze(frozen.seats);
    Object.freeze(frozen.startingRoster);
    Object.freeze(frozen);
    expect(matchRatingGroups(frozen).status).toBe("applied");
  });

  it("allows a held reconnect seat even if its socket is absent at normal finish", () => {
    const input = match("ffa", 3);
    input.seats[0].disconnected = true;
    expect(matchRatingGroups(input).status).toBe("applied");
    input.seats[0].disconnected = false;
    expect(matchRatingGroups(input).status).toBe("applied");
  });

  it.each([
    "duel",
    "amphi",
  ] as const)("rates a supported %s final forfeit without treating it as interrupted play", (mode) => {
    const input = match(mode);
    input.completion = "forfeit";
    Object.assign(input.seats[1], { forfeited: true, disconnected: true, leftAtTick: 80 });
    expect(matchRatingGroups(input).status).toBe("applied");
    input.seats[1].participationInterrupted = true;
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason: "participation_interrupted" });
  });

  it.each(["ffa", "snd"] as const)("never invents a %s disconnect forfeit", (mode) => {
    const input = match(mode);
    input.completion = "forfeit";
    Object.assign(input.seats[1], { forfeited: true, disconnected: true, leftAtTick: 80 });
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason: "unsupported_forfeit" });
  });

  it.each([
    "missing_start",
    "missing_player",
    "extra_player",
    "late_join",
    "changed_team",
    "played_both",
    "same_team_rejoin",
    "left_early",
    "unknown_participation",
    "duplicate_seat",
  ])("excludes %s while retaining records", (kind) => {
    const input = match("snd", 4);
    let reason: string;
    switch (kind) {
      case "missing_start":
        input.startingRoster = null;
        reason = "starting_roster_unavailable";
        break;
      case "missing_player":
        input.seats.pop();
        reason = "incomplete_roster";
        break;
      case "extra_player":
        input.seats[0].accountId = 42;
        reason = "incomplete_roster";
        break;
      case "late_join":
        input.seats[0].joinedAtTick++;
        input.seats[0].lateJoin = true;
        reason = "late_join";
        break;
      case "changed_team":
        input.seats[0].team = "soba";
        input.seats[0].teamsPlayed = ["soba"];
        reason = "team_changed";
        break;
      case "played_both":
        input.seats[0].teamsPlayed = ["udon", "soba"];
        reason = "team_changed";
        break;
      case "same_team_rejoin":
        input.seats[0].participationInterrupted = true;
        reason = "participation_interrupted";
        break;
      case "left_early":
        input.seats[0].leftAtTick = 50;
        reason = "participation_interrupted";
        break;
      case "unknown_participation":
        delete input.seats[0].participationInterrupted;
        reason = "participation_unknown";
        break;
      default:
        input.seats[0].accountId = input.seats[1].accountId;
        reason = "incomplete_roster";
    }
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason });
    expect(input.record).toEqual({ status: "recorded", reason: "eligible" });
  });

  it.each([
    "duel_too_many",
    "no_opponent",
    "duplicate_account",
    "invalid_account",
  ])("refuses %s starting rosters", (kind) => {
    const input = match(kind === "duel_too_many" ? "duel" : "snd", 4);
    if (kind === "no_opponent")
      input.startingRoster!.forEach((p) => {
        p.team = "udon";
      });
    if (kind === "duplicate_account") input.startingRoster![1].accountId = input.startingRoster![0].accountId;
    if (kind === "invalid_account") input.startingRoster![0].accountId = -1;
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason: "invalid_starting_roster" });
  });

  it("keeps private bot and mixed-team skill pending calibration", () => {
    const input = match("snd", 4);
    input.scope = "private";
    input.bots = 1;
    input.startingRoster![0].accountId = null;
    input.startingRoster![0].isBot = true;
    input.seats[0].accountId = null;
    expect(matchRatingGroups(input)).toEqual({ status: "pending", reason: "bot_reference_pending" });
    input.scope = "public";
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason: "public_roster_ineligible" });
  });

  it("never rates an abandoned or record-ineligible contest", () => {
    const input = match();
    input.completion = "aborted";
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason: "aborted" });
    input.record = { status: "excluded", reason: "too_few_accounts" };
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason: "too_few_accounts" });
  });

  it.each(["null_place", "wrong_team_place", "missing_team", "empty_time"])("refuses %s standings", (kind) => {
    const input = match();
    if (kind === "null_place") input.seats[0].placement = null;
    if (kind === "wrong_team_place") input.teams[0].placement = 2;
    if (kind === "missing_team") input.teams.pop();
    if (kind === "empty_time") input.endedAtTick = input.startedAtTick;
    expect(matchRatingGroups(input)).toEqual({ status: "excluded", reason: "invalid_standings" });
  });
});

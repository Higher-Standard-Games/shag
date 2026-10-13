import { describe, expect, it } from "vitest";
import { type BotMatchInput, type BotPreset, botAccountSeats, botMatchRatingGroups } from "../BotMatchRatingGroups";
import type { RatingMode } from "../RatingPolicy";
import { botReference } from "./_botReference";

function match(mode: RatingMode, count = 2): BotMatchInput {
  const ffa = mode === "ffa";
  const seats = Array.from({ length: count }, (_, i) => ({
    accountId: i % 2 ? null : i + 1,
    seatId: `seat-${i}`,
    team: (ffa ? "ffa" : i < count / 2 ? "udon" : "soba") as "ffa" | "udon" | "soba",
    joinedAtTick: 10,
    leftAtTick: null,
    disconnected: false,
    forfeited: false,
    lateJoin: false,
    participationInterrupted: false,
    placement: ffa ? i + 1 : i < count / 2 ? 1 : 2,
    ...(i % 2 ? { botReference: botReference() } : {}),
  }));
  return {
    gametype: mode,
    scope: "private",
    bots: count / 2,
    botReferenceChanged: false,
    completion: "normal",
    startedAtTick: 10,
    endedAtTick: 100,
    record: { status: "recorded", reason: "eligible" },
    teams: ffa
      ? []
      : [
          { id: "udon", placement: 1 },
          { id: "soba", placement: 2 },
        ],
    seats: seats.map((p) => ({ ...p, teamsPlayed: [p.team] })),
    startingRoster: seats.map((p) => ({
      accountId: p.accountId,
      isBot: p.accountId === null,
      team: p.team,
      ...(p.botReference ? { botReference: p.botReference } : {}),
    })),
  };
}
/** Bot preset accounts sit far above the human IDs the fixtures use. */
const ACCOUNTS: Record<BotPreset, number> = { easy: 901, medium: 902, hard: 903, insane: 904 };
const accountFor = (preset: BotPreset) => ACCOUNTS[preset];

describe("private bot games rated through preset accounts", () => {
  it.each([
    "duel",
    "amphi",
    "ffa",
    "snd",
  ] as const)("reuses full participation rules for %s with each bot as its preset's account", (mode) => {
    const input = match(mode, mode === "snd" ? 4 : 2);
    const result = botMatchRatingGroups(input, accountFor);
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("Missing groups");
    // One Medium account takes one seat; a second Medium in S&D plays fixed.
    expect(result.groups.flatMap((g) => g.accountIds).sort()).toEqual(mode === "snd" ? [1, 3, 902] : [1, 902]);
    expect(result.groups.flatMap((g) => g.bots ?? [])).toEqual(
      mode === "snd" ? [{ seatId: "seat-3", accountId: 902 }] : [],
    );
  });
  it("seats two presets as two accounts", () => {
    const input = match("snd", 4);
    input.seats[3].botReference = { ...input.seats[3].botReference!, preset: "hard" };
    input.startingRoster![3].botReference = input.seats[3].botReference;
    const result = botMatchRatingGroups(input, accountFor);
    if (result.status !== "applied") throw new Error("Missing groups");
    expect(result.groups.flatMap((g) => g.accountIds).sort()).toEqual([1, 3, 902, 903]);
    expect(result.groups.some((g) => g.bots)).toBe(false);
  });
  it.each([
    ["unknown_changes", "bot_reference_missing"],
    ["changed", "bot_reference_changed"],
    ["missing_identity", "bot_reference_missing"],
    ["custom", "bot_custom"],
    ["late", "late_join"],
    ["interrupted", "participation_interrupted"],
    ["side", "team_changed"],
  ])("excludes %s matches without changing the input", (kind, reason) => {
    const input = match("duel");
    if (kind === "unknown_changes") delete input.botReferenceChanged;
    if (kind === "changed") input.botReferenceChanged = true;
    if (kind === "missing_identity") {
      delete input.seats[1].botReference;
      delete input.startingRoster![1].botReference;
    }
    if (kind === "custom") input.startingRoster![1].botReference!.preset = "custom";
    if (kind === "late") {
      input.seats[1].joinedAtTick = 20;
      input.seats[1].lateJoin = true;
    }
    if (kind === "interrupted") input.seats[0].participationInterrupted = true;
    if (kind === "side") input.seats[0].teamsPlayed = ["udon", "soba"];
    const copy = JSON.stringify(input);
    expect(botMatchRatingGroups(input, accountFor)).toEqual({ status: "excluded", reason });
    expect(JSON.stringify(input)).toBe(copy);
  });
  it("rates a valid human forfeit against the connected bot but never public bot games", () => {
    const input = match("duel");
    input.completion = "forfeit";
    Object.assign(input.seats[0], { placement: 2, forfeited: true, disconnected: true, leftAtTick: 80 });
    input.seats[1].placement = 1;
    input.teams[0].placement = 2;
    input.teams[1].placement = 1;
    expect(botMatchRatingGroups(input, accountFor).status).toBe("applied");
    input.scope = "public";
    expect(botMatchRatingGroups(input, accountFor)).toEqual({
      status: "excluded",
      reason: "public_roster_ineligible",
    });
  });
  it("gives each preset's record to its first bot seat", () => {
    const input = match("snd", 4);
    expect([...botAccountSeats(input, accountFor)]).toEqual([["seat-1", 902]]);
  });
});

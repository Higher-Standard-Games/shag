import { describe, expect, it } from "vitest";
import { type BotMatchInput, botMatchRatingGroups } from "../BotMatchRatingGroups";
import type { RatingMode } from "../RatingPolicy";
import { botCalibration } from "./_botCalibration";
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
    map: "wdm2",
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
describe("calibrated private bot eligibility", () => {
  it("requires the signed map bytes when the calibration binds map digests", () => {
    const input = match("duel"),
      calibration = botCalibration();
    calibration.evidence.mapDigests = { wdm2: "b".repeat(64) };
    expect(botMatchRatingGroups(input, () => calibration).status).toBe("pending");
    input.mapDigest = "c".repeat(64);
    expect(botMatchRatingGroups(input, () => calibration).status).toBe("pending");
    input.mapDigest = "b".repeat(64);
    expect(botMatchRatingGroups(input, () => calibration).status).toBe("applied");
  });
  it.each([
    "duel",
    "amphi",
    "ffa",
    "snd",
  ] as const)("reuses full participation rules for %s and binds every bot", (mode) => {
    const input = match(mode, mode === "snd" ? 4 : 2);
    const result = botMatchRatingGroups(input, () => botCalibration(mode));
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("Missing groups");
    expect(result.groups.flatMap((g) => g.accountIds)).toEqual(mode === "snd" ? [1, 3] : [1]);
    expect(result.groups.flatMap((g) => g.bots ?? [])).toHaveLength(input.bots);
  });
  it.each([
    "unregistered",
    "unknown_changes",
    "changed",
    "missing_identity",
    "map",
    "late",
    "interrupted",
    "side",
  ])("refuses %s matches without changing the input", (kind) => {
    const input = match("duel");
    if (kind === "unknown_changes") delete input.botReferenceChanged;
    if (kind === "changed") input.botReferenceChanged = true;
    if (kind === "missing_identity") delete input.seats[1].botReference;
    if (kind === "map") input.map = "unpiloted";
    if (kind === "late") {
      input.seats[1].joinedAtTick = 20;
      input.seats[1].lateJoin = true;
    }
    if (kind === "interrupted") input.seats[0].participationInterrupted = true;
    if (kind === "side") input.seats[0].teamsPlayed = ["udon", "soba"];
    const copy = JSON.stringify(input);
    expect(botMatchRatingGroups(input, () => (kind === "unregistered" ? null : botCalibration())).status).not.toBe(
      "applied",
    );
    expect(JSON.stringify(input)).toBe(copy);
  });
  it("rates a valid human forfeit against the connected bot but never public bot games", () => {
    const input = match("duel");
    input.completion = "forfeit";
    Object.assign(input.seats[0], { placement: 2, forfeited: true, disconnected: true, leftAtTick: 80 });
    input.seats[1].placement = 1;
    input.teams[0].placement = 2;
    input.teams[1].placement = 1;
    expect(botMatchRatingGroups(input, () => botCalibration()).status).toBe("applied");
    input.scope = "public";
    expect(botMatchRatingGroups(input, () => botCalibration()).status).toBe("excluded");
  });
});

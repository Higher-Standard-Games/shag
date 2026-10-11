import { describe, expect, it } from "vitest";
import { analyzePilot, type BotPilot, pilotArtifact, validatePilot } from "../BotPilot";
import { RATING_POLICY, type RatingMode } from "../RatingPolicy";
import { botReference } from "./_botReference";

function pilot(mode: RatingMode = "duel"): BotPilot {
  return {
    version: 1,
    kind: "bot_pilot",
    policyVersion: RATING_POLICY.version,
    mode,
    anchorScope: "private",
    afterSequence: 2,
    throughSequence: 4,
    capturedAt: 10000,
    references: [{ id: "a".repeat(64), reference: botReference() }],
    skipped: [],
    trials: [3, 4].map((sequence, i) => ({
      sequence,
      matchId: `pilot-${sequence}`,
      map: "wdm2",
      mapDigest: "b".repeat(64),
      referenceId: "a".repeat(64),
      groups: [
        { rank: 0, players: [{ kind: "bot", playerId: "bot" }] },
        {
          rank: 1,
          players: [
            {
              kind: "human",
              playerId: `h:${i + 1}`,
              anchorSequence: i + 1,
              state: { policyVersion: RATING_POLICY.version, mu: 25, sigma: 2, ratedMatches: 30 },
            },
          ],
        },
      ],
    })),
  };
}
describe("offline pilot drafts", () => {
  it.each([
    "duel",
    "amphi",
    "ffa",
    "snd",
  ] as const)("fits %s without changing human anchors and makes an exact map-bound artifact", (mode) => {
    const input = pilot(mode),
      original = JSON.stringify(input);
    const fit = analyzePilot(input).fits[0];
    expect(fit.state!.mu).toBeGreaterThan(25);
    expect(fit).toMatchObject({ matches: 2, humans: 2, wins: 2, losses: 0 });
    const artifact = pilotArtifact(input, "a".repeat(64), "pilot-duel-v1", "analysis.json");
    expect(artifact.evidence.mapDigests).toEqual({ wdm2: "b".repeat(64) });
    expect(JSON.stringify(input)).toBe(original);
    input.trials.reverse();
    expect(analyzePilot(input).fits[0].state).toEqual(fit.state);
  });
  it("rejects future/provisional anchors and duplicate trials", () => {
    for (const mutation of ["future", "provisional", "duplicate"] as const) {
      const input = pilot();
      const human = input.trials[0].groups[1].players[0];
      if (human.kind !== "human") throw new Error("Bad fixture");
      if (mutation === "future") human.anchorSequence = 3;
      if (mutation === "provisional") human.state = { ...human.state, ratedMatches: 1 };
      if (mutation === "duplicate") input.trials.push(input.trials[0]);
      expect(() => validatePilot(input)).toThrow();
    }
  });
  it("refuses artifact creation for changed maps or only one human", () => {
    const input = pilot();
    input.trials[1].mapDigest = "c".repeat(64);
    expect(() => pilotArtifact(input, "a".repeat(64), "trial", "report")).toThrow("unchanged");
    input.trials.pop();
    expect(() => pilotArtifact(input, "a".repeat(64), "trial", "report")).toThrow("two anchored");
  });
});

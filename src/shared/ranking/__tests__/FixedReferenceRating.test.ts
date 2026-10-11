import { describe, expect, it } from "vitest";
import { rateWithFixedReferences } from "../FixedReferenceRating";
import { initialRating } from "../RatingPolicy";
import { rateMatch } from "../TrueSkillRating";

describe("fixed opponent numerical updates", () => {
  it.each([
    "duel",
    "amphi",
    "ffa",
    "snd",
  ] as const)("conditions %s on the reference without returning or mutating its state", (mode) => {
    const fixed = Object.freeze({ ...initialRating(), mu: 10, sigma: 2 });
    const groups = [
      { rank: 0, players: [{ playerId: "human", state: initialRating() }] },
      { rank: 1, players: [{ playerId: "bot", state: fixed, fixed: true }] },
    ];
    const expected = rateMatch(mode, groups).filter((p) => p.playerId === "human");
    expect(rateWithFixedReferences(mode, groups)).toEqual(expected);
    expect(fixed).toEqual({ ...initialRating(), mu: 10, sigma: 2 });
  });
  it("updates only humans in mixed teams and preserves draw symmetry", () => {
    const g = [0, 1].map((team) => ({
      rank: 0,
      players: [
        { playerId: `human${team}`, state: initialRating() },
        { playerId: `bot${team}`, state: initialRating(), fixed: true },
      ],
    }));
    const updates = rateWithFixedReferences("snd", g);
    expect(updates.map((p) => p.playerId)).toEqual(["human0", "human1"]);
    expect(updates[0].after).toEqual(updates[1].after);
  });
  it("handles all FFA ranks and ties deterministically with fixed opponents", () => {
    const g = Array.from({ length: 10 }, (_, i) => ({
      rank: Math.floor(i / 2),
      players: [{ playerId: `seat${i}`, state: initialRating(), fixed: i % 2 === 1 }],
    }));
    const updates = rateWithFixedReferences("ffa", g);
    expect(updates).toHaveLength(5);
    expect(rateWithFixedReferences("ffa", [...g].reverse())).toEqual(updates);
    expect(updates[0].after.mu).toBeGreaterThan(updates[4].after.mu);
  });
  it("does not let fixed references create bot-only human updates", () => {
    expect(() =>
      rateWithFixedReferences(
        "duel",
        [0, 1].map((i) => ({ rank: i, players: [{ playerId: `bot${i}`, state: initialRating(), fixed: true }] })),
      ),
    ).toThrow();
  });
  it("gives smaller estimated-skill gains for expected easy-opponent wins", () => {
    const win = (mu: number) =>
      rateWithFixedReferences("duel", [
        { rank: 0, players: [{ playerId: "human", state: initialRating() }] },
        { rank: 1, players: [{ playerId: "bot", state: { ...initialRating(), mu, sigma: 2 }, fixed: true }] },
      ])[0].after;
    expect(win(10).mu).toBeLessThan(win(35).mu);
  });
});

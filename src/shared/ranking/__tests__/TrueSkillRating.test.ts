import { describe, expect, it } from "vitest";
import {
  conservativeScore,
  displayRating,
  initialRating,
  isProvisional,
  RATING_POLICY,
  RatingError,
  type RatingMode,
  type RatingState,
} from "../RatingPolicy";
import { type RatingGroup, type RatingPlayer, rateMatch } from "../TrueSkillRating";

function player(playerId: string, state = initialRating()): RatingPlayer {
  return { playerId, state };
}

function singles(ranks: number[]): RatingGroup[] {
  return ranks.map((rank, i) => ({ rank, players: [player(String(i))] }));
}

function expectError(run: () => unknown, code: RatingError["code"]): void {
  try {
    run();
    expect.fail("Expected rating operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RatingError);
    expect((error as RatingError).code).toBe(code);
  }
}

describe("published classic TrueSkill reference vectors", () => {
  // Independent, rounded examples from https://trueskill.org/ (not computed by
  // the dependency during tests). Defaults: 25, 25/3, 25/6, 25/300, draw 0.1.
  it.each([
    [
      "win",
      [0, 1],
      [
        [29.396, 7.171],
        [20.604, 7.171],
      ],
    ],
    [
      "draw",
      [0, 0],
      [
        [25, 6.458],
        [25, 6.458],
      ],
    ],
  ] as const)("matches the published 1v1 %s", (_name, ranks, expected) => {
    const updates = rateMatch("duel", singles([...ranks]));
    updates.forEach((update, i) => {
      expect(Math.abs(update.after.mu - expected[i][0])).toBeLessThan(0.001);
      expect(Math.abs(update.after.sigma - expected[i][1])).toBeLessThan(0.001);
    });
  });

  it("matches the published 2v2 vector", () => {
    // https://github.com/scttcper/ts-trueskill/blob/master/README.md
    const updates = rateMatch("snd", [
      { rank: 0, players: [player("a"), player("b")] },
      { rank: 1, players: [player("c"), player("d")] },
    ]);
    updates.forEach((update, i) => {
      expect(Math.abs(update.after.mu - (i < 2 ? 28.108 : 21.892))).toBeLessThan(0.001);
      expect(Math.abs(update.after.sigma - 7.774)).toBeLessThan(0.001);
    });
  });

  it("matches the independent uneven 1v2 example", () => {
    const updates = rateMatch("snd", [
      { rank: 0, players: [player("a")] },
      { rank: 1, players: [player("b"), player("c")] },
    ]);
    updates.forEach((update, i) => {
      expect(Math.abs(update.after.mu - (i === 0 ? 33.731 : 16.269))).toBeLessThan(0.001);
      expect(Math.abs(update.after.sigma - 7.317)).toBeLessThan(0.001);
    });
  });

  it("matches Microsoft's eight-player FFA table", () => {
    // https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/
    const expected = [
      [36.771, 5.749],
      [32.242, 5.133],
      [29.074, 4.943],
      [26.322, 4.874],
      [23.678, 4.874],
      [20.926, 4.943],
      [17.758, 5.133],
      [13.229, 5.749],
    ];
    const updates = rateMatch("ffa", singles([0, 1, 2, 3, 4, 5, 6, 7]));
    updates.forEach((update, i) => {
      expect(Math.abs(update.after.mu - expected[i][0])).toBeLessThan(0.001);
      expect(Math.abs(update.after.sigma - expected[i][1])).toBeLessThan(0.001);
    });
  });
});

describe("canonical, immutable rating updates", () => {
  it.each(["duel", "amphi", "ffa", "snd"] as const)("supports policy parameters for %s", (mode) => {
    expect(rateMatch(mode, singles([0, 1]))).toEqual(rateMatch("duel", singles([0, 1])));
  });

  it("preserves tied leaders and lower tied places through reordered reports", () => {
    const groups = singles([0, 0, 2, 2]);
    const expected = rateMatch("ffa", groups);
    for (const order of [
      [3, 1, 0, 2],
      [2, 0, 3, 1],
      [1, 0, 3, 2],
    ]) {
      expect(
        rateMatch(
          "ffa",
          order.map((i) => groups[i]),
        ),
      ).toEqual(expected);
    }
    expect(Math.abs(expected[0].after.mu - expected[1].after.mu)).toBeLessThan(0.01);
    expect(Math.abs(expected[2].after.mu - expected[3].after.mu)).toBeLessThan(0.01);
    expect(expected[1].after.mu).toBeGreaterThan(expected[2].after.mu);
  });

  it("all-draw FFA results remain finite and approximately symmetric", () => {
    const updates = rateMatch("ffa", singles([0, 0, 0, 0]));
    for (const { after } of updates) {
      expect(Math.abs(after.mu - 25)).toBeLessThan(0.001);
      expect(after.sigma).toBeGreaterThan(0);
      expect(after.sigma).toBeLessThan(RATING_POLICY.initialSigma);
    }
  });

  it("normalizes ordinal rank gaps without treating them as score margins", () => {
    expect(rateMatch("ffa", singles([1, 1, 8, 42]))).toEqual(rateMatch("ffa", singles([0, 0, 1, 2])));
  });

  it("is invariant to member order in unequal-skill tied teams", () => {
    const groups: RatingGroup[] = [
      { rank: 0, players: [player("z", { ...initialRating(), mu: 32, sigma: 3 }), player("a")] },
      { rank: 0, players: [player("m", { ...initialRating(), mu: 20, sigma: 4 }), player("b")] },
    ];
    const reversed = [...groups].reverse().map((group) => ({ ...group, players: [...group.players].reverse() }));
    expect(rateMatch("snd", reversed)).toEqual(rateMatch("snd", groups));
  });

  it("returns fresh before/after snapshots without mutating frozen inputs", () => {
    const groups = singles([0, 1]);
    for (const group of groups) {
      for (const entry of group.players) {
        Object.freeze(entry.state);
        Object.freeze(entry);
      }
      Object.freeze(group.players);
      Object.freeze(group);
    }
    Object.freeze(groups);
    const updates = rateMatch("duel", groups);
    expect(updates[0].before).toEqual(initialRating());
    expect(updates[0].before).not.toBe(groups[0].players[0].state);
    expect(updates[0].after).not.toBe(updates[0].before);
    expect(groups[0].players[0].state.ratedMatches).toBe(0);
    expect(updates.every((update) => update.after.ratedMatches === 1)).toBe(true);
    for (let i = 0; i < 10; i++) expect(rateMatch("duel", groups)).toEqual(updates);
  });

  it("an upset moves estimates more than an expected win", () => {
    const strong = player("strong", { ...initialRating(), mu: 35, sigma: 3 });
    const weak = player("weak", { ...initialRating(), mu: 15, sigma: 3 });
    const expected = rateMatch("duel", [
      { rank: 0, players: [strong] },
      { rank: 1, players: [weak] },
    ]);
    const upset = rateMatch("duel", [
      { rank: 1, players: [strong] },
      { rank: 0, players: [weak] },
    ]);
    expect(35 - upset[0].after.mu).toBeGreaterThan(expected[0].after.mu - 35);
    expect(upset[1].after.mu).toBeGreaterThan(15);
  });
});

describe("rating input and numerical failures", () => {
  it.each([
    { mu: Number.NaN },
    { mu: Number.POSITIVE_INFINITY },
    { sigma: Number.NaN },
    { sigma: Number.POSITIVE_INFINITY },
    { sigma: 0 },
    { sigma: -1 },
    { ratedMatches: -1 },
    { ratedMatches: 0.5 },
    { ratedMatches: Number.MAX_SAFE_INTEGER },
  ])("refuses invalid prior %j", (patch) => {
    const groups = singles([0, 1]);
    groups[0] = { rank: 0, players: [player("0", { ...initialRating(), ...patch })] };
    expectError(() => rateMatch("duel", groups), "invalid_input");
    expect(groups[1].players[0].state).toEqual(initialRating());
  });

  it("refuses mixing policy revisions", () => {
    expectError(
      () =>
        rateMatch("duel", [
          { rank: 0, players: [player("a")] },
          { rank: 1, players: [player("b", { ...initialRating(), policyVersion: "future-policy" })] },
        ]),
      "policy_mismatch",
    );
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses rank %s", (rank) => {
    expectError(() => rateMatch("ffa", singles([rank, 1])), "invalid_input");
  });

  it("refuses missing competitors, empty teams and unsupported modes", () => {
    expectError(() => rateMatch("ffa", []), "invalid_input");
    expectError(() => rateMatch("ffa", singles([0])), "invalid_input");
    expectError(() => rateMatch("snd", [{ rank: 0, players: [] }, singles([1])[0]]), "invalid_input");
    expectError(() => rateMatch("unknown" as RatingMode, singles([0, 1])), "invalid_input");
  });

  it.each(["", " a", "a ", "a"])("refuses invalid or repeated player identity '%s'", (id) => {
    expectError(
      () =>
        rateMatch("duel", [
          { rank: 0, players: [player("a")] },
          { rank: 1, players: [player(id)] },
        ]),
      "invalid_input",
    );
  });

  it("fails the whole update on numerical underflow rather than manufacturing ratings", () => {
    const groups: RatingGroup[] = [
      { rank: 0, players: [player("a", { ...initialRating(), mu: -1000, sigma: 0.01 })] },
      { rank: 1, players: [player("b", { ...initialRating(), mu: 1000, sigma: 0.01 })] },
    ];
    const snapshot = JSON.stringify(groups);
    expectError(() => rateMatch("duel", groups), "numerical_failure");
    expect(JSON.stringify(groups)).toBe(snapshot);
  });

  it("refuses unsafe conservative/display values", () => {
    expectError(() => conservativeScore({ ...initialRating(), sigma: Number.MAX_VALUE }), "numerical_failure");
    expectError(() => displayRating({ ...initialRating(), mu: 1e20 }), "numerical_failure");
  });
});

describe("policy presentation and repeated results", () => {
  it("does not force the conservative rating down after every loss", () => {
    let states = [initialRating(), initialRating()];
    let firstLossRating = 0;
    for (let match = 1; match <= 10; match++) {
      states = rateMatch(
        "duel",
        states.map((state, i) => ({
          rank: i,
          players: [player(String(i), state)],
        })),
      ).map(({ after }) => after);
      if (match === 1) firstLossRating = displayRating(states[1]);
    }
    expect(states[1].mu).toBeLessThan(20.605);
    expect(displayRating(states[1])).toBeGreaterThan(firstLossRating);
  });
  it("freezes the numerical policy and returns independent priors", () => {
    expect(Object.isFrozen(RATING_POLICY)).toBe(true);
    expect(Object.isFrozen(RATING_POLICY.drawProbability)).toBe(true);
    expect(initialRating()).not.toBe(initialRating());
    expect(conservativeScore(initialRating())).toBe(0);
    expect(displayRating(initialRating())).toBe(1000);
  });

  it("shows a provisional rating immediately, including losses and draws", () => {
    const win = rateMatch("duel", singles([0, 1]));
    const draw = rateMatch("duel", singles([0, 0]));
    expect(displayRating(win[0].after)).toBe(1315);
    expect(displayRating(win[1].after)).toBe(964);
    expect(displayRating(draw[0].after)).toBe(1225);
    expect([win[0], win[1], draw[0]].every(({ after }) => isProvisional(after))).toBe(true);
  });

  it("requires both enough evidence and reduced uncertainty to finish provisional status", () => {
    expect(isProvisional({ ...initialRating(), ratedMatches: 9, sigma: 2 })).toBe(true);
    expect(isProvisional({ ...initialRating(), ratedMatches: 50, sigma: 5 })).toBe(true);
    expect(isProvisional({ ...initialRating(), ratedMatches: 10, sigma: 25 / 6 })).toBe(false);
  });

  it.each(["alternating", "all_draws", "one_winner"])("stays finite through 200 %s duels", (scenario) => {
    let states: RatingState[] = [initialRating(), initialRating()];
    for (let match = 0; match < 200; match++) {
      const ranks = scenario === "all_draws" ? [0, 0] : scenario === "alternating" && match % 2 ? [1, 0] : [0, 1];
      states = rateMatch(
        "duel",
        ranks.map((rank, i) => ({ rank, players: [player(String(i), states[i])] })),
      ).map(({ after }) => after);
      for (const state of states) {
        expect(state.ratedMatches).toBe(match + 1);
        expect(Number.isFinite(state.mu)).toBe(true);
        expect(state.sigma).toBeGreaterThan(0);
        expect(state.sigma).toBeLessThan(RATING_POLICY.initialSigma);
        expect(Number.isSafeInteger(displayRating(state))).toBe(true);
      }
    }
    expect(states.every((state) => !isProvisional(state))).toBe(true);
    if (scenario === "one_winner") expect(states[0].mu).toBeGreaterThan(states[1].mu);
  });

  it("rates rotating ten-player FFA ties for 100 matches without dropping a participant", () => {
    let states = Array.from({ length: 10 }, initialRating);
    for (let match = 0; match < 100; match++) {
      const groups = states.map((state, i) => ({
        rank: Math.floor(((i + match) % 10) / 2),
        players: [player(String(i), state)],
      }));
      const updates = rateMatch("ffa", groups);
      expect(updates).toHaveLength(10);
      states = updates.map(({ after }) => after);
      expect(
        states.every((state) => state.ratedMatches === match + 1 && Number.isFinite(state.mu) && state.sigma > 0),
      ).toBe(true);
    }
  });
});

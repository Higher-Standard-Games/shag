/**
 * A loss number on its own cannot tell you whether anything was learned.
 *
 * Most of these outputs are off most of the time, so a network that answers "no"
 * to everything scores a fine mean error. The floor — the error of the best
 * fixed answer, which for mean absolute error is the median — is what makes the
 * difference visible.
 *
 * TF-6 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import { describe, expect, it } from "vitest";
import {
  COMBAT_OUTPUT_NAMES,
  COMBAT_TARGET_SIZE,
  TACTICAL_OUTPUT_NAMES,
  TACTICAL_TARGET_SIZE,
} from "../CloningTargets";
import { formatScores, scoreOutputs } from "../TrainingReport";

describe("scoreOutputs", () => {
  it("scores each output on its own, not the head as a whole", () => {
    // Output 0 is answered exactly; output 1 is answered backwards
    const targets = [
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 0],
    ];
    const predictions = [
      [1, 0],
      [0, 1],
      [1, 0],
      [0, 1],
    ];
    const [first, second] = scoreOutputs(["right", "wrong"], predictions, targets);
    expect(first.error).toBe(0);
    expect(second.error).toBe(1);
    // Both columns are on half the time, so no fixed answer beats 0.5
    expect(first.floor).toBeCloseTo(0.5, 5);
    expect(second.floor).toBeCloseTo(0.5, 5);
  });

  it("gives a rare output a floor low enough to expose a lazy network", () => {
    // On in one frame of ten: answering "never" is wrong a tenth of the time,
    // which is exactly the floor — so the network added nothing
    const targets = Array.from({ length: 10 }, (_, index) => [index === 0 ? 1 : 0]);
    const lazy = Array.from({ length: 10 }, () => [0]);
    const [score] = scoreOutputs(["jump"], lazy, targets);

    expect(score.positiveRate).toBeCloseTo(0.1, 5);
    // A tenth of an error looks respectable until it is read against the floor
    expect(score.error).toBeCloseTo(0.1, 5);
    expect(score.floor).toBeCloseTo(0.1, 5);
    expect(score.error).toBeGreaterThanOrEqual(score.floor);
    expect(formatScores("Tactical", [score]).join("\n")).toContain("no better than a fixed answer");
  });

  it("says an output was learned only when it beat that floor", () => {
    const targets = [[1], [0], [1], [0]];
    const good = [[0.9], [0.1], [0.9], [0.1]];
    const [score] = scoreOutputs(["fire"], good, targets);
    expect(score.error).toBeLessThan(score.floor);
    expect(formatScores("Combat", [score]).join("\n")).toContain("learned");
  });

  it("refuses to score rows that do not line up", () => {
    expect(() => scoreOutputs(["a"], [[1]], [[1], [0]])).toThrow(/predictions/);
  });

  it("has nothing to say when nothing was held out", () => {
    expect(scoreOutputs(["a"], [], [])).toEqual([]);
    expect(formatScores("Tactical", []).join("")).toContain("nothing held out");
  });
});

describe("output names", () => {
  it("names every output of both heads", () => {
    expect(TACTICAL_OUTPUT_NAMES).toHaveLength(TACTICAL_TARGET_SIZE);
    expect(COMBAT_OUTPUT_NAMES).toHaveLength(COMBAT_TARGET_SIZE);
  });
});

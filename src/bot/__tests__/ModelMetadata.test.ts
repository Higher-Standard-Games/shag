/**
 * Weights say nothing about the features they expect: a dense layer takes any
 * vector of the right length. Metadata beside them turns a silent mismatch into
 * a refusal. TF-10 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import { describe, expect, it } from "vitest";
import { COMBAT_INPUT_SIZE, TACTICAL_INPUT_SIZE } from "../BotInputNormalizer";
import { TACTICAL_TARGET_SIZE } from "../CloningTargets";
import { checkCompatibility, describeCurrentFeatures, type ModelMetadata } from "../ModelMetadata";

const metadata = (over: Partial<ModelMetadata> = {}): ModelMetadata => ({
  ...describeCurrentFeatures(),
  trainedAt: "2026-09-23T00:00:00.000Z",
  matches: 3,
  trainFrames: 900,
  validationFrames: 100,
  includedBots: false,
  matchIds: ["m1", "m2", "m3"],
  ...over,
});

describe("checkCompatibility", () => {
  it("accepts weights trained on this build's features", () => {
    expect(checkCompatibility(metadata())).toEqual({ ok: true });
  });

  it("refuses weights whose tactical vector is a different size", () => {
    const result = checkCompatibility(metadata({ tacticalInputSize: TACTICAL_INPUT_SIZE + 3 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(`${TACTICAL_INPUT_SIZE}`);
  });

  it("refuses weights whose combat vector is a different size", () => {
    const result = checkCompatibility(metadata({ combatInputSize: COMBAT_INPUT_SIZE - 1 }));
    expect(result.ok).toBe(false);
  });

  it("refuses weights that predict a different number of outputs", () => {
    // The width fixes what each index means: weights trained when the tactical
    // head opened with three mode confidences would have index 0 answering a
    // question this build no longer asks.
    const result = checkCompatibility(metadata({ tacticalOutputSize: TACTICAL_TARGET_SIZE + 3 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("outputs");
  });

  it("accepts metadata written before output widths were recorded", () => {
    const older = metadata();
    delete older.tacticalOutputSize;
    delete older.combatOutputSize;
    expect(checkCompatibility(older)).toEqual({ ok: true });
  });

  it("allows weights with no metadata, but says the shape is unknown", () => {
    const result = checkCompatibility(null);
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("unknown");
  });
});

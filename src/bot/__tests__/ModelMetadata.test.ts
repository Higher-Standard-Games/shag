/**
 * Weights say nothing about the features they expect: a dense layer takes any
 * vector of the right length. Metadata beside them turns a silent mismatch into
 * a refusal. TF-10 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import { describe, expect, it } from "vitest";
import { COMBAT_INPUT_SIZE, TACTICAL_INPUT_SIZE } from "../BotInputNormalizer";
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

  it("allows weights with no metadata, but says the shape is unknown", () => {
    const result = checkCompatibility(null);
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("unknown");
  });
});

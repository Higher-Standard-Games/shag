import type { BotCalibration } from "../BotRatingReferences";
import { RATING_POLICY, type RatingMode } from "../RatingPolicy";
import { botReference } from "./_botReference";
/** Synthetic validation fixture only; never installed in a user's database. */
export function botCalibration(mode: RatingMode = "duel"): BotCalibration {
  return {
    version: 1,
    id: `synthetic-${mode}-v1`,
    policyVersion: RATING_POLICY.version,
    mode,
    reference: botReference(),
    mu: 10,
    sigma: 2,
    evidence: {
      kind: "human_pilot",
      matches: 30,
      humans: 3,
      maps: ["wdm2"],
      report: "synthetic test fixture; no real pilot evidence",
      createdAt: 2000,
    },
  };
}

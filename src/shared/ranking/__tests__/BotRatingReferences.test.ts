import { describe, expect, it } from "vitest";
import { canonicalCalibration } from "../BotRatingReferences";
import { botCalibration } from "./_botCalibration";

describe("immutable calibration artifact validation", () => {
  it("copies an evidence-bearing artifact and discards non-schema fields", () => {
    const input = botCalibration();
    const copy = canonicalCalibration({ ...input, secret: "unwanted" });
    input.reference.difficulty.aimAccuracy = 0;
    input.evidence.maps.push("other");
    expect(copy).toEqual(botCalibration());
    expect(JSON.stringify(copy)).not.toContain("unwanted");
  });
  it.each([
    "policy",
    "mu",
    "sigma",
    "bots_only",
    "no_humans",
    "no_games",
    "maps",
    "custom",
    "loading",
    "id",
  ])("rejects %s artifacts", (kind) => {
    const c = botCalibration();
    if (kind === "policy") c.policyVersion = "other";
    if (kind === "mu") c.mu = NaN;
    if (kind === "sigma") c.sigma = 0;
    if (kind === "bots_only") Object.assign(c.evidence, { kind: "bot_only" });
    if (kind === "no_humans") c.evidence.humans = 0;
    if (kind === "no_games") c.evidence.matches = 0;
    if (kind === "maps") c.evidence.maps = ["wdm2", "wdm2"];
    if (kind === "custom") c.reference.preset = "custom";
    if (kind === "loading") c.reference.model.status = "loading";
    if (kind === "id") c.id = "../../bad";
    expect(() => canonicalCalibration(c)).toThrow();
  });
});

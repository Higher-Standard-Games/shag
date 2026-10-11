import { describe, expect, it } from "vitest";
import { canonicalBotReference, sameBotReference } from "../BotReference";
import { botReference } from "./_botReference";

describe("bot calibration metadata", () => {
  it("copies only canonical fields and ignores display/process/path extras", () => {
    const value = botReference();
    const copy = canonicalBotReference({
      ...value,
      name: "Unwanted",
      modelDir: "Unwanted",
      model: { ...value.model, path: "Unwanted" },
    });
    expect(copy).toEqual(value);
    expect(JSON.stringify(copy)).not.toContain("Unwanted");
    value.difficulty.aimAccuracy = 0.1;
    expect(copy.difficulty.aimAccuracy).toBe(0.5);
  });
  it.each([
    "version",
    "digest",
    "fraction",
    "infinity",
    "negative",
    "loaded",
    "none",
    "boolean",
  ])("rejects invalid %s metadata", (kind) => {
    const v = botReference();
    if (kind === "version") Object.assign(v, { version: 2 });
    if (kind === "digest") v.behavior = "short";
    if (kind === "fraction") v.difficulty.aimAccuracy = 2;
    if (kind === "infinity") v.difficulty.reactionTimeMs = Infinity;
    if (kind === "negative") v.difficulty.mistakeRate = -1;
    if (kind === "loaded") v.model.status = "loaded";
    if (kind === "none") v.model.digest = "b".repeat(64);
    if (kind === "boolean") Object.assign(v.model, { tactical: "true" });
    expect(() => canonicalBotReference(v)).toThrow();
  });
  it("compares configurations independently of object field order", () => {
    const v = botReference();
    expect(sameBotReference(v, { ...v, difficulty: { ...v.difficulty, aimAccuracy: 0.5 } })).toBe(true);
    expect(sameBotReference(v, { ...v, goalArbiter: "legacy" })).toBe(false);
    expect(sameBotReference(undefined, undefined)).toBe(true);
    expect(sameBotReference(v, undefined)).toBe(false);
  });
});

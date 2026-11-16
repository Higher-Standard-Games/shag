import { describe, expect, it } from "vitest";
import { isRatingMode, RATING_MODES } from "../RatingPolicy";

describe("rating modes", () => {
  it("are the 1.0 gametypes, and nothing else passes for one", () => {
    expect([...RATING_MODES].sort()).toEqual(["amphi", "duel", "ffa", "snd"]);
    expect(isRatingMode("snd")).toBe(true);
    expect(isRatingMode("survival")).toBe(false);
    expect(isRatingMode("all")).toBe(false);
    expect(isRatingMode(undefined)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { BotPreset } from "../BotMatchRatingGroups";
import { chooseBotPreset } from "../BotPresetChoice";

const unrated = () => null;

describe("chooseBotPreset", () => {
  it("meets a player with no rating yet with Medium", () => {
    expect(chooseBotPreset(null, unrated)).toBe("medium");
  });

  it("climbs the presets in order as a player's skill rises, before any bot is rated", () => {
    expect([10, 25, 33, 45].map((mu) => chooseBotPreset(mu, unrated))).toEqual(["easy", "medium", "hard", "insane"]);
  });

  it("goes by a preset's own rating once it has one", () => {
    // Hard has proved weaker than its place: a player at 27 now meets it.
    const rated = (preset: BotPreset) => (preset === "hard" ? 27.5 : null);
    expect(chooseBotPreset(27, rated)).toBe("hard");
    expect(chooseBotPreset(24, rated)).toBe("medium");
  });
});

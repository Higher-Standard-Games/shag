import { describe, expect, it } from "vitest";
import { chooseBotPreset } from "../BotPresetChoice";

describe("chooseBotPreset", () => {
  it("meets a player with no rating yet with Medium", () => {
    expect(chooseBotPreset(null)).toBe("medium");
  });

  it("climbs the presets in order as a player's skill rises", () => {
    expect([10, 25, 33, 45].map((mu) => chooseBotPreset(mu))).toEqual(["easy", "medium", "hard", "insane"]);
  });

  it("gives a tie to the easier bot", () => {
    expect(chooseBotPreset(25 + 25 / 6)).toBe("medium");
  });
});

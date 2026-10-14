import { describe, expect, it } from "vitest";
import { filterChatText } from "../ChatFilter";

describe("server chat filter", () => {
  it("masks English profanity, case variants and common dictionary substitutions", () => {
    expect(filterChatText("shit SHIT sh1t", 128)).toBe("*** *** ***");
    // Repeated calls must not inherit the cached regex's lastIndex.
    expect(filterChatText("shit", 128)).toBe("***");
    expect(filterChatText("shit", 128)).toBe("***");
  });

  it("masks strong terms inside words, including prefix/suffix bypasses and case variants", () => {
    for (const word of ["fuck", "shit", "cunt", "nigger", "faggot"]) {
      expect(filterChatText(`${word}j x${word.toUpperCase()}x`, 128)).toBe("***j x***x");
    }
    expect(filterChatText("caféshit shitcafé", 128)).toBe("café*** ***café");
    expect(filterChatText("fuckj fuckj", 128)).toBe("***j ***j");
    expect(filterChatText("fuckj", 128)).toBe("***j");
  });

  it("keeps the place-name exception without exempting nearby profanity", () => {
    expect(filterChatText("SCUNTHORPE fuckj Scunthorpefuck", 128)).toBe("SCUNTHORPE ***j Scunthorpe***");
  });

  it("preserves game vocabulary, benign substrings, Unicode and empty input", () => {
    for (const text of [
      "Scunthorpe assassin assault classic shotgun",
      "grab armor and defend the bomb site",
      "こんにちは 👋 café",
      "",
    ]) {
      expect(filterChatText(text, 500)).toBe(text);
    }
  });

  it("bounds both matcher input and output to match and lobby limits", () => {
    for (const limit of [128, 500]) {
      expect(filterChatText(`${"x".repeat(limit - 5)} shit trailing`, limit)).toHaveLength(limit - 1);
      expect(filterChatText("x".repeat(limit + 50), limit)).toHaveLength(limit);
      expect(filterChatText("shit ".repeat(limit), limit).length).toBeLessThanOrEqual(limit);
    }
  });
});

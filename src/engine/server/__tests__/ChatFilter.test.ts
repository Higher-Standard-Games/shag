import { describe, expect, it } from "vitest";
import { FUN_WORDS, filterChatText, filterPlayerName, isOffensiveName } from "../ChatFilter";

const stars = () => "***";

describe("server chat filter", () => {
  it("masks English profanity, case variants and common dictionary substitutions", () => {
    expect(filterChatText("shit SHIT sh1t", 128, stars)).toBe("*** *** ***");
    // Repeated calls must not inherit the cached regex's lastIndex.
    expect(filterChatText("shit", 128, stars)).toBe("***");
    expect(filterChatText("shit", 128, stars)).toBe("***");
  });

  it("masks strong terms inside words, including prefix/suffix bypasses and case variants", () => {
    for (const word of ["fuck", "shit", "cunt", "nigger", "faggot"]) {
      expect(filterChatText(`${word}j x${word.toUpperCase()}x`, 128, stars)).toBe("***j x***x");
    }
    expect(filterChatText("caféshit shitcafé", 128, stars)).toBe("café*** ***café");
    expect(filterChatText("fuckj fuckj", 128, stars)).toBe("***j ***j");
    expect(filterChatText("fuckj", 128, stars)).toBe("***j");
  });

  it("keeps the place-name exception without exempting nearby profanity", () => {
    expect(filterChatText("SCUNTHORPE fuckj Scunthorpefuck", 128, stars)).toBe("SCUNTHORPE ***j Scunthorpe***");
  });

  it("preserves game vocabulary, benign substrings, Unicode and empty input", () => {
    for (const text of [
      "Scunthorpe assassin assault classic shotgun",
      "grab armor and defend the bomb site",
      "こんにちは 👋 café",
      "",
    ]) {
      expect(filterChatText(text, 500, stars)).toBe(text);
    }
  });

  it("bounds both matcher input and output to match and lobby limits", () => {
    for (const limit of [128, 500]) {
      expect(filterChatText(`${"x".repeat(limit - 5)} shit trailing`, limit, stars)).toHaveLength(limit - 1);
      expect(filterChatText("x".repeat(limit + 50), limit, stars)).toHaveLength(limit);
      expect(filterChatText("shit ".repeat(limit), limit, stars).length).toBeLessThanOrEqual(limit);
    }
  });
});

describe("fun words for filtered words", () => {
  it("turns each caught word into a noodle, a fruit or a silly animal", () => {
    const out = filterChatText("What the fuck is this?! You silly shit", 128);
    const words = out.match(/^What the (\w+) is this\?! You silly (\w+)$/);
    expect(words).not.toBeNull();
    expect(FUN_WORDS).toContain(words![1]);
    expect(FUN_WORDS).toContain(words![2]);
  });
});

describe("player names through the chat filter", () => {
  it("gives a name the chat filter would catch a silly name of its own, the same every time", () => {
    for (const name of ["nigger", "xX_FUCKER_Xx", "shit-head", "big_ass"]) {
      const shown = filterPlayerName(name);
      expect(shown).toMatch(/^[A-Z][a-z]+_[A-Z][a-z]+$/);
      expect(shown.length).toBeLessThanOrEqual(16);
      expect(filterPlayerName(name)).toBe(shown);
      expect(isOffensiveName(shown)).toBe(false);
    }
  });

  it("leaves ordinary names alone, words that only contain a mild one included", () => {
    for (const name of ["crizis", "Assassin", "Classic_Bo", "Scunthorpe", "Player_1234", "noodle-bot"]) {
      expect(isOffensiveName(name)).toBe(false);
      expect(filterPlayerName(name)).toBe(name);
    }
  });
});

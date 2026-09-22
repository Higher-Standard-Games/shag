/**
 * Player keys and names: how a key is written and read back, and which names a
 * player may take.
 */

import { describe, expect, it } from "vitest";
import { checkPlayerName, encodeKey, formatKey, KEY_BYTES, keyCharacters, normalizeKey } from "../PlayerIdentity";

const bytes = (fill: (i: number) => number) => Uint8Array.from({ length: KEY_BYTES }, (_, i) => fill(i));

describe("player keys", () => {
  it("writes 15 bytes as 24 Crockford characters", () => {
    expect(encodeKey(bytes(() => 0))).toBe("000000000000000000000000");
    expect(encodeKey(bytes(() => 255))).toBe("ZZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(encodeKey(bytes((i) => i * 17))).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
  });

  it("refuses the wrong number of bytes", () => {
    expect(() => encodeKey(new Uint8Array(14))).toThrow();
  });

  it("reads a key back however a player pastes it", () => {
    const key = encodeKey(bytes((i) => (i * 37 + 11) & 255));
    expect(normalizeKey(key)).toBe(key);
    expect(normalizeKey(formatKey(key))).toBe(key);
    expect(normalizeKey(formatKey(key).toLowerCase())).toBe(key);
    expect(normalizeKey(` ${key.slice(0, 12)} ${key.slice(12)} `)).toBe(key);
  });

  it("reads O as 0 and I or L as 1", () => {
    const key = "0123456789ABCDEFGHJKMNPQ";
    expect(normalizeKey("O123456789ABCDEFGHJKMNPQ")).toBe(key);
    expect(normalizeKey("0I23456789ABCDEFGHJKMNPQ")).toBe(key);
    expect(normalizeKey("0l23456789ABCDEFGHJKMNPQ")).toBe(key);
  });

  it("keeps a key that happens to start like the prefix", () => {
    // A canonical key can start with WASH01, which reads like WASHOI once mistyped
    const key = "WASH01234567890123456789";
    expect(normalizeKey(key)).toBe(key);
    expect(normalizeKey("WASHOI234567890123456789")).toBe(key);
  });

  it("rejects what can't be a key", () => {
    expect(normalizeKey("")).toBeNull();
    expect(normalizeKey("tooshort")).toBeNull();
    expect(normalizeKey("0123456789ABCDEFGHJKMNPQR")).toBeNull();
    expect(normalizeKey("0123456789ABCDEFGHJKMNPU")).toBeNull();
  });

  it("shows a key in groups of four after WASHOI", () => {
    expect(formatKey("0123456789ABCDEFGHJKMNPQ")).toBe("WASHOI-0123-4567-89AB-CDEF-GHJK-MNPQ");
  });
});

describe("part-typed keys", () => {
  it("keeps the key characters typed so far, in order", () => {
    expect(keyCharacters("6hzq-amxe")).toBe("6HZQAMXE");
    expect(keyCharacters("WASHOI-6HZQ")).toBe("6HZQ");
    expect(keyCharacters("  6h zq ")).toBe("6HZQ");
  });

  it("reads O as 0 and I or L as 1, and drops what can't be in a key", () => {
    expect(keyCharacters("oil?!")).toBe("011");
  });

  it("stops at a whole key", () => {
    expect(keyCharacters("6HZQAMXE8844KN0A9WCM71TYZZZZ")).toBe("6HZQAMXE8844KN0A9WCM71TY");
  });
});

describe("player names", () => {
  it("takes 2 to 16 letters, digits, underscores and dashes", () => {
    expect(checkPlayerName("Sundflux")).toBeNull();
    expect(checkPlayerName("ab")).toBeNull();
    expect(checkPlayerName("a-b_c-1234567890")).toBeNull();
    expect(checkPlayerName("a")).toBe("name_invalid");
    expect(checkPlayerName("a".repeat(17))).toBe("name_invalid");
    expect(checkPlayerName("has space")).toBe("name_invalid");
    expect(checkPlayerName("Ünicode")).toBe("name_invalid");
  });

  it("reserves default names in any capitals", () => {
    expect(checkPlayerName("Player_1234")).toBe("name_reserved");
    expect(checkPlayerName("PLAYER_9")).toBe("name_reserved");
    expect(checkPlayerName("Player_one")).toBeNull();
    expect(checkPlayerName("Player1234")).toBeNull();
  });

  it("reserves bot names, numbered copies included", () => {
    expect(checkPlayerName("Nova")).toBe("name_reserved");
    expect(checkPlayerName("nova")).toBe("name_reserved");
    expect(checkPlayerName("Nova_2")).toBe("name_reserved");
    expect(checkPlayerName("Novak")).toBeNull();
  });
});

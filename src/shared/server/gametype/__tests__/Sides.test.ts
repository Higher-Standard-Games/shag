import { describe, expect, it } from "vitest";
import { isSide, sameSide } from "../GametypeTypes";

describe("sides", () => {
  it("knows udon and soba as sides, and ffa and spectator as not", () => {
    expect(isSide("udon")).toBe(true);
    expect(isSide("soba")).toBe(true);
    expect(isSide("ffa")).toBe(false);
    expect(isSide("spectator")).toBe(false);
    expect(isSide(undefined)).toBe(false);
  });

  it("puts two players on one side only when it is a real side", () => {
    expect(sameSide("udon", "udon")).toBe(true);
    expect(sameSide("udon", "soba")).toBe(false);
    // In a free-for-all everyone is an enemy, and spectators share nothing
    expect(sameSide("ffa", "ffa")).toBe(false);
    expect(sameSide("spectator", "spectator")).toBe(false);
  });
});

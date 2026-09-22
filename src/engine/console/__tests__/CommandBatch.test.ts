/**
 * A `--exec` batch is separated by semicolons, which some commands also use
 * inside an argument: `sim replay "W 60; JUMP 1"` is one command, not three.
 */

import { describe, expect, it } from "vitest";
import { splitCommandBatch } from "../CommandBatch";

describe("splitCommandBatch", () => {
  it("splits on semicolons and newlines", () => {
    expect(splitCommandBatch("bsp load wdm2; bsp info; quit")).toEqual(["bsp load wdm2", "bsp info", "quit"]);
    expect(splitCommandBatch("pk3 stats\nbsp info\r\nquit")).toEqual(["pk3 stats", "bsp info", "quit"]);
  });

  it("drops empty commands and surrounding space", () => {
    expect(splitCommandBatch("  bsp info ;; ; quit  ")).toEqual(["bsp info", "quit"]);
    expect(splitCommandBatch("   ")).toEqual([]);
  });

  it("keeps a quoted argument whole, semicolons and all", () => {
    expect(splitCommandBatch('sim replay "W+CROUCH 60; JUMP 1; W 30"; quit')).toEqual([
      'sim replay "W+CROUCH 60; JUMP 1; W 30"',
      "quit",
    ]);
  });

  it("leaves the quotes for the argument parser", () => {
    expect(splitCommandBatch('echo "hello; world"')).toEqual(['echo "hello; world"']);
  });

  it("does not lose a command when a quote is never closed", () => {
    expect(splitCommandBatch('echo "unterminated; quit')).toEqual(['echo "unterminated; quit']);
  });
});

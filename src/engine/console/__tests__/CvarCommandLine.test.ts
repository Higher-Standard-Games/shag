/**
 * Typing a cvar at the console. A set that did not happen has to read as a
 * failure, because headless and batch runners take their exit code from it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cvar } from "../../core/Cvar";
import { CommandRegistry } from "../CommandRegistry";

const registry = CommandRegistry.getInstance();

beforeEach(() => {
  Cvar.register("r_testbloom", 1.5, { type: "float", min: 0, max: 4, persist: false });
});

afterEach(() => {
  Cvar.set("r_testbloom", 1.5);
});

describe("a cvar typed at the console", () => {
  it("reports its value when given no argument", async () => {
    const result = await registry.executeChecked("r_testbloom");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("r_testbloom");
  });

  it("takes a number", async () => {
    const result = await registry.executeChecked("r_testbloom 2.5");
    expect(result.ok).toBe(true);
    expect(Cvar.getNumber("r_testbloom")).toBe(2.5);
  });

  it("fails on text, and leaves the value alone", async () => {
    const result = await registry.executeChecked("r_testbloom abc");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Failed to set r_testbloom");
    expect(Cvar.getNumber("r_testbloom")).toBe(1.5);
  });

  it("clamps a number outside its range rather than failing", async () => {
    const result = await registry.executeChecked("r_testbloom 99");
    expect(result.ok).toBe(true);
    expect(Cvar.getNumber("r_testbloom")).toBe(4);
  });
});

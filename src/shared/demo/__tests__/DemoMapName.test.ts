import { describe, expect, it } from "vitest";
import { normalizeDemoMapName } from "../DemoMapName";

describe("normalizeDemoMapName", () => {
  it("passes through a bare lowercased key unchanged", () => {
    expect(normalizeDemoMapName("wdm7")).toBe("wdm7");
  });

  it("lowercases mixed case", () => {
    expect(normalizeDemoMapName("WDM7")).toBe("wdm7");
    expect(normalizeDemoMapName("AeroWalk")).toBe("aerowalk");
  });

  it("strips a directory prefix (forward slashes)", () => {
    expect(normalizeDemoMapName("maps/wdm7")).toBe("wdm7");
  });

  it("strips a directory prefix (back slashes)", () => {
    expect(normalizeDemoMapName("maps\\WDM7")).toBe("wdm7");
  });

  it("strips a .bsp extension", () => {
    expect(normalizeDemoMapName("wdm7.bsp")).toBe("wdm7");
    expect(normalizeDemoMapName("maps/WDM7.BSP")).toBe("wdm7");
  });

  it("strips a .pk3 extension", () => {
    expect(normalizeDemoMapName("wdm7.pk3")).toBe("wdm7");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDemoMapName("  wdm7  ")).toBe("wdm7");
  });

  it("returns empty string for empty/nullish input", () => {
    expect(normalizeDemoMapName("")).toBe("");
    expect(normalizeDemoMapName(null)).toBe("");
    expect(normalizeDemoMapName(undefined)).toBe("");
  });

  it("does not strip non-map extensions or interior dots", () => {
    expect(normalizeDemoMapName("q3dm6_rev2")).toBe("q3dm6_rev2");
    expect(normalizeDemoMapName("map.v2")).toBe("map.v2");
  });
});

import { describe, expect, it } from "vitest";
import { formatAmmoDigits, parseAmmoCounter } from "../AmmoCounterDisplay";

describe("parseAmmoCounter", () => {
  it("parses the plasmagun ammoCounter directive", () => {
    const cfg = `
      firesound "sounds/weapons/plasmagun_strong1"
      //ammoCounter font_family font_size digit_width digit_height digit_alpha icon_size icon_alpha
      ammoCounter "LCDdigits" 46 0.18 0.34 0.75 0.22 0.3
      barrel 850 0.5 0.5
    `;
    expect(parseAmmoCounter(cfg)).toEqual({
      fontFamily: "LCDdigits",
      fontSize: 46,
      digitWidth: 0.18,
      digitHeight: 0.34,
      digitAlpha: 0.75,
      iconSize: 0.22,
      iconAlpha: 0.3,
    });
  });

  it("returns null when the weapon declares no counter", () => {
    expect(parseAmmoCounter("firesound \"x\"\nbarrel 850 0.5 0.5")).toBeNull();
  });

  it("ignores a commented-out ammoCounter line", () => {
    expect(parseAmmoCounter("// ammoCounter \"LCDdigits\" 46 0.18 0.34 0.75 0.22 0.3")).toBeNull();
  });

  it("tolerates an unquoted font and extra whitespace", () => {
    const cfg = "ammoCounter   LCDdigits   40   0.2 0.3 0.8 0.25 0.4";
    expect(parseAmmoCounter(cfg)?.fontFamily).toBe("LCDdigits");
    expect(parseAmmoCounter(cfg)?.digitWidth).toBe(0.2);
  });

  it("rejects a malformed line with too few numbers", () => {
    expect(parseAmmoCounter('ammoCounter "LCDdigits" 46 0.18')).toBeNull();
  });
});

describe("formatAmmoDigits", () => {
  it("right-aligns and blanks leading zeros", () => {
    expect(formatAmmoDigits(7)).toBe("  7");
    expect(formatAmmoDigits(42)).toBe(" 42");
    expect(formatAmmoDigits(137)).toBe("137");
  });

  it("clamps out-of-range values", () => {
    expect(formatAmmoDigits(9999)).toBe("999");
    expect(formatAmmoDigits(-5)).toBe("  0");
    expect(formatAmmoDigits(0)).toBe("  0");
  });

  it("truncates fractional ammo toward zero", () => {
    expect(formatAmmoDigits(12.9)).toBe(" 12");
  });
});

import { describe, expect, it } from "vitest";
import { blend, GradeMixer, lutStrip, neutralGrade } from "../GradeProfiles";

describe("GradeProfiles", () => {
  it("is neutral with nothing active", () => {
    expect(new GradeMixer().update(0.016, "neutral", null)).toEqual(neutralGrade());
  });

  it("blends by weight from neutral", () => {
    const half = blend([{ profile: { saturation: 0.5, gain: [2, 1, 1] }, weight: 0.5 }]);
    expect(half.saturation).toBeCloseTo(0.75);
    expect(half.gain[0]).toBeCloseTo(1.5);
  });

  it("weighs zones by distance from the point", () => {
    const mixer = new GradeMixer();
    mixer.define("test", { exposure: -1 });
    mixer.setZones([{ profile: "test", x: 0, y: 0, z: 0, radius: 100, falloff: 100 }]);
    expect(mixer.update(0, "neutral", { x: 50, y: 0, z: 0 }).exposure).toBeCloseTo(-1);
    expect(mixer.update(0, "neutral", { x: 150, y: 0, z: 0 }).exposure).toBeCloseTo(-0.5);
    expect(mixer.update(0, "neutral", { x: 300, y: 0, z: 0 }).exposure).toBeCloseTo(0);
  });

  it("fades pushed layers in and out", () => {
    const mixer = new GradeMixer();
    mixer.define("test", { exposure: -1 });
    mixer.push("test", { fade: 2 });
    expect(mixer.update(1, "neutral", null).exposure).toBeCloseTo(-0.5);
    expect(mixer.update(1, "neutral", null).exposure).toBeCloseTo(-1);
    mixer.pop("test", { fade: 1 });
    expect(mixer.update(1, "neutral", null).exposure).toBeCloseTo(0);
    expect(mixer.weights).toEqual({});
  });

  it("keeps the two heaviest lookup tables", () => {
    const out = blend([
      { profile: { lut: "a" }, weight: 0.2 },
      { profile: { lut: "b" }, weight: 0.9 },
      { profile: { lut: "c" }, weight: 0.5 },
    ]);
    expect(out.luts.map((l) => l.lut)).toEqual(["b", "c"]);
  });

  it("writes an identity strip with green down the rows", () => {
    const bytes = lutStrip((rgb) => rgb);
    const at = (x: number, y: number) => [...bytes.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3)];
    expect(at(0, 0)).toEqual([0, 0, 0]);
    expect(at(15, 0)).toEqual([255, 0, 0]);
    expect(at(0, 15)).toEqual([0, 255, 0]);
    expect(at(255, 15)).toEqual([255, 255, 255]);
  });
});

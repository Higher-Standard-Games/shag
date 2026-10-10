import { describe, expect, it } from "vitest";
import { formatBounds, placedBounds } from "../EditorModelAsset";

const BARREL = { min: { x: -8, y: -4, z: 0 }, max: { x: 8, y: 4, z: 32 } };

describe("model bounds", () => {
  it("reports a model's size in whole units", () => {
    expect(formatBounds(BARREL)).toBe("16×8×32 units");
    expect(formatBounds(null)).toBe("size unknown");
  });

  it("scales the extents and turns them counter-clockwise from above, as Quake's yaw does", () => {
    expect(placedBounds(BARREL, 2, 0)).toEqual({ min: { x: -16, y: -8, z: 0 }, max: { x: 16, y: 8, z: 64 } });
    const turned = placedBounds({ min: { x: 0, y: -1, z: 0 }, max: { x: 10, y: 1, z: 4 } }, 1, 90);
    // a model pointing along +X points along +Y after a 90 degree yaw
    expect(turned.min.x).toBeCloseTo(-1);
    expect(turned.max.x).toBeCloseTo(1);
    expect(turned.min.y).toBeCloseTo(0);
    expect(turned.max.y).toBeCloseTo(10);
  });
});

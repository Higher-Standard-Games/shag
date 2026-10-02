import { describe, expect, it } from "vitest";
import { pickResizeEdge, resizeBox } from "../EditorBoxTools";

const brush = {
  id: "box",
  min: { x: 0, y: 0, z: 0 },
  max: { x: 64, y: 96, z: 48 },
  shader: "blx/blx_grid",
};

describe("box edge tools", () => {
  it("chooses a visible edge but not the interior or hidden axis", () => {
    expect(pickResizeEdge(brush, "x", "z", 0, 24, 8)).toEqual({ axis: "x", side: "min" });
    expect(pickResizeEdge(brush, "x", "z", 32, 48, 8)).toEqual({ axis: "z", side: "max" });
    expect(pickResizeEdge(brush, "x", "z", 32, 24, 8)).toBeNull();
    expect(pickResizeEdge(brush, "x", "z", -1, 24, 8)).toBeNull();
  });

  it("clamps inversion to one grid cell and leaves other coordinates alone", () => {
    const resized = resizeBox(brush, { axis: "y", side: "max" }, -100, 16);
    expect(resized.max.y).toBe(16);
    expect(resized.min).toEqual(brush.min);
    expect(brush.max.y).toBe(96);
  });
});

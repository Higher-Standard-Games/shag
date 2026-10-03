import { describe, expect, it } from "vitest";
import { pickResizeEdge, resizeBox, resizeCursor } from "../EditorBoxTools";

const brush = {
  id: "box",
  min: { x: 0, y: 0, z: 0 },
  max: { x: 64, y: 96, z: 48 },
  shader: "blx/blx_grid",
};

describe("box edge tools", () => {
  it("chooses a visible edge but not the interior or hidden axis", () => {
    expect(pickResizeEdge(brush, "x", "z", 0, 24, 8)).toEqual({ faces: [{ axis: "x", side: "min" }] });
    expect(pickResizeEdge(brush, "x", "z", 32, 48, 8)).toEqual({ faces: [{ axis: "z", side: "max" }] });
    expect(pickResizeEdge(brush, "x", "z", 32, 24, 8)).toBeNull();
    expect(pickResizeEdge(brush, "x", "z", -1, 24, 8)).toBeNull();
  });

  it("chooses a corner — both axes at once — near a box's corner", () => {
    expect(pickResizeEdge(brush, "x", "z", 2, 46, 8)).toEqual({
      faces: [
        { axis: "x", side: "min" },
        { axis: "z", side: "max" },
      ],
    });
    expect(pickResizeEdge(brush, "x", "z", 62, 2, 8)).toEqual({
      faces: [
        { axis: "x", side: "max" },
        { axis: "z", side: "min" },
      ],
    });
    // just one axis away from the corner falls back to that single edge
    expect(pickResizeEdge(brush, "x", "z", 2, 24, 8)).toEqual({ faces: [{ axis: "x", side: "min" }] });
  });

  it("clamps inversion to one grid cell and leaves other coordinates alone", () => {
    const resized = resizeBox(brush, { faces: [{ axis: "y", side: "max" }] }, { y: -100 }, 16);
    expect(resized.max.y).toBe(16);
    expect(resized.min).toEqual(brush.min);
    expect(brush.max.y).toBe(96);
  });

  it("resizes both faces of a corner from one set of values", () => {
    const resized = resizeBox(
      brush,
      {
        faces: [
          { axis: "x", side: "min" },
          { axis: "z", side: "max" },
        ],
      },
      { x: -16, z: 80 },
      8,
    );
    expect(resized.min.x).toBe(-16);
    expect(resized.max.z).toBe(80);
    expect(resized.max.x).toBe(brush.max.x);
    expect(resized.min.z).toBe(brush.min.z);
  });

  it("ignores an axis with no value, such as a corner dragged off one visible edge's tolerance", () => {
    const resized = resizeBox(brush, { faces: [{ axis: "x", side: "min" }] }, { z: 999 }, 8);
    expect(resized).toEqual(brush);
  });

  it("picks the resize cursor from the pane's u axis: ↔/↕ for an edge, ↗↙/↖↘ for a corner", () => {
    expect(resizeCursor({ faces: [{ axis: "x", side: "min" }] }, "x")).toBe("ew-resize");
    expect(resizeCursor({ faces: [{ axis: "z", side: "max" }] }, "x")).toBe("ns-resize");
    // left+top (min, max on a screen-flipped v axis) and right+bottom are the same "\" diagonal
    expect(
      resizeCursor(
        {
          faces: [
            { axis: "x", side: "min" },
            { axis: "z", side: "max" },
          ],
        },
        "x",
      ),
    ).toBe("nwse-resize");
    expect(
      resizeCursor(
        {
          faces: [
            { axis: "x", side: "max" },
            { axis: "z", side: "min" },
          ],
        },
        "x",
      ),
    ).toBe("nwse-resize");
    // left+bottom and right+top are the "/" diagonal
    expect(
      resizeCursor(
        {
          faces: [
            { axis: "x", side: "min" },
            { axis: "z", side: "min" },
          ],
        },
        "x",
      ),
    ).toBe("nesw-resize");
  });
});

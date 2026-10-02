import { describe, expect, it } from "vitest";
import { brushBounds, PLANE_AXES, panCenter, paneToWorld, zoomCenter } from "../EditorViewTools";

describe("editor pane navigation", () => {
  it.each(["xy", "xz", "yz"] as const)("keeps the cursor's world position fixed when zooming %s", (plane) => {
    const center = { x: -200, y: 300, z: 100 };
    const anchor = paneToWorld(plane, center, 0.5, 91, -47);
    const zoomed = zoomCenter(plane, center, 0.5, 2, 91, -47);
    expect(paneToWorld(plane, zoomed, 2, 91, -47)).toEqual(anchor);
    const axes = PLANE_AXES[plane];
    expect(zoomed[axes.hidden]).toBe(center[axes.hidden]);
    const panned = panCenter(plane, center, 0.5, 80, -40);
    expect(paneToWorld(plane, panned, 0.5, 80, -40)).toEqual([center[axes.u], center[axes.v]]);
  });

  it("frames the combined bounds of brushes away from the origin", () => {
    expect(
      brushBounds([
        { id: "a", min: { x: 100, y: -200, z: 64 }, max: { x: 164, y: -136, z: 128 }, shader: "grid" },
        { id: "b", min: { x: 200, y: -300, z: 0 }, max: { x: 300, y: -100, z: 64 }, shader: "grid" },
      ]),
    ).toEqual({ center: { x: 200, y: -200, z: 64 }, size: { x: 200, y: 200, z: 128 } });
    expect(brushBounds([])).toBeNull();
  });
});

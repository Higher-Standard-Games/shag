import { describe, expect, it } from "vitest";
import { drawBounds, moveBox } from "../EditorGesture";

const axes = { u: "x", v: "y", hidden: "z" } as const;

describe("transient brush gestures", () => {
  it("normalizes reverse drags and uses the captured work plane and grid thickness", () => {
    expect(drawBounds(axes, [64, 32], [-32, -64], 128, 16)).toEqual({
      min: { x: -32, y: -64, z: 128 },
      max: { x: 64, y: 32, z: 144 },
    });
    expect(drawBounds(axes, [64, 32], [64, -64], 128, 16)).toBeNull();
  });

  it("moves only the visible axes without mutating the source brush", () => {
    const source = {
      id: "box",
      min: { x: 0, y: 0, z: 128 },
      max: { x: 64, y: 64, z: 144 },
      shader: "blx/blx_grid",
    };
    const moved = moveBox(source, axes, 16, -32);
    expect(moved.min).toEqual({ x: 16, y: -32, z: 128 });
    expect(moved.max).toEqual({ x: 80, y: 32, z: 144 });
    expect(source.min).toEqual({ x: 0, y: 0, z: 128 });
  });
});

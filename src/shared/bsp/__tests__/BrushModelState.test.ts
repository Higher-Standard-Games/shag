import { describe, expect, it } from "vitest";
import { BrushModelState, extractBrushModels } from "../BrushModelState";

describe("brush model state", () => {
  it("extracts explosive targets and restores only known geometry", () => {
    const model = { mins: [0, 0, 0], maxs: [10, 20, 30] };
    const definitions = extractBrushModels(
      [
        {
          classname: "func_explosive",
          properties: { model: "*1", targetname: "site_a", delay: "0.6", debris1: "chunk.md3" },
        },
        { classname: "func_explosive", properties: { model: "*2", spawnflags: "1" } },
        { classname: "func_explosive", properties: { model: "*999" } },
      ],
      [model, model, model],
    );
    expect(definitions[0]).toMatchObject({
      targetname: "site_a",
      delay: 0.6,
      debris: ["chunk.md3"],
      max: { x: 10, y: 30, z: 20 },
    });
    const state = new BrushModelState(definitions);
    expect(state.snapshot()).toEqual([2]);
    state.restore([1, 999]);
    expect(state.isEnabled(1)).toBe(false);
    expect(state.snapshot()).toEqual([1, 2]);
    state.reset();
    expect(state.isEnabled(1)).toBe(true);
  });
});

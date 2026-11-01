import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cvar } from "../core/Cvar";
import { getDynamicLightCluster } from "../lighting/DynamicLightCluster";
import { renderScaleLevel } from "../rendering/RenderScale";
import { renderToggle } from "../rendering/RenderToggles";
import { RenderVars } from "../rendering/RenderVars";
import { getPointLightPool } from "../weapon/PointLightPool";

afterEach(() => {
  getPointLightPool().dispose();
  vi.restoreAllMocks();
});

describe("frame-cost switches", () => {
  it("draws a share of the window's pixels, never below a quarter", () => {
    expect(renderScaleLevel(1)).toBe(1);
    expect(renderScaleLevel(0.5)).toBe(2);
    expect(renderScaleLevel(0.1)).toBe(4);
    expect(renderScaleLevel(Number.NaN)).toBe(1);
  });

  it("counts a switch nobody registered as on, and follows it once registered", () => {
    const get = vi.spyOn(Cvar, "get").mockReturnValue(undefined);
    expect(renderToggle("r_gibs")).toBe(true);
    get.mockReturnValue(0);
    expect(renderToggle("r_gibs")).toBe(false);
  });

  it("builds no dynamic lights, and so no light cluster, with r_dynamiclight off", () => {
    RenderVars.getInstance();
    Cvar.set("r_dynamiclight", 0);
    const scene = new Scene(new NullEngine());
    try {
      getPointLightPool().init(scene);
      expect(scene.lights).toHaveLength(0);
      expect(getDynamicLightCluster(scene)).toBeNull();
      expect(getPointLightPool().acquire(Vector3.Zero(), Color3.White(), 1, 10)).toBeNull();

      // Back on, the next map's pool has its lights again
      Cvar.set("r_dynamiclight", 1);
      const next = new Scene(scene.getEngine());
      getPointLightPool().init(next);
      expect(next.lights.length).toBeGreaterThan(0);
      expect(getPointLightPool().acquire(Vector3.Zero(), Color3.White(), 1, 10)).not.toBeNull();
    } finally {
      Cvar.set("r_dynamiclight", 1);
      scene.getEngine().dispose();
    }
  });
});

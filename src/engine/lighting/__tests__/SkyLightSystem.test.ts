import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkyLightSystem } from "../SkyLightSystem";

afterEach(() => SkyLightSystem.resetInstance());

describe("SkyLightSystem across map loads", () => {
  it("keeps the same lights, in the same order, when a map reloads on the same scene", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const sky = SkyLightSystem.getInstance();
      sky.init(scene, { ambientIntensity: 0.5 });
      const before = [...scene.lights];
      expect(before.map((light) => light.name)).toEqual(["worldFillLight", "sunLight", "moonLight", "ambientLight"]);

      // A light added later, like the view weapon's, must keep its place too.
      sky.init(scene, { ambientIntensity: 0.7 });

      expect(scene.lights).toEqual(before);
      expect(before.every((light) => !light.isDisposed())).toBe(true);

      // And they end up lit exactly as freshly built ones with that configuration.
      const freshScene = new Scene(engine);
      SkyLightSystem.resetInstance();
      SkyLightSystem.getInstance().init(freshScene, { ambientIntensity: 0.7 });
      for (const name of ["sunLight", "moonLight", "ambientLight", "worldFillLight"]) {
        expect(scene.getLightByName(name)?.intensity).toBe(freshScene.getLightByName(name)?.intensity);
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("rebuilds the lights a scene clear disposed", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const sky = SkyLightSystem.getInstance();
      sky.init(scene);
      const sun = scene.getLightByName("sunLight")!;
      sun.dispose();

      sky.init(scene);

      const rebuilt = scene.getLightByName("sunLight");
      expect(rebuilt).not.toBeNull();
      expect(rebuilt).not.toBe(sun);
      expect(scene.lights.filter((light) => light.name === "ambientLight")).toHaveLength(1);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("fills the world from map load and leaves the first-person weapon to its own light", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      SkyLightSystem.getInstance().init(scene);
      const fill = scene.getLightByName("worldFillLight")!;
      const world = CreateBox("wall", {}, scene);
      const gun = CreateBox("gun", {}, scene);
      gun.layerMask = 0x10000000;
      expect(fill.canAffectMesh(world)).toBe(true);
      expect(fill.canAffectMesh(gun)).toBe(false);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

describe("SkyLightSystem day/night clock", () => {
  it("saves the animated time of day once a game minute, not every frame", async () => {
    const { Cvar } = await import("../../core/Cvar");
    const { RenderVars } = await import("../../rendering/RenderVars");
    RenderVars.getInstance();
    Cvar.set("r_daynight", 1);
    Cvar.set("r_daynight_animate", 1);
    Cvar.set("r_daynight_length", 1440); // one game minute per real second
    Cvar.set("r_daynight_time", 0.5);
    const set = vi.spyOn(Cvar, "set");
    try {
      const sky = SkyLightSystem.getInstance();
      for (let frame = 0; frame < 120; frame++) sky.update(1000 / 60); // two seconds
      const writes = set.mock.calls.filter(([name]) => name === "r_daynight_time").length;
      expect(writes).toBeGreaterThanOrEqual(1);
      expect(writes).toBeLessThanOrEqual(2);
      // Saved to within a game minute of the running clock, and fractional (it
      // used to be an int cvar, which rounded every write to 0 or 1)
      expect(Math.abs(Number(Cvar.get("r_daynight_time")) - (0.5 + 2 / 1440))).toBeLessThanOrEqual(1 / 1440);

      // A time typed in the console takes over the clock
      Cvar.set("r_daynight_time", 0.25);
      sky.update(1000 / 60);
      expect(Number(Cvar.get("r_daynight_time"))).toBe(0.25);
    } finally {
      set.mockRestore();
      for (const name of ["r_daynight", "r_daynight_animate", "r_daynight_length", "r_daynight_time"]) Cvar.reset(name);
    }
  });
});

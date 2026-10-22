/**
 * World fog through Babylon's scene fog: which fog is drawn under the cvars
 * (Warfork's r_main.c rules), how it lands in scene fog, and how fog volumes
 * and the underwater view borrow the scene fog and hand it back.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { Cvar } from "../../core/Cvar";
import { parseWorldFog } from "../../loader/bsp/WorldFog";
import { type FogCvars, resolveWorldFog, WorldFogController } from "../WorldFogController";

const cvars = (over: Partial<FogCvars> = {}): FogCvars => ({
  enabled: true,
  distance: 0,
  color: "0.75 0.75 0.75",
  minDist: -1,
  heightClear: 99999,
  heightFull: -99999,
  sunDir: "",
  sunColor: "",
  sunInscatter: -1,
  skyBlend: -1,
  ...over,
});
const wdm11 = parseWorldFog({ fog: "10000 0.843137 0.576471 0.25098 700" });

describe("resolveWorldFog", () => {
  it("draws the map's fog, and none with r_fog 0", () => {
    expect(resolveWorldFog(wdm11, cvars(), false)).toBe(wdm11);
    expect(resolveWorldFog(wdm11, cvars({ enabled: false }), true)).toBeNull();
    expect(resolveWorldFog(null, cvars(), false)).toBeNull();
  });

  it("ignores the overrides without developer mode", () => {
    expect(resolveWorldFog(null, cvars({ distance: 3000 }), false)).toBeNull();
    expect(resolveWorldFog(wdm11, cvars({ distance: 3000, minDist: 0 }), false)?.minDist).toBe(700);
  });

  it("lets r_fog_distance make the cvars the source, on any map", () => {
    const fog = resolveWorldFog(null, cvars({ distance: 3000 }), true);
    expect(fog?.density).toBeCloseTo(3 / 3000);
    expect(fog?.color).toEqual([0.75, 0.75, 0.75]);
    expect(fog?.minDist).toBe(0);
    // A fogless map with no colour cvar has nothing to draw (Warfork's alpha 0)
    expect(resolveWorldFog(null, cvars({ distance: 3000, color: "" }), true)).toBeNull();
  });

  it("takes the colour from r_fog_color even over a map's own, as Warfork does", () => {
    const fog = resolveWorldFog(wdm11, cvars({ distance: 10000 }), true);
    expect(fog?.color).toEqual([0.75, 0.75, 0.75]);
    expect(fog?.minDist).toBe(700);
  });

  it("overrides start, heights, sun and sky one by one", () => {
    const fog = resolveWorldFog(
      wdm11,
      cvars({ distance: 10000, minDist: 0, heightFull: 256, sunDir: "0 0 2", sunColor: "1 0.5 0 8", skyBlend: 1 }),
      true,
    );
    expect(fog?.minDist).toBe(0);
    expect(fog?.height).toEqual({ clear: 0, full: 256 });
    expect(fog?.sun).toEqual({ dir: [0, 0, 1], color: [1, 0.5, 0], intensity: 1.5, exponent: 8 });
    expect(fog?.sky).toEqual({ horizonBias: 0.05, horizonScale: 2, zenithFalloff: 3 });
    expect(resolveWorldFog(wdm11, cvars({ distance: 10000, skyBlend: 0 }), true)?.sky).toBeNull();
  });
});

describe("WorldFogController", () => {
  const scene = () => new Scene(new NullEngine());
  afterEach(() => {
    WorldFogController.getInstance().setMap(null, null);
    Cvar.set("r_fog", true);
  });

  it("puts the map's fog in scene fog as EXP from the start distance", () => {
    WorldFogController.getInstance().registerCvars();
    const s = scene();
    WorldFogController.getInstance().setMap(s, wdm11);
    expect(s.fogMode).toBe(Scene.FOGMODE_EXP);
    expect(s.fogDensity).toBeCloseTo(3 / 10000);
    expect(s.fogStart).toBe(700);
    expect(s.fogColor.asArray()).toEqual([0.843137, 0.576471, 0.25098]);

    Cvar.set("r_fog", false);
    expect(s.fogMode).toBe(Scene.FOGMODE_NONE);
  });

  it("fogs only the map's scene, not a preview or the menu logo", () => {
    WorldFogController.getInstance().registerCvars();
    const map = scene();
    const preview = scene();
    WorldFogController.getInstance().setMap(map, wdm11);
    expect(WorldFogController.getInstance().isDrawingIn(map)).toBe(true);
    expect(WorldFogController.getInstance().isDrawingIn(preview)).toBe(false);
  });

  it("clears the fog when the map goes", () => {
    const s = scene();
    WorldFogController.getInstance().setMap(s, wdm11);
    WorldFogController.getInstance().setMap(null, null);
    expect(s.fogMode).toBe(Scene.FOGMODE_NONE);
  });

  it("lets fog volumes and the underwater view borrow the scene fog and hand it back", () => {
    const controller = WorldFogController.getInstance();
    const s = scene();
    controller.setMap(s, wdm11);
    controller.suspend("fog-volume");
    controller.suspend("underwater");
    s.fogMode = Scene.FOGMODE_EXP2;
    controller.resume("underwater");
    expect(s.fogMode).toBe(Scene.FOGMODE_EXP2);
    controller.resume("fog-volume");
    expect(s.fogMode).toBe(Scene.FOGMODE_EXP);
    expect(s.fogStart).toBe(700);
  });
});

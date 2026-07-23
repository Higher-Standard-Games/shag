/**
 * MapAreaLightEntities — pure `light_area` entity parsing. Locks the
 * Quake→Babylon origin, the angle→emit-direction convention (incl. up/down), and
 * size/color/intensity defaults, so they can be confirmed against a real map.
 */

import { describe, expect, it } from "vitest";
import type { BspEntity } from "../../loader/bsp/BspLoader";
import { resolveAreaLightEntities } from "../MapAreaLightEntities";

const ent = (classname: string, properties: Record<string, string>): BspEntity => ({ classname, properties });

describe("resolveAreaLightEntities", () => {
  it("parses origin, size, color, intensity, and skips non-light_area", () => {
    const specs = resolveAreaLightEntities([
      ent("light_area", { origin: "10 20 30", _size: "100 50", _color: "255 0 0", light: "8" }),
      ent("light", { origin: "0 0 0" }),
    ]);
    expect(specs).toHaveLength(1);
    const [s] = specs;
    expect(s.position.asArray()).toEqual([10, 30, 20]); // Quake -> Babylon
    expect(s.width).toBe(100);
    expect(s.height).toBe(50);
    expect(s.color?.asArray()).toEqual([1, 0, 0]);
    expect(s.intensity).toBe(8);
  });

  it("applies defaults for size/intensity when absent", () => {
    const [s] = resolveAreaLightEntities([ent("light_area", { origin: "0 0 0" })]);
    expect([s.width, s.height]).toEqual([64, 40]);
    expect(s.intensity).toBe(4);
    expect(s.color).toBeUndefined();
  });

  it("maps Q3 angle to an emit direction (yaw, up=-1, down=-2)", () => {
    const dir = (angle: string) => resolveAreaLightEntities([ent("light_area", { origin: "0 0 0", angle })])[0].faceDir;

    const yaw90 = dir("90");
    expect(yaw90.x).toBeCloseTo(0, 5);
    expect(yaw90.z).toBeCloseTo(1, 5);

    expect(dir("-1").asArray()).toEqual([0, 1, 0]); // up
    expect(dir("-2").asArray()).toEqual([0, -1, 0]); // down
    expect(dir("0").x).toBeCloseTo(1, 5); // east
  });

  it("prefers an explicit _arealight_dir over angle", () => {
    const [s] = resolveAreaLightEntities([ent("light_area", { origin: "0 0 0", angle: "0", _arealight_dir: "0 0 5" })]);
    // Quake (0 0 5) -> Babylon (0,5,0), normalized -> up.
    expect(s.faceDir.asArray()).toEqual([0, 1, 0]);
  });

  it("defaults to -Z when no angle/dir given, and skips entities without origin", () => {
    expect(resolveAreaLightEntities([ent("light_area", { origin: "1 2 3" })])[0].faceDir.asArray()).toEqual([0, 0, -1]);
    expect(resolveAreaLightEntities([ent("light_area", {})])).toHaveLength(0);
  });
});

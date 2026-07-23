/**
 * MapGodRayEntities — pure BSP-entity → god-ray parsing. Locks the Quake→Babylon
 * coordinate convention, the Warsow/Q3 targeted-sun direction (and its sign), and
 * light_volumetric emitter parsing, so they can be confirmed against a real map.
 */

import { describe, expect, it } from "vitest";
import type { BspEntity } from "../../loader/bsp/BspLoader";
import {
  parseEntityColor,
  parseQuakeOrigin,
  resolveMapSunDirection,
  resolveVolumetricEmitters,
} from "../MapGodRayEntities";

const ent = (classname: string, properties: Record<string, string>): BspEntity => ({ classname, properties });

describe("parseQuakeOrigin", () => {
  it("swaps Quake Z-up to Babylon Y-up: (x y z) -> (x, z, y)", () => {
    const v = parseQuakeOrigin("1 2 3");
    expect(v?.asArray()).toEqual([1, 3, 2]);
  });

  it("returns null for missing/garbage input", () => {
    expect(parseQuakeOrigin(undefined)).toBeNull();
    expect(parseQuakeOrigin("1 2")).toBeNull();
    expect(parseQuakeOrigin("a b c")).toBeNull();
  });
});

describe("parseEntityColor", () => {
  it("normalizes 0-255 colors", () => {
    const c = parseEntityColor("255 128 0");
    expect(c?.r).toBe(1);
    expect(c?.g).toBeCloseTo(128 / 255, 5);
    expect(c?.b).toBe(0);
  });

  it("passes through 0-1 colors", () => {
    expect(parseEntityColor("0.5 0.5 0.5")?.asArray()).toEqual([0.5, 0.5, 0.5]);
  });

  it("returns null for garbage", () => {
    expect(parseEntityColor("nope")).toBeNull();
  });
});

describe("resolveMapSunDirection", () => {
  it("resolves a targeted sun/_sun light to a downward travel direction", () => {
    // Light at origin, marker high above (Quake z=200 -> Babylon y=200). The sun
    // is toward the marker, so sunlight travels from marker down to the light.
    const entities = [
      ent("light", { origin: "0 0 0", target: "sun" }),
      ent("info_null", { origin: "0 0 200", targetname: "sun" }),
      ent("worldspawn", {}),
    ];
    const dir = resolveMapSunDirection(entities);
    expect(dir).not.toBeNull();
    expect(dir?.length()).toBeCloseTo(1, 5); // normalized
    expect(dir?.y).toBeLessThan(0); // travels downward (marker is up)
  });

  it("accepts the _sun link name too", () => {
    const entities = [
      ent("light", { origin: "0 0 0", target: "_sun" }),
      ent("info_null", { origin: "0 0 100", targetname: "_sun" }),
    ];
    expect(resolveMapSunDirection(entities)).not.toBeNull();
  });

  it("returns null when there is no sun entity or no matching marker", () => {
    expect(resolveMapSunDirection([ent("light", { origin: "0 0 0" })])).toBeNull();
    expect(resolveMapSunDirection([ent("light", { origin: "0 0 0", target: "sun" })])).toBeNull();
  });
});

describe("resolveVolumetricEmitters", () => {
  it("parses light_volumetric entities and ignores others", () => {
    const entities = [
      ent("light_volumetric", { origin: "10 20 30", _color: "0.5 0.8 1", godrays_exposure: "0.4", size: "80" }),
      ent("light", { origin: "1 2 3" }),
      ent("light_volumetric", { origin: "5 5 5" }),
    ];
    const emitters = resolveVolumetricEmitters(entities);
    expect(emitters).toHaveLength(2);

    const [a, b] = emitters;
    expect(a.position.asArray()).toEqual([10, 30, 20]); // Quake -> Babylon
    expect(a.color?.asArray()).toEqual([0.5, 0.8, 1]);
    expect(a.exposure).toBe(0.4);
    expect(a.size).toBe(80);
    // Second has no optional keys.
    expect(b.color).toBeUndefined();
    expect(b.exposure).toBeUndefined();
  });

  it("skips entities without a valid origin", () => {
    expect(resolveVolumetricEmitters([ent("light_volumetric", {})])).toHaveLength(0);
  });
});

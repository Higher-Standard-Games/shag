/**
 * AreaLightManager (NullEngine) — owns the per-map area lights. Verifies the
 * count cap (area lights aren't clustered → budget by count), that applying
 * replaces the previous set, and clean disposal. The worldspawn/entity read path
 * needs a loaded BSP, so it's browser-validated; the lifecycle is covered here.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AreaLightManager } from "../AreaLightManager";
import type { AreaLightSpec } from "../MapAreaLightEntities";

let engine: NullEngine;
let scene: Scene;

const spec = (name: string): AreaLightSpec => ({
  name,
  position: new Vector3(0, 50, 0),
  faceDir: new Vector3(0, 0, -1),
  width: 40,
  height: 20,
  intensity: 4,
  color: new Color3(0.5, 0.8, 1),
});

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  AreaLightManager.resetInstance();
  scene.dispose();
  engine.dispose();
});

describe("AreaLightManager", () => {
  it("caps the number of panels created", () => {
    const mgr = AreaLightManager.getInstance();
    const created = mgr.applySpecs(scene, [spec("a"), spec("b"), spec("c"), spec("d"), spec("e")], 3);
    expect(created).toBe(3);
    expect(mgr.count()).toBe(3);
    expect(mgr.isEnabled()).toBe(true);
  });

  it("cap 0 creates nothing", () => {
    const mgr = AreaLightManager.getInstance();
    expect(mgr.applySpecs(scene, [spec("a")], 0)).toBe(0);
    expect(mgr.isEnabled()).toBe(false);
  });

  it("re-applying replaces the previous panels", () => {
    const mgr = AreaLightManager.getInstance();
    mgr.applySpecs(scene, [spec("a"), spec("b")], 4);
    expect(mgr.count()).toBe(2);
    mgr.applySpecs(scene, [spec("c")], 4);
    expect(mgr.count()).toBe(1);
  });

  it("disposes cleanly and idempotently", () => {
    const mgr = AreaLightManager.getInstance();
    mgr.applySpecs(scene, [spec("a")], 4);
    mgr.dispose();
    expect(mgr.count()).toBe(0);
    expect(mgr.isEnabled()).toBe(false);
    expect(() => mgr.dispose()).not.toThrow();
  });
});

/**
 * Pooled effect lights, once the pool runs out and once they ride a projectile
 * (NullEngine).
 *
 * Out of lights, the pool takes the oldest. Its old owner kept dimming it and
 * later released it, which put out the new owner's light mid-flash. And a
 * projectile's light was given a world position and then parented to the
 * projectile, so the offset counted twice and the glow lit the wrong place.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEntityRegistry } from "../../../shared/entities";
import { PK3Loader } from "../../loader/pk3/PK3Loader";
import { getPointLightPool } from "../PointLightPool";
import { ProjectileManager } from "../ProjectileManager";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  engine = new NullEngine();
  scene = new Scene(engine);
  getPointLightPool().init(scene);
});

afterEach(() => {
  getPointLightPool().dispose();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

const owner = () => ({ light: null as PointLight | null });

function fillPool() {
  const owners = [];
  for (let i = 0; i < 8; i++) {
    const o = owner();
    o.light = getPointLightPool().acquire(Vector3.Zero(), Color3.White(), 1, 10, o);
    owners.push(o);
  }
  return owners;
}

describe("a light taken back from its owner", () => {
  it("is no longer the old owner's, so its release cannot put out the new one", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(0);
    const [oldest] = fillPool();
    const taken = oldest.light;
    const node = new TransformNode("old_projectile", scene);
    if (taken) taken.parent = node;

    now.mockReturnValue(100);
    const newer = owner();
    newer.light = getPointLightPool().acquire(new Vector3(5, 0, 0), Color3.White(), 7, 30, newer);

    expect(newer.light).toBe(taken);
    expect(oldest.light).toBeNull();
    expect(taken?.parent).toBeNull();

    getPointLightPool().release(oldest.light); // what the old owner does when it ends
    node.dispose(); // its node goes, and must not take the light with it
    expect(taken?.intensity).toBe(7);
    expect(taken?.isDisposed()).toBe(false);
  });
});

describe("a projectile's light", () => {
  it("sits on the projectile, not twice as far from the map origin", () => {
    (ProjectileManager as unknown as { instance?: ProjectileManager }).instance = undefined;
    const manager = ProjectileManager.getInstance();
    (manager as unknown as { scene: Scene }).scene = scene;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(getEntityRegistry(), "get").mockReturnValue({
      id: "rocket",
      speed: 1000,
      lifetime: 10,
      lightIntensity: 3,
      lightRange: 40,
    } as never);
    vi.spyOn(PK3Loader.getInstance(), "hasFile").mockReturnValue(false);
    vi.spyOn(PK3Loader.getInstance(), "getFile").mockResolvedValue(null as never);
    manager.spawn("rocket", new Vector3(100, 50, -200), new Vector3(1, 0, 0));
    const light = scene.lights.find((l) => l.name.startsWith("_pool_light_") && (l as PointLight).intensity > 0) as
      | PointLight
      | undefined;
    expect(light?.parent).toBeTruthy();
    light?.computeWorldMatrix(true);
    light?.computeTransformedInformation();
    const at = light?.transformedPosition ?? Vector3.Zero();
    expect(Vector3.Distance(at, new Vector3(100, 50, -200))).toBeLessThan(1);
    manager.clear();
    (ProjectileManager as unknown as { instance?: ProjectileManager }).instance = undefined;
  });
});

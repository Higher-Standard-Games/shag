/**
 * DynamicLightCluster lifecycle (NullEngine).
 *
 * NOTE: clustered lighting is a GPU feature — `ClusteredLightContainer` gates
 * `addLight`/membership on a non-zero engine batch size (float-blend caps),
 * which NullEngine lacks, so `.lights` never populates headlessly (same class
 * of "GPU output not headlessly testable" as the beam/rail shaders). These
 * tests therefore cover what THIS module owns: the scene-scoped WeakMap
 * lifecycle — lazy single-container creation, teardown that does not dispose
 * member lights, the scene-dispose hook, and disposeClusteredLight. Actual
 * light membership/rendering is validated in-browser.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addToDynamicLightCluster,
  disposeClusteredLight,
  disposeDynamicLightCluster,
  getDynamicLightCluster,
  removeFromDynamicLightCluster,
  supportsClusteredLighting,
} from "../DynamicLightCluster";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

function light(name: string): PointLight {
  return new PointLight(name, Vector3.Zero(), scene);
}

describe("DynamicLightCluster", () => {
  it("uses clustered lighting on the non-WebGPU headless backend", () => {
    expect(supportsClusteredLighting(scene)).toBe(true);
  });

  it("rejects clustered lighting on WebGPU until its bindings pass validation", () => {
    const webGPUScene = {
      getEngine: () => ({ isWebGPU: true }),
    } as Scene;
    expect(supportsClusteredLighting(webGPUScene)).toBe(false);
  });

  it("creates exactly one container per scene, lazily on first add", () => {
    expect(getDynamicLightCluster(scene)).toBeNull();

    addToDynamicLightCluster(scene, light("a"));
    const container = getDynamicLightCluster(scene);
    expect(container).not.toBeNull();
    expect(container?.getClassName()).toBe("ClusteredLightContainer");

    // Subsequent adds reuse the same container (WeakMap), never a second one.
    addToDynamicLightCluster(scene, light("b"));
    expect(getDynamicLightCluster(scene)).toBe(container);
  });

  it("disposeClusteredLight disposes the light (and is safe when unclustered)", () => {
    const a = light("a");
    addToDynamicLightCluster(scene, a);
    disposeClusteredLight(a);
    expect(a.isDisposed()).toBe(true);

    // A light that was never clustered still disposes cleanly.
    const loose = light("loose");
    expect(() => disposeClusteredLight(loose)).not.toThrow();
    expect(loose.isDisposed()).toBe(true);
  });

  it("removeFromDynamicLightCluster is a no-op for an unknown scene/light", () => {
    const orphanEngine = new NullEngine();
    const orphanScene = new Scene(orphanEngine);
    expect(() => removeFromDynamicLightCluster(orphanScene, light("x"))).not.toThrow();
    orphanScene.dispose();
    orphanEngine.dispose();
  });

  it("teardown removes the container without disposing member lights", () => {
    const a = light("a");
    addToDynamicLightCluster(scene, a);

    disposeDynamicLightCluster(scene);
    expect(getDynamicLightCluster(scene)).toBeNull();
    // The light's owner (pool / glow map) disposes it, not the cluster teardown.
    expect(a.isDisposed()).toBe(false);

    // Idempotent.
    expect(() => disposeDynamicLightCluster(scene)).not.toThrow();
  });

  it("scene disposal tears the container down automatically", () => {
    addToDynamicLightCluster(scene, light("a"));
    expect(getDynamicLightCluster(scene)).not.toBeNull();
    scene.dispose(); // afterEach also disposes — idempotent
    expect(getDynamicLightCluster(scene)).toBeNull();
  });
});

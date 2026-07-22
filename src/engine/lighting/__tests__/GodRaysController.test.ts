/**
 * GodRaysController (NullEngine) — the single owner of the one active VLS pass.
 * Verifies enable/disable, that switching modes disposes the previous pass (only
 * one full-screen VLS runs at a time), and that it survives a missing sun by
 * falling back to a default direction. Worldspawn parsing needs a loaded BSP, so
 * it's exercised in-browser; the enable/disable lifecycle is covered here.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodRaysController } from "../GodRaysController";

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("cam", new Vector3(0, 0, 0), scene);
});

afterEach(() => {
  GodRaysController.resetInstance();
  scene.dispose();
  engine.dispose();
});

describe("GodRaysController", () => {
  it("enables sun shafts (falls back to a default sun direction when none exists)", () => {
    const controller = GodRaysController.getInstance();
    expect(controller.isEnabled()).toBe(false);

    const rays = controller.enableSun(scene, camera);
    expect(controller.isEnabled()).toBe(true);
    expect(rays.postProcess.getClassName()).toBe("VolumetricLightScatteringPostProcess");
  });

  it("keeps a single pass: switching modes disposes the previous one", () => {
    const controller = GodRaysController.getInstance();
    const sun = controller.enableSun(scene, camera);
    const anchored = controller.enableAnchored(scene, camera, new Vector3(1, 2, 3));

    // The sun pass was torn down when the anchored one took its place.
    expect(sun.source.isDisposed()).toBe(true);
    expect(anchored.source.isDisposed()).toBe(false);
    expect(controller.isEnabled()).toBe(true);
  });

  it("disables cleanly and idempotently", () => {
    const controller = GodRaysController.getInstance();
    controller.enableSun(scene, camera);
    controller.disable();
    expect(controller.isEnabled()).toBe(false);
    expect(() => controller.disable()).not.toThrow();
  });
});

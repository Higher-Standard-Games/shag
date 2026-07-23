/**
 * SunGodRays / volumetric-light-scattering plumbing (NullEngine). Verifies the
 * Babylon-9 god-ray wiring that can't be visually checked headlessly:
 *  - the VolumetricLightScatteringPostProcess side-effect registers, so the
 *    post-process constructs and reports its class (the outline/physics/area-
 *    light side-effect class of regression);
 *  - a bright emissive source mesh is created and tracks the sun direction /
 *    anchor position (the rays' radial center);
 *  - excluded meshes propagate to the occlusion pass;
 *  - dispose detaches the post-process and tears down the source cleanly.
 * The actual shafts + occlusion silhouettes are browser-validated.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SunGodRays } from "../SunGodRays";

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("cam", new Vector3(0, 0, 0), scene);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("SunGodRays", () => {
  it("creates a registered VolumetricLightScatteringPostProcess (side-effect wired)", () => {
    const rays = new SunGodRays(scene, camera, {
      mode: "sun",
      direction: new Vector3(0, -1, 0),
      samples: 40,
      exposure: 0.4,
    });

    expect(rays.postProcess.getClassName()).toBe("VolumetricLightScatteringPostProcess");
    expect(rays.postProcess.exposure).toBe(0.4);
    // The bright source exists and is emissive (drives the radial center).
    expect(rays.source).toBeTruthy();
    expect(rays.source.material?.getClassName()).toBe("StandardMaterial");

    rays.dispose();
  });

  it("tracks the sun opposite the light direction, above the camera", () => {
    camera.position.set(10, 20, 30);
    const rays = new SunGodRays(scene, camera, {
      mode: "sun",
      direction: new Vector3(0, -1, 0), // sun straight overhead
      distance: 1000,
    });
    // onBeforeRender positions the source; force one positioning tick.
    scene.onBeforeRenderObservable.notifyObservers(scene);

    // Sun sits opposite −direction → straight up, 1000 above the camera.
    expect(rays.source.position.y).toBeGreaterThan(camera.position.y + 900);
    rays.dispose();
  });

  it("anchors a fixed emitter and forwards excluded meshes", () => {
    const box = CreateBox("occluder", { size: 1 }, scene);
    const anchor = new Vector3(5, 5, 5);
    const rays = new SunGodRays(scene, camera, {
      mode: "anchored",
      anchor,
      color: new Color3(0.5, 0.8, 1),
      excludedMeshes: [box],
    });

    expect(rays.source.position.equals(anchor)).toBe(true);
    expect(rays.postProcess.excludedMeshes).toContain(box);
    rays.dispose();
  });

  it("disposes cleanly and idempotently", () => {
    const rays = new SunGodRays(scene, camera, { mode: "sun" });
    const source = rays.source;
    expect(() => rays.dispose()).not.toThrow();
    expect(source.isDisposed()).toBe(true);
    expect(() => rays.dispose()).not.toThrow();
  });
});

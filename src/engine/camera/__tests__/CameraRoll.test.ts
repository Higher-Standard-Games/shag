/**
 * A first-person view must not tilt once its roll settles.
 *
 * Babylon applies roll through the camera's up vector, and by default rebuilds
 * that vector only on frames where the roll changes, from the whole rotation of
 * that frame. A walk-bob roll that drops to zero at a jump keeps that frame's
 * pitch in the up vector; turning in the air then tilts the view sideways.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpectatorController } from "../controllers/SpectatorController";

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

/** Degrees the view is rolled: how far its right axis leaves the horizontal. */
function viewRoll(camera: FreeCamera): number {
  camera.getViewMatrix(true);
  const right = camera.getDirection(new Vector3(1, 0, 0));
  return (Math.asin(right.y) * 180) / Math.PI;
}

/** Run, jump with the bob roll settling at zero while looking down, then turn. */
function jumpAndTurn(camera: FreeCamera): number {
  camera.rotation.set(0.4, 0, 0.01);
  camera.getViewMatrix(true);
  camera.rotation.set(0.4, 0, 0);
  camera.getViewMatrix(true);
  camera.rotation.set(0.4, Math.PI / 2, 0);
  return viewRoll(camera);
}

describe("first-person roll", () => {
  it("tilts with Babylon's default once the roll settles and the view turns", () => {
    expect(Math.abs(jumpAndTurn(new FreeCamera("plain", Vector3.Zero(), scene)))).toBeGreaterThan(10);
  });

  it("stays level when the up vector is rebuilt from the rotation", () => {
    const camera = new FreeCamera("fps", Vector3.Zero(), scene);
    camera.updateUpVectorFromRotation = true;
    expect(jumpAndTurn(camera)).toBeCloseTo(0, 5);
  });

  it("still rolls when asked to", () => {
    const camera = new FreeCamera("fps", Vector3.Zero(), scene);
    camera.updateUpVectorFromRotation = true;
    camera.rotation.set(0, 1, (5 * Math.PI) / 180);
    expect(Math.abs(viewRoll(camera))).toBeCloseTo(5, 3);
  });

  it("is how the spectator camera follows a player", () => {
    const camera = new FreeCamera("spectated", Vector3.Zero(), scene);
    new SpectatorController().attach(camera, scene, {} as HTMLCanvasElement);
    expect(camera.updateUpVectorFromRotation).toBe(true);
  });
});

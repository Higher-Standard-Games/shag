// @vitest-environment jsdom

/**
 * A camera controller handed a non-FreeCamera makes its own, once (NullEngine).
 *
 * The spectator and freefly controllers made a new FreeCamera on every attach
 * and never disposed the last one, so a cinematic demo left one per camera cut.
 */

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeflyController } from "../controllers/FreeflyController";
import { SpectatorController } from "../controllers/SpectatorController";

let scene: Scene;

afterEach(() => {
  scene.getEngine().dispose();
  vi.restoreAllMocks();
});

describe("cutting between spectator and freefly", () => {
  it("leaves one camera per controller however many cuts there are", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    scene = new Scene(new NullEngine());
    const canvas = document.createElement("canvas");
    const base = new ArcRotateCamera("camera", 0, 1, 100, Vector3.Zero(), scene);
    const spectator = new SpectatorController();
    const freefly = new FreeflyController();

    for (let cut = 0; cut < 10; cut++) {
      spectator.attach(base, scene, canvas);
      spectator.detach();
      freefly.attach(base, scene, canvas);
      freefly.detach();
    }

    expect(scene.cameras.map((camera) => camera.name).sort()).toEqual(["camera", "freeflyCamera", "spectatorCamera"]);
  });
});

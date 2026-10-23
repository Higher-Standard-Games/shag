import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CameraSystem } from "../../camera/CameraSystem";
import type { ICameraController } from "../../camera/controllers/ICameraController";
import DebugCommand from "../commands/DebugCommand";

let scene: Scene;
let engine: NullEngine;
const command = new DebugCommand();

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  const camera = new FreeCamera("debug", Vector3.Zero(), scene);
  vi.spyOn(CameraSystem.getInstance(), "getCamera").mockReturnValue(camera);
});

afterEach(async () => {
  if (scene.getMeshByName("debug_player_body")) await command.execute(["player"]);
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

it("tracks a player through the engine position capability and cleans up its observer", async () => {
  const controller = {
    type: "fps",
    position: new Vector3(12, 100, 34),
    getPlayerPosition() {
      return this.position;
    },
  };
  vi.spyOn(CameraSystem.getInstance(), "getActiveController").mockReturnValue(
    controller as unknown as ICameraController,
  );
  const observers = scene.onBeforeRenderObservable.observers.length;
  await expect(command.execute(["player"])).resolves.toContain("Player debug visualization: ON");
  scene.onBeforeRenderObservable.notifyObservers(scene);
  expect(scene.getMeshByName("debug_player_body")?.position.asArray()).toEqual([12, 104, 34]);
  expect(scene.getMeshByName("debug_eye_level")?.position.asArray()).toEqual([12, 124, 34]);
  controller.position.set(56, 200, 78);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  expect(scene.getMeshByName("debug_player_body")?.position.asArray()).toEqual([56, 204, 78]);
  await expect(command.execute(["player"])).resolves.toBe("Player debug visualization: OFF");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scene.onBeforeRenderObservable.observers.length).toBe(observers);
});

it("preserves the inactive-controller response", async () => {
  vi.spyOn(CameraSystem.getInstance(), "getActiveController").mockReturnValue(null);
  await expect(command.execute(["player"])).resolves.toBe(
    "FPS controller not active or does not support position tracking",
  );
});

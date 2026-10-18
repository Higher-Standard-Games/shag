// @vitest-environment jsdom
import "@babylonjs/core/Collisions/collisionCoordinator";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, expect, it, vi } from "vitest";
import { InputSystem } from "../../input/InputSystem";
import { FreeflyController } from "../controllers/FreeflyController";

const input = InputSystem.getInstance();
let engine: NullEngine;
let controller: FreeflyController;
afterEach(() => {
  controller?.detach();
  input.dispose();
  engine?.dispose();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "pointerLockElement");
});
it("moves the default freefly camera with held movement actions", () => {
  Object.defineProperty(document, "exitPointerLock", { configurable: true, value: vi.fn() });
  expect(FreeflyController.isCollisionEnabled()).toBe(false);
  engine = new NullEngine();
  vi.spyOn(engine, "getDeltaTime").mockReturnValue(16);
  const scene = new Scene(engine);
  const canvas = document.body.appendChild(document.createElement("canvas"));
  const camera = new FreeCamera("fps", new Vector3(0, 100, 0), scene);
  controller = new FreeflyController();
  controller.attach(camera, scene, canvas);
  Object.defineProperty(document, "pointerLockElement", { configurable: true, value: canvas });
  document.dispatchEvent(new Event("pointerlockchange"));
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
  scene.onBeforeRenderObservable.notifyObservers(scene);
  expect(input.isKeyDown("KeyW")).toBe(true);
  expect(camera.position.z).toBeGreaterThan(0);
});

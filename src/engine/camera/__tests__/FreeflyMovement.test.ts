// @vitest-environment jsdom
import "@babylonjs/core/Collisions/collisionCoordinator";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InputSystem } from "../../input/InputSystem";
import { FreeflyController } from "../controllers/FreeflyController";
import { clearFreeflyInput } from "../FreeflyInput";
import { setGameFrameHook } from "../GameFrameHook";

const input = InputSystem.getInstance();
let engine: NullEngine;
let controller: FreeflyController;
let scene: Scene;
let camera: FreeCamera;
let canvas: HTMLCanvasElement;
const frame = () => scene.onBeforeRenderObservable.notifyObservers(scene);
const press = (code: string) => document.dispatchEvent(new KeyboardEvent("keydown", { code }));
const lock = (element: Element | null) => {
  Object.defineProperty(document, "pointerLockElement", { configurable: true, value: element });
  document.dispatchEvent(new Event("pointerlockchange"));
};

beforeEach(() => {
  clearFreeflyInput();
  input.resetAllBindings();
  input.setContext("gameplay");
  Object.defineProperty(document, "exitPointerLock", { configurable: true, value: vi.fn() });
  engine = new NullEngine();
  vi.spyOn(engine, "getDeltaTime").mockReturnValue(16);
  scene = new Scene(engine);
  canvas = document.body.appendChild(document.createElement("canvas"));
  camera = new FreeCamera("engine", new Vector3(0, 100, 0), scene);
  controller = new FreeflyController();
  controller.attach(camera, scene, canvas);
  lock(canvas);
});

afterEach(() => {
  controller?.detach();
  input.dispose();
  engine?.dispose();
  canvas?.remove();
  setGameFrameHook(null);
  clearFreeflyInput();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "pointerLockElement");
});
it("moves the default freefly camera with held movement actions", () => {
  expect(FreeflyController.isCollisionEnabled()).toBe(false);
  press("KeyW");
  frame();
  expect(input.isKeyDown("KeyW")).toBe(true);
  expect(camera.position.z).toBeGreaterThan(0);
});

it.each([
  ["KeyS", "z", -1],
  ["KeyA", "x", -1],
  ["KeyD", "x", 1],
  ["Space", "y", 1],
  ["KeyC", "y", -1],
  ["ControlLeft", "y", -1],
  ["ControlRight", "y", -1],
] as const)("moves with engine-local %s without a game adapter", (code, axis, direction) => {
  const start = camera.position[axis];
  press(code);
  frame();
  expect((camera.position[axis] - start) * direction).toBeGreaterThan(0);
});

it("uses middle mouse to descend without a game adapter", () => {
  canvas.dispatchEvent(new MouseEvent("mousedown", { button: 1 }));
  frame();
  expect(camera.position.y).toBeLessThan(100);
});

it.each(["ShiftLeft", "ShiftRight"])("preserves the triple speed multiplier with %s", (code) => {
  press("KeyW");
  frame();
  const normal = camera.position.z;
  controller.setPosition(new Vector3(0, 100, 0));
  press(code);
  frame();
  expect(camera.position.z).toBeCloseTo(normal * 3);
});

it("requires a fresh press after mouse capture is released", () => {
  press("KeyW");
  frame();
  const stopped = camera.position.z;
  lock(null);
  frame();
  lock(canvas);
  frame();
  expect(camera.position.z).toBe(stopped);
  press("KeyW");
  frame();
  expect(camera.position.z).toBeGreaterThan(stopped);
});

it("keeps game-frame updates while unlocked and removes its observer on detach", () => {
  const hook = { isGameRunning: () => true, processSnapshots: vi.fn(), renderRemotePlayers: vi.fn() };
  setGameFrameHook(hook);
  lock(null);
  frame();
  expect(hook.processSnapshots).toHaveBeenCalledTimes(1);
  expect(hook.renderRemotePlayers).toHaveBeenCalledTimes(1);
  controller.detach();
  frame();
  expect(hook.processSnapshots).toHaveBeenCalledTimes(1);
  expect(hook.renderRemotePlayers).toHaveBeenCalledTimes(1);
});

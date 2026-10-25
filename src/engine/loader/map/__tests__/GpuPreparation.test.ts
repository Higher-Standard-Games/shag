import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, expect, it, vi } from "vitest";
import { prepareMaterial, sceneGpuReady, waitForGpuCondition, waitForPreparation } from "../GpuPreparation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("suspends GPU work and its budget while hidden, then resumes with the remaining visible time", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", doc);
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const check = vi.fn(() => false);
  const pending = waitForGpuCondition(scene, check, "visible budget", undefined, 100);
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(40);
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  const calls = check.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(check).toHaveBeenCalledTimes(calls);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(61);
  await rejected;
  scene.dispose();
  engine.dispose();
});

it.each(["cancel", "device loss"])("terminates a suspended GPU wait on %s", async (cause) => {
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: true }));
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const controller = new AbortController();
  const check = vi.fn(() => true);
  const pending = waitForGpuCondition(scene, check, "suspended", controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  if (cause === "cancel") controller.abort(new Error("cancelled"));
  else engine.onContextLostObservable.notifyObservers(engine);
  await rejected;
  expect(check).not.toHaveBeenCalled();
  scene.dispose();
  engine.dispose();
});

it.each(["timeout", "abort", "dispose"])("stops readiness polling on %s and releases observers", async (mode) => {
  vi.useFakeTimers();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const check = vi.fn(() => false);
  const controller = new AbortController();
  const count = scene.onDisposeObservable.observers.length;
  const pending = waitForGpuCondition(scene, check, "test stage", controller.signal, 100);
  const rejected = expect(pending).rejects.toThrow();
  if (mode === "abort") controller.abort(new Error("cancelled"));
  if (mode === "dispose") scene.dispose();
  await vi.advanceTimersByTimeAsync(120);
  await rejected;
  const calls = check.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(check).toHaveBeenCalledTimes(calls);
  expect(scene.onDisposeObservable.observers.length).toBeLessThanOrEqual(count);
  scene.dispose();
  engine.dispose();
});

it("checks the primary camera pass and restores the camera left by layered rendering", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const world = new FreeCamera("world", Vector3.Zero(), scene);
  const weapon = new FreeCamera("weapon", Vector3.Zero(), scene);
  scene.activeCameras = [world, weapon];
  scene.activeCamera = weapon;
  vi.spyOn(scene, "isReady").mockImplementation(() => {
    expect(scene.activeCamera).toBe(world);
    return true;
  });
  expect(sceneGpuReady(scene)).toBe(true);
  expect(scene.activeCamera).toBe(weapon);
  scene.dispose();
  engine.dispose();
});

it("stops an unready material without leaving Babylon compilation polling or a changed hot-swap policy", async () => {
  vi.useFakeTimers();
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const mesh = CreateBox("fixture", {}, scene),
    material = new StandardMaterial("fixture", scene);
  mesh.material = material;
  const check = vi.spyOn(material, "isReadyForSubMesh").mockReturnValue(false);
  const force = vi.spyOn(material, "forceCompilationAsync");
  const controller = new AbortController();
  const policy = material.allowShaderHotSwapping;
  const pending = prepareMaterial(material, mesh, controller.signal);
  const rejected = expect(pending).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await rejected;
  await vi.advanceTimersByTimeAsync(60000);
  expect(check).toHaveBeenCalledOnce();
  expect(force).not.toHaveBeenCalled();
  expect(material.allowShaderHotSwapping).toBe(policy);
  scene.dispose();
  engine.dispose();
});

it("detaches cancelled preparation while consuming a late rejection safely", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const controller = new AbortController();
  let fail!: (error: Error) => void;
  const work = new Promise<void>((_, reject) => {
    fail = reject;
  });
  const waiting = waitForPreparation(work, scene, "model", controller.signal);
  const rejected = expect(waiting).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await rejected;
  fail(new Error("late import failure"));
  await Promise.resolve();
  scene.dispose();
  engine.dispose();
});

it("keeps a frozen PBR surface out of render draws while a replacement light shader is compiling", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const mesh = CreateBox("wall", {}, scene);
  const material = new PBRMaterial("wall", scene);
  mesh.material = material;
  material.allowShaderHotSwapping = false;
  new PointLight("first", Vector3.Zero(), scene);
  await material.forceCompilationAsync(mesh);
  material.freeze();
  const subMesh = mesh.subMeshes[0];
  expect(material.isReadyForSubMesh(mesh, subMesh, false)).toBe(true);
  new PointLight("replacement", Vector3.One(), scene);
  scene.incrementRenderId();
  const createEffect = engine.createEffect.bind(engine);
  const compiler = vi.spyOn(engine, "createEffect").mockImplementation((...args) => {
    const effect = createEffect(...args);
    vi.spyOn(effect, "isReady").mockReturnValue(false);
    return effect;
  });
  const controller = new AbortController();
  const pending = prepareMaterial(material, mesh, controller.signal).catch((error: unknown) => error);
  try {
    expect(compiler).toHaveBeenCalled();
    // This is the readiness call made by Babylon's real non-instanced draw.
    expect(material.isReadyForSubMesh(mesh, subMesh, false)).toBe(false);
  } finally {
    controller.abort(new Error("test complete"));
    await pending;
    expect(material.isFrozen).toBe(true);
    scene.dispose();
    engine.dispose();
  }
});

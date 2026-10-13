import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WaterRefractionProvider } from "../rendering/water/WaterRefraction";

let engine: NullEngine;
let scene: Scene;
let provider: WaterRefractionProvider;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  provider = new WaterRefractionProvider(scene);
});
afterEach(() => {
  provider.dispose();
  scene.dispose();
  engine.dispose();
});
const camera = () => new FreeCamera("world", Vector3.Zero(), scene);

it("owns a world-camera target without camera postprocessing or scene registration", () => {
  const world = camera();
  const map = provider.mapFor(world)!;
  expect(map.activeCamera).toBe(world);
  expect(world.customRenderTargets).toEqual([map]);
  expect(scene.customRenderTargets).toHaveLength(0);
  expect(map.useCameraPostProcesses).toBe(false);
  expect(map.renderParticles).toBe(false);
  expect(provider.mapFor(world)).toBe(map);
});

it("stops offscreen, resumes without reallocating, and unregisters on camera changes/dispose", () => {
  const a = camera(),
    b = camera();
  const first = provider.mapFor(a);
  provider.setRendering(false);
  expect(a.customRenderTargets).toHaveLength(0);
  provider.setRendering(true);
  expect(a.customRenderTargets).toEqual([first]);
  const second = provider.mapFor(b);
  expect(second).not.toBe(first);
  expect(a.customRenderTargets).toHaveLength(0);
  provider.dispose();
  expect(b.customRenderTargets).toHaveLength(0);
});

it("captures opaque/alpha-tested world but not liquids, effects, weapon or transparent geometry", () => {
  const meshes = Array.from({ length: 7 }, (_, i) => CreateBox(String(i), {}, scene));
  meshes[1].metadata = { liquidKind: "water" };
  meshes[2].metadata = { effectOwned: true };
  meshes[3].layerMask = 0x10000000;
  meshes[4].material = new StandardMaterial("glass", scene);
  meshes[4].material.alpha = 0.5;
  meshes[5].isVisible = false;
  meshes[6].infiniteDistance = true; // Sky is a valid colour background.
  const map = provider.mapFor(camera())!;
  expect(map.getCustomRenderList!(0, meshes, meshes.length)).toEqual([meshes[0], meshes[6]]);
});

it("tracks the same input colour space as scene materials without toggling scene processing", () => {
  const map = provider.mapFor(camera())!;
  for (const linear of [true, false, true]) {
    scene.imageProcessingConfiguration.applyByPostProcess = linear;
    map.onBeforeBindObservable.notifyObservers(map);
    expect(map.gammaSpace).toBe(!linear);
    expect(scene.imageProcessingConfiguration.applyByPostProcess).toBe(linear);
  }
});

it("preserves viewport proportions on resize rather than rounding each axis to a power of two", () => {
  const width = vi.spyOn(engine, "getRenderWidth").mockReturnValue(1100);
  const height = vi.spyOn(engine, "getRenderHeight").mockReturnValue(740);
  const world = camera();
  const map = provider.mapFor(world)!;
  expect(map.getSize()).toMatchObject({ width: 550, height: 370 });
  width.mockReturnValue(1920);
  height.mockReturnValue(1080);
  expect(provider.mapFor(world)).toBe(map);
  expect(map.getSize()).toMatchObject({ width: 960, height: 540 });
  width.mockRestore();
  height.mockRestore();
});

it("leaves out meshes wholly above the capture ceiling", () => {
  const below = CreateBox("below", {}, scene);
  const straddling = CreateBox("straddling", { height: 40 }, scene);
  straddling.position.y = 60;
  const above = CreateBox("above", {}, scene);
  above.position.y = 200;
  const meshes = [below, straddling, above];
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  const map = provider.mapFor(camera())!;
  provider.setCaptureCeiling(60);
  expect(map.getCustomRenderList!(0, meshes, meshes.length)).toEqual([below, straddling]);
  provider.setCaptureCeiling(null);
  expect(map.getCustomRenderList!(0, meshes, meshes.length)).toEqual(meshes);
});

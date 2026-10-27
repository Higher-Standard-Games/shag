import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_WATER_IMPULSES, WaterDisturbances } from "../rendering/water/WaterDisturbances";
import { WaterProbeCache, waterPatch } from "../rendering/water/WaterProbeCache";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  vi.restoreAllMocks();
  scene.dispose();
  engine.dispose();
});

it("restores transient lights and PVS state after a failed capture without retrying forever", async () => {
  const camera = new FreeCamera("world", new Vector3(0, 80, -100), scene);
  const root = new Mesh("map", scene);
  const wall = CreateBox("wall", { size: 20 }, scene);
  wall.parent = root;
  wall.position.z = 50;
  wall.material = new StandardMaterial("wall-material", scene);
  const flash = new PointLight("impact", Vector3.Zero(), scene);
  flash.metadata = { excludeFromWaterCapture: true };
  const pool = CreateGround("pool", { width: 100, height: 100 }, scene);
  pool.parent = root;
  pool.metadata = { liquidKind: "water" };
  const cache = new WaterProbeCache(scene);
  cache.claim(root, [pool]);
  await scene.whenReadyAsync();
  wall.isVisible = false;
  const render = vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => {
    expect(flash.isEnabled()).toBe(false);
    throw new Error("simulated driver failure");
  });
  cache.update(camera);
  expect(flash.isEnabled()).toBe(true);
  expect(wall.isVisible).toBe(false);
  expect(scene.reflectionProbes).toHaveLength(0);
  expect(cache.patchFor(pool)).toBeDefined(); // Ripples survive reflection fallback.
  scene.render();
  cache.update(camera);
  expect(render).toHaveBeenCalledTimes(1);
  cache.dispose();
});

it("uses world geometry to place a probe and constrain surface membership", () => {
  const pool = CreateGround("pool", { width: 100, height: 100, subdivisions: 2 }, scene);
  pool.position.set(200, 56, -300);
  const patch = waterPatch(pool)!;
  expect(patch.position.asArray()).toEqual([200, 58, -300]);
  expect(patch.contains(200, 56, -300)).toBe(true);
  expect(patch.contains(200, 100, -300)).toBe(false);
  expect(patch.contains(260, 56, -300)).toBe(false);
});

it("rejects multi-height or disconnected batches instead of projecting one false pool", () => {
  expect(waterPatch(CreateBox("volume", { size: 100 }, scene))).toBeNull();
  const a = CreateGround("a", { width: 40, height: 40 }, scene);
  const b = CreateGround("b", { width: 40, height: 40 }, scene);
  b.position.x = 100;
  const merged = Mesh.MergeMeshes([a, b], true)!;
  expect(waterPatch(merged)).toBeNull();
});

it("captures static PVS-hidden geometry once, excludes actors, and restores visibility", async () => {
  const camera = new FreeCamera("world", new Vector3(0, 80, -100), scene);
  camera.setTarget(Vector3.Zero());
  const root = new Mesh("map", scene);
  const wall = CreateBox("wall", { size: 20 }, scene);
  wall.parent = root;
  wall.position.z = 50;
  wall.material = new StandardMaterial("wall-material", scene);
  const pool = CreateGround("pool", { width: 100, height: 100 }, scene);
  pool.parent = root;
  pool.metadata = { liquidKind: "water" };
  const actor = CreateBox("actor", { size: 5 }, scene);
  const flash = CreateBox("flash", { size: 5 }, scene);
  flash.parent = root;
  flash.metadata = { effectOwned: true };
  const cache = new WaterProbeCache(scene);
  cache.claim(root, [pool]);
  await scene.whenReadyAsync();
  wall.isVisible = false;
  cache.update(camera);
  expect(cache.entries).toHaveLength(1);
  const entry = cache.entries[0];
  expect(entry.ready).toBe(true);
  expect(entry.probe.renderList?.map((mesh) => mesh.name)).toEqual(["wall"]);
  expect(entry.probe.renderList).not.toContain(actor);
  expect(entry.probe.renderList).not.toContain(flash);
  expect(wall.isVisible).toBe(false);
  expect(scene.customRenderTargets).toHaveLength(0);
  for (let frame = 0; frame < 4; frame++) {
    scene.render();
    cache.update(camera);
  }
  expect(cache.entries).toHaveLength(1);
  expect(cache.entries[0]).toBe(entry);
  cache.dispose();
  expect(scene.reflectionProbes).toHaveLength(0);
});

it("bounds impulses, expires them, and filters them to their own pool", () => {
  const waves = new WaterDisturbances();
  for (let i = 0; i < MAX_WATER_IMPULSES + 4; i++) waves.add({ x: i, y: 56, z: 0 }, 0.5);
  expect(waves.impulses).toHaveLength(MAX_WATER_IMPULSES);
  const packed = waves.pack((x) => x >= 10);
  expect(packed[0]).toBe(10);
  expect(packed[4]).toBe(0.5);
  expect(waves.pack(() => false).every((x) => x === 0)).toBe(true);
  waves.update(2);
  expect(waves.impulses).toHaveLength(0);
});

it("packs normalized wake directions without changing the radial splash layout", () => {
  const waves = new WaterDisturbances();
  expect(waves.add({ x: 0, y: 56, z: 0 }, 0.5, 64, { x: 3, z: -4 })).toBe(true);
  waves.add({ x: 1, y: 56, z: 0 }, 0.5);
  const packed = waves.pack(() => true);
  expect(packed[6]).toBeCloseTo(0.6);
  expect(packed[7]).toBeCloseTo(-0.8);
  expect(Array.from(packed.slice(14, 16))).toEqual([0, 0]);
  expect(waves.add({ x: 0, y: 56, z: 0 }, 0.5, 64, { x: NaN, z: 1 })).toBe(false);
  expect(waves.impulses).toHaveLength(2);
});

it("shares adjacent faces but isolates a disconnected pool at the same height", () => {
  const root = new Mesh("map", scene);
  const pools = [0, 100, 300].map((x) => {
    const pool = CreateGround(`pool-${x}`, { width: 100, height: 100 }, scene);
    pool.position.x = x;
    pool.parent = root;
    pool.metadata = { liquidKind: "water" };
    return pool;
  });
  const cache = new WaterProbeCache(scene);
  cache.claim(root, pools);
  expect(cache.patchFor(pools[0])).toBe(cache.patchFor(pools[1]));
  expect(cache.patchFor(pools[0])).not.toBe(cache.patchFor(pools[2]));
  expect(cache.patchFor(pools[1])!.contains(0, 0, 0)).toBe(true);
  expect(cache.patchFor(pools[2])!.contains(0, 0, 0)).toBe(false);
  cache.dispose();
});

it("does not capture from inside a solid island covering the pool centre", async () => {
  const camera = new FreeCamera("world", new Vector3(0, 80, -100), scene);
  const root = new Mesh("map", scene);
  const island = CreateBox("island", { size: 30 }, scene);
  island.parent = root;
  island.material = new StandardMaterial("stone", scene);
  const pool = CreateGround("pool", { width: 100, height: 100 }, scene);
  pool.parent = root;
  pool.metadata = { liquidKind: "water" };
  const cache = new WaterProbeCache(scene);
  cache.claim(root, [pool]);
  await scene.whenReadyAsync();
  cache.update(camera);
  expect(cache.entries).toHaveLength(1);
  expect(Math.abs(cache.entries[0].probe.position.x)).toBeGreaterThan(15);
  expect(cache.entries[0].probe.position.y).toBe(66);
  cache.dispose();
});

it("clamps the lifted capture below an overhang and supports the waterline baseline", async () => {
  const camera = new FreeCamera("world", new Vector3(0, 10, -40), scene);
  const root = new Mesh("map", scene);
  const ceiling = CreateBox("ceiling", { width: 200, depth: 200, height: 4 }, scene);
  ceiling.position.y = 20;
  ceiling.parent = root;
  ceiling.material = new StandardMaterial("ceiling-material", scene);
  // PVS/picking flags must not make the lift go through a solid ceiling.
  ceiling.isVisible = false;
  ceiling.isPickable = false;
  const pool = CreateGround("pool", { width: 80, height: 80 }, scene);
  pool.parent = root;
  pool.metadata = { liquidKind: "water" };
  await scene.whenReadyAsync();
  for (const [lift, expectedY] of [
    [64, 14],
    [0, 2],
  ]) {
    const cache = new WaterProbeCache(scene, lift);
    cache.claim(root, [pool]);
    cache.update(camera);
    expect(cache.entries).toHaveLength(1);
    expect(cache.entries[0].probe.position.y).toBeCloseTo(expectedY);
    expect(cache.entries[0].roomMin.y).toBeLessThan(pool.position.y);
    expect(ceiling.isVisible).toBe(false);
    cache.dispose();
  }
});
it("captures every pool in one call for the loading screen, waiting for a target not ready", async () => {
  const camera = new FreeCamera("world", new Vector3(0, 80, -100), scene);
  const root = new Mesh("map", scene);
  const wall = CreateBox("wall", { size: 20 }, scene);
  wall.parent = root;
  wall.position.z = 50;
  wall.material = new StandardMaterial("wall-material", scene);
  const pools = [0, 300].map((x) => {
    const pool = CreateGround(`pool-${x}`, { width: 100, height: 100 }, scene);
    pool.position.x = x;
    pool.parent = root;
    pool.metadata = { liquidKind: "water" };
    return pool;
  });
  const cache = new WaterProbeCache(scene);
  cache.claim(root, pools);
  await scene.whenReadyAsync();
  vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => {});
  const ready = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(false);
  expect(await cache.captureAll(camera, 50)).toBe(0);
  // A target still compiling keeps its probe, whose passes have the shaders so far
  expect(scene.reflectionProbes).toHaveLength(1);
  cache.update(camera);
  expect(scene.reflectionProbes).toHaveLength(1);
  ready.mockReturnValueOnce(false).mockReturnValue(true);
  expect(await cache.captureAll(camera)).toBe(2);
  expect(scene.reflectionProbes).toHaveLength(2);
  expect(cache.entries.map((entry) => entry.ready)).toEqual([true, true]);
  expect(await cache.captureAll(camera)).toBe(0);
  cache.dispose();
});

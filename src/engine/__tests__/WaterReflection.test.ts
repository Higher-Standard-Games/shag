/** Budgeted live planar reflection used by Epic water. */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WaterReflection } from "../rendering/water/WaterReflection";

let engine: NullEngine;
let scene: Scene;
let reflection: WaterReflection;
let camera: FreeCamera;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("eye", Vector3.Zero(), scene);
  reflection = new WaterReflection(scene);
});

afterEach(() => {
  reflection.dispose();
  scene.dispose();
  engine.dispose();
});

function pool(name: string, width: number, depth: number, y: number, height = 1): AbstractMesh {
  const mesh = CreateBox(name, { width, depth, height }, scene);
  mesh.position.y = y;
  mesh.metadata = { liquidKind: "water" };
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();
  return mesh;
}

describe("WaterReflection plane selection", () => {
  it("chooses the largest horizontal footprint at its actual world height", () => {
    pool("small", 50, 50, 300);
    const big = pool("big", 400, 300, 56);

    expect(WaterReflection.choosePlaneY(scene.meshes)).toBeCloseTo(56, 4);
    expect(WaterReflection.choosePlaneY([big])).toBeCloseTo(56, 4);
  });

  it("rejects vertical liquid geometry that a horizontal mirror cannot represent", () => {
    const waterfall = pool("waterfall", 200, 1, 100, 200);

    expect(WaterReflection.choosePlaneY([waterfall])).toBeNull();
  });

  it("returns null for no eligible surface", () => {
    expect(WaterReflection.choosePlaneY([])).toBeNull();
  });
});

describe("WaterReflection capture and ownership", () => {
  const captured = (): AbstractMesh[] => {
    const mirror = reflection.textureFor(camera, 56);
    if (!mirror) return [];
    return mirror.getCustomRenderList?.(0, scene.meshes, scene.meshes.length) ?? [];
  };

  it("reflects the room but excludes liquid, viewmodels, and marked effects", () => {
    const wall = CreateBox("wall", { size: 1 }, scene);
    const liquid = pool("pool", 100, 100, 56);
    const gun = CreateBox("gun", { size: 1 }, scene);
    gun.layerMask = 0x10000000;
    const spray = CreateBox("spray", { size: 1 }, scene);
    spray.metadata = { excludeFromWaterCapture: true };
    const muzzleFlash = CreateBox("muzzle_flash", { size: 1 }, scene);
    muzzleFlash.metadata = { effectOwned: true, muzzleFlash: true };

    expect(captured()).toContain(wall);
    expect(captured()).not.toContain(liquid);
    expect(captured()).not.toContain(gun);
    expect(captured()).not.toContain(spray);
    expect(captured()).not.toContain(muzzleFlash);
  });

  it("filters Babylon's active list instead of building an uncullable scene-wide list", () => {
    const activeWall = CreateBox("active_wall", { size: 1 }, scene);
    CreateBox("inactive_wall", { size: 1 }, scene);
    const mirror = reflection.textureFor(camera, 56)!;

    expect(mirror.renderList).toBeNull();
    expect(mirror.renderListPredicate).toBeUndefined();
    expect(mirror.getCustomRenderList?.(0, [activeWall], 1)).toEqual([activeWall]);
    expect(mirror.forceLayerMaskCheck).toBe(true);
    expect(mirror.refreshRate).toBe(3);
  });

  it("keeps exactly one target and rebuilds only when the plane changes", () => {
    const first = reflection.textureFor(camera, 56);
    expect(reflection.textureFor(camera, 56)).toBe(first);
    const second = reflection.textureFor(camera, 128);

    expect(second).not.toBe(first);
    expect(scene.customRenderTargets).toHaveLength(1);
    expect(reflection.reflectedY).toBe(128);
  });

  it("suspends and resumes the pass without rebuilding it", () => {
    const mirror = reflection.textureFor(camera, 56);
    reflection.setRendering(false);
    expect(scene.customRenderTargets).not.toContain(mirror);

    reflection.setRendering(true);
    expect(reflection.textureFor(camera, 56)).toBe(mirror);
    expect(scene.customRenderTargets).toEqual([mirror]);
  });

  it("removes the render target on dispose and is idempotent", () => {
    reflection.textureFor(camera, 56);
    reflection.dispose();

    expect(scene.customRenderTargets).toHaveLength(0);
    expect(reflection.reflectedY).toBeNull();
    expect(() => reflection.dispose()).not.toThrow();
  });
});

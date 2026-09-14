/**
 * PVS, the static freeze and Babylon's own frustum culling all decide whether a
 * world mesh is drawn. They have to compose, and each one can defeat the others
 * quietly: a frozen world matrix captured before a mesh is positioned leaves
 * stale bounds, and `doNotSyncBoundingInfo` means nothing will ever correct
 * them. Nothing here mocks Babylon — the assertions are what the engine
 * actually does with these flags.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BspMeshBuilder } from "../BspMeshBuilder";
import type { BspMeshBuildResult } from "../mesh/types";

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("cam", new Vector3(0, 0, 0), scene);
  camera.setTarget(new Vector3(0, 0, 1));
  scene.activeCamera = camera;
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

/** A world batch shaped like the builder's output: annotated, already placed. */
function worldSurface(name: string, at: Vector3): Mesh {
  const mesh = CreateBox(name, { size: 2 }, scene);
  mesh.position.copyFrom(at);
  mesh.metadata = { bspPvsClusters: [0] };
  mesh.computeWorldMatrix(true);
  return mesh;
}

describe("PVS, static freeze and frustum culling together", () => {
  it("keeps world bounds correct through the freeze", () => {
    const world = new Mesh("bsp_world", scene);
    const far = worldSurface("bsp_tex_0", new Vector3(0, 0, 400));
    far.parent = world;
    world.computeWorldMatrix(true);

    BspMeshBuilder.freezeStaticWorld({ worldMesh: world } as BspMeshBuildResult);

    // The freeze captured a positioned mesh, so its world bounds still describe
    // where it actually is. Stale bounds here would cull visible geometry.
    expect(far.isWorldMatrixFrozen).toBe(true);
    expect(far.doNotSyncBoundingInfo).toBe(true);
    expect(far.getBoundingInfo().boundingBox.centerWorld.z).toBeCloseTo(400, 4);
  });

  it("still frustum-culls a frozen mesh that is behind the camera", () => {
    const world = new Mesh("bsp_world", scene);
    const ahead = worldSurface("bsp_tex_ahead", new Vector3(0, 0, 50));
    const behind = worldSurface("bsp_tex_behind", new Vector3(0, 0, -50));
    ahead.parent = world;
    behind.parent = world;
    world.computeWorldMatrix(true);

    BspMeshBuilder.freezeStaticWorld({ worldMesh: world } as BspMeshBuildResult);
    scene.render();

    const active = scene.getActiveMeshes();
    expect(active.data.slice(0, active.length)).toContain(ahead);
    expect(active.data.slice(0, active.length)).not.toContain(behind);
  });

  it("lets PVS hide a mesh the frustum would have accepted", () => {
    const world = new Mesh("bsp_world", scene);
    const ahead = worldSurface("bsp_tex_ahead", new Vector3(0, 0, 50));
    ahead.parent = world;
    world.computeWorldMatrix(true);
    BspMeshBuilder.freezeStaticWorld({ worldMesh: world } as BspMeshBuildResult);

    scene.render();
    const before = scene.getActiveMeshes();
    expect(before.data.slice(0, before.length)).toContain(ahead);

    // What the culler does: visibility only, never transforms.
    ahead.isVisible = false;
    scene.render();

    const after = scene.getActiveMeshes();
    expect(after.data.slice(0, after.length)).not.toContain(ahead);
    // And the freeze is undisturbed by the visibility change.
    expect(ahead.isWorldMatrixFrozen).toBe(true);
  });
});

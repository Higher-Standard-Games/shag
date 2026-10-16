import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BspMeshBuilder, type BspMeshBuildResult } from "../BspMeshBuilder";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

function billboard(isAutosprite2 = false) {
  const worldMesh = new Mesh("world", scene);
  const mesh = new Mesh("sprite", scene);
  mesh.parent = worldMesh;
  mesh.setVerticesData(VertexBuffer.PositionKind, [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], true);
  mesh.setIndices([0, 1, 2, 0, 2, 3]);
  const result = {
    worldMesh,
    autospriteMeshes: [
      {
        mesh,
        center: [0, 0, 0],
        halfWidth: 1,
        halfHeight: 1,
        isAutosprite2,
        vertexOffsets: [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      },
    ],
  } as BspMeshBuildResult;
  return { mesh, result, upload: vi.spyOn(mesh, "updateVerticesData") };
}

describe("cached BSP billboards", () => {
  it.each([false, true])("updates normals for projected-distance fades (autosprite2=%s)", (cylindrical) => {
    const { mesh, result } = billboard(cylindrical);
    mesh.setVerticesData(VertexBuffer.NormalKind, Array.from({ length: 4 }, () => [0, 0, 1]).flat(), true);
    BspMeshBuilder.updateAutosprites(result, new Vector3(3, 4, 0));
    const normal = Array.from(mesh.getVerticesData(VertexBuffer.NormalKind)!).slice(0, 3);
    expect(normal[0]).toBeCloseTo(cylindrical ? 1 : 0.6);
    expect(normal[1]).toBeCloseTo(cylindrical ? 0 : 0.8);
    expect(normal[2]).toBe(0);
  });
  it("does no vertex reads or uploads for an unchanged eye, then catches even tiny motion", () => {
    const { mesh, result, upload } = billboard();
    const eye = new Vector3(0, 0, 10);
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(1);
    const read = vi.spyOn(mesh, "getVerticesData");
    expect(BspMeshBuilder.updateAutosprites(result, eye.clone())).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
    eye.x = 0.0001;
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(1);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it.each([
    "hidden",
    "disabled",
    "parent disabled",
    "zero visibility",
  ])("skips %s sprites and refreshes on re-entry at an unchanged eye", (reason) => {
    const { mesh, result, upload } = billboard();
    const eye = new Vector3(0, 0, 10);
    BspMeshBuilder.updateAutosprites(result, eye);
    if (reason === "hidden") mesh.isVisible = false;
    if (reason === "disabled") mesh.setEnabled(false);
    if (reason === "parent disabled") result.worldMesh.setEnabled(false);
    if (reason === "zero visibility") mesh.visibility = 0;
    const read = vi.spyOn(mesh, "getVerticesData");
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(0);
    expect(read).not.toHaveBeenCalled();
    mesh.isVisible = true;
    mesh.setEnabled(true);
    result.worldMesh.setEnabled(true);
    mesh.visibility = 1;
    expect(BspMeshBuilder.updateAutosprites(result, eye)).toBe(1);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("preserves full/cylindrical billboard geometry (autosprite2=%s)", (cylindrical) => {
    const { mesh, result } = billboard(cylindrical);
    BspMeshBuilder.updateAutosprites(result, new Vector3(10, 0, 0));
    const z = cylindrical ? -1 : 1;
    expect(Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!)).toEqual([
      0,
      -1,
      z,
      0,
      -1,
      -z,
      0,
      1,
      -z,
      0,
      1,
      z,
    ]);
    expect(Array.from(mesh.getIndices()!)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("keeps per-mesh state independent and does not poison it with invalid eye positions", () => {
    const first = billboard();
    const second = billboard();
    const eye = new Vector3(0, 0, 10);
    expect(BspMeshBuilder.updateAutosprites(first.result, eye)).toBe(1);
    expect(BspMeshBuilder.updateAutosprites(second.result, eye)).toBe(1);
    expect(BspMeshBuilder.updateAutosprites(first.result, new Vector3(Number.NaN, 0, 10))).toBe(0);
    expect(BspMeshBuilder.updateAutosprites(first.result, new Vector3(0, 0, Infinity))).toBe(0);
    expect(BspMeshBuilder.updateAutosprites(first.result, Vector3.Zero())).toBe(0);
    expect(BspMeshBuilder.updateAutosprites(first.result, eye)).toBe(0);
    first.mesh.dispose();
    expect(BspMeshBuilder.updateAutosprites(first.result, new Vector3(10, 0, 0))).toBe(0);
  });
});

describe("map-owned billboard callbacks", () => {
  it("updates after frame visibility changes and before active-mesh selection in a real scene render", () => {
    const { mesh, result, upload } = billboard();
    const camera = new FreeCamera("eye", new Vector3(0, 0, 10), scene);
    camera.setTarget(Vector3.Zero());
    mesh.isVisible = false;
    BspMeshBuilder.registerAutospriteUpdates(result);
    // Register later, as BspManager does at the end of gameplay loading.
    scene.onBeforeRenderObservable.add(() => {
      mesh.isVisible = true;
    });
    const counts: number[] = [];
    scene.onBeforeActiveMeshesEvaluationObservable.add(() => counts.push(upload.mock.calls.length));
    scene.render();
    expect(counts).toEqual([1]);
    scene.render();
    expect(counts).toEqual([1, 1]);
  });

  it("uses parented world positions, ignores the weapon camera, and refreshes for each world view", () => {
    const { result, upload } = billboard();
    const parent = new TransformNode("rig", scene);
    parent.position.z = 10;
    const eye = new FreeCamera("eye", Vector3.Zero(), scene);
    eye.parent = parent;
    const weapon = new FreeCamera("weapon", new Vector3(-10, 0, 0), scene);
    weapon.layerMask = 0x10000000;
    BspMeshBuilder.registerAutospriteUpdates(result);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    scene.onBeforeCameraRenderObservable.notifyObservers(weapon);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    expect(upload).toHaveBeenCalledTimes(1);
    const other = new FreeCamera("other", new Vector3(10, 0, 0), scene);
    scene.onBeforeCameraRenderObservable.notifyObservers(other);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    expect(upload).toHaveBeenCalledTimes(3);
    parent.position.x = 1;
    scene.activeCamera = eye;
    scene.render();
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it("waits for a camera and removes its observer on map disposal and replacement", () => {
    const first = billboard();
    const count = () => scene.onBeforeCameraRenderObservable.observers.filter((o) => !o._willBeUnregistered).length;
    const before = count();
    BspMeshBuilder.registerAutospriteUpdates(first.result);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(first.upload).not.toHaveBeenCalled();
    expect(count()).toBe(before + 1);
    first.result.worldMesh.dispose();
    expect(count()).toBe(before);
    const second = billboard();
    BspMeshBuilder.registerAutospriteUpdates(second.result);
    const eye = new FreeCamera("eye", new Vector3(0, 0, 10), scene);
    scene.onBeforeCameraRenderObservable.notifyObservers(eye);
    expect(first.upload).not.toHaveBeenCalled();
    expect(second.upload).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(count()).toBe(0);
  });
});

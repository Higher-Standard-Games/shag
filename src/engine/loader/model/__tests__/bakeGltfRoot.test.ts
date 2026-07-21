/**
 * bakeWorldTransformIntoVertices regression lock.
 *
 * Reproduces the Babylon-9 pickup-invisibility bug in miniature: a mesh under a
 * `(1,1,-1)` parent (the glTF `__root__` handedness flip). Baking must (a) flip
 * the face winding for the negative determinant so it stays correct once the
 * mesh leaves `__root__`, and (b) leave the mesh detached at the identity
 * transform. Without this, cloned pickup meshes render inside-out (invisible).
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bakeWorldTransformIntoVertices } from "../bakeGltfRoot";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("bakeWorldTransformIntoVertices", () => {
  it("flips winding for the (1,1,-1) glTF root flip and flattens to identity", () => {
    const root = new TransformNode("__root__", scene);
    root.scaling = new Vector3(1, 1, -1); // glTF handedness flip
    const mesh = MeshBuilder.CreateBox("m", { size: 2 }, scene);
    mesh.parent = root;

    const before = (mesh.getIndices() ?? []).slice(0, 6);

    bakeWorldTransformIntoVertices(mesh);

    // Detached and flattened to identity.
    expect(mesh.parent).toBeNull();
    expect(mesh.scaling.asArray()).toEqual([1, 1, 1]);
    expect(mesh.position.asArray()).toEqual([0, 0, 0]);
    expect(mesh.rotationQuaternion).toBeNull();

    // Winding flipped (negative determinant → flipFaces).
    const after = (mesh.getIndices() ?? []).slice(0, 6);
    expect(after).not.toEqual(before);

    // Geometry preserved (a size-2 box: ±1 extents, with Z mirrored).
    const bb = mesh.getBoundingInfo().boundingBox;
    expect(bb.minimum.x).toBeCloseTo(-1);
    expect(bb.maximum.x).toBeCloseTo(1);
    expect(bb.minimum.z).toBeCloseTo(-1);
    expect(bb.maximum.z).toBeCloseTo(1);
  });

  it("is a no-op-shaped identity bake for an already-identity mesh (no winding flip)", () => {
    const mesh = MeshBuilder.CreateBox("m", { size: 2 }, scene);
    const before = (mesh.getIndices() ?? []).slice(0, 6);

    bakeWorldTransformIntoVertices(mesh);

    // Positive determinant → winding unchanged.
    const after = (mesh.getIndices() ?? []).slice(0, 6);
    expect(after).toEqual(before);
    expect(mesh.parent).toBeNull();
    expect(mesh.scaling.asArray()).toEqual([1, 1, 1]);
  });
});

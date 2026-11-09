import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { PlayerOutlineSmoothing, smoothPlayerOutlineNormals } from "../rendering/PlayerOutlineSmoothing";

it("smooths seams with identical skinning without changing the body's normal buffer", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const mesh = new Mesh("seam", scene);
    mesh.setVerticesData("position", [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    mesh.setVerticesData("normal", [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    mesh.setVerticesData("matricesIndices", [0, 1, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]);
    mesh.setVerticesData("matricesWeights", [0.75, 0.25, 0, 0, 0.25, 0.75, 0, 0, 1, 0, 0, 0]);
    const before = [...mesh.getVerticesData("normal")!];
    const result = smoothPlayerOutlineNormals(mesh)!;
    expect([...result.slice(0, 3)]).toEqual([...result.slice(3, 6)]);
    expect(result[0]).toBeCloseTo(Math.SQRT1_2);
    expect(result[1]).toBeCloseTo(Math.SQRT1_2);
    expect([...result.slice(6)]).toEqual([0, 0, 1]);
    expect([...mesh.getVerticesData("normal")!]).toEqual(before);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it("shares outline geometry between actors and releases it after the last actor", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const source = CreateBox("body", {}, scene);
    const skeleton = new Skeleton("rig", "rig", scene);
    new Bone("hips", skeleton, null, Matrix.Identity());
    source.skeleton = skeleton;
    const size = source.getTotalVertices();
    source.setVerticesData("matricesIndices", new Float32Array(size * 4));
    const weights = new Float32Array(size * 4);
    for (let i = 0; i < size; i++) weights[i * 4] = 1;
    source.setVerticesData("matricesWeights", weights);
    const container = new AssetContainer(scene);
    container.meshes = [source];
    const a = source.clone("a", null, true),
      b = source.clone("b", null, true);
    const before = scene.geometries.length,
      meshes = scene.meshes.length;
    const pool = new PlayerOutlineSmoothing(scene);
    pool.attach(a, container);
    pool.attach(b, container);
    expect(scene.geometries).toHaveLength(before + 1);
    expect(scene.meshes).toHaveLength(meshes);
    expect(a.geometry).toBe(source.geometry);
    expect(b.geometry).toBe(source.geometry);
    pool.dispose();
    a.dispose();
    b.dispose();
    expect(scene.geometries).toHaveLength(before);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it("keeps the cached outline template out of subsequent source hierarchy clones", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const root = new Mesh("model", scene);
    const source = CreateBox("body", {}, scene);
    source.parent = root;
    const skeleton = new Skeleton("rig", "rig", scene);
    new Bone("hips", skeleton, null, Matrix.Identity());
    source.skeleton = skeleton;
    const size = source.getTotalVertices();
    source.setVerticesData("matricesIndices", new Float32Array(size * 4));
    const weights = new Float32Array(size * 4);
    for (let i = 0; i < size; i++) weights[i * 4] = 1;
    source.setVerticesData("matricesWeights", weights);
    const container = new AssetContainer(scene);
    container.meshes = [root, source];
    const first = root.clone("first", null, false);
    const pool = new PlayerOutlineSmoothing(scene);
    pool.attach(first, container);
    expect(root.getChildMeshes().map((mesh) => mesh.name)).toEqual(["body"]);
    const next = root.clone("next", null, false);
    expect(next.getChildMeshes().map((mesh) => mesh.name)).toEqual(["next.body"]);
    pool.attach(next, container);
    expect(next.getChildMeshes()).toHaveLength(1);
    first.dispose();
    next.dispose();
    pool.dispose();
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

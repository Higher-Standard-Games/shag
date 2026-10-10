import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { PlayerOutlineProxy } from "../rendering/PlayerOutlineProxy";

it("routes both outline passes with the live skeleton, preserves body/overlay/fallback and restores ownership", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const body = CreateBox("player_0/body", {}, scene),
    template = CreateBox("body", {}, scene);
  for (const mesh of [body, template]) {
    mesh.skeleton = new Skeleton(mesh.name, mesh.name, scene);
    new Bone("hips", mesh.skeleton, null, Matrix.Identity());
  }
  body.material = new StandardMaterial("body", scene);
  body.position.set(2, 3, 4);
  body.scaling.setAll(36);
  const renderer = scene.getOutlineRenderer(),
    original = vi.spyOn(renderer, "render").mockImplementation(() => {});
  const ready = vi.spyOn(renderer, "isReady").mockReturnValue(true),
    adapter = new PlayerOutlineProxy(scene);
  const batch = body._getInstancesRenderList(0),
    subMesh = body.subMeshes[0],
    geometry = body.geometry;
  try {
    adapter.attach(body, template);
    body.computeWorldMatrix(true); // The ordinary body pass prepares its world matrix before outlines.
    renderer.render(subMesh, batch, false, 10);
    expect(original.mock.calls.at(-1)![0]).toBe(subMesh); // Opt-in only.
    adapter.enabled = true;
    renderer.render(subMesh, batch, false, 10);
    const proxy = original.mock.calls.at(-1)![0].getRenderingMesh();
    renderer.render(subMesh, batch, false, 11);
    expect(original.mock.calls.at(-1)![3]).toBe(11); // Retains the depth pass ID.
    expect(adapter.routedPasses).toBe(2);
    expect(adapter.routedIndices).toBe(template.getTotalIndices() * 2);
    expect(proxy.skeleton).toBe(body.skeleton);
    expect(proxy.getWorldMatrix().equalsWithEpsilon(body.computeWorldMatrix(true))).toBe(true);
    expect(scene.meshes).not.toContain(proxy);
    expect(body.getChildMeshes()).not.toContain(proxy);
    expect(proxy.parent).toBeNull();
    body.position.x = 7;
    body.computeWorldMatrix(true);
    renderer.render(subMesh, batch, false, 11);
    expect(proxy.getWorldMatrix().equalsWithEpsilon(body.getWorldMatrix())).toBe(true);
    expect(body.geometry).toBe(geometry);
    renderer.render(subMesh, batch, true, 12);
    expect(original.mock.calls.at(-1)![0]).toBe(subMesh);
    ready.mockReturnValue(false);
    renderer.render(subMesh, batch, false, 10);
    expect(original.mock.calls.at(-1)![0]).toBe(subMesh);
    expect(adapter.fallbackPasses).toBe(1);
    ready.mockReturnValue(true);
    body.material.alpha = 0.5;
    renderer.render(subMesh, batch, false, 10);
    expect(original.mock.calls.at(-1)![0]).toBe(subMesh);
    expect(adapter.fallbackPasses).toBe(1);
    expect(adapter.unsupportedPasses).toBe(1);
    adapter.dispose();
    expect(renderer.render).toBe(original);
    expect(proxy.isDisposed()).toBe(true);
    expect(scene.skeletons).toContain(body.skeleton);
    expect(body.geometry).toBe(geometry);
    template.skeleton!.bones[0].name = "wrong";
    const invalid = new PlayerOutlineProxy(scene);
    expect(() => invalid.attach(body, template)).toThrow("bone mismatch");
    invalid.dispose();
  } finally {
    adapter.dispose();
    ready.mockRestore();
    original.mockRestore();
    scene.dispose();
    engine.dispose();
  }
});

import { Ray } from "@babylonjs/core/Culling/ray";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { StaticVisibilityIndex } from "../rendering/water/StaticVisibilityIndex";

it("matches Babylon triangle picking over transformed static geometry, finite rays and misses", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const meshes = Array.from({ length: 9 }, (_, i) => {
      const mesh = CreateBox(`wall${i}`, { size: 2 }, scene);
      mesh.position.set((i % 3) * 4 - 4, 4, Math.floor(i / 3) * 4 - 4);
      mesh.rotation.set(i * 0.05, i * 0.13, i * 0.03);
      mesh.scaling.set(1 + i * 0.1, 0.5 + i * 0.2, 0.8);
      mesh.computeWorldMatrix(true);
      mesh.isVisible = false;
      mesh.isPickable = false;
      return mesh;
    });
    const index = new StaticVisibilityIndex(meshes);
    let hits = 0,
      misses = 0;
    for (let x = -12; x <= 12; x++)
      for (let z = -12; z <= 12; z++) {
        const ray = new Ray(new Vector3(x, 0, z), new Vector3(0.01, 1, 0.03).normalize(), (x + z) % 2 === 0 ? 12 : 1);
        const expected = meshes.some((mesh) => ray.intersectsMesh(mesh, true).hit);
        expect(index.hits(ray)).toBe(expected);
        if (expected) hits++;
        else misses++;
      }
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
    expect(new StaticVisibilityIndex([]).hits(new Ray(Vector3.Zero(), Vector3.Up(), 100))).toBe(false);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

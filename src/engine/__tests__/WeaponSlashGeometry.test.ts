import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { WeaponSlash } from "../weapon/WeaponSlash";

/**
 * A swing adds a ribbon point a frame. Disposing the ribbon's last submesh
 * releases its shader even while the material survives, so a ribbon rebuilt
 * each frame recompiled the same program for the whole swing. The mesh, its
 * submesh and its material must outlive every frame of a swing.
 */
it("keeps the slash ribbon's mesh, submesh and material for the whole swing", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new FreeCamera("camera", Vector3.Zero(), scene);
  const slash = new WeaponSlash();
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  try {
    slash.trigger();
    slash.updateTrail(scene, camera);
    now = 8;
    slash.updateTrail(scene, camera);
    const mesh = scene.getMeshByName("slashTrail") as Mesh;
    const subMesh = mesh.subMeshes[0];
    const material = mesh.material;
    for (now = 16; now < 400; now += 8) {
      camera.position.x += 0.3;
      slash.updateTrail(scene, camera);
      expect(scene.getMeshByName("slashTrail")).toBe(mesh);
      expect(mesh.isDisposed()).toBe(false);
      expect(mesh.subMeshes[0]).toBe(subMesh);
      expect(mesh.material).toBe(material);
      // The bounds follow the growing ribbon.
      const trail = (slash as unknown as { trails: { tipPoints: Vector3[]; handlePoints: Vector3[] }[] }).trails[0];
      const box = mesh.getBoundingInfo().boundingBox;
      for (const point of [...trail.tipPoints, ...trail.handlePoints]) {
        for (const axis of ["x", "y", "z"] as const) {
          expect(point[axis]).toBeGreaterThanOrEqual(box.minimum[axis] - 1e-4);
          expect(point[axis]).toBeLessThanOrEqual(box.maximum[axis] + 1e-4);
        }
      }
    }
    slash.dispose();
    expect(scene.getMeshByName("slashTrail")).toBeNull();
    expect(scene.materials).not.toContain(material);
    expect(scene.textures.some((texture) => texture.name === "slashTrailFeather")).toBe(false);
  } finally {
    clock.mockRestore();
    slash.dispose();
    scene.dispose();
    engine.dispose();
  }
});

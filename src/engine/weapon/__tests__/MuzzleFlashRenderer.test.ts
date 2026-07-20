import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import type { MuzzleFlashStyle } from "../../../shared/entities/WeaponDef";
import { MuzzleFlashRenderer } from "../muzzle/MuzzleFlashRenderer";

function flash(style: MuzzleFlashStyle) {
  return {
    position: new Vector3(0, 0, 5),
    color: new Color3(1, 0.8, 0.3),
    style,
    intensity: 25,
    duration: 0.06,
  };
}

describe("MuzzleFlashRenderer lifecycle", () => {
  it("spawns, renders, and expires flashes without leaking meshes/materials", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 0, -10), scene);
    let now = 10;
    const renderer = new MuzzleFlashRenderer(scene, () => now);
    const initialMeshes = scene.meshes.length;
    const initialMaterials = scene.materials.length;
    const mesh = scene.getMeshByName("muzzle_flash") as Mesh | null;

    try {
      expect(mesh?.isEnabled()).toBe(false);

      renderer.spawn(flash("burst"));
      renderer.update(1 / 60);
      expect(renderer.getDebugCount()).toBe(1);
      expect(mesh?.isEnabled()).toBe(true);
      expect(mesh?.thinInstanceCount).toBe(1);
      expect(scene.meshes).toHaveLength(initialMeshes);
      expect(scene.materials).toHaveLength(initialMaterials);

      now += 1; // past the 0.06s fade
      renderer.update(1 / 60);
      expect(renderer.getDebugCount()).toBe(0);
      expect(mesh?.isEnabled()).toBe(false);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("caps concurrent flashes at capacity and clears cleanly", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 0, -10), scene);
    let now = 1;
    const renderer = new MuzzleFlashRenderer(scene, () => now, 3);

    try {
      for (const style of ["burst", "plume", "arcs", "burst", "arcs"] as const) {
        now += 0.001;
        renderer.spawn(flash(style));
      }
      renderer.update(1 / 60);
      expect(renderer.getDebugCount()).toBe(3);

      renderer.clear();
      expect(renderer.getDebugCount()).toBe(0);
      expect((scene.getMeshByName("muzzle_flash") as Mesh | null)?.isEnabled()).toBe(false);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});

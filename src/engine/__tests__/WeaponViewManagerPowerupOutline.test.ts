import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import type { MD3LoadResult } from "../loader/model/MD3Loader";
import { WeaponViewManager } from "../weapon/WeaponViewManager";

type Internals = { currentWeapon: MD3LoadResult | null };

describe("WeaponViewManager powerup outline", () => {
  it("overrides a disabled user outline and restores it after Quad", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode("weapon", scene);
    root.scaling.setAll(2);
    const mesh = MeshBuilder.CreateBox("weaponMesh", {}, scene);
    mesh.parent = root;
    const manager = new WeaponViewManager();
    (manager as unknown as Internals).currentWeapon = { root, meshes: [mesh] } as unknown as MD3LoadResult;

    try {
      manager.setWeaponOutlineEnabled(false);
      manager.setPowerupOutlineOverride(true, new Color3(1, 0.3, 0.02), 0.4);

      expect(mesh.renderOutline).toBe(true);
      expect(mesh.outlineColor.asArray()).toEqual([1, 0.3, 0.02]);
      expect(mesh.outlineWidth).toBeCloseTo(0.2);

      manager.setPowerupOutlineOverride(false, Color3.Black(), 0);
      expect(mesh.renderOutline).toBe(false);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

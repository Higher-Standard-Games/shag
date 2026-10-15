import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { configureBspBakedLighting } from "../BspBakedLightingPlugin";
import { createBspLightmapTexture } from "../mesh/lightmaps";

describe("direct FBSP baked lighting", () => {
  it("preserves raw light color and converts direction data only at the loader boundary", () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    try {
      const light = createBspLightmapTexture(new Uint8Array([153, 139, 110]), 1, scene, "light", true);
      const direction = createBspLightmapTexture(new Uint8Array([128, 10, 240]), 1, scene, "direction", true, true);
      expect(Array.from(light.getInternalTexture()!._bufferView as Uint8Array)).toEqual([153, 139, 110, 255]);
      expect(Array.from(direction.getInternalTexture()!._bufferView as Uint8Array)).toEqual([128, 240, 10, 255]);
      expect(light.gammaSpace).toBe(false);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
  it("removes synthetic fill but retains current and future dynamic lights, and cleans up mesh references", async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    try {
      const mesh = new Mesh("world", scene),
        material = new StandardMaterial("baked", scene);
      mesh.material = material;
      const fill = new HemisphericLight("worldFillLight", Vector3.Up(), scene);
      const dynamic = new PointLight("rocket", Vector3.Zero(), scene);
      const profile = { gain: 3, ambient: [0, 0, 0] as [number, number, number], deluxe: false };
      configureBspBakedLighting(material, mesh, profile, null);
      const sun = new HemisphericLight("sunLight", Vector3.Up(), scene);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fill.canAffectMesh(mesh)).toBe(false);
      expect(sun.canAffectMesh(mesh)).toBe(false);
      expect(dynamic.canAffectMesh(mesh)).toBe(true);
      const plugin = material.pluginManager!.getPlugin("BspBakedLighting");
      configureBspBakedLighting(material, mesh, { ...profile, gain: 2 }, null);
      expect(material.pluginManager!.getPlugin("BspBakedLighting")).toBe(plugin);
      mesh.dispose();
      expect(fill.excludedMeshes).toHaveLength(0);
      expect(sun.excludedMeshes).toHaveLength(0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

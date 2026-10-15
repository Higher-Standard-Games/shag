import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { BspMeshBuilder, type BspMeshBuildResult } from "../BspMeshBuilder";

describe("baked lightmap versus vertex lighting", () => {
  it.each([
    { page: 0, authored: false, translucent: false, neutral: true },
    { page: 0, authored: true, translucent: false, neutral: false },
    { page: -1, authored: false, translucent: false, neutral: false },
    { page: 0, authored: false, translucent: true, neutral: false },
  ])("keeps vertex alpha and honors RGB ownership: %j", ({ page, authored, translucent, neutral }) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const mesh = new Mesh("world", scene);
      mesh.setVerticesData("position", [0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const colors = [0, 0.25, 0.5, 0.75, 0.5, 0.25, 0, 1, 0, 0, 0, 0.25];
      mesh.setVerticesData("color", colors);
      mesh.metadata = { lightmapIndex: page, usesVertexRgb: authored, preserveVertexLighting: translucent };
      mesh.material = new StandardMaterial("lit", scene);
      const result = { worldMesh: mesh, lightmapTextures: [new Texture(null, scene)] } as BspMeshBuildResult;
      BspMeshBuilder.applyLightmaps(result);
      const actual = Array.from(mesh.getVerticesData("color")!);
      expect(actual).toEqual(neutral ? colors.map((c, i) => (i % 4 === 3 ? c : 1)) : colors);
      expect(mesh.useVertexColors).toBe(true);
      BspMeshBuilder.applyLightmaps(result, { intensity: 3 });
      expect(Array.from(mesh.getVerticesData("color")!)).toEqual(actual);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

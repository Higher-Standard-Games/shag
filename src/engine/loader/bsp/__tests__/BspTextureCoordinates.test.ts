import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { Q3ShaderRegistry } from "../../shader/Q3ShaderRegistry";
import type { BspFile } from "../BspLoader";
import { BspMeshBuilder } from "../BspMeshBuilder";

describe("FBSP texture coordinates and vertex-alpha decals", () => {
  it.each([1, 3])("keeps texture UV distinct from baked UV on face type %i", (faceType) => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    const registry = Q3ShaderRegistry.getInstance();
    const defaults = registry.resolveMaterialProps("textures/qa/unknown");
    const resolve = vi
      .spyOn(registry, "resolveMaterialProps")
      .mockReturnValue({ ...defaults, alphaMode: "blend", isTransparent: true, usesVertexAlpha: true });
    try {
      const uv = [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ];
      const uv2 = [
        [0.7, 0.8],
        [0.9, 1],
        [0.11, 0.12],
      ];
      const bsp = {
        header: { isFBSP: true },
        entities: [],
        textures: [{ name: "textures/qa/decal", surfaceFlags: 0, contentFlags: 0 }],
        models: [{ firstFace: 0, numFaces: 1 }],
        faces: [
          {
            faceType,
            textureIndex: 0,
            firstVertex: 0,
            numVertices: 3,
            firstMeshVert: 0,
            numMeshVerts: 3,
            lightmapIndex: -1,
          },
        ],
        vertices: uv.map((texCoord, i) => ({
          position: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ][i],
          normal: [0, 0, 1],
          texCoord,
          lightmapCoords: [uv2[i], [0, 0], [0, 0], [0, 0]],
          colors: [
            [255, 255, 255, i * 127],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
          ],
        })),
        meshVerts: [0, 1, 2],
        lightmaps: [],
        lightmapSize: 512,
        lightVols: [],
        effects: [],
        brushes: [],
        brushSides: [],
        planes: [],
        nodes: [],
        leafBrushes: [],
        leafs: [],
        leafFaces: [],
        visData: null,
      } as unknown as BspFile;
      const result = BspMeshBuilder.build(bsp, scene);
      const mesh = result.worldMesh.getChildMeshes()[0];
      expect(Array.from(mesh.getVerticesData("uv")!)).toEqual(uv.flat());
      expect(Array.from(mesh.getVerticesData("uv2")!)).toEqual(uv2.flat());
      expect(mesh.hasVertexAlpha).toBe(true);
      expect(mesh.material!.needAlphaBlendingForMesh(mesh)).toBe(true);
      const colors = mesh.getVerticesData("color")!;
      expect(colors[3]).toBe(0);
      expect(colors[7]).toBeCloseTo(127 / 255);
    } finally {
      resolve.mockRestore();
      scene.dispose();
      engine.dispose();
    }
  });
});

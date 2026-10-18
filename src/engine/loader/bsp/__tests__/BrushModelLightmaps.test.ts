import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { PK3TextureLoader } from "../../pk3/PK3TextureLoader";
import type { BspFile } from "../BspLoader";
import { buildBrushModel } from "../mesh/brushModelBuilder";

describe("inline brush lightmap pages", () => {
  it("renders curved inline structures with interpolated UVs and shared polygon groups", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const load = vi.spyOn(PK3TextureLoader.getInstance(), "loadTexture").mockResolvedValue(new Texture(null, scene));
    try {
      const bsp = {
        models: [{ mins: [0, 0, 0], maxs: [2, 2, 1], firstFace: 0, numFaces: 2 }],
        textures: [{ name: "textures/qa/curved", surfaceFlags: 0, contentFlags: 1 }],
        lightmaps: [],
        faces: [
          { textureIndex: 0, lightmapIndex: -1, faceType: 2, firstVertex: 0, numVertices: 9, patchSize: [3, 3] },
          {
            textureIndex: 0,
            lightmapIndex: -1,
            faceType: 3,
            firstVertex: 9,
            numVertices: 3,
            firstMeshVert: 0,
            numMeshVerts: 3,
          },
        ],
        vertices: Array.from({ length: 12 }, (_, i) => ({
          position: [i % 3, Math.floor(i / 3), i === 4 ? 2 : 0],
          normal: [0, 0, 1],
          texCoord: [(i % 3) / 2, Math.floor(i / 3) / 2],
          lightmapCoord: [0.25, 0.75],
          color: [255, 255, 255, 255],
        })),
        meshVerts: [0, 1, 2],
      } as unknown as BspFile;
      const parent = await buildBrushModel(bsp, 0, scene, "curved_structure");
      const child = parent!.getChildMeshes()[0];
      expect(parent!.getChildMeshes()).toHaveLength(1);
      expect(child.getTotalVertices()).toBe(84); // 9x9 tessellation plus triangle
      expect(child.getTotalIndices()).toBe(387);
      expect(child.getIndices()!.slice(-3)).toEqual([81, 83, 82]);
      expect(child.getVerticesData(VertexBuffer.PositionKind)!.slice(120, 123)).toEqual([1, 0.5, 1]);
      expect(child.getVerticesData(VertexBuffer.UV2Kind)!.slice(80, 82)).toEqual([0.25, 0.75]);
    } finally {
      load.mockRestore();
      scene.dispose();
      engine.dispose();
    }
  });

  it.each([false, true])("keeps lightmapped and unlightmapped faces separate (WebGPU policy=%s)", async (webgpu) => {
    const engine = new NullEngine();
    if (webgpu) Object.defineProperty(engine, "isWebGPU", { value: true });
    const scene = new Scene(engine);
    const diffuse = new Texture(null, scene);
    const load = vi.spyOn(PK3TextureLoader.getInstance(), "loadTexture").mockResolvedValue(diffuse);
    try {
      const bsp = {
        models: [{ mins: [0, 0, 0], maxs: [4, 1, 1], firstFace: 0, numFaces: 4 }],
        textures: [{ name: "textures/qa/lift", surfaceFlags: 0, contentFlags: 1 }],
        lightmapSize: 1,
        lightmaps: [new Uint8Array([255, 0, 0]), new Uint8Array([0, 255, 0])],
        faces: [0, 1, -3, 0].map((lightmapIndex, i) => ({
          textureIndex: 0,
          lightmapIndex,
          faceType: 1,
          firstVertex: i * 3,
          numVertices: 3,
          firstMeshVert: i * 3,
          numMeshVerts: 3,
        })),
        vertices: Array.from({ length: 12 }, (_, i) => ({
          position: [Math.floor(i / 3), i % 3 === 1 ? 1 : 0, i % 3 === 2 ? 1 : 0],
          normal: [1, 0, 0],
          texCoord: [0, 0],
          lightmapCoord: [0.25, 0.75],
          color: [255, 255, 255, 255],
        })),
        meshVerts: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2],
      } as unknown as BspFile;
      const parent = await buildBrushModel(bsp, 0, scene, "lift");
      const children = parent!.getChildMeshes();
      expect(children).toHaveLength(3);
      expect(new Set(children.map((mesh) => mesh.name)).size).toBe(3);
      expect(children.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0)).toBe(12);
      for (const child of children) {
        const page = child.metadata.lightmapIndex;
        const material = child.material as StandardMaterial;
        expect(material.diffuseTexture).toBe(diffuse);
        expect(material.maxSimultaneousLights).toBe(webgpu ? 2 : 6);
        expect(child.getVerticesData(VertexBuffer.UV2Kind)?.slice(0, 2)).toEqual([0.25, 0.75]);
        expect(child.getIndices()?.slice(0, 3)).toEqual([0, 2, 1]);
        if (page === -1) expect(material.lightmapTexture).toBeNull();
        else {
          expect(material.lightmapTexture!.coordinatesIndex).toBe(1);
          expect(material.useLightmapAsShadowmap).toBe(true);
          const upload = material.lightmapTexture!.getInternalTexture()!._bufferView;
          expect(Array.from(upload as Uint8Array)).toEqual(page === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]);
        }
      }
      const second = await buildBrushModel(bsp, 0, scene, "second_lift");
      const pages = children.map((child) => (child.material as StandardMaterial).lightmapTexture);
      const secondPages = second!.getChildMeshes().map((child) => (child.material as StandardMaterial).lightmapTexture);
      for (let i = 0; i < pages.length; i++) expect(secondPages[i]).toBe(pages[i]);
      parent!.dispose();
      for (const page of secondPages) if (page) expect(page.getInternalTexture()).not.toBeNull();
      second!.dispose();
      for (const page of pages) if (page) expect(page.getInternalTexture()).toBeNull();
    } finally {
      load.mockRestore();
      scene.dispose();
      engine.dispose();
    }
  });
});

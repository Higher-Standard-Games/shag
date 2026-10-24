/**
 * A texture's faces on different lightmap pages share one mesh when the pages
 * are layers of one texture (NullEngine): the page rides in lightmap U.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BspFile } from "../BspLoader";
import { BspMeshBuilder } from "../BspMeshBuilder";

// A NullEngine cannot build array textures; the layers here only need a name
vi.mock("../mesh/lightmaps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mesh/lightmaps")>();
  return {
    ...actual,
    createBspLightmapArray: (_pages: unknown, _size: number, _scene: unknown, name: string) => ({
      name,
      dispose: () => {},
    }),
  };
});

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  vi.restoreAllMocks();
  scene.dispose();
  engine.dispose();
});

const page = (size: number) => new Uint8Array(size * size * 3).fill(128);

/** Two triangles of one texture, on lightmap pages 0 and 2, with deluxe pages 1 and 3. */
function map(isFBSP: boolean): BspFile {
  const face = (lightmapIndex: number, firstVertex: number) => ({
    faceType: 1,
    textureIndex: 0,
    firstVertex,
    numVertices: 3,
    firstMeshVert: 0,
    numMeshVerts: 3,
    lightmapIndex,
  });
  const vertex = (x: number, u: number) => ({
    position: [x, 0, 0],
    normal: [0, 0, 1],
    texCoord: [0, 0],
    lightmapCoords: [
      [u, 0.5],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    lightmapCoord: [u, 0.5],
    colors: [
      [255, 255, 255, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    color: [255, 255, 255, 255],
  });
  return {
    header: { isFBSP },
    entities: [],
    textures: [{ name: "textures/qa/wall", surfaceFlags: 0, contentFlags: 1 }],
    models: [{ firstFace: 0, numFaces: 2 }],
    faces: [face(0, 0), face(2, 3)],
    vertices: [vertex(0, 0.1), vertex(1, 0.2), vertex(2, 0.3), vertex(3, 0.4), vertex(4, 0.5), vertex(5, 0.6)],
    meshVerts: [0, 1, 2],
    lightmaps: [page(2), page(2), page(2), page(2)],
    lightmapSize: 2,
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
}

describe("layered lightmaps", () => {
  it("puts one texture's faces on different pages into one mesh, the page in lightmap U", () => {
    // The layering a GPU engine chooses; a NullEngine itself never layers
    vi.spyOn(
      BspMeshBuilder.prototype as unknown as { canLayerLightmaps(): boolean },
      "canLayerLightmaps",
    ).mockReturnValue(true);
    const result = BspMeshBuilder.build(map(true), scene);
    const meshes = result.worldMesh.getChildMeshes();
    expect(meshes).toHaveLength(1);
    expect(meshes[0].metadata).toMatchObject({ lightmapIndex: 0, lightmapLayered: true });
    const u = Array.from(meshes[0].getVerticesData("uv2")!).filter((_, i) => i % 2 === 0);
    // Page 0 is layer 0; page 2 (after deluxe page 1) is layer 1, two units on
    expect(u.map((value) => Number(value.toFixed(5)))).toEqual([0.1, 0.2, 0.3, 2.4, 2.5, 2.6]);
    expect(result.lightmapTextures.map((texture) => texture.name)).toEqual([
      "lightmap_layers",
      "lightmap_direction_layers",
      "lightmap_white",
    ]);
  });

  it("keeps a page per mesh without a GPU", () => {
    const result = BspMeshBuilder.build(map(true), scene);
    expect(result.worldMesh.getChildMeshes()).toHaveLength(2);
    expect(result.lightmapTextures).toHaveLength(4);
  });
});

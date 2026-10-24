/**
 * `map $cubemap` stages reflect a capture of the map: the stage loads no
 * image, draws as its own pass beside other stages, and each object using it
 * gets a mesh of its own (NullEngine).
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeSurface, groupCubemapSurfaces } from "../../../rendering/SurfaceCubemaps";
import { PK3TextureLoader } from "../../pk3/PK3TextureLoader";
import { parseShaderFile } from "../../shader/Q3ShaderParser";
import { Q3ShaderRegistry } from "../../shader/Q3ShaderRegistry";
import type { Q3Shader, ResolvedMaterialProps } from "../../shader/Q3ShaderTypes";
import { BspMeshBuilder, type BspMeshBuildResult } from "../BspMeshBuilder";
import { cubemapObjectOfFaces } from "../mesh/cubemapObjects";

const MIRROR = `models/qa/sphere
{
  qer_editorimage textures/qa/sphere
  {
    map $cubemap
    rgbgen identity
  }
}`;

const SHINY_WALL = `textures/qa/shiny
{
  {
    map textures/qa/wall
  }
  {
    map $lightmap
    blendfunc filter
  }
  {
    map $cubemap
    blendfunc add
  }
}`;

let engine: NullEngine;
let scene: Scene;
const registry = Q3ShaderRegistry.getInstance();

function define(source: string): Q3Shader {
  const [shader] = parseShaderFile(source);
  (registry as unknown as { shaders: Map<string, Q3Shader> }).shaders.set(shader.name, shader);
  return shader;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  registry.clear();
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  vi.restoreAllMocks();
  registry.clear();
  scene.dispose();
  engine.dispose();
});

describe("$cubemap shader stages", () => {
  it("resolve to a reflection with no image and no lightmap", () => {
    const shader = define(MIRROR);
    const props = registry.resolveMaterialProps(shader.name, { worldSurface: true });
    expect(props).toMatchObject({ generatedCubemap: true, useLightmap: false });
    expect(props.diffuseTexture).toBeUndefined();
    expect(registry.resolveMaterialPasses(shader.name)).toHaveLength(1);
    expect(registry.hasGeneratedCubemap(shader.name)).toBe(true);
  });

  it("draw as their own pass after the other stages, blended by their blendFunc", () => {
    const shader = define(SHINY_WALL);
    const [base, cube, ...rest] = registry.resolveMaterialPasses(shader.name, { worldSurface: true });
    expect(rest).toHaveLength(0);
    expect(base).toMatchObject({ diffuseTexture: "textures/qa/wall", useLightmap: true, alphaMode: "opaque" });
    expect(base.generatedCubemap).toBeUndefined();
    expect(cube).toMatchObject({ generatedCubemap: true, alphaMode: "add", depthWrite: false, useLightmap: false });
    // The whole shader still describes its base for grouping and collision
    expect(registry.resolveMaterialProps(shader.name).diffuseTexture).toBe("textures/qa/wall");
  });

  it("load no texture and leave only the reflection to draw", async () => {
    const shader = define(MIRROR);
    const load = vi
      .spyOn(PK3TextureLoader.getInstance(), "resolveAndLoadTexture")
      .mockResolvedValue(RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene));
    vi.spyOn(PK3TextureLoader.getInstance(), "init").mockImplementation(() => {});
    const root = new Mesh("world", scene);
    const mesh = CreateSphere("bsp_tex_0", {}, scene);
    mesh.parent = root;
    mesh.metadata = { textureName: shader.name, lightmapIndex: -1, generatedCubemap: true };
    const factory = BspMeshBuilder as unknown as {
      createMaterialFromProps(name: string, scene: Scene, props: ResolvedMaterialProps): StandardMaterial;
    };
    mesh.material = factory.createMaterialFromProps("m", scene, registry.resolveMaterialProps(shader.name));
    const result = {
      worldMesh: root,
      textureGroups: [{ textureIndex: 0, textureName: shader.name }],
      lightmapTextures: [],
    } as unknown as BspMeshBuildResult;
    await BspMeshBuilder.applyTextures(result, result.bspData, scene);
    expect(load).not.toHaveBeenCalled();
    const material = mesh.material as StandardMaterial;
    expect(material.diffuseTexture).toBeNull();
    expect(material.disableLighting).toBe(true);
    expect(material.diffuseColor.asArray()).toEqual([0, 0, 0]);
  });

  it("clone a reflection pass over a mixed shader's surface", async () => {
    const shader = define(SHINY_WALL);
    vi.spyOn(PK3TextureLoader.getInstance(), "resolveAndLoadTexture").mockResolvedValue(
      RawTexture.CreateRGBATexture(new Uint8Array([128, 128, 128, 255]), 1, 1, scene),
    );
    vi.spyOn(PK3TextureLoader.getInstance(), "init").mockImplementation(() => {});
    const root = new Mesh("world", scene);
    const mesh = CreatePlane("bsp_tex_0", {}, scene);
    mesh.parent = root;
    mesh.metadata = { textureName: shader.name, lightmapIndex: -1 };
    mesh.material = new StandardMaterial("placeholder", scene);
    const result = {
      worldMesh: root,
      textureGroups: [{ textureIndex: 0, textureName: shader.name }],
      lightmapTextures: [],
    } as unknown as BspMeshBuildResult;
    await BspMeshBuilder.applyTextures(result, result.bspData, scene);
    const pass = root.getChildMeshes().find((m) => m.name === "bsp_tex_0_pass_1");
    expect(mesh.metadata.generatedCubemap).toBe(false);
    expect((mesh.material as StandardMaterial).diffuseTexture).not.toBeNull();
    expect(pass?.metadata.generatedCubemap).toBe(true);
    expect((pass?.material as StandardMaterial | undefined)?.diffuseTexture).toBeNull();
  });
});

describe("$cubemap objects", () => {
  it("are faces joined by shared vertices", () => {
    const vertex = (x: number, y: number) => ({ position: [x, y, 0] });
    const face = (textureIndex: number, firstVertex: number) => ({ textureIndex, firstVertex, numVertices: 3 });
    const bsp = {
      // Faces 0 and 1 share a corner; face 2 stands apart; face 3 is another shader
      faces: [face(0, 0), face(0, 3), face(0, 6), face(1, 0)],
      vertices: [
        vertex(0, 0),
        vertex(1, 0),
        vertex(0, 1),
        vertex(1, 0),
        vertex(2, 0),
        vertex(2, 1),
        vertex(9, 9),
        vertex(10, 9),
        vertex(9, 10),
      ],
    } as never;
    const objects = cubemapObjectOfFaces(bsp, 0, 4, (index) => index === 0);
    expect([...objects.entries()]).toEqual([
      [0, 0],
      [1, 0],
      [2, 2],
    ]);
  });

  it("are flat or curved, and share a capture across their passes", () => {
    const wall = CreatePlane("wall", { size: 64 }, scene);
    wall.position.set(0, 32, 100);
    const flat = describeSurface(wall);
    expect(flat.flatNormal?.z).toBeCloseTo(-1);
    expect(flat.centre.asArray()).toEqual([0, 32, 100]);
    const ball = CreateSphere("ball", { diameter: 32 }, scene);
    expect(describeSurface(ball).flatNormal).toBeNull();
    const pass = wall.clone("wall_pass_1", null)!;
    const groups = groupCubemapSurfaces([wall, ball, pass]);
    expect(groups.map((group) => group.meshes.map((mesh) => mesh.name))).toEqual([["wall", "wall_pass_1"], ["ball"]]);
    expect(groups[1].centre.equalsWithEpsilon(Vector3.Zero())).toBe(true);
  });
});

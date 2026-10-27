import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cvar } from "../../../core/Cvar";
import { BspSurfaceArrayPlugin, SURFACE_LAYER_KIND } from "../BspSurfaceArrayPlugin";
import { mergeBspSurfaceArrays } from "../BspSurfaceArrays";
import type { BspMeshBuildResult } from "../mesh/types";

// NullEngine has no device to copy with: arrays stand in as plain textures
vi.mock("../../../rendering/TextureArrays", () => ({
  textureArrayShape: (texture: BaseTexture) => (texture.name.includes("odd") ? "64x64" : "256x256"),
  createTextureArray: (_textures: BaseTexture[], scene: Scene, name: string) => {
    const array = new BaseTexture(scene);
    array.name = name;
    return array;
  },
}));

describe("texture-array surface merging", () => {
  let engine: NullEngine;
  let scene: Scene;
  let world: Mesh;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    world = new Mesh("bsp_world", scene);
    Cvar.set("r_surface_arrays", 1);
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  /** A one-quad surface of its own texture, as the BSP builder makes them. */
  const surface = (index: number, textureName: string, options: { image?: string; cull?: boolean } = {}) => {
    const mesh = new Mesh(`bsp_tex_${index}`, scene);
    const data = new VertexData();
    data.positions = [0, 0, index, 1, 0, index, 1, 1, index, 0, 1, index];
    data.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    data.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    data.indices = [0, 1, 2, 0, 2, 3];
    data.applyToMesh(mesh);
    const material = new StandardMaterial(`bsp_mat_${index}`, scene);
    const image = new BaseTexture(scene);
    image.name = options.image ?? `image_${index}`;
    material.diffuseTexture = image;
    material.backFaceCulling = options.cull ?? true;
    mesh.material = material;
    mesh.parent = world;
    mesh.metadata = {
      textureName,
      surfaceArrayEligible: true,
      bspPvsClusters: [index],
      contentFlags: 1,
      surfaceFlags: 0,
    };
    return mesh;
  };
  const merge = () => mergeBspSurfaceArrays({ worldMesh: world } as BspMeshBuildResult);

  it("draws surfaces that differ only in their image as one mesh, each vertex naming its layer", () => {
    const [a, b, c] = [surface(1, "textures/a"), surface(2, "textures/b"), surface(3, "textures/c")];
    const first = a.material as StandardMaterial;
    const others = [b.material, c.material];

    expect(merge()).toEqual({ merged: 3, meshes: 1, arrays: 1 });
    const merged = scene.getMeshByName("bsp_tex_1_array") as Mesh;
    expect(merged.getTotalVertices()).toBe(12);
    expect(Array.from(merged.getVerticesData(SURFACE_LAYER_KIND)!)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(Array.from(merged.getIndices()!)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
    expect(Array.from(merged.getVerticesData("position")!).filter((_, i) => i % 3 === 2)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
    expect(merged.parent).toBe(world);
    expect(merged.metadata.bspPvsClusters).toEqual([1, 2, 3]);
    expect(merged.metadata.surfaceArrayTextures).toEqual(["textures/a", "textures/b", "textures/c"]);
    expect(merged.material).toBe(first);
    expect(first.pluginManager?.getPlugin("BspSurfaceArray")).toBeInstanceOf(BspSurfaceArrayPlugin);
    expect([a, b, c].every((mesh) => mesh.isDisposed())).toBe(true);
    expect(others.every((material) => !scene.materials.includes(material!))).toBe(true);
  });

  it("keeps a surface that draws differently, has another image size or names an effect", () => {
    surface(1, "textures/a");
    surface(2, "textures/b");
    const twoSided = surface(3, "textures/c", { cull: false });
    const otherSize = surface(4, "textures/d", { image: "odd_image" });
    const flare = surface(5, "textures/lights/flare1");
    const ineligible = surface(6, "textures/e");
    ineligible.metadata.surfaceArrayEligible = false;

    expect(merge()).toEqual({ merged: 2, meshes: 1, arrays: 1 });
    for (const mesh of [twoSided, otherSize, flare, ineligible]) expect(mesh.isDisposed()).toBe(false);
  });

  it("keeps surfaces of different shot or collision flags apart", () => {
    surface(1, "textures/a");
    const detail = surface(2, "textures/b");
    detail.metadata.contentFlags = 0x8000000;
    expect(merge().merged).toBe(0);
  });

  it("leaves every surface alone with r_surface_arrays 0", () => {
    surface(1, "textures/a");
    surface(2, "textures/b");
    Cvar.set("r_surface_arrays", 0);
    expect(merge()).toEqual({ merged: 0, meshes: 0, arrays: 0 });
    expect(scene.getMeshByName("bsp_tex_1")?.isDisposed()).toBe(false);
  });
});

describe("texture-array material plugin", () => {
  it.each([ShaderLanguage.GLSL, ShaderLanguage.WGSL])(
    "replaces the base sample and perturbs the normal from the arrays (%s)",
    (language) => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const material = new StandardMaterial("surface", scene);
      const plugin = new BspSurfaceArrayPlugin(material, new BaseTexture(scene), new BaseTexture(scene), false);
      const fragment = plugin.getCustomCode("fragment", language)!;
      const replacement = Object.entries(fragment).find(([key]) => key.startsWith("!"))!;
      // The pattern matches Babylon's own sample, semicolon included
      const babylon =
        language === ShaderLanguage.WGSL
          ? "baseColor=TEXRD(diffuseSampler,diffuseSamplerSampler,fragmentInputs.vDiffuseUV+uvOffset);"
          : "baseColor=TEXRD(diffuseSampler,vDiffuseUV+uvOffset);";
      expect(new RegExp(replacement[0].slice(1)).test(babylon)).toBe(true);
      expect(replacement[1]).toContain("bspBaseArray");
      expect(replacement[1].endsWith(";")).toBe(true);
      expect(fragment.CUSTOM_FRAGMENT_UPDATE_DIFFUSE).toContain("bspBumpArray");
      expect(plugin.getCustomCode("vertex", language)!.CUSTOM_VERTEX_MAIN_END).toContain(SURFACE_LAYER_KIND);
      scene.dispose();
      engine.dispose();
    },
  );
});

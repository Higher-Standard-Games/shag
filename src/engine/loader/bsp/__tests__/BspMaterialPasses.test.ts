import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { PK3TextureLoader } from "../../pk3/PK3TextureLoader";
import { parseShaderFile } from "../../shader/Q3ShaderParser";
import { Q3ShaderRegistry } from "../../shader/Q3ShaderRegistry";
import type { Q3Shader } from "../../shader/Q3ShaderTypes";
import { BspMeshBuilder, type BspMeshBuildResult } from "../BspMeshBuilder";

it("loads ordered passes without whitening the base vertex colour or sharing mutable stage textures", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const registry = Q3ShaderRegistry.getInstance();
  registry.clear();
  const [shader] = parseShaderFile(`textures/qa/support {
    { material textures/qa/base - -
      rgbGen vertex }
    { material textures/qa/base - -
      rgbGen identity
      blendFunc blend }
    { map textures/qa/ao
      rgbGen const 0.05 0.025 0.01
      blendFunc add }
  }`);
  (registry as unknown as { shaders: Map<string, Q3Shader> }).shaders.set(shader.name, shader);
  const source = RawTexture.CreateRGBATexture(new Uint8Array([128, 64, 32, 128]), 1, 1, scene);
  const loader = PK3TextureLoader.getInstance();
  const init = vi.spyOn(loader, "init").mockImplementation(() => {});
  const load = vi.spyOn(loader, "resolveAndLoadTexture").mockResolvedValue(source);
  try {
    const root = new Mesh("world", scene),
      base = CreatePlane("bsp_tex_0", {}, scene);
    base.parent = root;
    base.setVerticesData("uv2", base.getVerticesData("uv")!);
    base.setVerticesData("color", Array.from({ length: 4 }, () => [0.2, 0.4, 0.6, 0.7]).flat());
    base.metadata = { textureName: shader.name, lightmapIndex: 0 };
    base.material = new StandardMaterial("placeholder", scene);
    const result = {
      worldMesh: root,
      textureGroups: [{ textureIndex: 0, textureName: shader.name }],
      lightmapTextures: [source],
      bspData: { header: { isFBSP: true }, entities: [], faces: [], lightmaps: [] },
    } as unknown as BspMeshBuildResult;
    await BspMeshBuilder.applyTextures(result, result.bspData, scene);
    BspMeshBuilder.applyLightmaps(result);
    const passes = root.getChildMeshes().sort((a, b) => a.metadata.materialPass - b.metadata.materialPass);
    expect(passes).toHaveLength(3);
    expect(Array.from(passes[0].getVerticesData("color")!).slice(0, 4)).toEqual([0.2, 0.4, 0.6, 0.7]);
    expect(Array.from(passes[1].getVerticesData("color")!).slice(0, 4)).toEqual([1, 1, 1, expect.closeTo(0.7)]);
    const materials = passes.map((m) => m.material as StandardMaterial);
    expect(materials.map((m) => m.alphaMode)).toEqual([0, 2, 6]);
    expect(materials[1].disableDepthWrite).toBe(true);
    expect(materials[2].pluginManager?.getPlugin("Q3StageColor")).toBeTruthy();
    expect(materials[2].lightmapTexture).toBeNull();
    expect(materials[0].diffuseTexture).not.toBe(materials[1].diffuseTexture);
    const privateImage = materials[0].diffuseTexture!;
    root.dispose();
    expect(scene.textures).not.toContain(privateImage);
    expect(scene.textures).toContain(source);
  } finally {
    init.mockRestore();
    load.mockRestore();
    registry.clear();
    scene.dispose();
    engine.dispose();
  }
});

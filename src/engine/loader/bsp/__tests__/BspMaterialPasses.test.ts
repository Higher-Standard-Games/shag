import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { PK3TextureLoader } from "../../pk3/PK3TextureLoader";
import { parseShaderFile } from "../../shader/Q3ShaderParser";
import { Q3ShaderRegistry } from "../../shader/Q3ShaderRegistry";
import type { Q3Shader } from "../../shader/Q3ShaderTypes";
import { BspMeshBuilder, type BspMeshBuildResult } from "../BspMeshBuilder";

it("keeps authored black vertex shadows but allows game lights and gloss on vertex-lit metal", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const registry = Q3ShaderRegistry.getInstance();
  registry.clear();
  const [shader] = parseShaderFile(`qa/metal {
    surfaceparm nolightmap
    { rgbGen vertex material qa/aluminium $blankbumpimage qa/aluminium_gloss }
  }`);
  (registry as unknown as { shaders: Map<string, Q3Shader> }).shaders.set(shader.name, shader);
  const image = RawTexture.CreateRGBATexture(new Uint8Array([128, 128, 128, 255]), 1, 1, scene);
  const loader = PK3TextureLoader.getInstance();
  const init = vi.spyOn(loader, "init").mockImplementation(() => {});
  const load = vi.spyOn(loader, "resolveAndLoadTexture").mockResolvedValue(image);
  try {
    const root = new Mesh("world", scene),
      mesh = CreatePlane("bsp_tex_0", {}, scene);
    mesh.parent = root;
    mesh.metadata = { textureName: shader.name, lightmapIndex: -1, usesVertexRgb: true };
    const colors = [0, 0, 0, 1, 0.2, 0.3, 0.4, 1, 0.2, 0.3, 0.4, 1, 0, 0, 0, 1];
    mesh.setVerticesData("color", colors);
    mesh.material = new StandardMaterial("placeholder", scene);
    const fill = new HemisphericLight("worldFillLight", Vector3.Up(), scene);
    const gameLight = new PointLight("rocket", Vector3.Zero(), scene);
    const result = {
      worldMesh: root,
      textureGroups: [{ textureIndex: 0, textureName: shader.name }],
      lightmapTextures: [],
    } as unknown as BspMeshBuildResult;
    await BspMeshBuilder.applyTextures(result, result.bspData, scene);
    const material = mesh.material as StandardMaterial;
    expect(material.disableLighting).toBe(false);
    expect(material.emissiveTexture).toBeNull();
    expect(material.specularTexture).toBeTruthy();
    expect(material.pluginManager?.getPlugin("BspVertexLighting")).toBeTruthy();
    expect(fill.canAffectMesh(mesh)).toBe(false);
    expect(gameLight.canAffectMesh(mesh)).toBe(true);
    expect(Array.from(mesh.getVerticesData("color")!)).toEqual(colors);
  } finally {
    init.mockRestore();
    load.mockRestore();
    registry.clear();
    scene.dispose();
    engine.dispose();
  }
});

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

it("retains cutout blending and authored depth writes after BSP texture binding", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const registry = Q3ShaderRegistry.getInstance();
  registry.clear();
  const [cable, cutout, additive, transparent] = parseShaderFile(`
    qa/cable { surfaceparm nolightmap { map qa/cable rgbGen vertex alphaFunc GT0 blendFunc blend depthWrite } }
    qa/cutout { { map qa/cutout alphaFunc GE128 } }
    qa/additive { { map qa/additive alphaFunc GT0 blendFunc GL_SRC_ALPHA GL_ONE } }
    qa/transparent { { map qa/transparent alphaFunc GT0 blendFunc blend } }
  `);
  const shaders = [cable, cutout, additive, transparent];
  for (const shader of shaders)
    (registry as unknown as { shaders: Map<string, Q3Shader> }).shaders.set(shader.name, shader);
  const source = RawTexture.CreateRGBATexture(new Uint8Array([64, 32, 16, 128]), 1, 1, scene);
  const loader = PK3TextureLoader.getInstance();
  const init = vi.spyOn(loader, "init").mockImplementation(() => {});
  const load = vi.spyOn(loader, "resolveAndLoadTexture").mockResolvedValue(source);
  try {
    const root = new Mesh("world", scene);
    const factory = BspMeshBuilder as unknown as {
      createMaterialFromProps(
        name: string,
        scene: Scene,
        props: ReturnType<typeof registry.resolveMaterialProps>,
      ): StandardMaterial;
    };
    const meshes = shaders.map((shader, i) => {
      const mesh = CreatePlane(`bsp_tex_${i}`, {}, scene);
      const props = registry.resolveMaterialProps(shader.name);
      mesh.parent = root;
      mesh.metadata = { textureName: shader.name, lightmapIndex: -1, usesVertexRgb: true };
      mesh.setVerticesData("color", Array.from({ length: 4 }, () => [0.2, 0.4, 0.6, 1]).flat());
      mesh.material = factory.createMaterialFromProps(`mat_${i}`, scene, props);
      expect(mesh.material.transparencyMode).toBe(i === 1 ? 1 : 3);
      return mesh;
    });
    const result = {
      worldMesh: root,
      textureGroups: shaders.map((s, i) => ({ textureIndex: i, textureName: s.name })),
      lightmapTextures: [],
      shaderRegistry: registry,
    } as unknown as BspMeshBuildResult;
    await BspMeshBuilder.applyTextures(result, result.bspData, scene);
    const materials = meshes.map((m) => m.material as StandardMaterial);
    expect(materials.map((m) => m.transparencyMode)).toEqual([3, 1, 3, 3]);
    expect(materials.map((m) => m.needAlphaBlending())).toEqual([true, false, true, true]);
    expect(materials.map((m) => m.needAlphaTesting())).toEqual([true, true, true, true]);
    expect(materials.map((m) => m.forceDepthWrite)).toEqual([true, false, false, false]);
    expect(materials.map((m) => m.alphaMode)).toEqual([2, 0, 1, 2]);
    expect(materials[0].disableDepthWrite).toBe(false);
    expect(materials[2].disableDepthWrite).toBe(true);
    expect(meshes[0].getVerticesData("color")?.slice(0, 4)).toEqual([0.2, 0.4, 0.6, 1]);
  } finally {
    init.mockRestore();
    load.mockRestore();
    registry.clear();
    scene.dispose();
    engine.dispose();
  }
});

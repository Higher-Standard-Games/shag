import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Cvar } from "../core/Cvar";
import { cloneModelMaterial } from "../rendering/MaterialCloneBatch";
import { applySceneRendererPolicy } from "../rendering/SceneRendererPolicy";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  Cvar.set("r_material_clone_batch", 1);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
  Cvar.set("r_material_clone_batch", 1);
});

it("reduces unrelated scene visits during fresh PBR cloning", () => {
  const world = MeshBuilder.CreateBox("world", {}, scene);
  world.material = new StandardMaterial("world", scene);
  const source = new PBRMaterial("source", scene);
  source.usePhysicalLightFalloff = false;
  source.disableLighting = true;
  source.twoSidedLighting = true;
  source.alpha = 0.6;
  source.backFaceCulling = false;
  source.maxSimultaneousLights = 2;
  const visits = vi.spyOn(world.subMeshes[0], "getMaterial");
  const add = scene.addMaterial;
  Cvar.set("r_material_clone_batch", 0);
  const plain = cloneModelMaterial(source, "plain") as PBRMaterial;
  const plainVisits = visits.mock.calls.length;
  visits.mockClear();
  Cvar.set("r_material_clone_batch", 1);
  const batched = cloneModelMaterial(source, "batched") as PBRMaterial;
  expect(visits.mock.calls.length).toBeLessThan(plainVisits);
  expect(visits.mock.calls.length).toBe(1);
  expect(scene.addMaterial).toBe(add);
  expect(Object.getOwnPropertyDescriptor(scene, "addMaterial")).toBeUndefined();
  expect(batched.alpha).toBe(plain.alpha);
  expect(batched.backFaceCulling).toBe(plain.backFaceCulling);
  expect(batched.maxSimultaneousLights).toBe(plain.maxSimultaneousLights);
  expect(batched.blockDirtyMechanism).toBe(false);
  expect(source.blockDirtyMechanism).toBe(false);
});

it.each([
  { name: "Standard", Constructor: StandardMaterial },
  { name: "PBR", Constructor: PBRMaterial },
])("preserves first-draw defines and subsequent mutations for $name", async ({ Constructor }) => {
  new FreeCamera("camera", new Vector3(0, 0, -5), scene);
  const world = MeshBuilder.CreateBox("world", {}, scene);
  world.position.x = -1;
  const source = new Constructor("source", scene);
  const texture = RawTexture.CreateRGBATexture(new Uint8Array([100, 180, 220, 255]), 1, 1, scene);
  texture.getInternalTexture()!.isReady = true; // NullEngine does not upload raw texture pixels.
  source.alpha = 0.7;
  source.backFaceCulling = false;
  if (source instanceof PBRMaterial) {
    source.albedoTexture = texture;
    source.albedoColor = new Color3(0.2, 0.4, 0.6);
    source.metallic = 0.3;
    source.roughness = 0.4;
    source.clearCoat.isEnabled = true;
    source.clearCoat.intensity = 0.5;
  } else source.diffuseTexture = texture;
  world.material = source;
  await scene.whenReadyAsync();
  scene.render();
  const before = world.subMeshes[0].materialDefines!.toString();
  const unrelatedDirty = vi.spyOn(
    source as unknown as { _markAllSubMeshesAsDirty: () => void },
    "_markAllSubMeshesAsDirty",
  );
  Cvar.set("r_material_clone_batch", 0);
  const plain = cloneModelMaterial(source, "plain") as StandardMaterial | PBRMaterial;
  Cvar.set("r_material_clone_batch", 1);
  const batched = cloneModelMaterial(source, "batched") as StandardMaterial | PBRMaterial;
  expect(unrelatedDirty).not.toHaveBeenCalled();
  const gun = MeshBuilder.CreateBox("gun", {}, scene);
  gun.position.x = 1;
  const frame = async (material: StandardMaterial | PBRMaterial) => {
    gun.material = material;
    await scene.whenReadyAsync();
    scene.render();
    expect(scene.getActiveIndices()).toBeGreaterThan(0);
    return { defines: gun.subMeshes[0].materialDefines!.toString(), indices: scene.getActiveIndices() };
  };
  expect(await frame(batched as StandardMaterial)).toEqual(await frame(plain as StandardMaterial));
  expect(world.subMeshes[0].materialDefines!.toString()).toBe(before);
  expect(batched.getActiveTextures()[0].getInternalTexture()).toBe(texture.getInternalTexture());
  plain.alpha = 1;
  batched.alpha = 1;
  expect(await frame(batched as StandardMaterial)).toEqual(await frame(plain as StandardMaterial));
  // A later light/define change must still invalidate an already-rendered clone.
  plain.maxSimultaneousLights = 1;
  batched.maxSimultaneousLights = 1;
  expect(await frame(batched as StandardMaterial)).toEqual(await frame(plain as StandardMaterial));
  expect(source.alpha).toBe(0.7);
  if (batched instanceof PBRMaterial) {
    expect(batched.clearCoat.isEnabled).toBe(true);
    expect(batched.clearCoat.intensity).toBe(0.5);
    expect(batched.metallic).toBe(0.3);
    expect(batched.roughness).toBe(0.4);
  }
});

it("batches MultiMaterial children without changing ownership or touching custom clones", () => {
  const source = new MultiMaterial("multi", scene);
  const child = new PBRMaterial("child", scene);
  child.alpha = 0.4;
  source.subMaterials.push(child, null, child);
  const result = cloneModelMaterial(source, "copy", true) as MultiMaterial;
  expect(source.subMaterials[0]).toBe(child);
  expect(source.subMaterials[1]).toBeNull();
  expect(source.subMaterials[2]).toBe(child);
  expect(result.subMaterials[0]).not.toBe(child);
  expect(result.subMaterials[0]!.alpha).toBe(0.4);
  expect(result.subMaterials[0]!.blockDirtyMechanism).toBe(false);
  expect(result.subMaterials[1]).toBeNull();
  const clone = vi.spyOn(child, "clone").mockImplementation(() => {
    expect(Object.getOwnPropertyDescriptor(scene, "addMaterial")).toBeUndefined();
    return child;
  });
  expect(cloneModelMaterial(child, "custom")).toBe(child);
  expect(clone).toHaveBeenCalledOnce();
});

it("restores the scene method and fresh material flags when construction throws", () => {
  const source = new PBRMaterial("source", scene);
  const original = scene.addMaterial;
  let created: PBRMaterial | null = null;
  const error = new Error("construction failed");
  const add = vi.spyOn(scene, "addMaterial").mockImplementation((material) => {
    original.call(scene, material);
    created = material as PBRMaterial;
    throw error;
  });
  expect(() => cloneModelMaterial(source, "failure")).toThrow(error);
  expect(scene.addMaterial).toBe(add);
  expect(created!.blockDirtyMechanism).toBe(false);
  expect(source.blockDirtyMechanism).toBe(false);
  // The injected failure interrupted PBR's constructor before its plugin fields
  // existed. Release its completed base resources without invoking PBR.dispose.
  Material.prototype.dispose.call(created, false, false, true);
});

it("preserves a scene provider replaced during cloning", () => {
  const source = new PBRMaterial("source", scene);
  const original = scene.addMaterial;
  const replacement = (material: Material) => original.call(scene, material);
  vi.spyOn(scene, "addMaterial").mockImplementation((material) => {
    original.call(scene, material);
    scene.addMaterial = replacement;
  });
  const clone = cloneModelMaterial(source, "copy")!;
  expect(scene.addMaterial).toBe(replacement);
  expect(clone.blockDirtyMechanism).toBe(false);
});

it("retains WebGPU caps and no-hot-swap policy on clones after deferred notifications", async () => {
  Object.defineProperty(engine, "isWebGPU", { value: true });
  engine.getCaps().texelFetch = true;
  applySceneRendererPolicy(scene);
  for (let i = 0; i < 11; i++) new PointLight(`light-${i}`, Vector3.One(), scene);
  const source = new PBRMaterial("source", scene);
  await vi.waitFor(() => expect(source.allowShaderHotSwapping).toBe(false));
  const clone = cloneModelMaterial(source, "copy") as PBRMaterial;
  expect(clone.maxSimultaneousLights).toBe(4);
  expect(clone.allowShaderHotSwapping).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  clone.maxSimultaneousLights = 11;
  expect(clone.maxSimultaneousLights).toBe(4);
  expect(source.maxSimultaneousLights).toBe(4);
});

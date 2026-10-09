import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { describe, expect, it, vi } from "vitest";
import { applySceneRendererPolicy } from "../rendering/SceneRendererPolicy";

// A real, local glTF import: no network, textures, model cache or loader mocks.
function triangleAsset(): string {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return `data:${JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: "imported" }],
    buffers: [
      {
        byteLength: positions.byteLength,
        uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString("base64")}`,
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  })}`;
}

describe("shared scene renderer policy", () => {
  it.each([
    [false, true],
    [true, false],
  ])("does not alter glTF behavior outside managed WebGPU scenes (WebGPU=%s, policy=%s)", async (webgpu, policy) => {
    const engine = new NullEngine();
    if (webgpu) Object.defineProperty(engine, "isWebGPU", { value: true });
    const scene = new Scene(engine);
    try {
      for (let i = 0; i < 11; i++) new PointLight(`light-${i}`, Vector3.One(), scene);
      const material = new StandardMaterial("existing", scene);
      if (policy) applySceneRendererPolicy(scene);
      await ImportMeshAsync(triangleAsset(), scene, { pluginExtension: ".gltf" });
      expect(material.maxSimultaneousLights).toBe(11);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("retains WebGPU caps after glTF completes (frozen=%s, clusters=%s)", async (frozen, clusters) => {
    const engine = new NullEngine();
    Object.defineProperty(engine, "isWebGPU", { value: true });
    engine.getCaps().texelFetch = clusters;
    const scene = new Scene(engine);
    try {
      for (let i = 0; i < 11; i++) new PointLight(`light-${i}`, Vector3.One(), scene);
      const world = new StandardMaterial("bsp_mat_existing", scene);
      const worldMesh = CreateBox("world", {}, scene);
      worldMesh.material = world;
      applySceneRendererPolicy(scene);
      await world.forceCompilationAsync(worldMesh);
      expect(world.isReadyForSubMesh(worldMesh, worldMesh.subMeshes[0])).toBe(true);
      if (frozen) world.freeze();
      // Includes imports that happen after the original map shader warmup.
      for (let i = 0; i < 2; i++) {
        const result = await ImportMeshAsync(triangleAsset(), scene, { pluginExtension: ".gltf" });
        expect(world.maxSimultaneousLights).toBe(clusters ? 6 : 2);
        const imported = result.meshes.find((mesh) => mesh.material)?.material as PBRMaterial;
        expect(imported.maxSimultaneousLights).toBe(clusters ? 4 : 1);
        expect(world.isFrozen).toBe(frozen);
        scene.incrementRenderId();
        await world.forceCompilationAsync(worldMesh);
        expect(world.isReadyForSubMesh(worldMesh, worldMesh.subMeshes[0])).toBe(true);
        expect(worldMesh.subMeshes[0].effect!.defines).not.toContain(`#define LIGHT${clusters ? 6 : 2}`);
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
  it("leaves existing WebGPU materials clean across glTF imports, and keeps lowered caps", async () => {
    const engine = new NullEngine();
    Object.defineProperty(engine, "isWebGPU", { value: true });
    engine.getCaps().texelFetch = true;
    const scene = new Scene(engine);
    try {
      for (let i = 0; i < 11; i++) new PointLight(`light-${i}`, Vector3.One(), scene);
      applySceneRendererPolicy(scene);
      const world = new StandardMaterial("bsp_mat_existing", scene);
      const weapon = new PBRMaterial("view_weapon", scene);
      scene.onNewMaterialAddedObservable.notifyObservers(world);
      scene.onNewMaterialAddedObservable.notifyObservers(weapon);
      // The view weapon deliberately runs under the PBR budget.
      weapon.maxSimultaneousLights = 2;
      const worldDirty = vi.spyOn(
        world as unknown as { _markAllSubMeshesAsLightsDirty(): void },
        "_markAllSubMeshesAsLightsDirty",
      );
      const weaponDirty = vi.spyOn(
        weapon as unknown as { _markAllSubMeshesAsLightsDirty(): void },
        "_markAllSubMeshesAsLightsDirty",
      );
      for (let i = 0; i < 3; i++) await ImportMeshAsync(triangleAsset(), scene, { pluginExtension: ".gltf" });
      expect(world.maxSimultaneousLights).toBe(6);
      expect(weapon.maxSimultaneousLights).toBe(2);
      expect(worldDirty).not.toHaveBeenCalled();
      expect(weaponDirty).not.toHaveBeenCalled();
      // Writes other than the policy may still lower a cap.
      world.maxSimultaneousLights = 3;
      expect(world.maxSimultaneousLights).toBe(3);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
  it("caps existing and later WebGPU materials without duplicate observers", async () => {
    const engine = new NullEngine();
    // Policy only; never claim this is a WebGPU shader test.
    Object.defineProperty(engine, "isWebGPU", { value: true });
    const scene = new Scene(engine);
    try {
      const standard = new StandardMaterial("existing", scene);
      applySceneRendererPolicy(scene);
      expect(standard.maxSimultaneousLights).toBe(2);
      const observerCount = scene.onNewMaterialAddedObservable.observers.length;
      applySceneRendererPolicy(scene);
      expect(scene.onNewMaterialAddedObservable.observers).toHaveLength(observerCount);
      const pbr = new PBRMaterial("later", scene);
      await vi.waitFor(() => expect(pbr.maxSimultaneousLights).toBe(1));
      scene.dispose();
      expect(scene.onNewMaterialAddedObservable.observers).toHaveLength(0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

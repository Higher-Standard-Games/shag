/**
 * AssetPreloader across a second join (NullEngine). loadClientMap's scene clear
 * disposed the preloaded models, preloadFromBsp skipped them as already cached,
 * and every pickup and dropped weapon cloned an empty mesh: invisible, yet
 * still collectable because the server's trigger was untouched.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityRegistry } from "../../../shared/entities/EntityRegistry";
import { EntityType } from "../../../shared/entities/EntityType";
import { AssetPreloader } from "../AssetPreloader";
import type { BspFile } from "../bsp/BspLoader";
import { ModelLoader, type ModelLoadResult } from "../model/ModelLoader";

const MODEL = "models/items/ammo/ammobox/ammobox.md3";
const BSP = { entities: [{ classname: "ammo_rockets", properties: {} }] } as unknown as BspFile;

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(EntityRegistry.getInstance(), "getByClassname").mockReturnValue({
    type: EntityType.AMMO,
    modelPath: MODEL,
  } as never);
  const loader = ModelLoader.getInstance();
  vi.spyOn(loader, "isInitialized").mockReturnValue(true);
});

afterEach(() => {
  AssetPreloader.getInstance().clearCache();
  engine.dispose();
  vi.restoreAllMocks();
});

function loadedModel(): ModelLoadResult {
  const root = new TransformNode("md3_ammobox", scene);
  const material = new StandardMaterial("ammobox_box", scene);
  material.diffuseTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  const mesh = MeshBuilder.CreateBox("ammobox_box", { size: 1 }, scene);
  mesh.material = material;
  mesh.parent = root;
  return { root, meshes: [mesh], animationGroups: [], skeletons: [], lights: [] };
}

describe("AssetPreloader", () => {
  it("loads a model again after the scene clear instead of handing out an empty clone", async () => {
    const load = vi.spyOn(ModelLoader.getInstance(), "loadModel").mockImplementation(async () => loadedModel());
    const preloader = AssetPreloader.getInstance();

    await preloader.preloadFromBsp(BSP, scene);
    expect(preloader.cloneCachedModel(MODEL, scene)?.meshes[0].getTotalVertices()).toBeGreaterThan(0);

    for (const mesh of [...scene.meshes]) mesh.dispose(false, true);
    expect(preloader.hasModel(MODEL)).toBe(false);
    expect(preloader.cloneCachedModel(MODEL, scene)).toBeNull();

    await preloader.preloadFromBsp(BSP, scene);
    const clone = preloader.cloneCachedModel(MODEL, scene);

    expect(load).toHaveBeenCalledTimes(2);
    expect(clone?.meshes[0].getTotalVertices()).toBeGreaterThan(0);
    expect(clone?.meshes[0].material).not.toBeNull();
  });

  it("still skips a model that is cached and renderable", async () => {
    const load = vi.spyOn(ModelLoader.getInstance(), "loadModel").mockImplementation(async () => loadedModel());
    const preloader = AssetPreloader.getInstance();

    await preloader.preloadFromBsp(BSP, scene);
    await preloader.preloadFromBsp(BSP, scene);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("releases its models when cleared, as a map unload does", async () => {
    vi.spyOn(ModelLoader.getInstance(), "loadModel").mockImplementation(async () => loadedModel());
    const preloader = AssetPreloader.getInstance();
    await preloader.preloadFromBsp(BSP, scene);
    const source = preloader.getCachedModel(MODEL);

    preloader.clearCache();

    expect(preloader.hasModel(MODEL)).toBe(false);
    expect(source?.meshes[0].isDisposed()).toBe(true);
  });
});

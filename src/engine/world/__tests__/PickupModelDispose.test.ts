/**
 * Pickup.dispose (NullEngine). Disposing a map pickup used to dispose the
 * material and texture that its clone shares with the preloaded model, leaving
 * the cache and every other pickup of that weapon without them.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetPreloader } from "../../loader/AssetPreloader";
import type { ModelLoadResult } from "../../loader/model/ModelLoader";
import { isTextureReleased, type ModelSourceCache } from "../../loader/model/ModelSourceCache";
import { Pickup } from "../Pickup";

const MODEL = "/data/models/weapons/rlauncher/rlauncher.glb";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  AssetPreloader.getInstance().clearCache();
  engine.dispose();
  vi.restoreAllMocks();
});

/** Put a textured source into the preloader, as MapLoader's preload phase does. */
function preload() {
  const root = new TransformNode("__root__", scene);
  const material = new StandardMaterial("models/weapons/rlauncher/rlauncher", scene);
  const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  material.diffuseTexture = texture;
  const mesh = MeshBuilder.CreateBox("stock_cover_lp", { size: 1 }, scene);
  mesh.material = material;
  mesh.parent = root;
  mesh.setEnabled(false);
  const cache = (AssetPreloader.getInstance() as unknown as { modelCache: ModelSourceCache<ModelLoadResult> })
    .modelCache;
  cache.set(MODEL, { root, meshes: [mesh], animationGroups: [], skeletons: [], lights: [] });
  return { material, texture };
}

function spawn(name: string, x: number): Pickup {
  return new Pickup(name, scene, new Vector3(x, 50, 0), { id: "rlauncher", modelPath: MODEL });
}

const meshOf = (pickup: Pickup) => (pickup as unknown as { mesh: Mesh | null }).mesh;

describe("Pickup.dispose", () => {
  it("leaves the preloaded model and the other pickups of that weapon renderable", async () => {
    const { material, texture } = preload();
    // wdm2 has two rocket launcher spawns cloned from one preloaded model.
    const first = spawn("weapon_rocketlauncher_a", 0);
    const second = spawn("weapon_rocketlauncher_b", 200);
    await Promise.all([first.whenReady(), second.whenReady()]);
    const secondMesh = meshOf(second);
    expect(secondMesh?.getTotalVertices()).toBeGreaterThan(0);

    first.dispose();

    expect(AssetPreloader.getInstance().hasModel(MODEL)).toBe(true);
    expect(secondMesh?.material).toBe(material);
    expect(isTextureReleased(texture)).toBe(false);
  });

  it("disposes its clone and the loader root it detached the clone from", async () => {
    preload();
    const pickup = spawn("weapon_rocketlauncher", 0);
    await pickup.whenReady();
    const mesh = meshOf(pickup);
    const roots = scene.transformNodes.filter((node) => node.name.startsWith("__root___clone_"));
    expect(mesh).not.toBeNull();
    expect(roots).toHaveLength(1);

    pickup.dispose();

    expect(mesh?.isDisposed()).toBe(true);
    expect(roots[0].isDisposed()).toBe(true);
  });
});

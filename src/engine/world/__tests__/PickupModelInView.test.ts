/**
 * A model pickup the camera cannot see is not drawn, and only what it drew
 * comes back. Enabled state stays the server's (active / collected).
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetPreloader } from "../../loader/AssetPreloader";
import type { ModelLoadResult } from "../../loader/model/ModelLoader";
import type { ModelSourceCache } from "../../loader/model/ModelSourceCache";
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

class WatchedPickup extends Pickup {
  inView = true;
  protected override isInView(): boolean {
    return this.inView;
  }
  frame(): void {
    this.tick();
  }
}

it("hides a model pickup out of view and restores only the parts it drew", async () => {
  const root = new TransformNode("__root__", scene);
  const body = MeshBuilder.CreateBox("body", { size: 1 }, scene);
  const barrel = MeshBuilder.CreateBox("barrel", { size: 1 }, scene);
  body.parent = barrel.parent = root;
  body.setEnabled(false);
  barrel.setEnabled(false);
  const cache = (AssetPreloader.getInstance() as unknown as { modelCache: ModelSourceCache<ModelLoadResult> })
    .modelCache;
  cache.set(MODEL, { root, meshes: [body, barrel], animationGroups: [], skeletons: [], lights: [] });

  const pickup = new WatchedPickup("weapon_rl", scene, new Vector3(0, 50, 0), { id: "rlauncher", modelPath: MODEL });
  await pickup.whenReady();
  const leader = (pickup as unknown as { mesh: Mesh }).mesh;
  const parts = [leader, ...leader.getChildMeshes()];
  expect(parts.length).toBe(2);
  // A part the model keeps invisible on purpose.
  parts[1].isVisible = false;

  pickup.frame();
  expect(parts.map((p) => p.isVisible)).toEqual([true, false]);
  pickup.inView = false;
  pickup.frame();
  pickup.frame();
  expect(parts.map((p) => p.isVisible)).toEqual([false, false]);
  expect(leader.isEnabled(false)).toBe(true);
  pickup.inView = true;
  pickup.frame();
  expect(parts.map((p) => p.isVisible)).toEqual([true, false]);
  pickup.dispose();
});

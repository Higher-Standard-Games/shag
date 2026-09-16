/**
 * Pickup placement (NullEngine). A placed model rests at the yaw it was given,
 * and an item already standing on its resting spot is left there rather than
 * raycast onto a floor of the client's own choosing.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.spyOn(console, "error").mockImplementation(() => {});
  const root = new TransformNode("__root__", scene);
  const mesh = MeshBuilder.CreateBox("stock_cover_lp", { size: 1 }, scene);
  mesh.material = new StandardMaterial("rlauncher", scene);
  mesh.parent = root;
  mesh.setEnabled(false);
  const cache = (AssetPreloader.getInstance() as unknown as { modelCache: ModelSourceCache<ModelLoadResult> })
    .modelCache;
  cache.set(MODEL, { root, meshes: [mesh], animationGroups: [], skeletons: [], lights: [] });

  // A floor to fall onto, so "dropped" and "left alone" are visibly different.
  const floor = MeshBuilder.CreateBox("floor", { width: 500, height: 1, depth: 500 }, scene);
  floor.position.y = 0;
  floor.computeWorldMatrix(true);
});

afterEach(() => {
  AssetPreloader.getInstance().clearCache();
  engine.dispose();
  vi.restoreAllMocks();
});

const meshOf = (pickup: Pickup) => (pickup as unknown as { mesh: Mesh | null }).mesh;

describe("Pickup placement", () => {
  it("rests the model at the yaw it was given", async () => {
    const pickup = new Pickup("weapon_rocketlauncher", scene, new Vector3(0, 50, 0), {
      id: "rlauncher",
      modelPath: MODEL,
      yaw: 1.25,
    });
    await pickup.whenReady();

    expect(meshOf(pickup)?.rotation.y).toBeCloseTo(1.25);
  });

  it("rests the model square when no yaw is given", async () => {
    const pickup = new Pickup("weapon_rocketlauncher", scene, new Vector3(0, 50, 0), {
      id: "rlauncher",
      modelPath: MODEL,
    });
    await pickup.whenReady();

    expect(meshOf(pickup)?.rotation.y).toBe(0);
  });

  it("drops a plain map spawn onto the floor beneath it", async () => {
    const pickup = new Pickup("weapon_rocketlauncher", scene, new Vector3(0, 50, 0), {
      id: "rlauncher",
      modelPath: MODEL,
    });
    await pickup.whenReady();

    expect(pickup.position.y).toBeLessThan(50);
    expect(meshOf(pickup)?.position.y).toBeCloseTo(pickup.position.y);
  });

  it("leaves an item that already rests where the server's trigger is", async () => {
    const pickup = new Pickup("weapon_rocketlauncher", scene, new Vector3(0, 50, 0), {
      id: "rlauncher",
      modelPath: MODEL,
      landedOnFloor: true,
    });
    await pickup.whenReady();

    expect(pickup.position.y).toBe(50);
    expect(meshOf(pickup)?.position.y).toBe(50);
  });
});

describe("Pickup with nothing to render", () => {
  it("says so when the cached source yields no vertices", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const EMPTY_MODEL = "/data/models/weapons/plasmagun/plasmagun.glb";

    // What a clone of released geometry looks like: a live, undisposed mesh
    // carrying no vertices, which loadModel skips when picking a leader.
    const root = new TransformNode("__root__empty", scene);
    const body = new Mesh("body_lp", scene);
    body.parent = root;
    const cache = (AssetPreloader.getInstance() as unknown as { modelCache: ModelSourceCache<ModelLoadResult> })
      .modelCache;
    cache.set(EMPTY_MODEL, { root, meshes: [body], animationGroups: [], skeletons: [], lights: [] });

    const pickup = new Pickup("weapon_plasmagun", scene, new Vector3(0, 50, 0), {
      id: "plasmagun",
      modelPath: EMPTY_MODEL,
    });
    await pickup.whenReady();

    // Silence here is the defect: the pickup draws nothing and the log is clean.
    expect(meshOf(pickup)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no renderable mesh"));
  });
});

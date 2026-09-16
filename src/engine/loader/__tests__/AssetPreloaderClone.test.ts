/**
 * Every map pickup and dropped weapon is a clone of a cached model. The
 * preloader keeps its sources hidden — each mesh disabled and invisible — so a
 * clone only draws once it is turned back on.
 *
 * Babylon clones a mesh together with its children, and a weapon GLB is a
 * hierarchy, so a clone carries meshes that were never handed back as top-level
 * results. Those must be turned on too, and must not be cloned a second time on
 * their own: a hidden child is a weapon body that never draws while the barrels
 * loaded fresh beside it do, and a doubled child is the same geometry drawn
 * twice in one place.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetPreloader } from "../AssetPreloader";
import type { ModelLoadResult } from "../model/ModelLoader";
import type { ModelSourceCache } from "../model/ModelSourceCache";

const MODEL = "/data/models/weapons/plasmagun/plasmagun.glb";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  AssetPreloader.getInstance().clearCache();
  engine.dispose();
  vi.restoreAllMocks();
});

/** A weapon GLB as preloadFromBsp caches it: a body with a child part, all hidden. */
function cacheHierarchicalSource(): void {
  const root = new TransformNode("__root__", scene);
  const body = MeshBuilder.CreateBox("body_lp", { size: 1 }, scene);
  const chamber = MeshBuilder.CreateBox("chamber_lp", { size: 0.5 }, scene);
  body.parent = root;
  chamber.parent = body;

  root.setEnabled(false);
  for (const mesh of [body, chamber]) {
    mesh.setEnabled(false);
    mesh.isVisible = false;
  }

  const cache = (AssetPreloader.getInstance() as unknown as { modelCache: ModelSourceCache<ModelLoadResult> })
    .modelCache;
  cache.set(MODEL, { root, meshes: [body, chamber], animationGroups: [], skeletons: [], lights: [] });
}

/** A flat export: every cached mesh is its own root. */
function cacheFlatSource(): void {
  const root = new TransformNode("__root__flat", scene);
  const first = MeshBuilder.CreateBox("barrel_a", { size: 1 }, scene);
  const second = MeshBuilder.CreateBox("barrel_b", { size: 1 }, scene);
  for (const mesh of [first, second]) {
    mesh.parent = root;
    mesh.setEnabled(false);
    mesh.isVisible = false;
  }
  root.setEnabled(false);

  const cache = (AssetPreloader.getInstance() as unknown as { modelCache: ModelSourceCache<ModelLoadResult> })
    .modelCache;
  cache.set(MODEL, { root, meshes: [first, second], animationGroups: [], skeletons: [], lights: [] });
}

const clonedMeshes = (clone: ModelLoadResult | null): AbstractMesh[] =>
  (clone?.root.getChildMeshes(false) ?? []) as AbstractMesh[];

describe("AssetPreloader.cloneCachedModel", () => {
  it("hands back meshes that are on", () => {
    cacheHierarchicalSource();

    const clone = AssetPreloader.getInstance().cloneCachedModel(MODEL, scene);

    expect(clone).not.toBeNull();
    for (const mesh of clone?.meshes ?? []) {
      expect(mesh.isVisible).toBe(true);
      expect(mesh.isEnabled()).toBe(true);
    }
  });

  it("leaves nothing hidden anywhere in the cloned hierarchy", () => {
    cacheHierarchicalSource();

    const clone = AssetPreloader.getInstance().cloneCachedModel(MODEL, scene);

    // A mesh cloned as somebody's child is never handed back in `meshes`, so it
    // keeps the hidden state the cached source was stored with.
    const hidden = clonedMeshes(clone).filter((mesh) => !mesh.isVisible || !mesh.isEnabled());
    expect(hidden.map((mesh) => mesh.name)).toEqual([]);
    expect(clonedMeshes(clone).length).toBeGreaterThan(0);
  });

  it("does not clone a cached mesh that already came along as a child", () => {
    cacheHierarchicalSource();

    const clone = AssetPreloader.getInstance().cloneCachedModel(MODEL, scene);

    const chambers = clonedMeshes(clone).filter((mesh) => mesh.name.includes("chamber"));
    expect(chambers).toHaveLength(1);
  });

  it("still clones every mesh of a flat source", () => {
    cacheFlatSource();

    const clone = AssetPreloader.getInstance().cloneCachedModel(MODEL, scene);

    expect(clone?.meshes).toHaveLength(2);
    for (const mesh of clonedMeshes(clone)) {
      expect(mesh.isVisible).toBe(true);
      expect(mesh.isEnabled()).toBe(true);
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWorldBundleReplay,
  installWorldBundleReplay,
  isStaticWorldSurface,
  supportsWorldBundleReplay,
  worldBundlesDisabledBySearch,
} from "../rendering/WorldBundleReplay";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

class NamedPlugin extends MaterialPluginBase {
  constructor(material: StandardMaterial, name: string) {
    super(material, name, 100, {});
    this._enable(true);
  }
  override getClassName(): string {
    return this.name;
  }
}

function surface(name: string, material = frozenMaterial(name)): Mesh {
  const mesh = MeshBuilder.CreateBox(name, {}, scene);
  mesh.material = material;
  mesh.freezeWorldMatrix();
  return mesh;
}
function frozenMaterial(name: string): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.freeze();
  return material;
}

/** A NullEngine that claims to record WebGPU bundles, enough to run selection and the group hook. */
function bundleEngine() {
  const addBundle = vi.fn();
  Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
  Object.defineProperty(engine, "compatibilityMode", { value: false, configurable: true });
  Object.assign(engine, { _bundleList: { addBundle }, _applyRenderPassChanges: vi.fn(), _reportDrawCall: vi.fn() });
  return { addBundle };
}

describe("isStaticWorldSurface", () => {
  it("takes a frozen opaque surface with a frozen world matrix", () => {
    expect(isStaticWorldSurface(surface("wall"))).toBe(true);
  });

  it("leaves surfaces whose draw can change from frame to frame", () => {
    const unfrozen = surface("unfrozen", new StandardMaterial("unfrozen", scene));
    const moving = MeshBuilder.CreateBox("moving", {}, scene);
    moving.material = frozenMaterial("moving");
    const blended = surface("blended");
    (blended.material as StandardMaterial).alpha = 0.5;
    const group = surface("group");
    group.renderingGroupId = 1;
    const observed = surface("observed");
    observed.onBeforeRenderObservable.add(() => {});
    expect([unfrozen, moving, blended, group, observed].map(isStaticWorldSurface)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("takes only material plugins known to bind the same values every frame", () => {
    const fogged = surface("fogged");
    new NamedPlugin(fogged.material as StandardMaterial, "AtmosphericFog");
    const animated = surface("animated");
    new NamedPlugin(animated.material as StandardMaterial, "Q3AnalyticAnimation");
    expect(isStaticWorldSurface(fogged)).toBe(true);
    expect(isStaticWorldSurface(animated)).toBe(false);
  });
});

describe("world bundle replay", () => {
  it("is off without bundle recording and with ?worldbundles=0", () => {
    expect(supportsWorldBundleReplay(engine as unknown as AbstractEngine)).toBe(false);
    expect(installWorldBundleReplay(scene, surface("wall"), () => null)).toBeNull();
    expect(worldBundlesDisabledBySearch("?worldbundles=0")).toBe(true);
    expect(worldBundlesDisabledBySearch("?renderer=webgpu")).toBe(false);
  });

  it("keeps static surfaces out of the view's selection but in its active meshes when visible", () => {
    bundleEngine();
    const world = MeshBuilder.CreateBox("world", { size: 0.01 }, scene);
    world.isVisible = false;
    const seen = surface("seen");
    const hidden = surface("hidden");
    const behind = surface("behind");
    for (const mesh of [seen, hidden, behind]) mesh.parent = world;
    seen.position.z = hidden.position.z = 8;
    behind.position.z = -8;
    hidden.isVisible = false;
    const eye = new FreeCamera("eye", Vector3.Zero(), scene);
    eye.setTarget(new Vector3(0, 0, 1));
    scene.activeCamera = eye;
    for (const mesh of [seen, hidden, behind]) mesh.freezeWorldMatrix(undefined, true);

    const replay = installWorldBundleReplay(scene, world, () => eye);
    expect(replay?.surfaces).toBe(3);
    const rendered = vi.spyOn(seen, "render");
    scene.render();

    expect(scene.getActiveMeshCandidates().data.slice(0, scene.getActiveMeshCandidates().length)).not.toContain(seen);
    const active = scene.getActiveMeshes();
    const activeList = active.data.slice(0, active.length);
    expect(activeList).toContain(seen);
    expect(activeList).not.toContain(hidden);
    expect(activeList).not.toContain(behind);
    // No bundle recorded on a NullEngine: the surface draws through Babylon's own path.
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(replay?.stats().drawn).toBe(1);
  });

  it("gives the surfaces back to normal selection when switched off or disposed", () => {
    bundleEngine();
    const world = surface("world");
    const eye = new FreeCamera("eye", new Vector3(0, 0, -8), scene);
    scene.activeCamera = eye;
    const replay = installWorldBundleReplay(scene, world, () => eye);
    expect(getWorldBundleReplay(scene)).toBe(replay);
    const candidates = () => {
      const list = scene.getActiveMeshCandidates();
      return list.data.slice(0, list.length);
    };
    expect(candidates()).not.toContain(world);
    replay!.enabled = false;
    expect(candidates()).toContain(world);
    replay!.enabled = true;
    world.dispose();
    expect(getWorldBundleReplay(scene)).toBeNull();
    expect(candidates()).not.toContain(world);
  });
});

describe("Babylon internals the replay reads", () => {
  it("are still where the installed Babylon keeps them", () => {
    const root = path.resolve("node_modules", "@babylonjs", "core");
    const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
    const engineSource = source("Engines/webgpuEngine.pure.js");
    expect(engineSource).toContain("    _applyRenderPassChanges(bundleList) {");
    expect(engineSource).toContain("this._bundleList = new WebGPUBundleList(");
    expect(source("Engines/WebGPU/webgpuBundleList.js")).toContain("    addBundle(bundle) {");
    const drawContext = source("Engines/WebGPU/webgpuDrawContext.js");
    for (const member of ["this.fastBundle = undefined", "this.buffers = {}", "this.buffers[name] = buffer"])
      expect(drawContext).toContain(member);
    expect(source("Materials/drawWrapper.js")).toContain("this._wasPreviouslyReady = false");
    expect(source("Materials/material.pure.js")).toContain("drawWrapper._forceRebindOnNextCall = forceMaterialDirty");
    expect(SubMesh.prototype._getDrawWrapper).toBeTypeOf("function");
    expect(UniformBuffer.prototype.getBuffer).toBeTypeOf("function");
    expect(scene.onAfterActiveMeshesEvaluationObservable).toBeDefined();
    const cluster = source("Lights/Clustered/clusteredLightContainer.pure.js");
    for (const member of [
      "_lastBoundLightIndex",
      "_sliceScale",
      "_sliceBias",
      "_sliceRanges",
      "_tileMaskBuffer",
      "vSliceData",
      "vSliceRanges",
    ])
      expect(cluster).toContain(member);
  });
});

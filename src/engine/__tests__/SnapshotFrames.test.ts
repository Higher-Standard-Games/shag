import fs from "node:fs";
import path from "node:path";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShaderAnimationSystem } from "../loader/shader/ShaderAnimationSystem";
import { bindAtmosphericFog } from "../rendering/AtmosphericFogShader";
import { PlayerOutlineProxy, playerOutlineSnapshotMeshes } from "../rendering/PlayerOutlineProxy";
import {
  drawListSignature,
  installSnapshotFrames,
  markSnapshotMaterialDynamic,
  snapshotFramesRequested,
  supportsSnapshotFrames,
} from "../rendering/SnapshotFrames";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.unstubAllGlobals();
});

describe("drawListSignature", () => {
  it("holds still while nothing that decides the draws changes", () => {
    const box = MeshBuilder.CreateBox("box", {}, scene);
    box.material = new StandardMaterial("m", scene);
    const before = drawListSignature(scene.meshes);
    box.position.x = 10;
    box.rotation.y = 1;
    expect(drawListSignature(scene.meshes)).toBe(before);
  });

  it("changes when a mesh is hidden, disabled, rematerialed or regrouped", () => {
    const box = MeshBuilder.CreateBox("box", {}, scene);
    const other = MeshBuilder.CreateBox("other", {}, scene);
    const changes: number[] = [];
    const base = drawListSignature(scene.meshes);
    other.isVisible = false;
    changes.push(drawListSignature(scene.meshes));
    other.isVisible = true;
    other.setEnabled(false);
    changes.push(drawListSignature(scene.meshes));
    other.setEnabled(true);
    box.material = new StandardMaterial("m2", scene);
    changes.push(drawListSignature(scene.meshes));
    box.renderingGroupId = 1;
    changes.push(drawListSignature(scene.meshes));
    for (const signature of changes) expect(signature).not.toBe(base);
    // Hidden and disabled leave the same draw list
    expect(changes[0]).toBe(changes[1]);
    expect(new Set(changes).size).toBe(3);
  });
});

describe("whole-frame snapshots", () => {
  it("includes off-scene outline uniform slots using the live body's world matrix", () => {
    vi.stubGlobal("location", { search: "" });
    Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
    Object.defineProperty(engine, "compatibilityMode", { value: false, configurable: true });
    Object.assign(engine, { _snapshotRendering: { endRenderPass() {}, _allBundleLists: [] } });
    const body = MeshBuilder.CreateBox("body", {}, scene);
    body.skeleton = new Skeleton("rig", "rig", scene);
    new Bone("hips", body.skeleton, null, Matrix.Identity());
    const template = body.clone("template");
    const adapter = new PlayerOutlineProxy(scene, true);
    adapter.attach(body, template);
    const proxy = playerOutlineSnapshotMeshes(body)[1];
    let outlineReady = false;
    body.renderOutline = true;
    const context = { buffers: { LeftOver: {} } };
    const uniforms = {
      _uniformLocations: { world: 0 },
      _uniformSizes: { world: 16 },
      _slotByOwner: new Map([[context, 0]]),
      _slotFrameId: [0],
    };
    const subMesh = proxy.subMeshes[0] as unknown as { _drawWrappers: unknown[] };
    subMesh._drawWrappers = [
      { effect: { isReady: () => outlineReady, _pipelineContext: { uniformBuffer: uniforms } }, drawContext: context },
    ];
    const compiling = drawListSignature([body]);
    outlineReady = true;
    const ready = drawListSignature([body]);
    expect(ready).not.toBe(compiling);
    body.renderOutline = false;
    expect(drawListSignature([body])).toBe(compiling);
    body.renderOutline = true;

    const handle = installSnapshotFrames(
      scene,
      body,
      () => null,
      () => {},
    );
    try {
      const internals = handle as unknown as {
        recorded: (typeof body)[];
        recordingFrame: number;
        slotDraws(): { mesh: typeof body }[];
      };
      internals.recorded = [body];
      internals.recordingFrame = 0;
      const draws = internals.slotDraws();
      expect(draws).toHaveLength(1);
      expect(draws[0].mesh).toBe(body);
      expect(scene.meshes).not.toContain(proxy);
    } finally {
      subMesh._drawWrappers = [];
      handle?.dispose();
      adapter.dispose();
      delete (engine as unknown as { isWebGPU?: boolean }).isWebGPU;
      delete (engine as unknown as { compatibilityMode?: boolean }).compatibilityMode;
    }
  });

  it("refreshes declared and fog shader uniforms from their first recording without promoting unmarked materials", () => {
    vi.stubGlobal("location", { search: "" });
    Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
    Object.defineProperty(engine, "compatibilityMode", { value: false, configurable: true });
    Object.assign(engine, {
      _snapshotRendering: { endRenderPass() {}, _allBundleLists: [] },
    });
    const materials = ["declared", "fog", "unmarked"].map((name) => new ShaderMaterial(name, scene, "fixture"));
    markSnapshotMaterialDynamic(materials[0]);
    bindAtmosphericFog(materials[1]);
    const meshes = materials.map((material) => {
      const mesh = MeshBuilder.CreateBox(material.name, {}, scene);
      mesh.material = material;
      const context = { buffers: { LeftOver: {} } };
      const uniforms = {
        _uniformLocations: { uOffset: 0 },
        _uniformSizes: { uOffset: 1 },
        _slotByOwner: new Map([[context, 0]]),
        _slotFrameId: [0],
      };
      const subMesh = mesh.subMeshes[0] as unknown as { _drawWrappers: unknown[] };
      subMesh._drawWrappers = [{ effect: { _pipelineContext: { uniformBuffer: uniforms } }, drawContext: context }];
      return mesh;
    });
    const handle = installSnapshotFrames(
      scene,
      meshes[0],
      () => null,
      () => {},
    );
    try {
      expect(handle).not.toBeNull();
      const internals = handle as unknown as {
        recorded: typeof meshes;
        recordingFrame: number;
        slotDraws(): unknown[];
        dynamicMaterials: WeakSet<ShaderMaterial>;
      };
      internals.recorded = meshes;
      internals.recordingFrame = 0;
      expect(internals.slotDraws()).toHaveLength(3);
      expect(materials.map((material) => internals.dynamicMaterials.has(material))).toEqual([true, true, false]);
    } finally {
      handle?.dispose();
      for (const mesh of meshes) (mesh.subMeshes[0] as unknown as { _drawWrappers: unknown[] })._drawWrappers = [];
      delete (engine as unknown as { isWebGPU?: boolean }).isWebGPU;
      delete (engine as unknown as { compatibilityMode?: boolean }).compatibilityMode;
    }
  });

  it("refreshes animated material UBOs from the first recording without learning loose-uniform changes", () => {
    vi.stubGlobal("location", { search: "" });
    Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
    Object.defineProperty(engine, "compatibilityMode", { value: false, configurable: true });
    Object.assign(engine, { _snapshotRendering: { endRenderPass() {}, _allBundleLists: [] } });
    const animation = ShaderAnimationSystem.getInstance();
    animation.init(scene);
    const materials = ["teleporter", "fixed_scale", "ordinary"].map((name) => new StandardMaterial(name, scene));
    animation.registerMaterial("teleporter", materials[0], new Texture(null, scene), [
      { type: "rotate", degreesPerSecond: 60 },
    ]);
    animation.registerMaterial("fixed", materials[1], new Texture(null, scene), [
      { type: "scale", sScale: 2, tScale: 2 },
    ]);
    const meshes = materials.map((material) => {
      const mesh = MeshBuilder.CreateBox(material.name, {}, scene);
      mesh.material = material;
      const context = { buffers: { LeftOver: {} } };
      const uniforms = {
        _uniformLocations: { cameraPosition: 0 },
        _uniformSizes: { cameraPosition: 3 },
        _slotByOwner: new Map([[context, 0]]),
        _slotFrameId: [0],
      };
      (mesh.subMeshes[0] as unknown as { _drawWrappers: unknown[] })._drawWrappers = [
        { effect: { _pipelineContext: { uniformBuffer: uniforms } }, drawContext: context },
      ];
      return mesh;
    });
    const handle = installSnapshotFrames(
      scene,
      meshes[0],
      () => null,
      () => {},
    );
    try {
      expect(handle).not.toBeNull();
      const internals = handle as unknown as {
        recorded: typeof meshes;
        recordingFrame: number;
        slotDraws(): unknown[];
        dynamicMaterials: WeakSet<StandardMaterial>;
      };
      internals.recorded = meshes;
      internals.recordingFrame = 0;
      expect(internals.slotDraws()).toHaveLength(3);
      expect(materials.map((m) => internals.dynamicMaterials.has(m))).toEqual([true, false, false]);
    } finally {
      handle?.dispose();
      animation.dispose();
      vi.unstubAllGlobals();
      for (const mesh of meshes) (mesh.subMeshes[0] as unknown as { _drawWrappers: unknown[] })._drawWrappers = [];
      delete (engine as unknown as { isWebGPU?: boolean }).isWebGPU;
      delete (engine as unknown as { compatibilityMode?: boolean }).compatibilityMode;
    }
  });

  it("record map surfaces PVS hides, so replayed frames write their per-draw camera", () => {
    vi.stubGlobal("location", { search: "" });
    Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
    Object.defineProperty(engine, "compatibilityMode", { value: false, configurable: true });
    Object.assign(engine, { _snapshotRendering: { endRenderPass() {}, _allBundleLists: [] } });
    const world = MeshBuilder.CreateBox("world", {}, scene);
    const water = MeshBuilder.CreateBox("water", {}, scene);
    water.parent = world;
    water.material = new ShaderMaterial("water", scene, "fixture");
    const handle = installSnapshotFrames(
      scene,
      world,
      () => null,
      () => {},
    );
    try {
      // PVS hides the surface; the recording frame, without culling, draws it
      water.isVisible = false;
      const internals = handle as unknown as { endOfFrame(): void; recordNext: boolean; recorded: unknown[] };
      internals.endOfFrame();
      internals.endOfFrame();
      expect(internals.recordNext).toBe(true);
      expect(internals.recorded).toContain(water);
    } finally {
      handle?.dispose();
      delete (engine as unknown as { isWebGPU?: boolean }).isWebGPU;
      delete (engine as unknown as { compatibilityMode?: boolean }).compatibilityMode;
    }
  });

  it("start unless the session turns them off, on an engine that records bundles", () => {
    expect(snapshotFramesRequested("?snapshot=1")).toBe(true);
    expect(snapshotFramesRequested("?renderer=webgpu")).toBe(true);
    expect(snapshotFramesRequested("?renderer=webgpu&snapshot=0")).toBe(false);
    expect(supportsSnapshotFrames(engine as unknown as AbstractEngine)).toBe(false);
    const world = MeshBuilder.CreateBox("world", {}, scene);
    expect(
      installSnapshotFrames(
        scene,
        world,
        () => null,
        () => {},
      ),
    ).toBeNull();
  });
});

describe("Babylon internals the snapshot controller reads", () => {
  it("are still where the installed Babylon keeps them", () => {
    const root = path.resolve("node_modules", "@babylonjs", "core");
    const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
    const recorder = source("Engines/WebGPU/webgpuSnapshotRendering.js");
    for (const member of [
      "this._allBundleLists = []",
      "this._playBundleListIndex = 0",
      "    endRenderPass(currentRenderPass) {",
      "bundleList = this._allBundleLists[this._playBundleListIndex++]",
      "    get play() {",
      "    get record() {",
    ])
      expect(recorder).toContain(member);
    expect(source("Engines/webgpuEngine.pure.js")).toContain("this._snapshotRendering = new WebGPUSnapshotRendering(");
    const manager = source("Rendering/renderingManager.js");
    expect(manager).toContain("if (!renderingGroup || renderingGroup._empty) {");
    expect(source("Rendering/renderingGroup.js")).toContain("this._empty = true;");
    const sceneSource = source("scene.pure.js");
    expect(sceneSource).toContain("this._renderingManager.render(null, null, true, !fastSnapshotMode);");
  });

  it("let a replayed frame write a draw's own uniform slot and bind its material there", () => {
    const root = path.resolve("node_modules", "@babylonjs", "core");
    const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
    const ubo = source("Materials/uniformBuffer.js");
    // Slots keyed by draw context, each with a CPU copy draws compare against
    expect(ubo).toContain("let idx = this._slotByOwner.get(owner);");
    expect(ubo).toContain("const shadow = this._buffers[idx][1];");
    // setDataBuffer pins the slot for the rest of the frame
    expect(ubo).toContain("this._currentFrameId = this._engine.frameId;\n                return true;");
    expect(source("Engines/webgpuEngine.pure.js")).toContain(
      "webgpuPipelineContext.uniformBuffer._updateOwnerKeyed(this._currentDrawContext);",
    );
    // A bind picks its effect by the current render pass and may write the scene's uniforms
    expect(source("Meshes/subMesh.pure.js")).toContain("(this._getDrawWrapper()?.effect ?? null)");
    expect(source("Materials/material.pure.js")).toContain("this._scene.finalizeSceneUbo();");
    expect(source("Materials/shaderMaterial.pure.js")).toContain("scene.finalizeSceneUbo();");
    // The clustered light container refreshes its own uniforms under FAST snapshots
    expect(source("Lights/Clustered/clusteredLightContainer.pure.js")).toContain(
      "engine.snapshotRendering && engine.snapshotRenderingMode === 1",
    );
  });
});

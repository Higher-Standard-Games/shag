import fs from "node:fs";
import path from "node:path";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  drawListSignature,
  installSnapshotFrames,
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

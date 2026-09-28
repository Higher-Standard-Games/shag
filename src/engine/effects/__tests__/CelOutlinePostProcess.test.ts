import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CelOutlinePostProcess } from "../CelOutlinePostProcess";

let engine: NullEngine;
let scene: Scene;
const cel = CelOutlinePostProcess.getInstance();
beforeEach(() => {
  engine = new NullEngine();
  engine.getCaps().textureHalfFloatRender = true;
  scene = new Scene(engine);
  cel.setEnabled(false);
});
afterEach(() => {
  cel.dispose();
  scene.dispose();
  engine.dispose();
});

describe("outline depth ownership", () => {
  it("does not modify or destroy another consumer's depth renderer", () => {
    const camera = new FreeCamera("world", Vector3.Zero(), scene);
    const shared = scene.enableDepthRenderer(camera, false);
    const predicate = () => true;
    shared.getDepthMap().renderListPredicate = predicate;
    cel.init(scene, camera);
    cel.setEnabled(true);
    expect(shared.getDepthMap().renderListPredicate).toBe(predicate);
    expect(camera.customRenderTargets).toHaveLength(1);
    const owned = camera.customRenderTargets[0];
    cel.setEnabled(false);
    expect(camera.customRenderTargets).toHaveLength(0);
    expect(scene.textures).not.toContain(owned);
    expect(scene.enableDepthRenderer(camera)).toBe(shared);
  });

  it("releases the old camera's target on camera changes and disposal", () => {
    const first = new FreeCamera("first", Vector3.Zero(), scene);
    const second = new FreeCamera("second", Vector3.Zero(), scene);
    cel.init(scene, first);
    cel.setEnabled(true);
    const oldTarget = first.customRenderTargets[0];
    expect(oldTarget).toBeDefined();
    cel.setCamera(second);
    expect(first.customRenderTargets).toHaveLength(0);
    expect(scene.textures).not.toContain(oldTarget);
    expect(second.customRenderTargets).toHaveLength(1);
    const target = second.customRenderTargets[0];
    cel.dispose();
    expect(second.customRenderTargets).toHaveLength(0);
    expect(scene.textures).not.toContain(target);
    expect(() => cel.dispose()).not.toThrow();
  });
});

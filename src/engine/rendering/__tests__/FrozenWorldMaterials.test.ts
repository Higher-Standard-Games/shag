import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackFrozenWorldMaterials } from "../FrozenWorldMaterials";

describe("frozen world materials", () => {
  let engine: NullEngine;
  let scene: Scene;

  const setup = () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const material = new StandardMaterial("world", scene);
    MeshBuilder.CreateBox("wall", {}, scene).material = material;
    material.freeze();
    trackFrozenWorldMaterials(scene, [material]);
    return { material, dirty: vi.spyOn(material, "markDirty") };
  };
  const frame = () => scene.onBeforeRenderObservable.notifyObservers(scene);

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it("leaves frozen materials alone while the light set and ambient hold still", () => {
    const { dirty } = setup();
    for (let i = 0; i < 5; i++) frame();
    expect(dirty).not.toHaveBeenCalled();
  });

  it("re-checks them once when a light arrives, is disabled or leaves", () => {
    const { dirty } = setup();
    const light = new HemisphericLight("container", new Vector3(0, 1, 0), scene);
    frame();
    frame();
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty).toHaveBeenLastCalledWith(true);

    light.setEnabled(false);
    frame();
    expect(dirty).toHaveBeenCalledTimes(2);

    light.dispose();
    frame();
    expect(dirty).toHaveBeenCalledTimes(3);
  });

  it("re-checks them when the scene ambient changes", () => {
    const { dirty } = setup();
    scene.ambientColor = new Color3(0.2, 0.2, 0.3);
    frame();
    expect(dirty).toHaveBeenCalledTimes(1);
  });

  it("ignores a light added and removed within one task", () => {
    const { dirty } = setup();
    const pooled = new HemisphericLight("pooled", new Vector3(0, 1, 0), scene);
    scene.removeLight(pooled);
    frame();
    expect(dirty).not.toHaveBeenCalled();
  });

  it("does not touch a material that was unfrozen since", () => {
    const { material, dirty } = setup();
    material.unfreeze();
    dirty.mockClear();
    new HemisphericLight("container", new Vector3(0, 1, 0), scene);
    frame();
    expect(dirty).not.toHaveBeenCalled();
  });
});

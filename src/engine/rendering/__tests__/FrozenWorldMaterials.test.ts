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

  it("re-checks them once when a light arrives or is switched off", () => {
    const { dirty } = setup();
    const light = new HemisphericLight("container", new Vector3(0, 1, 0), scene);
    frame();
    frame();
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty).toHaveBeenLastCalledWith(true);

    light.setEnabled(false);
    frame();
    expect(dirty).toHaveBeenCalledTimes(2);

    // Already off, so the world's lights do not change when it goes
    light.dispose();
    frame();
    expect(dirty).toHaveBeenCalledTimes(2);
  });

  it("ignores lights no world surface can receive: a weapon-layer light, a model's own light", () => {
    const { dirty } = setup();
    const weaponLight = new HemisphericLight("blade", new Vector3(0, 1, 0), scene);
    weaponLight.includeOnlyWithLayerMask = 0x10000000;
    const model = MeshBuilder.CreateBox("pickup", {}, scene);
    const modelLight = new HemisphericLight("model", new Vector3(0, 1, 0), scene);
    modelLight.includedOnlyMeshes = [model];
    frame();
    weaponLight.setEnabled(false);
    frame();
    weaponLight.setEnabled(true);
    modelLight.dispose();
    frame();
    expect(dirty).not.toHaveBeenCalled();
  });

  it("re-checks them when another light re-sorts the world's light order", () => {
    const { dirty } = setup();
    const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
    new HemisphericLight("sun", new Vector3(0, 1, 0), scene);
    const wall = scene.getMeshByName("wall")!;
    // Switched back on, the sky moves to the end of the wall's list
    sky.setEnabled(false);
    frame();
    sky.setEnabled(true);
    frame();
    expect(wall.lightSources.map((light) => light.name)).toEqual(["sun", "sky"]);
    dirty.mockClear();

    // A light only a model receives puts every list back in scene order
    const model = MeshBuilder.CreateBox("pickup", {}, scene);
    const modelLight = new HemisphericLight("model", new Vector3(0, 1, 0), scene);
    modelLight.includedOnlyMeshes = [model];
    expect(wall.lightSources.map((light) => light.name)).toEqual(["sky", "sun"]);
    frame();
    expect(dirty).toHaveBeenCalledTimes(1);
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

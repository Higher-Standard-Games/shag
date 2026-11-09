import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { disposePlayerModel, type PlayerModelInstance, PlayerModelManager } from "../animation/PlayerModelManager";

it("restores authored albedo and emissive colours when tint is removed, keeping the coloured outline", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const manager = new PlayerModelManager(scene);
  const source = new PBRMaterial("authored", scene);
  source.albedoColor.set(0.6, 0.7, 0.8);
  source.emissiveColor.set(0.02, 0.03, 0.04);
  const mesh = new Mesh("body", scene);
  mesh.material = source;
  const instance = { id: "test", mesh, anchor: new TransformNode("anchor", scene) } as PlayerModelInstance;
  const style = {
    tintColor: new Color3(1, 0, 0),
    fullbrightEnabled: true,
    fullbrightIntensity: 0.6,
    outlineEnabled: true,
    outlineColor: new Color3(0, 1, 1),
    outlineWidth: 0.04,
  };
  try {
    manager.applyVisualStyle(instance, style);
    const material = mesh.material as PBRMaterial;
    expect(material.albedoColor.asArray()).toEqual([1, 0, 0]);
    manager.applyVisualStyle(instance, { ...style, tintColor: null, fullbrightEnabled: false });
    expect(material.albedoColor.asArray()).toEqual([0.6, 0.7, 0.8]);
    expect(material.emissiveColor.asArray()).toEqual([0.02, 0.03, 0.04]);
    expect(mesh.outlineColor.asArray()).toEqual([0, 1, 1]);
    expect(mesh.renderOutline).toBe(true);
    expect(source.albedoColor.asArray()).toEqual([0.6, 0.7, 0.8]);
  } finally {
    disposePlayerModel(instance);
    manager.dispose();
    engine.dispose();
  }
});

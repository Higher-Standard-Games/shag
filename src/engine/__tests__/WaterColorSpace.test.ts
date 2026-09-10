import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Scene } from "@babylonjs/core/scene";
import { expect, it, vi } from "vitest";
import { createUnifiedWaterMaterial, disposeWaterNoise } from "../rendering/water/UnifiedWaterMaterial";

it("feeds linear output to image processing even for a frozen water material", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const material = createUnifiedWaterMaterial(scene, "water")!;
  const mesh = CreateGround("water", {}, scene);
  const setFloat = vi.fn();
  const effect = vi.spyOn(material, "getEffect").mockReturnValue({ setFloat } as unknown as Effect);
  try {
    material.freeze();
    for (const enabled of [false, true, false]) {
      scene.imageProcessingConfiguration.applyByPostProcess = enabled;
      material.onBindObservable.notifyObservers(mesh);
      expect(setFloat).toHaveBeenLastCalledWith("uOutputLinear", enabled ? 1 : 0);
    }
    scene.imageProcessingConfiguration.applyByPostProcess = true;
    scene.imageProcessingConfiguration.isEnabled = false;
    material.onBindObservable.notifyObservers(mesh);
    expect(setFloat).toHaveBeenLastCalledWith("uOutputLinear", 0);
  } finally {
    effect.mockRestore();
    disposeWaterNoise(scene);
    scene.dispose();
    engine.dispose();
  }
});

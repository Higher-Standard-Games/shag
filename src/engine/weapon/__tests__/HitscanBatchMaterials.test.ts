import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { getHitscanEffects } from "../HitscanEffects";

it.each([false, true])("keeps batch materials owned by the current scene (replace scene: %s)", (replace) => {
  const engine = new NullEngine();
  let scene = new Scene(engine);
  const effects = getHitscanEffects() as unknown as {
    scene: Scene | null;
    spawnWallMark(position: Vector3, normal: Vector3, color: Color3, size: number): void;
    ensurePelletBatch(scene: Scene): void;
    clear(): void;
  };
  const spawn = () => {
    effects.scene = scene;
    effects.spawnWallMark(Vector3.Zero(), Vector3.Up(), Color3.White(), 1);
    effects.ensurePelletBatch(scene);
    return ["wallmark_batch", "pellet_batch"].map((name) => scene.getMeshByName(name)!.material!);
  };
  try {
    const first = spawn();
    effects.clear();
    expect(spawn()).toEqual(first);
    effects.clear();
    if (replace) {
      scene.dispose();
      scene = new Scene(engine);
    } else {
      for (const material of [...scene.materials]) material.dispose();
    }
    const next = spawn();
    for (let i = 0; i < next.length; i++) {
      expect(next[i]).not.toBe(first[i]);
      expect(next[i].getScene()).toBe(scene);
      expect(scene.materials).toContain(next[i]);
    }
    expect(spawn()).toEqual(next);
    for (const name of ["wallmark_shared_mat", "pellet_mat"])
      expect(scene.materials.filter((material) => material.name === name)).toHaveLength(1);
  } finally {
    effects.clear();
    effects.scene = null;
    engine.dispose();
  }
});

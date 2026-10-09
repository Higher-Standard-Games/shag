/**
 * Clearing hitscan effects takes the bullet holes too (NullEngine).
 *
 * They were left behind on a demo seek, a demo stop and a map change, so the
 * next demo or map showed the last one's holes on its walls (D10).
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getHitscanEffects } from "../HitscanEffects";

afterEach(() => vi.restoreAllMocks());

describe("clearing hitscan effects", () => {
  it("removes the bullet holes and keeps the shared material for the next ones", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scene = new Scene(new NullEngine());
    const effects = getHitscanEffects() as unknown as {
      scene: Scene | null;
      spawnWallMark(position: Vector3, normal: Vector3, color: Color3, size: number): void;
      clear(): void;
    };
    effects.scene = scene;
    effects.spawnWallMark(new Vector3(0, 0, 0), new Vector3(0, 1, 0), Color3.White(), 1);
    effects.spawnWallMark(new Vector3(8, 0, 0), new Vector3(0, 1, 0), Color3.White(), 1);
    const marks = () => scene.meshes.filter((mesh) => mesh.material?.name === "wallmark_shared_mat");
    expect(marks()).toHaveLength(2);

    effects.clear();

    expect(marks()).toHaveLength(0);
    expect(scene.materials.some((material) => material.name === "wallmark_shared_mat")).toBe(true);
    effects.scene = null;
    scene.getEngine().dispose();
  });
});

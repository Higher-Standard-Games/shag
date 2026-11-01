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
    const batches = () => scene.meshes.filter((mesh) => mesh.material?.name === "wallmark_shared_mat");
    // Every mark is an instance of one disc: one draw however many there are
    expect(batches()).toHaveLength(1);
    expect((batches()[0] as unknown as { thinInstanceCount: number }).thinInstanceCount).toBe(2);
    expect(batches()[0].isEnabled()).toBe(true);

    effects.clear();

    expect(batches()).toHaveLength(0);
    expect(scene.materials.some((material) => material.name === "wallmark_shared_mat")).toBe(true);
    effects.scene = null;
    scene.getEngine().dispose();
  });

  it("keeps at most fifty marks, dropping the oldest, and fades each from its own spawn", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scene = new Scene(new NullEngine());
    let now = 0;
    const effects = getHitscanEffects() as unknown as {
      scene: Scene | null;
      now: () => number;
      spawnWallMark(position: Vector3, normal: Vector3, color: Color3, size: number): void;
      updateWallMarks(now: number): void;
      wallMarkColors: Float32Array;
      clear(): void;
    };
    const clock = effects.now;
    effects.scene = scene;
    effects.now = () => now;
    for (let i = 0; i < 55; i++) {
      now = i * 0.01;
      effects.spawnWallMark(new Vector3(i, 0, 0), new Vector3(0, 1, 0), Color3.White(), 1);
    }
    const batch = scene.meshes.find((mesh) => mesh.name === "wallmark_batch") as unknown as {
      thinInstanceCount: number;
    };
    expect(batch.thinInstanceCount).toBe(50);

    // The oldest kept mark (spawned at 0.05 s) is nearer its end than the newest
    effects.updateWallMarks(1.55);
    expect(effects.wallMarkColors[3]).toBeCloseTo(1 - 1.5 / 3);
    expect(effects.wallMarkColors[49 * 4 + 3]).toBeCloseTo(1 - (1.55 - 0.54) / 3);

    // All gone after the fade: no instances and the disc leaves the frame
    effects.updateWallMarks(10);
    expect(batch.thinInstanceCount).toBe(0);
    expect(scene.meshes.find((mesh) => mesh.name === "wallmark_batch")?.isEnabled()).toBe(false);

    effects.clear();
    effects.now = clock;
    effects.scene = null;
    scene.getEngine().dispose();
  });
});

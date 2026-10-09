/**
 * Bullet streaks — the machinegun tracer that replaced a one-pixel line drawn
 * from the eye. These pin the timing the impact waits on and the pooling that
 * keeps sixteen machineguns at one draw call.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STREAK_SPEED, StreakTracerRenderer } from "../tracer/StreakTracerRenderer";

describe("streak tracers", () => {
  let engine: NullEngine;
  let scene: Scene;
  let now: number;
  let renderer: StreakTracerRenderer;
  const color = new Color3(1, 0.9, 0.3);

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    now = 50;
    renderer = new StreakTracerRenderer(scene, () => now, 4);
  });
  afterEach(() => {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("reports when the head reaches the end, for the impact to wait on", () => {
    const travel = renderer.fire({ start: new Vector3(0, 0, 0), end: new Vector3(0, 0, 1200), color });
    expect(travel).toBeCloseTo(1200 / STREAK_SPEED, 9);
  });

  it("lives until its tail has gone into the wall, then frees its slot", () => {
    renderer.fire({ start: new Vector3(0, 0, 0), end: new Vector3(0, 0, 1200), color });
    expect(renderer.getDebugCount()).toBe(1);

    now += 1200 / STREAK_SPEED; // head arrives; the tail is still on its way
    renderer.update(0);
    expect(renderer.getDebugCount()).toBe(1);

    now += 0.05;
    renderer.update(0);
    expect(renderer.getDebugCount()).toBe(0);
  });

  it("recycles the oldest streak when the pool is full", () => {
    for (let i = 0; i < 6; i++) {
      now += 0.001;
      renderer.fire({ start: new Vector3(i, 0, 0), end: new Vector3(i, 0, 5000), color });
    }
    expect(renderer.getDebugCount()).toBe(4);
    const { startSpawn } = renderer as unknown as { startSpawn: Float32Array };
    const starts = [0, 1, 2, 3].map((slot) => startSpawn[slot * 4]).sort();
    expect(starts).toEqual([2, 3, 4, 5]);
  });

  it("is cleared with the other effects", () => {
    renderer.fire({ start: new Vector3(0, 0, 0), end: new Vector3(0, 0, 100), color });
    renderer.clear();
    expect(renderer.getDebugCount()).toBe(0);
  });
});

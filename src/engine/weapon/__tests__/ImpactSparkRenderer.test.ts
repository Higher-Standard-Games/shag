/**
 * Impact sparks — the half of every contact that was missing.
 *
 * Before this, a hit left a fading triangle and a point light; nothing radiated
 * from the surface. These pin the properties that make a burst read as contact
 * rather than as decoration, and the pooling that keeps a shotgun blast from
 * being hundreds of meshes.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImpactSparkRenderer } from "../impact/ImpactSparkRenderer";

type Instances = {
  originSeed: Float32Array;
  velocityKind: Float32Array;
  params: Float32Array;
};

/** The instance buffers are private; tests read them to assert real scatter. */
function buffers(renderer: ImpactSparkRenderer): Instances {
  return renderer as unknown as Instances;
}

function velocitiesOf(renderer: ImpactSparkRenderer): Vector3[] {
  const { velocityKind } = buffers(renderer);
  const out: Vector3[] = [];
  for (let i = 0; i < renderer.getDebugCount(); i++) {
    const o = i * 4;
    if (velocityKind[o + 3] > 0.5) continue; // skip the star
    out.push(new Vector3(velocityKind[o], velocityKind[o + 1], velocityKind[o + 2]));
  }
  return out;
}

describe("impact sparks", () => {
  let engine: NullEngine;
  let scene: Scene;
  let now: number;
  let renderer: ImpactSparkRenderer;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    now = 100;
    renderer = new ImpactSparkRenderer(scene, () => now, 64);
  });
  afterEach(() => {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  });

  const floor = { position: new Vector3(0, 0, 0), normal: new Vector3(0, 1, 0), color: new Color3(1, 0.8, 0.3) };

  it("spends one instance per ember, and adds the star only when heavy", () => {
    renderer.burst({ ...floor, incoming: new Vector3(0, -1, 0), count: 5 });
    expect(renderer.getDebugCount()).toBe(5);

    renderer.clear();
    renderer.burst({ ...floor, incoming: new Vector3(0, -1, 0), count: 5, heavy: true });
    expect(renderer.getDebugCount()).toBe(6);

    const { velocityKind } = buffers(renderer);
    const stars = Array.from({ length: 6 }, (_, i) => velocityKind[i * 4 + 3]).filter((kind) => kind > 0.5);
    expect(stars).toHaveLength(1);
  });

  it("throws every ember away from the surface, even on a grazing hit", () => {
    // Almost parallel to the floor: a pure mirror reflection would run along it,
    // and the scatter cone would tip half the burst underneath.
    renderer.burst({ ...floor, incoming: new Vector3(1, -0.04, 0).normalize(), count: 40 });

    const velocities = velocitiesOf(renderer);
    expect(velocities).toHaveLength(40);
    for (const velocity of velocities) {
      expect(Vector3.Dot(velocity.clone().normalize(), floor.normal)).toBeGreaterThan(0);
    }
  });

  it("mirrors the shot rather than spraying straight back", () => {
    // Straight down onto the floor scatters up; a 45 degree hit carries its
    // horizontal direction through the bounce.
    renderer.burst({ ...floor, incoming: new Vector3(1, -1, 0).normalize(), count: 40 });
    const mean = velocitiesOf(renderer)
      .reduce((acc, v) => acc.addInPlace(v), Vector3.Zero())
      .scaleInPlace(1 / 40);

    expect(mean.x).toBeGreaterThan(0);
    expect(mean.y).toBeGreaterThan(0);
  });

  it("scatters — a burst is not one repeated direction", () => {
    renderer.burst({ ...floor, incoming: new Vector3(0, -1, 0), count: 24 });
    const velocities = velocitiesOf(renderer);
    const distinct = new Set(velocities.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`));
    expect(distinct.size).toBe(velocities.length);

    // And they differ in speed, so the burst does not expand as a clean shell.
    const speeds = velocities.map((v) => v.length());
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(1);
  });

  it("retires a spark once its own lifetime is up", () => {
    renderer.burst({ ...floor, incoming: new Vector3(0, -1, 0), count: 8 });
    expect(renderer.getDebugCount()).toBe(8);

    now += 0.15; // under the shortest lifetime
    renderer.update(0.15);
    expect(renderer.getDebugCount()).toBe(8);

    now += 0.5; // past the longest
    renderer.update(0.5);
    expect(renderer.getDebugCount()).toBe(0);
  });

  it("recycles the oldest rather than growing past capacity", () => {
    // A riotgun blast is one burst per pellet and can outrun any fixed pool.
    for (let pellet = 0; pellet < 30; pellet++) {
      now += 0.001;
      renderer.burst({ ...floor, incoming: new Vector3(0, -1, 0), count: 8 });
    }
    expect(renderer.getDebugCount()).toBe(64);

    // Every surviving slot must still be a live, well-formed spark.
    const { originSeed, params } = buffers(renderer);
    for (let i = 0; i < 64; i++) {
      expect(Number.isFinite(originSeed[i * 4])).toBe(true);
      expect(params[i * 4 + 1]).toBeGreaterThan(0);
    }
  });

  it("survives a degenerate normal instead of poisoning the buffer with NaN", () => {
    // A trace can hand back a zero normal; NaN velocities would corrupt every
    // instance sharing the buffer, not just this burst.
    renderer.burst({
      position: new Vector3(10, 20, 30),
      normal: new Vector3(0, 0, 0),
      incoming: new Vector3(0, 0, 0),
      color: new Color3(1, 1, 1),
      count: 6,
    });

    for (const velocity of velocitiesOf(renderer)) {
      expect(Number.isFinite(velocity.x)).toBe(true);
      expect(Number.isFinite(velocity.y)).toBe(true);
      expect(Number.isFinite(velocity.z)).toBe(true);
      expect(velocity.length()).toBeGreaterThan(0);
    }
  });

  it("holds the star still on the surface while embers fly", () => {
    renderer.burst({ ...floor, incoming: new Vector3(0, -1, 0), count: 3, heavy: true });
    const { velocityKind, params } = buffers(renderer);
    const starIndex = [0, 1, 2, 3].find((i) => velocityKind[i * 4 + 3] > 0.5)!;

    expect(velocityKind[starIndex * 4]).toBe(0);
    expect(velocityKind[starIndex * 4 + 1]).toBe(0);
    expect(velocityKind[starIndex * 4 + 2]).toBe(0);
    expect(params[starIndex * 4 + 2]).toBe(0); // no gravity: it marks the contact
  });

  it("draws nothing when nothing is alive", () => {
    const mesh = scene.getMeshByName("impact_spark") as Mesh;
    expect(mesh.isEnabled()).toBe(false);

    renderer.burst({ ...floor, incoming: new Vector3(0, -1, 0), count: 4 });
    expect(mesh.isEnabled()).toBe(true);
    expect(mesh.thinInstanceCount).toBe(4);

    now += 1;
    renderer.update(1);
    expect(mesh.isEnabled()).toBe(false);
    expect(mesh.thinInstanceCount).toBe(0);
  });
});

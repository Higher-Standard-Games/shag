/**
 * Explosions are instances in three shared meshes (NullEngine): an explosion
 * adds instances only, the shader animates them, and they expire on their own.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLADE_EXPLOSION,
  GRENADE_EXPLOSION,
  getExplosionEffect,
  PLASMA_EXPLOSION,
  ROCKET_EXPLOSION,
} from "../weapon/ExplosionEffect";
import { SPARKS_PER_EXPLOSION } from "../weapon/explosion/ExplosionBatchRenderer";
import { getPointLightPool } from "../weapon/PointLightPool";

let engine: NullEngine;
let scene: Scene;
let now = 0;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  now = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  // The flash light comes from a pool the map load fills
  vi.spyOn(getPointLightPool(), "acquire").mockReturnValue(null);
  vi.spyOn(getPointLightPool(), "release").mockImplementation(() => {});
  getExplosionEffect().init(scene);
});

afterEach(() => {
  getExplosionEffect().clear();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

const advance = (ms: number) => {
  now += ms;
  getExplosionEffect().update(ms / 1000);
};

describe("batched explosions", () => {
  it("adds instances, not meshes, materials or particle systems", () => {
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    const effect = getExplosionEffect();
    for (let i = 0; i < 10; i++) effect.spawn(new Vector3(i * 64, 0, 0), ROCKET_EXPLOSION);
    expect(scene.meshes).toHaveLength(meshes);
    expect(scene.materials).toHaveLength(materials);
    expect(scene.particleSystems).toHaveLength(0);
    // Math.random at 0.5 puts every rocket at 10 rays
    expect(effect.getDebugCounts()).toEqual({
      explosions: 10,
      fireball: 10,
      ray: 100,
      spark: 10 * SPARKS_PER_EXPLOSION,
    });
    expect(
      scene.meshes
        .filter((m) => m.name.startsWith("explosion_"))
        .map((m) => m.name)
        .sort(),
    ).toEqual(["explosion_fireball", "explosion_ray", "explosion_spark"]);
  });

  it("gives plasma fewer rays", () => {
    const effect = getExplosionEffect();
    effect.spawn(Vector3.Zero(), PLASMA_EXPLOSION);
    expect(effect.getDebugCounts()).toMatchObject({ fireball: 1, ray: 5 });
    effect.spawn(Vector3.Zero(), GRENADE_EXPLOSION);
    effect.spawn(Vector3.Zero(), BLADE_EXPLOSION);
    expect(effect.getDebugCounts()).toMatchObject({ fireball: 3, ray: 25 });
  });

  it("retires each layer when it has played out, and the explosion with its light", () => {
    const light = new PointLight("flash", Vector3.Zero(), scene);
    vi.mocked(getPointLightPool().acquire).mockImplementation((_position, _color, intensity) => {
      light.intensity = intensity;
      return light;
    });
    const effect = getExplosionEffect();
    effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    const peak = light.intensity;
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(2);
    advance(50);
    expect(light.intensity).toBeLessThan(peak);
    // Sparks live 0.35 particle time here (0.58 s); fire layers 0.6 / 0.85 s
    advance(550);
    expect(effect.getDebugCounts()).toMatchObject({ fireball: 1, spark: 0 });
    advance(150);
    expect(effect.getDebugCounts()).toMatchObject({ explosions: 1, fireball: 0, ray: 0 });
    // The explosion and its light go at 0.9 / 0.85 s
    advance(400);
    expect(effect.getDebugCounts()).toEqual({ explosions: 0, fireball: 0, ray: 0, spark: 0 });
    expect(getPointLightPool().release).toHaveBeenCalledWith(light);
    expect(scene.meshes.filter((m) => m.name.startsWith("explosion_")).every((m) => !m.isEnabled())).toBe(true);
  });

  it("clears every live explosion and keeps working afterwards", () => {
    const effect = getExplosionEffect();
    effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    effect.clear();
    expect(effect.getDebugCounts()).toEqual({ explosions: 0, fireball: 0, ray: 0, spark: 0 });
    effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    expect(effect.getDebugCounts().fireball).toBe(1);
  });

  it("rebuilds its meshes after a scene clear disposes them, and never repopulates a disposed scene", () => {
    const effect = getExplosionEffect();
    for (const mesh of [...scene.meshes]) mesh.dispose(false, true);
    effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    const layers = scene.meshes.filter((m) => m.name.startsWith("explosion_"));
    expect(layers).toHaveLength(3);
    expect(layers.every((m) => !m.isDisposed())).toBe(true);
    expect(effect.getDebugCounts().fireball).toBe(1);
    scene.dispose();
    effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    expect(scene.meshes).toHaveLength(0);
  });

  it("recycles the oldest explosions when more are alive than the batch holds", () => {
    const effect = getExplosionEffect();
    for (let i = 0; i < 120; i++) effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    expect(effect.getDebugCounts()).toMatchObject({ fireball: 96, ray: 96 * 12, spark: 96 * SPARKS_PER_EXPLOSION });
  });
});

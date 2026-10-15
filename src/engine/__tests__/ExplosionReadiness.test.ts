/**
 * An explosion leaves nothing behind that can never be ready (NullEngine).
 *
 * The map load's last step waits for the scene to report ready. Explosions from
 * a match already under way arrive during that wait, and each one added two
 * empty particle systems with no emitter and no texture, which never report
 * ready; the game loop that clears them only starts once the load finishes. So
 * joining a match where people were already fighting held the loading screen
 * up for good.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExplosionEffect, PLASMA_EXPLOSION, ROCKET_EXPLOSION } from "../weapon/ExplosionEffect";
import { getPointLightPool } from "../weapon/PointLightPool";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  vi.spyOn(console, "log").mockImplementation(() => {});
  // The flash light comes from a pool the map load fills; it is not what this is about
  vi.spyOn(getPointLightPool(), "acquire").mockReturnValue(null);
  vi.spyOn(getPointLightPool(), "release").mockImplementation(() => {});
  // The procedural particle texture needs a 2D canvas, which the test runner lacks
  Object.assign(getExplosionEffect() as object, { scene, particleTexture: null });
});

afterEach(() => {
  getExplosionEffect().clear();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

describe("explosion particle systems", () => {
  it("keeps the flash below two light units and fades it from the same initial gain", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
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
    now = 50;
    effect.update(0.05);
    expect(light.intensity).toBeLessThan(peak);
    expect(light.intensity).toBeGreaterThan(0);
  });
  it("reuses retired ray materials without setup scans, resetting color and fade while keeping active rays independent", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const effect = getExplosionEffect();
    const sceneDefault = scene.defaultMaterial;
    const world = MeshBuilder.CreateBox("world", {}, scene);
    world.material = new StandardMaterial("world", scene);
    const visits = vi.spyOn(world.subMeshes[0], "getMaterial");
    effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    const rayMaterials = () =>
      scene.meshes.filter((m) => /_ray_\d+$/.test(m.name)).map((m) => m.material as StandardMaterial);
    const first = rayMaterials();
    expect(first).toHaveLength(10);
    expect(new Set(first).size).toBe(10);
    now = 100;
    effect.update(0.1);
    const expected = Color3.Lerp(
      ROCKET_EXPLOSION.coreColor,
      ROCKET_EXPLOSION.outerColor,
      ((0.1 * ROCKET_EXPLOSION.speed) / 0.6) * 3,
    );
    expect(first[0].emissiveColor.asArray()).toEqual(expected.asArray());
    now = 400;
    effect.update(0.3);
    expect(first[0].alpha).toBeLessThan(0.8);
    now = 2000;
    effect.update(1.9);
    expect(first.every((material) => Object.keys(material.meshMap ?? {}).length === 0)).toBe(true);
    visits.mockClear();
    effect.spawn(Vector3.Zero(), PLASMA_EXPLOSION);
    const reused = rayMaterials();
    expect(reused.every((material) => first.includes(material))).toBe(true);
    // Only fireball setup scans the world; plasma allocates no shockwave.
    expect(scene.meshes.some((mesh) => mesh.name.includes("shockwave"))).toBe(false);
    expect(scene.materials.some((material) => material.name.includes("shockwave"))).toBe(false);
    expect(visits.mock.calls.length).toBeLessThanOrEqual(2);
    expect(reused[0].emissiveColor.asArray()).toEqual(
      Color3.Lerp(PLASMA_EXPLOSION.coreColor, PLASMA_EXPLOSION.outerColor, 0.5).asArray(),
    );
    expect(reused[0].alpha).toBe(0.8);
    effect.spawn(new Vector3(64, 0, 0), ROCKET_EXPLOSION);
    const simultaneous = rayMaterials();
    expect(new Set(simultaneous).size).toBe(20);
    expect(simultaneous[10].emissiveColor.asArray()).toEqual(
      Color3.Lerp(ROCKET_EXPLOSION.coreColor, ROCKET_EXPLOSION.outerColor, 0.5).asArray(),
    );
    expect(reused[0].emissiveColor.asArray()).toEqual(
      Color3.Lerp(PLASMA_EXPLOSION.coreColor, PLASMA_EXPLOSION.outerColor, 0.5).asArray(),
    );
    now = 2200;
    effect.update(0.2);
    expect(reused[0].alpha).toBeCloseTo(0.8 * (1 - (0.5 - 0.25) / 0.35));
    effect.clear();
    expect(scene.materials).toHaveLength(2);
    expect(scene.materials.includes(world.material!)).toBe(true);
    expect(scene.materials.includes(sceneDefault)).toBe(true);
  });

  it("bounds idle material retention and retires the pool and its observer on clear or scene disposal", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const effect = getExplosionEffect();
    const sceneDefault = scene.defaultMaterial;
    const observers = scene.onDisposeObservable.observers.length;
    for (let i = 0; i < 14; i++) effect.spawn(Vector3.Zero());
    expect(scene.meshes.filter((m) => /_ray_\d+$/.test(m.name))).toHaveLength(140);
    now = 2000;
    effect.update(2);
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(129); // Scene default + 128 idle rays.
    expect(scene.onDisposeObservable.observers).toHaveLength(observers + 1);
    effect.clear();
    await new Promise((resolve) => setTimeout(resolve, 0)); // Observable.remove defers physical removal.
    expect(scene.materials).toHaveLength(1);
    expect(scene.materials.includes(sceneDefault)).toBe(true);
    expect(scene.onDisposeObservable.observers).toHaveLength(observers);
    effect.spawn(Vector3.Zero());
    now = 4000;
    effect.update(2);
    const retained = [...scene.materials];
    scene.dispose();
    expect(retained.every((m) => !scene.materials.includes(m))).toBe(true);
    effect.spawn(Vector3.Zero()); // Disposed scene must not be repopulated.
    expect(scene.meshes).toHaveLength(0);
  });
  it("batches cold material setup and deforms the same buffer without dirtying shader attributes", () => {
    const world = MeshBuilder.CreateBox("unrelated-world", {}, scene);
    world.material = new StandardMaterial("unrelated-world", scene);
    const visits = vi.spyOn(world.subMeshes[0], "getMaterial");
    const effect = getExplosionEffect();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    effect.spawn(Vector3.Zero());
    const materialCount = scene.materials.filter((m) => m.name.startsWith("explosion_")).length;
    // One final readiness invalidation per configured material, instead of
    // separate full-scene scans for its alpha, culling and light setters.
    expect(visits.mock.calls.length).toBeLessThanOrEqual(materialCount + 1);
    const fireball = scene.meshes.find((m) => m.name.endsWith("_fireball"))!;
    const buffer = fireball.getVertexBuffer(VertexBuffer.PositionKind);
    const before = [...fireball.getVerticesData(VertexBuffer.PositionKind)!];
    const attributes = vi.spyOn(fireball, "_markSubMeshesAsAttributesDirty");
    now = 120;
    effect.update(0.12);
    now = 240;
    effect.update(0.12);
    expect(fireball.getVertexBuffer(VertexBuffer.PositionKind)).toBe(buffer);
    expect([...fireball.getVerticesData(VertexBuffer.PositionKind)!]).not.toEqual(before);
    expect(attributes).not.toHaveBeenCalled();
    const material = fireball.material as StandardMaterial;
    expect(material.disableLighting).toBe(true);
    expect(material.alpha).toBe(0.9);
    now = 480;
    effect.update(0.24);
    expect(material.alpha).toBeLessThan(0.9);
  });
  it("adds only the sparks it draws", () => {
    getExplosionEffect().spawn(new Vector3(0, 0, 0));

    expect(scene.particleSystems.map((system) => system.name)).toEqual([expect.stringMatching(/_sparks$/)]);
  });

  it("takes its particle systems with it when cleared", () => {
    const effect = getExplosionEffect();
    effect.spawn(new Vector3(0, 0, 0));
    effect.spawn(new Vector3(64, 0, 0));

    effect.clear();

    expect(scene.particleSystems).toHaveLength(0);
  });
});

describe("the sparks' shared texture", () => {
  it("outlives every explosion that used it", () => {
    const effect = getExplosionEffect();
    const texture = new Texture(null, scene);
    const dispose = vi.spyOn(texture, "dispose");
    Object.assign(effect as object, { particleTexture: texture });

    effect.spawn(new Vector3(0, 0, 0));
    effect.spawn(new Vector3(64, 0, 0));
    effect.clear();
    effect.spawn(new Vector3(0, 0, 0));

    expect(dispose).not.toHaveBeenCalled();
    expect(scene.particleSystems[0]?.particleTexture).toBe(texture);
  });

  it("is let go when the effect is set up again", () => {
    const effect = getExplosionEffect();
    const old = new Texture(null, scene);
    const dispose = vi.spyOn(old, "dispose");
    Object.assign(effect as object, { particleTexture: old });
    const fresh = new Texture(null, scene);
    vi.spyOn(effect as unknown as { createParticleTexture(): Texture }, "createParticleTexture").mockReturnValue(fresh);

    effect.init(scene);

    expect(dispose).toHaveBeenCalledOnce();
  });
});

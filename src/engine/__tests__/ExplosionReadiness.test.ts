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
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExplosionEffect } from "../weapon/ExplosionEffect";
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

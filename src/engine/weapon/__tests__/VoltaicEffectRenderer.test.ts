import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { buildVoltaicBeamTemplate, buildVoltaicImpactTemplate } from "../voltaic/VoltaicBeamGeometry";
import { VoltaicEffectRenderer } from "../voltaic/VoltaicEffectRenderer";
import { makeVoltaicSeed } from "../voltaic/VoltaicProfiles";

describe("Voltaic fixed topology", () => {
  it("builds bounded immutable templates for every presentation profile", () => {
    const hero = buildVoltaicBeamTemplate("hero");
    const world = buildVoltaicBeamTemplate("world");
    const chain = buildVoltaicBeamTemplate("chain");
    const impact = buildVoltaicImpactTemplate();

    expect(hero.vertexCount).toBe(704);
    expect(world.vertexCount).toBe(146);
    expect(chain.vertexCount).toBe(92);
    expect(impact.vertexCount).toBe(48);
    expect(Math.max(...Array.from(impact.positions).filter((_value, index) => index % 3 === 2))).toBe(11);
    expect(Math.max(...Array.from(hero.positions).filter((_value, index) => index % 3 === 2))).toBe(25);
    expect(hero.indices.length).toBeGreaterThan(world.indices.length);
    expect(world.indices.length).toBeGreaterThan(chain.indices.length);

    for (const template of [hero, world, chain, impact]) {
      expect(template.positions.length).toBe(template.vertexCount * 3);
      expect(template.uvs.length).toBe(template.vertexCount * 2);
      expect(Math.max(...template.indices)).toBeLessThan(template.vertexCount);
      expect(Array.from(template.positions).every(Number.isFinite)).toBe(true);
    }
  });

  it("uses stable presentation seeds without requiring cross-client equality", () => {
    expect(makeVoltaicSeed("player_1", 1)).toBe(makeVoltaicSeed("player_1", 1));
    expect(makeVoltaicSeed("player_1", 1)).not.toBe(makeVoltaicSeed("player_1", 2));
    expect(makeVoltaicSeed("player_1", 1)).not.toBe(makeVoltaicSeed("player_2", 1));
  });
});

describe("VoltaicEffectRenderer lifecycle", () => {
  it("releases restoration hooks when the scene is disposed before the controller", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const renderer = new VoltaicEffectRenderer(scene);
    scene.dispose();
    expect(engine.onContextRestoredObservable.hasObservers()).toBe(false);
    engine.onContextRestoredObservable.notifyObservers(engine);
    expect(scene.meshes).toHaveLength(0);
    renderer.dispose();
    engine.dispose();
  });

  it("uploads changed logical slots, handles swap-removal and rebuilds full capacity on restoration", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const before = engine.onContextRestoredObservable.hasObservers();
    const renderer = new VoltaicEffectRenderer(scene, () => 1);
    const beam = scene.getMeshByName("voltaic_world_beam") as Mesh;
    const impact = scene.getMeshByName("voltaic_world_impact") as Mesh;
    const beamWrites = vi.spyOn(beam, "thinInstancePartialBufferUpdate");
    const impactWrites = vi.spyOn(impact, "thinInstancePartialBufferUpdate");
    const sample = {
      start: Vector3.Zero(),
      end: new Vector3(0, 0, 100),
      color: new Color3(0, 1, 1),
      impactKind: "world" as const,
    };
    try {
      for (const id of ["a", "b", "c"]) renderer.updateRemote(id, sample, Vector3.Forward());
      renderer.update(0);
      expect(beamWrites.mock.calls.every(([, count, offset]) => count === 3 && offset === 0)).toBe(true);
      beamWrites.mockClear();
      impactWrites.mockClear();
      renderer.updateRemote("b", sample, Vector3.Forward());
      renderer.update(0);
      expect(beamWrites).toHaveBeenCalledTimes(4);
      expect(impactWrites).toHaveBeenCalledTimes(5);
      expect(beamWrites.mock.calls.every(([, count, offset]) => count === 1 && offset === 1)).toBe(true);
      beamWrites.mockClear();
      impactWrites.mockClear();
      renderer.removeRemote("b");
      renderer.update(0);
      expect(renderer.getDebugRemoteKeys()).toEqual(["a", "c"]);
      expect(beamWrites.mock.calls.every(([, count, offset]) => count === 1 && offset === 1)).toBe(true);
      beamWrites.mockClear();
      impactWrites.mockClear();
      renderer.removeRemote("c");
      renderer.update(0);
      expect(beamWrites).not.toHaveBeenCalled();
      expect(impactWrites).not.toHaveBeenCalled();
      engine.onContextRestoredObservable.notifyObservers(engine);
      expect(beam.getVertexBuffer("iParams")?.getData()).toHaveLength(32 * 4);
      expect(beam.thinInstanceCount).toBe(1);
      renderer.clear();
      renderer.update(0);
      renderer.updateRemote("reused", sample, Vector3.Forward());
      renderer.update(0);
      expect(beamWrites).toHaveBeenCalledWith("iParams", 1, 0);
    } finally {
      renderer.dispose();
      expect(engine.onContextRestoredObservable.hasObservers()).toBe(before);
      scene.dispose();
      engine.dispose();
      vi.restoreAllMocks();
    }
  });

  it("reuses retained hero and instanced world resources", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    const now = 10;
    const renderer = new VoltaicEffectRenderer(scene, () => now);
    const initialMeshCount = scene.meshes.length;
    const initialMaterialCount = scene.materials.length;
    const color = new Color3(1, 0.7, 0.1);
    const worldBeam = scene.getMeshByName("voltaic_world_beam") as Mesh | null;
    const worldImpact = scene.getMeshByName("voltaic_world_impact");
    const chainBeam = scene.getMeshByName("voltaic_chain_beam");

    try {
      expect(worldBeam?.isEnabled()).toBe(false);
      expect(worldImpact?.isEnabled()).toBe(false);
      expect(chainBeam?.isEnabled()).toBe(false);
      await renderer.prewarm();
      // Prewarming must compile THIN_INSTANCES without leaving template draws alive.
      expect(worldBeam?.isEnabled()).toBe(false);
      expect(worldBeam?.thinInstanceCount).toBe(0);
      renderer.updateHero({
        start: Vector3.Zero(),
        end: new Vector3(0, 0, 200),
        color,
        impactKind: "world",
        impactNormal: new Vector3(0, 0, -1),
      });
      renderer.updateRemote(
        "enemy_1",
        {
          start: new Vector3(10, 0, 0),
          end: new Vector3(10, 0, 200),
          color,
          impactKind: "world",
          impactNormal: new Vector3(0, 0, -1),
        },
        Vector3.Forward(),
      );
      renderer.fireChainArc(
        {
          start: new Vector3(0, 0, 200),
          end: new Vector3(25, 5, 220),
          color,
          impactKind: "player",
        },
        0.14,
      );
      renderer.update(1 / 60);

      expect(renderer.getDebugCounts()).toEqual({ remote: 1, chain: 1, heroVisible: true });
      expect(worldBeam?.isEnabled()).toBe(true);
      expect(worldBeam?.thinInstanceCount).toBe(1);
      expect(scene.meshes).toHaveLength(initialMeshCount);
      expect(scene.materials).toHaveLength(initialMaterialCount);

      renderer.clear();
      expect(renderer.getDebugCounts()).toEqual({ remote: 0, chain: 0, heroVisible: false });
      expect(scene.meshes).toHaveLength(initialMeshCount);
      expect(scene.materials).toHaveLength(initialMaterialCount);
      expect(worldBeam?.isEnabled()).toBe(false);
      expect(worldImpact?.isEnabled()).toBe(false);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("refreshes remote muzzle anchors, expires effects, and fades the hero deterministically", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    let now = 1;
    const renderer = new VoltaicEffectRenderer(scene, () => now);
    const color = new Color3(1, 0.7, 0.1);
    const muzzle = new Vector3(25, 30, 35);

    try {
      renderer.setRemoteStartResolver((_key, _direction, result) => {
        result.copyFrom(muzzle);
        return true;
      });
      renderer.updateRemote(
        "enemy",
        {
          start: Vector3.Zero(),
          end: new Vector3(0, 0, 200),
          color,
          impactKind: "player",
          impactNormal: new Vector3(0, 0, -1),
        },
        Vector3.Forward(),
      );
      renderer.updateHero({
        start: Vector3.Zero(),
        end: new Vector3(0, 0, 200),
        color,
        impactKind: "none",
      });
      renderer.update(1 / 60);
      // The muzzle moves after the effects update, as a spectator camera placed
      // by a later before-render observer does; the beam leaves where it is
      // when the world camera renders.
      muzzle.set(40, 45, 50);
      scene.onBeforeCameraRenderObservable.notifyObservers(camera);

      expect(renderer.getDebugRemoteStart("enemy")?.asArray()).toEqual([40, 45, 50]);
      // Misses still retain the hero muzzle corona; endpoint pieces gate
      // themselves off in the shader.
      expect(scene.getMeshByName("voltaic_hero_impact")?.isEnabled()).toBe(true);

      renderer.stopHero();
      now += 0.06;
      renderer.update(1 / 60);
      expect(renderer.getDebugCounts().heroVisible).toBe(false);

      now += 0.22;
      renderer.update(1 / 60);
      expect(renderer.getDebugCounts().remote).toBe(0);
      expect(scene.getMeshByName("voltaic_world_beam")?.isEnabled()).toBe(false);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("evicts the least-recently-touched remote beam at capacity", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    let now = 1;
    const renderer = new VoltaicEffectRenderer(scene, () => now);
    const color = new Color3(1, 0.7, 0.1);

    try {
      for (let index = 0; index < 32; index++) {
        now += 0.001;
        renderer.updateRemote(
          `enemy_${index}`,
          {
            start: new Vector3(index, 0, 0),
            end: new Vector3(index, 0, 100),
            color,
            impactKind: "none",
          },
          Vector3.Forward(),
        );
      }
      now += 0.001;
      renderer.updateRemote(
        "enemy_32",
        {
          start: Vector3.Zero(),
          end: new Vector3(0, 0, 100),
          color,
          impactKind: "none",
        },
        Vector3.Forward(),
      );

      const keys = renderer.getDebugRemoteKeys();
      expect(keys).toHaveLength(32);
      expect(keys).not.toContain("enemy_0");
      expect(keys).toContain("enemy_1");
      expect(keys).toContain("enemy_32");
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});

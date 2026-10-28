import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { buildRailBeamTemplate, buildRailImpactTemplate } from "../rail/RailBeamGeometry";
import { RailEffectRenderer } from "../rail/RailEffectRenderer";
import type { RailEffectSample } from "../rail/RailProfiles";

function sampleAt(z: number, kind: RailEffectSample["impactKind"] = "world"): RailEffectSample {
  return {
    start: new Vector3(0, 0, 0),
    end: new Vector3(0, 0, z),
    color: new Color3(0.3, 0.6, 1.0),
    impactKind: kind,
    impactNormal: new Vector3(0, 0, -1),
  };
}

describe("Rail fixed topology", () => {
  it("builds bounded templates (glow + core + twin helix, and a 4-quad impact)", () => {
    const beam = buildRailBeamTemplate();
    const impact = buildRailImpactTemplate();

    // 2 straight strips (2 nodes → 4 verts each) + 2 helix strips (56 nodes → 112 verts each)
    expect(beam.vertexCount).toBe(232);
    expect(impact.vertexCount).toBe(16);
    // impact parts run 0..3 (terminal 0/1, muzzle 2/3)
    expect(Math.max(...Array.from(impact.positions).filter((_v, i) => i % 3 === 2))).toBe(3);

    for (const template of [beam, impact]) {
      expect(template.positions.length).toBe(template.vertexCount * 3);
      expect(template.uvs.length).toBe(template.vertexCount * 2);
      expect(Math.max(...template.indices)).toBeLessThan(template.vertexCount);
      expect(Array.from(template.positions).every(Number.isFinite)).toBe(true);
    }
  });
});

describe("RailEffectRenderer lifecycle", () => {
  it("spawns, renders, and expires one-shot rails without leaking meshes/materials", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    let now = 10;
    const renderer = new RailEffectRenderer(scene, () => now);
    const initialMeshCount = scene.meshes.length;
    const initialMaterialCount = scene.materials.length;
    const beam = scene.getMeshByName("rail_beam") as Mesh | null;
    const impact = scene.getMeshByName("rail_impact") as Mesh | null;

    try {
      expect(beam?.isEnabled()).toBe(false);
      expect(impact?.isEnabled()).toBe(false);

      await renderer.prewarm();
      expect(beam?.thinInstanceCount).toBe(0);
      expect(beam?.isEnabled()).toBe(false);

      renderer.fireRail(sampleAt(500));
      renderer.update(1 / 60);
      expect(renderer.getDebugCount()).toBe(1);
      expect(beam?.isEnabled()).toBe(true);
      expect(beam?.thinInstanceCount).toBe(1);
      expect(impact?.thinInstanceCount).toBe(1);
      // No per-shot allocation — everything rides the two retained templates.
      expect(scene.meshes).toHaveLength(initialMeshCount);
      expect(scene.materials).toHaveLength(initialMaterialCount);

      // Past the fade window the slot is reclaimed and the meshes go quiet.
      now += 1;
      renderer.update(1 / 60);
      expect(renderer.getDebugCount()).toBe(0);
      expect(beam?.isEnabled()).toBe(false);
      expect(impact?.isEnabled()).toBe(false);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("caps concurrent rails at capacity, recycling the oldest", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    let now = 1;
    const renderer = new RailEffectRenderer(scene, () => now, 3);

    try {
      for (let i = 0; i < 5; i++) {
        now += 0.001; // all within the fade window, so none expire
        renderer.fireRail(sampleAt(200 + i));
      }
      renderer.update(1 / 60);
      expect(renderer.getDebugCount()).toBe(3);
      expect((scene.getMeshByName("rail_beam") as Mesh | null)?.thinInstanceCount).toBe(3);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("keeps a following rail's start on the muzzle, and leaves other rails where they were fired", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    const renderer = new RailEffectRenderer(scene, () => 1);
    const muzzle = new Vector3(1, 2, 3);

    try {
      renderer.fireRail(sampleAt(300));
      renderer.fireRail(sampleAt(400), undefined, () => muzzle);
      muzzle.set(4, 5, 6);
      renderer.refreshFollowedStarts();
      const starts = (renderer as unknown as { startSeed: Float32Array }).startSeed;
      expect(Array.from(starts.slice(0, 3))).toEqual([0, 0, 0]);
      expect(Array.from(starts.slice(4, 7))).toEqual([4, 5, 6]);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("clear() removes all live rails and disables the meshes", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 10, -20), scene);
    const now = 5;
    const renderer = new RailEffectRenderer(scene, () => now);

    try {
      renderer.fireRail(sampleAt(300));
      renderer.fireRail(sampleAt(400, "player"));
      renderer.update(1 / 60);
      expect(renderer.getDebugCount()).toBe(2);

      renderer.clear();
      expect(renderer.getDebugCount()).toBe(0);
      expect(scene.getMeshByName("rail_beam")?.isEnabled()).toBe(false);
      expect(scene.getMeshByName("rail_impact")?.isEnabled()).toBe(false);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});

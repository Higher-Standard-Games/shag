/**
 * Projectile trails (NullEngine). The ribbon is rebuilt in place every frame;
 * its edges must stay exactly where the camera-facing taper puts them, and
 * every shot of a type draws its trail with one shared material.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEntityRegistry } from "../../shared/entities";
import { getMD3Loader, type MD3LoadResult } from "../loader/model/MD3Loader";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { getExplosionEffect } from "../weapon/ExplosionEffect";
import { ProjectileManager } from "../weapon/ProjectileManager";

const ribbons = vi.hoisted(() => [] as number[][][]);

vi.mock("../weapon/EffectGeometry", async (original) => {
  const actual = await original<typeof import("../weapon/EffectGeometry")>();
  return {
    ...actual,
    updateUnlitTrailRibbon: (mesh: never, pathA: Vector3[], pathB: Vector3[]) => {
      ribbons.push([...pathA, ...pathB].map((v) => [v.x, v.y, v.z]));
      actual.updateUnlitTrailRibbon(mesh, pathA, pathB);
    },
  };
});

let engine: NullEngine;
let scene: Scene;
let manager: ProjectileManager;
let now = 0;
let shots = 0;

interface TrailState {
  id: string;
  node: TransformNode;
  trailPoints: Vector3[];
  trailMaterial: StandardMaterial | null;
}

function loadedModel(): MD3LoadResult {
  const root = new TransformNode("md3_rocket", scene);
  const mesh = MeshBuilder.CreateBox("rocket_rocket", { size: 4 }, scene);
  mesh.material = new StandardMaterial("rocket_rocket", scene);
  mesh.parent = root;
  return {
    root,
    meshes: [mesh],
    model: {} as MD3LoadResult["model"],
    currentFrame: 0,
    setFrame: () => {},
    getTag: () => null,
  };
}

const fire = (direction = new Vector3(0, 0, 1)) =>
  manager.spawn("rocket", Vector3.Zero(), direction, { isServerDriven: true, serverEntityId: `p_${++shots}` });

const stateOf = (id: string | null) =>
  (manager as unknown as { projectiles: TrailState[] }).projectiles.find((p) => p.id === id) as TrailState;

const tick = () => {
  now += 16;
  scene.onBeforeRenderObservable.notifyObservers(scene);
};

/** The ribbon edges as the allocating original computed them: [A, B] and the crossing [C, D]. */
function reference(points: Vector3[], cameraPos: Vector3): [number[][], number[][]] {
  const width = 6.0;
  const arc = [0];
  for (let i = 1; i < points.length; i++) arc[i] = arc[i - 1] + Vector3.Distance(points[i], points[i - 1]);
  const total = arc[points.length - 1];
  const a: Vector3[] = [];
  const b: Vector3[] = [];
  const c: Vector3[] = [];
  const d: Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const tangent = (i < points.length - 1 ? points[i + 1].subtract(p) : p.subtract(points[i - 1])).normalize();
    let perp = Vector3.Cross(tangent, cameraPos.subtract(p));
    if (perp.lengthSquared() < 0.001) perp = Vector3.Cross(tangent, Vector3.Up());
    if (perp.lengthSquared() < 0.001) perp = Vector3.Cross(tangent, Vector3.Forward());
    perp.normalize();
    const w = width * (total > 0.001 ? arc[i] / total : 0);
    const cross = Vector3.Cross(tangent, perp).normalize();
    a.push(p.add(perp.scale(w)));
    b.push(p.subtract(perp.scale(w)));
    c.push(p.add(cross.scale(w)));
    d.push(p.subtract(cross.scale(w)));
  }
  const flat = (vs: Vector3[]) => vs.map((v) => [v.x, v.y, v.z]);
  return [flat([...a, ...b]), flat([...c, ...d])];
}

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  now = 0;
  ribbons.length = 0;
  (ProjectileManager as unknown as { instance?: ProjectileManager }).instance = undefined;
  manager = ProjectileManager.getInstance();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(getExplosionEffect(), "init").mockImplementation(() => {});
  vi.spyOn(getExplosionEffect(), "update").mockImplementation(() => {});
  vi.spyOn(getEntityRegistry(), "get").mockReturnValue({
    id: "rocket",
    modelPath: "models/objects/projectile/rlauncher/rocket_strong.md3",
    speed: 1814,
    lifetime: 10,
    trailEffect: "rocket_trail",
  } as never);
  vi.spyOn(PK3Loader.getInstance(), "getFile").mockResolvedValue(new ArrayBuffer(8));
  vi.spyOn(PK3Loader.getInstance(), "hasFile").mockReturnValue(false);
  vi.spyOn(getMD3Loader(), "parseMD3").mockReturnValue({} as never);
  vi.spyOn(getMD3Loader(), "createMeshes").mockImplementation(() => loadedModel());
  vi.spyOn(engine, "getDeltaTime").mockReturnValue(16);
  manager.init(scene);
  scene.activeCamera = new FreeCamera("eye", new Vector3(140, 60, -90), scene);
});

afterEach(() => {
  manager.clear();
  (ProjectileManager as unknown as { instance?: ProjectileManager }).instance = undefined;
  engine.dispose();
  vi.restoreAllMocks();
});

describe("projectile trails", () => {
  it("places the ribbon edges where the camera-facing taper puts them, frame after frame", async () => {
    await manager.preloadModel("rocket");
    const shot = stateOf(fire(new Vector3(0.3, 0.1, 1).normalize()));
    const eye = (scene.activeCamera as FreeCamera).globalPosition;
    for (let frame = 0; frame < 70; frame++) {
      // A curving flight, with the odd stationary frame.
      if (frame % 9 !== 4) shot.node.position.addInPlace(new Vector3(Math.sin(frame / 7) * 9, frame % 5, 20));
      const before = ribbons.length;
      tick();
      if (ribbons.length === before) continue;
      const [ab, cd] = reference(shot.trailPoints, eye);
      for (const [actual, expected] of [
        [ribbons[ribbons.length - 2], ab],
        [ribbons[ribbons.length - 1], cd],
      ]) {
        expect(actual).toHaveLength(expected.length);
        for (let i = 0; i < expected.length; i++)
          for (let k = 0; k < 3; k++) expect(actual[i][k]).toBeCloseTo(expected[i][k], 6);
      }
    }
    expect(ribbons.length).toBeGreaterThan(120);
    expect(shot.trailPoints).toHaveLength(60);
  });

  it("draws every trail of a type with one material that outlives each shot", async () => {
    await manager.preloadModel("rocket");
    const first = fire();
    const second = fire();
    tick();
    // Compared by id: a failing match on Babylon objects prints the whole scene.
    const material = stateOf(first).trailMaterial;
    expect(material).not.toBeNull();
    expect(stateOf(second).trailMaterial?.uniqueId).toBe(material?.uniqueId);

    manager.despawn(first as string);
    expect(scene.materials.includes(material as StandardMaterial)).toBe(true);
    tick();
    expect(stateOf(second).trailMaterial?.uniqueId).toBe(material?.uniqueId);

    manager.clear();
    expect(scene.materials.includes(material as StandardMaterial)).toBe(false);
  });
});

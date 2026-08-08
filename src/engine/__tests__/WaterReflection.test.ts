/**
 * Planar reflection.
 *
 * The budget is the design: ONE mirror for the whole map, at the height of its
 * largest pool. Each one is a full pass over the world, and a reflection is
 * the least load-bearing thing the surface does — so a map with pools on three
 * floors reflects on the biggest and shows the flat sky colour on the rest.
 *
 * The exclusions matter as much as they do for the refraction capture: a
 * mirror that can see the water reflects the water reflecting the water.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WaterReflection } from "../rendering/water/WaterReflection";
import { EXCLUDE_FROM_WATER_CAPTURE } from "../rendering/water/WaterSceneCapture";

let engine: NullEngine;
let scene: Scene;
let reflection: WaterReflection;
let camera: FreeCamera;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera("eye", new Vector3(0, 0, 0), scene);
  reflection = new WaterReflection(scene);
});

afterEach(() => {
  reflection.dispose();
  scene.dispose();
  engine.dispose();
});

/** A liquid surface of a given footprint, centred at a given height. */
function pool(name: string, width: number, depth: number, y: number): AbstractMesh {
  const mesh = CreateBox(name, { width, depth, height: 2 }, scene);
  mesh.position.set(0, y, 0);
  mesh.metadata = { liquidKind: "water" };
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();
  return mesh;
}

describe("choosing which pool reflects", () => {
  it("picks the one with the largest footprint", () => {
    // Area, because area is what decides how much of the screen the reflection
    // can ever occupy — and it needs no knowledge of the map.
    const small = pool("small", 50, 50, 300);
    const big = pool("big", 400, 400, 100);

    const y = WaterReflection.choosePlaneY([small, big]);

    expect(y).toBeCloseTo(big.getBoundingInfo().boundingBox.maximumWorld.y, 3);
  });

  it("reflects the TOP of the volume, not its middle", () => {
    // A liquid brush is a box. The surface a player sees is its lid.
    const surface = pool("pool", 200, 200, 100);
    const box = surface.getBoundingInfo().boundingBox;

    const y = WaterReflection.choosePlaneY([surface]);

    expect(y).toBe(box.maximumWorld.y);
    expect(y).toBeGreaterThan(100);
  });

  it("returns null when there is nothing to reflect", () => {
    expect(WaterReflection.choosePlaneY([])).toBeNull();
  });
});

describe("what appears in the reflection", () => {
  const captured = (): AbstractMesh[] => {
    const mirror = reflection.textureFor(camera, 100);
    if (!mirror) return [];
    const predicate = mirror.renderListPredicate;
    return scene.meshes.filter((m) => predicate(m));
  };

  it("includes the room", () => {
    const wall = CreateBox("wall", { size: 1 }, scene);

    expect(captured()).toContain(wall);
  });

  it("excludes liquid, so the mirror cannot see itself", () => {
    const surface = pool("pool", 200, 200, 100);

    expect(captured()).not.toContain(surface);
  });

  it("excludes splash spray", () => {
    // Spray sits above the surface; reflected, it would hang under the pool.
    const spray = CreateBox("spray", { size: 1 }, scene);
    spray.metadata = { [EXCLUDE_FROM_WATER_CAPTURE]: true };

    expect(captured()).not.toContain(spray);
  });

  it("excludes the viewmodel", () => {
    const gun = CreateBox("viewmodel", { size: 1 }, scene);
    gun.layerMask = 0x10000000;

    expect(captured()).not.toContain(gun);
  });
});

describe("ownership", () => {
  it("registers exactly one target", () => {
    reflection.textureFor(camera, 100);
    reflection.textureFor(camera, 100);

    expect(scene.customRenderTargets.length).toBe(1);
  });

  it("reuses the mirror while the plane is unchanged", () => {
    expect(reflection.textureFor(camera, 100)).toBe(reflection.textureFor(camera, 100));
  });

  it("rebuilds when the plane moves", () => {
    // A different map, with its water at a different height.
    const first = reflection.textureFor(camera, 100);
    const second = reflection.textureFor(camera, 250);

    expect(second).not.toBe(first);
    expect(reflection.reflectedY).toBe(250);
    expect(scene.customRenderTargets.length).toBe(1);
  });

  it("follows the active camera without rebuilding", () => {
    const first = reflection.textureFor(camera, 100);
    const second = reflection.textureFor(new FreeCamera("spectate", new Vector3(0, 0, 0), scene), 100);

    expect(second).toBe(first);
    expect(scene.customRenderTargets.length).toBe(1);
  });

  it("removes its target on dispose", () => {
    const mirror = reflection.textureFor(camera, 100);
    expect(scene.customRenderTargets).toContain(mirror);

    reflection.dispose();

    expect(scene.customRenderTargets).not.toContain(mirror);
    expect(reflection.reflectedY).toBeNull();
  });

  it("does not stack targets across repeated tier changes", () => {
    for (let i = 0; i < 10; i++) {
      reflection.textureFor(camera, 100);
      reflection.dispose();
    }
    reflection.textureFor(camera, 100);

    expect(scene.customRenderTargets.length).toBe(1);
  });

  it("is idempotent", () => {
    reflection.textureFor(camera, 100);
    reflection.dispose();

    expect(() => reflection.dispose()).not.toThrow();
  });
});

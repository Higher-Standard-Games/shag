/**
 * Explosions build from shapes made once per scene (NullEngine). A ray is the
 * unit cone scaled to its size, which must match the cylinder it replaces, and
 * every fireball animates vertices of its own.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExplosionEffect, ROCKET_EXPLOSION } from "../weapon/ExplosionEffect";
import { getPointLightPool } from "../weapon/PointLightPool";

let engine: NullEngine;
let scene: Scene;
let now = 0;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  now = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(getPointLightPool(), "acquire").mockReturnValue(null);
  vi.spyOn(getPointLightPool(), "release").mockImplementation(() => {});
  Object.assign(getExplosionEffect() as object, { scene, particleTexture: null });
});

afterEach(() => {
  getExplosionEffect().clear();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

const positions = (mesh: Mesh) => Array.from(mesh.getVerticesData(VertexBuffer.PositionKind) ?? []);

describe("explosion shapes", () => {
  it("draws each ray as the cylinder it replaces, sharing one geometry", () => {
    getExplosionEffect().spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    const rays = scene.meshes.filter((m) => /_ray_\d+$/.test(m.name)) as Mesh[];
    expect(rays.length).toBeGreaterThan(0);
    expect(new Set(rays.map((ray) => ray.geometry)).size).toBe(1);

    // With Math.random at 0.5 every ray has the same length and width.
    const scale = ROCKET_EXPLOSION.scale;
    const reference = MeshBuilder.CreateCylinder(
      "reference",
      { height: 3.5 * scale, diameterTop: 0, diameterBottom: 0.45 * scale, tessellation: 6 },
      scene,
    );
    const expected = positions(reference);
    // Undo the start-small factor to compare the ray's full size.
    const size = rays[0].scaling.scale(10);
    const unit = positions(rays[0]);
    expect(unit).toHaveLength(expected.length);
    for (let i = 0; i < unit.length; i += 3) {
      expect(unit[i] * size.x).toBeCloseTo(expected[i], 3);
      expect(unit[i + 1] * size.y).toBeCloseTo(expected[i + 1], 3);
      expect(unit[i + 2] * size.z).toBeCloseTo(expected[i + 2], 3);
    }
  });

  it("starts every fireball from the same spiky shape, in a buffer of its own", () => {
    const effect = getExplosionEffect();
    effect.spawn(Vector3.Zero(), ROCKET_EXPLOSION);
    now = 100;
    effect.update(0.1); // The first fireball's vertices move.
    effect.spawn(new Vector3(50, 0, 0), ROCKET_EXPLOSION);
    const [first, second] = scene.meshes.filter((m) => m.name.endsWith("_fireball")) as Mesh[];

    expect(first.geometry).not.toBe(second.geometry);
    expect(positions(first)).not.toEqual(positions(second));

    // The original built and deformed a fresh icosphere for every explosion.
    const sphere = MeshBuilder.CreateIcoSphere(
      "reference",
      { radius: 2.5 * ROCKET_EXPLOSION.scale, subdivisions: 3, flat: true },
      scene,
    );
    const raw = positions(sphere);
    const fresh = positions(second);
    expect(fresh).toHaveLength(raw.length);
    for (let i = 0; i < raw.length; i += 3) {
      const [x, y, z] = [raw[i], raw[i + 1], raw[i + 2]];
      const dist = Math.sqrt(x * x + y * y + z * z);
      const [nx, ny, nz] = [x / dist, y / dist, z / dist];
      const a1 = Math.atan2(ny, nx);
      const a2 = Math.acos(nz / dist);
      const spike = 1 + (0.5 + 0.5 * Math.sin(a1 * 7.3 + a2 * 5.1) * Math.cos(a1 * 3.7 - a2 * 8.9)) * 0.8;
      expect(fresh[i]).toBeCloseTo(nx * dist * spike, 4);
      expect(fresh[i + 1]).toBeCloseTo(ny * dist * spike, 4);
      expect(fresh[i + 2]).toBeCloseTo(nz * dist * spike, 4);
    }
  });
});

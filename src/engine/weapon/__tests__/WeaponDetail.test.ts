/**
 * A weapon's small parts stop drawing past their detail distances (NullEngine):
 * fine parts sooner than glow strips; its body never.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dropDistantWeaponDetail, WEAPON_FINE_DETAIL_DISTANCE, WEAPON_STRIP_DETAIL_DISTANCE } from "../WeaponDetail";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

const part = (material: string) => {
  const mesh = CreateBox(material, {}, scene);
  mesh.material = new StandardMaterial(`models/weapons/plasmagun/${material}`, scene);
  return mesh;
};

describe("weapon detail at range", () => {
  it("drops sights, displays, glass and halos first, glow and emit strips further out, and keeps the body and barrel", () => {
    const fine = ["sight_small_1", "sight_display", "lasergun_glass", "plasmagun_barrel_halo"].map(part);
    const strips = ["plasmagun_emit", "electrobolt_glow"].map(part);
    const kept = ["plasmagun", "plasmagun_barrel", "plasmagun_barrel_plasma"].map(part);
    expect(dropDistantWeaponDetail([...fine, ...strips, ...kept])).toBe(fine.length + strips.length);

    const camera = new FreeCamera("eye", Vector3.Zero(), scene);
    const at = (distance: number) => {
      camera.position.z = -distance;
      camera.computeWorldMatrix();
    };
    const drawn = (meshes: typeof kept) => meshes.map((mesh) => mesh.getLOD(camera) === mesh);
    at(WEAPON_FINE_DETAIL_DISTANCE - 50);
    expect([...drawn(fine), ...drawn(strips)].every(Boolean)).toBe(true);
    at(WEAPON_FINE_DETAIL_DISTANCE + 50);
    expect(drawn(fine).some(Boolean)).toBe(false);
    expect(drawn(strips).every(Boolean)).toBe(true);
    at(WEAPON_STRIP_DETAIL_DISTANCE + 50);
    expect(drawn(strips).some(Boolean)).toBe(false);
    expect(drawn(kept).every(Boolean)).toBe(true);
  });

  it("sets a part once however often it is applied", () => {
    const sight = part("sight_small");
    dropDistantWeaponDetail([sight]);
    expect(dropDistantWeaponDetail([sight])).toBe(0);
    expect(sight.getLODLevels()).toHaveLength(1);
  });
});

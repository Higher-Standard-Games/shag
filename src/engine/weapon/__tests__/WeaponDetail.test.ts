/**
 * A weapon's small parts stop drawing past the detail distance (NullEngine);
 * its body does not.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dropDistantWeaponDetail, WEAPON_DETAIL_DISTANCE } from "../WeaponDetail";

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
  it("drops sights, displays, glow, emit, glass and halos past the distance and keeps the body and barrel", () => {
    const small = [
      "sight_small_1",
      "sight_display",
      "plasmagun_emit",
      "electrobolt_glow",
      "lasergun_glass",
      "plasmagun_barrel_halo",
    ].map(part);
    const kept = ["plasmagun", "plasmagun_barrel", "plasmagun_barrel_plasma"].map(part);
    expect(dropDistantWeaponDetail([...small, ...kept])).toBe(small.length);

    const camera = new FreeCamera("eye", new Vector3(0, 0, -(WEAPON_DETAIL_DISTANCE - 50)), scene);
    camera.computeWorldMatrix();
    for (const mesh of small) expect(mesh.getLOD(camera)).toBe(mesh);
    camera.position.z = -(WEAPON_DETAIL_DISTANCE + 50);
    camera.computeWorldMatrix();
    for (const mesh of small) expect(mesh.getLOD(camera)).toBeNull();
    for (const mesh of kept) expect(mesh.getLOD(camera)).toBe(mesh);
  });

  it("sets a part once however often it is applied", () => {
    const sight = part("sight_small");
    dropDistantWeaponDetail([sight]);
    expect(dropDistantWeaponDetail([sight])).toBe(0);
    expect(sight.getLODLevels()).toHaveLength(1);
  });
});

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { PLAYER_POSE_BOUNDS, type PlayerModelInstance, PlayerModelManager } from "../animation/PlayerModelManager";

/** vanguard.glb's shape: an empty scaled root over a rotated, offset geometry part. */
function makeInstance(scene: Scene): { instance: PlayerModelInstance; part: Mesh } {
  const anchor = new TransformNode("anchor", scene);
  const mesh = new Mesh("__root__", scene);
  mesh.parent = anchor;
  mesh.scaling.setAll(36);
  mesh.alwaysSelectAsActiveMesh = true;
  const part = CreateBox("vanguard_Mesh", { size: 0.2 }, scene);
  part.parent = mesh;
  part.rotation.set(-Math.PI / 2, 0.3, 0);
  part.position.set(0.05, 0.9, -0.02);
  part.alwaysSelectAsActiveMesh = true;
  const instance: PlayerModelInstance = {
    id: "test",
    anchor,
    mesh,
    skeleton: null,
    anims: [],
    masterGroup: null,
    currentAnim: "",
    oneshotUntil: 0,
  };
  return { instance, part };
}

/** Points on the pose cylinder's rim, top and bottom, in anchor space. */
function cylinderPoints(): Vector3[] {
  const { radius, minY, maxY } = PLAYER_POSE_BOUNDS;
  const points: Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    for (const y of [minY, maxY]) points.push(new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  return points;
}

describe("PlayerModelManager.useConservativeBounds", () => {
  it("bounds every pose wherever the anchor moves or turns, and leaves culling on", () => {
    const scene = new Scene(new NullEngine());
    const manager = new PlayerModelManager(scene);
    const { instance, part } = makeInstance(scene);
    instance.anchor.position.set(100, 20, -50);
    instance.anchor.rotation.y = 0.7;
    manager.useConservativeBounds(instance);
    expect(part.alwaysSelectAsActiveMesh).toBe(false);
    // The empty root has no geometry to bound.
    expect(instance.mesh.alwaysSelectAsActiveMesh).toBe(true);

    for (const [x, y, z, yaw] of [
      [100, 20, -50, 0.7],
      [-900, 300, 1200, 0],
      [5, -40, 5, 2.4],
      [0, 0, 0, -1.9],
    ]) {
      instance.anchor.position.set(x, y, z);
      instance.anchor.rotation.y = yaw;
      instance.anchor.computeWorldMatrix(true);
      part.computeWorldMatrix(true);
      const box = part.getBoundingInfo().boundingBox;
      const anchorWorld = instance.anchor.getWorldMatrix();
      for (const point of cylinderPoints()) {
        const world = Vector3.TransformCoordinates(point, anchorWorld);
        for (const axis of ["x", "y", "z"] as const) {
          expect(world[axis]).toBeGreaterThanOrEqual(box.minimumWorld[axis] - 1e-3);
          expect(world[axis]).toBeLessThanOrEqual(box.maximumWorld[axis] + 1e-3);
        }
      }
    }
  });

  it("goes back to always-selected for poses that leave the anchor", () => {
    const scene = new Scene(new NullEngine());
    const manager = new PlayerModelManager(scene);
    const { instance, part } = makeInstance(scene);
    manager.useConservativeBounds(instance);
    manager.selectAlways(instance);
    expect(part.alwaysSelectAsActiveMesh).toBe(true);
  });
});

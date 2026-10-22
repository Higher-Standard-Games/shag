import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { ProjectileManager } from "../weapon/ProjectileManager";

const statics = ProjectileManager as unknown as {
  faceAlong(node: TransformNode, dir: Vector3): void;
  solidByName(mesh: { name: string; metadata?: { textureName?: string } }): boolean;
};

/** The orientation as it was built before, allocating fresh quaternions. */
function previousFacing(dir: Vector3): Quaternion {
  const fwd = new Vector3(0, 0, 1);
  const dot = Vector3.Dot(fwd, dir);
  let q: Quaternion;
  if (dot > 0.9999) q = Quaternion.Identity();
  else if (dot < -0.9999) q = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
  else q = Quaternion.RotationAxis(Vector3.Cross(fwd, dir).normalize(), Math.acos(dot));
  return q.multiply(Quaternion.RotationAxis(Vector3.Up(), -Math.PI / 2));
}

it("faces a grenade along its arc exactly as before, reusing one quaternion", () => {
  const scene = new Scene(new NullEngine());
  const node = new TransformNode("grenade", scene);
  const dirs = [
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
    new Vector3(1, 0.5, 0.2),
    new Vector3(-0.3, -1, 0.7),
    new Vector3(0, 1, 0),
  ];
  statics.faceAlong(node, dirs[0]);
  const reused = node.rotationQuaternion;
  for (const raw of dirs) {
    const dir = raw.normalizeToNew();
    statics.faceAlong(node, dir);
    expect(node.rotationQuaternion).toBe(reused);
    const want = previousFacing(dir);
    for (const k of ["x", "y", "z", "w"] as const) expect(node.rotationQuaternion?.[k]).toBeCloseTo(want[k], 10);
  }
  scene.dispose();
});

it("remembers which meshes are effects by name, and notices a rename", () => {
  const mesh = { name: "wall_01", metadata: { textureName: "textures/base_wall/concrete" } };
  expect(statics.solidByName(mesh)).toBe(true);
  expect(statics.solidByName({ name: "Flare_3" })).toBe(false);
  expect(statics.solidByName({ name: "x", metadata: { textureName: "sfx/beam" } })).toBe(false);
  mesh.name = "proj_rocket";
  expect(statics.solidByName(mesh)).toBe(false);
  mesh.name = "wall_01";
  mesh.metadata.textureName = "Lights/strip";
  expect(statics.solidByName(mesh)).toBe(false);
});

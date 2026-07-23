import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { describe, expect, it } from "vitest";
import { collectModelAttachmentPoints } from "../ModelLoader";

function node(
  name: string,
  position: Vector3,
  rotation = Vector3.Zero(),
  rotationQuaternion: Quaternion | null = null,
): TransformNode {
  return { name, position, rotation, rotationQuaternion } as TransformNode;
}

describe("collectModelAttachmentPoints", () => {
  it("retains authored tag transforms while ignoring ordinary nodes", () => {
    const position = new Vector3(14.17, 6, 2.1);
    const rotation = new Vector3(0.1, 0.2, 0.3);
    const rotationQuaternion = Quaternion.FromEulerVector(rotation);

    const points = collectModelAttachmentPoints([
      node("tag_barrel2", position, rotation, rotationQuaternion),
      node("pg_grip_lp", Vector3.Zero()),
    ]);

    expect(Object.keys(points)).toEqual(["tag_barrel2"]);
    expect(points.tag_barrel2.position.asArray()).toEqual(position.asArray());
    expect(points.tag_barrel2.rotation.asArray()).toEqual(rotation.asArray());
    expect(points.tag_barrel2.rotationQuaternion).toEqual({
      x: rotationQuaternion.x,
      y: rotationQuaternion.y,
      z: rotationQuaternion.z,
      w: rotationQuaternion.w,
    });
  });

  it("copies vectors so cached attachment metadata cannot mutate the imported nodes", () => {
    const position = new Vector3(1, 2, 3);
    const rotation = new Vector3(4, 5, 6);
    const points = collectModelAttachmentPoints([node("tag_barrel", position, rotation)]);

    position.setAll(0);
    rotation.setAll(0);

    expect(points.tag_barrel.position.asArray()).toEqual([1, 2, 3]);
    expect(points.tag_barrel.rotation.asArray()).toEqual([4, 5, 6]);
    expect(points.tag_barrel.rotationQuaternion).toBeNull();
  });
});

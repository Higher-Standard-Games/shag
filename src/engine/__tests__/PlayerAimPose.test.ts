import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { PlayerAimPose } from "../animation/PlayerAimPose";
import type { PlayerModelInstance } from "../animation/PlayerModelManager";

it.each([1, -1])(
  "bends the hand with view pitch without moving hips or accumulating on paused frames (mirror %s)",
  (mirror) => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    try {
      const anchor = new TransformNode("anchor", scene);
      anchor.rotation.y = 0.7;
      const mesh = new Mesh("body", scene);
      mesh.parent = anchor;
      mesh.scaling.set(36 * mirror, 36, 36);
      const skeleton = new Skeleton("rig", "rig", scene);
      let parent: TransformNode = mesh;
      const nodes = ["mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2"].map((name) => {
        const node = new TransformNode(name, scene);
        node.parent = parent;
        node.rotationQuaternion = Quaternion.Identity();
        const bone = new Bone(name, skeleton);
        bone.linkTransformNode(node);
        parent = node;
        return node;
      });
      const pose = new PlayerAimPose({ anchor, mesh, skeleton } as PlayerModelInstance);
      pose.pitch = 0.8;
      const direction = () => Vector3.TransformNormal(Vector3.Forward(), parent.computeWorldMatrix(true)).normalize();
      pose.apply();
      const first = direction();
      expect(first.y).toBeCloseTo(-Math.sin(0.8), 5);
      for (let i = 0; i < 100; i++) {
        pose.restore();
        pose.apply();
      }
      expect(direction().equalsWithEpsilon(first, 1e-6)).toBe(true);
      expect(mesh.rotation.asArray()).toEqual([0, 0, 0]);
      pose.restore();
      expect(direction().y).toBeCloseTo(0, 6);
      // A newly evaluated clip takes precedence over the previous saved pose.
      pose.apply();
      nodes[0].rotationQuaternion!.copyFrom(Quaternion.RotationAxis(Vector3.Up(), 0.2));
      pose.restore();
      expect(nodes[0].rotationQuaternion!.y).toBeCloseTo(Math.sin(0.1));
    } finally {
      engine.dispose();
    }
  },
);

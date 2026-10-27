import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateSkeletonPreparation, gateSkinPreparation } from "../SkinPreparationGate";

describe("skin preparation gate", () => {
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

  /** A linked chain like a glTF rig: each bone driven by its own node. */
  const rig = (name: string, count = 6) => {
    const skeleton = new Skeleton(name, name, scene);
    const nodes: TransformNode[] = [];
    let parent: Bone | null = null;
    for (let i = 0; i < count; i++) {
      const bone: Bone = new Bone(`${name}_${i}`, skeleton, parent, Matrix.Translation(0, 1, 0));
      const node = new TransformNode(`${name}_node_${i}`, scene);
      node.position.set(0, 1, 0);
      node.rotationQuaternion = Quaternion.Identity();
      bone.linkTransformNode(node);
      nodes.push(node);
      parent = bone;
    }
    // The palette build itself, private in Babylon's typings
    const builds = vi.spyOn(
      skeleton as unknown as { _computeTransformMatrices: (target: Float32Array, pose: Matrix | null) => void },
      "_computeTransformMatrices",
    );
    return { skeleton, nodes, builds };
  };

  const frame = (...skeletons: Skeleton[]) => {
    scene.incrementRenderId();
    for (const skeleton of skeletons) skeleton.prepare();
  };

  it("rebuilds only when a linked value changes", () => {
    const { skeleton, nodes, builds } = rig("body");
    gateSkeletonPreparation(skeleton);
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(1);

    nodes[3].rotationQuaternion!.copyFrom(Quaternion.RotationAxis(Vector3.Right(), 0.4));
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(2);
    nodes[1].scaling.set(1, 1.0001, 1);
    frame(skeleton);
    nodes[5].position.z = 0.25;
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(4);
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(4);
  });

  it("produces the same palette as an ungated twin, frame by frame", () => {
    const gatedRig = rig("gated", 12);
    const plain = rig("plain", 12);
    gateSkeletonPreparation(gatedRig.skeleton);
    let seed = 7;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let f = 0; f < 200; f++) {
      // A pose step on roughly one frame in four, touching a few bones
      if (next() < 0.25) {
        for (let k = 0; k < 3; k++) {
          const bone = Math.floor(next() * 12);
          const rotation = Quaternion.FromEulerAngles(next() - 0.5, next() - 0.5, next() - 0.5);
          const offset = next() * 0.1;
          for (const { nodes } of [gatedRig, plain]) {
            nodes[bone].rotationQuaternion!.copyFrom(rotation);
            nodes[bone].position.x = offset;
          }
        }
      }
      frame(gatedRig.skeleton, plain.skeleton);
      expect(Array.from(gatedRig.skeleton.getTransformMatrices(null))).toEqual(
        Array.from(plain.skeleton.getTransformMatrices(null)),
      );
    }
    expect(gatedRig.builds.mock.calls.length).toBeLessThan(plain.builds.mock.calls.length / 2);
  });

  it("leaves a skeleton with an unlinked bone to Babylon, as a ragdoll unlinks its rig", () => {
    const { skeleton, builds } = rig("ragdoll");
    gateSkeletonPreparation(skeleton);
    frame(skeleton);
    for (const bone of skeleton.bones) bone.linkTransformNode(null);
    skeleton.bones[2].setRotationQuaternion(Quaternion.RotationAxis(Vector3.Up(), 0.3));
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(2);
    // Babylon's own check: nothing dirty, nothing rebuilt
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(2);
    skeleton.bones[4].setRotationQuaternion(Quaternion.RotationAxis(Vector3.Up(), 0.6));
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(3);
  });

  it("leaves a rig whose nodes use Euler rotation to Babylon", () => {
    const { skeleton, nodes, builds } = rig("euler");
    nodes[2].rotationQuaternion = null;
    gateSkeletonPreparation(skeleton);
    frame(skeleton);
    frame(skeleton);
    expect(builds).toHaveBeenCalledTimes(2);
  });

  it("answers a forced prepare from the last palette when nothing changed", () => {
    const { skeleton, builds } = rig("forced");
    gateSkeletonPreparation(skeleton);
    frame(skeleton);
    const palette = Array.from(skeleton.getTransformMatrices(null));
    skeleton.prepare(true);
    expect(builds).toHaveBeenCalledTimes(1);
    expect(Array.from(skeleton.getTransformMatrices(null))).toEqual(palette);
  });

  it("gates skeletons the scene already has and those added later", async () => {
    const early = rig("early");
    gateSkinPreparation(scene);
    const late = rig("late");
    // Babylon announces a new skeleton on the next tick
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame(early.skeleton, late.skeleton);
    frame(early.skeleton, late.skeleton);
    expect(early.builds).toHaveBeenCalledTimes(1);
    expect(late.builds).toHaveBeenCalledTimes(1);
  });
});

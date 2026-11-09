import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Animations/animatable";
import { expect, it } from "vitest";
import { measurePlayerModelFit } from "../animation/PlayerModelFit";

it("calibrates standing height and feet while preserving geometry and the source pose", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const mesh = CreateBox("body", { height: 2 }, scene);
    mesh.position.y = 3;
    const skeleton = new Skeleton("rig", "rig", scene);
    mesh.skeleton = skeleton;
    const hips = new TransformNode("mixamorig:Hips", scene),
      head = new TransformNode("mixamorig:Head", scene);
    head.parent = hips;
    head.position.y = 1;
    hips.rotationQuaternion = Quaternion.Identity();
    const hipBone = new Bone(hips.name, skeleton, null, Matrix.Identity());
    hipBone.linkTransformNode(hips);
    new Bone(head.name, skeleton, hipBone, Matrix.Translation(0, 1, 0)).linkTransformNode(head);
    mesh.setVerticesData("matricesIndices", new Float32Array(mesh.getTotalVertices() * 4));
    const weights = new Float32Array(mesh.getTotalVertices() * 4);
    for (let i = 0; i < mesh.getTotalVertices(); i++) weights[i * 4] = 1;
    mesh.setVerticesData("matricesWeights", weights);
    const idle = new AnimationGroup("idle", scene),
      rotation = new Animation("idle", "rotationQuaternion", 30, Animation.ANIMATIONTYPE_QUATERNION);
    rotation.setKeys([
      { frame: 0, value: Quaternion.Identity() },
      { frame: 30, value: Quaternion.Identity() },
    ]);
    idle.addTargetedAnimation(rotation, hips);
    const container = new AssetContainer(scene);
    container.meshes = [mesh];
    container.skeletons = [skeleton];
    container.animationGroups = [idle];
    const positions = [...mesh.getVerticesData("position")!];
    const originalRotation = Quaternion.RotationYawPitchRoll(0.2, 0.1, 0.3);
    hips.rotationQuaternion.copyFrom(originalRotation);
    const fit = measurePlayerModelFit(container, 64 / 36)!;
    expect(fit.scale).toBeCloseTo(64 / 36 / 2);
    expect(2 * fit.scale + fit.offsetY).toBeCloseTo(0);
    expect(4 * fit.scale + fit.offsetY).toBeCloseTo(64 / 36);
    expect([...mesh.getVerticesData("position")!]).toEqual(positions);
    expect(hips.rotationQuaternion?.equals(originalRotation)).toBe(true);
    expect(idle.isPlaying).toBe(false);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

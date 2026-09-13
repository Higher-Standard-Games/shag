import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayerModelManager } from "../animation/PlayerModelManager";

/** Real Babylon cloning and animation, with a small glTF-style linked skeleton. */
describe("player model instance isolation", () => {
  let engine: NullEngine;
  let scene: Scene;
  let manager: PlayerModelManager;
  let hips: TransformNode;
  let container: AssetContainer;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    manager = new PlayerModelManager(scene);
    const mesh = new Mesh("__root__", scene);
    const root = new TransformNode("RootNode", scene);
    root.parent = mesh;
    hips = new TransformNode("mixamorig:Hips", scene);
    hips.parent = root;
    hips.position.y = 1.061;
    const spine = new TransformNode("mixamorig:Spine", scene);
    spine.parent = hips;
    spine.position.y = 0.1;
    const skeleton = new Skeleton("source", "source", scene);
    const hipBone = new Bone("mixamorig:Hips", skeleton, null, Matrix.Translation(0, 1.061, 0));
    hipBone.linkTransformNode(hips);
    const spineBone = new Bone("mixamorig:Spine", skeleton, hipBone);
    spineBone.linkTransformNode(spine);
    mesh.skeleton = skeleton;
    const animation = new Animation("lean", "rotation.x", 30, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    container = new AssetContainer(scene);
    container.meshes = [mesh];
    container.transformNodes = mesh.getChildTransformNodes(false);
    container.skeletons = [skeleton];
    const group = new AnimationGroup("lean", scene);
    group.addTargetedAnimation(animation, spine);
    container.animationGroups = [group];
    // Only substitute asset loading; all instance/animation behavior is production code.
    Object.assign(manager, { sourceContainer: container });
  });

  afterEach(() => {
    manager.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("links every cloned bone to its own mesh hierarchy", () => {
    const a = manager.createInstance("a")!;
    const b = manager.createInstance("b")!;
    for (let i = 0; i < a.skeleton!.bones.length; i++) {
      const aNode = a.skeleton!.bones[i].getTransformNode()!;
      const bNode = b.skeleton!.bones[i].getTransformNode()!;
      expect(aNode.isDescendantOf(a.mesh)).toBe(true);
      expect(bNode.isDescendantOf(b.mesh)).toBe(true);
      expect(aNode).not.toBe(bNode);
    }
    expect(a.skeleton!.bones[0].getTransformNode()).toBe(a.hipsBind!.node);
  });

  it("playing and pausing one player's clip cannot change another player's pose", () => {
    const a = manager.createInstance("a")!;
    const b = manager.createInstance("b")!;
    manager.playAnimation(a, "lean");
    a.masterGroup!.goToFrame(30);
    const aSpine = a.skeleton!.bones[1].getTransformNode()!;
    const bSpine = b.skeleton!.bones[1].getTransformNode()!;
    expect(aSpine.rotation.x).toBeCloseTo(1);
    expect(bSpine.rotation.x).toBe(0);
    manager.playAnimation(b, "lean");
    b.masterGroup!.goToFrame(0);
    manager.setAnimationActive(b, false);
    expect(aSpine.rotation.x).toBeCloseTo(1);
    expect(a.masterGroup!.isPlaying).toBe(true);
    manager.disposeInstance(b);
    expect(aSpine.isDisposed()).toBe(false);
  });

  it("the root-motion guard resets the node that actually drives the skeleton", () => {
    const a = manager.createInstance("a")!;
    const drivenHips = a.skeleton!.bones[0].getTransformNode()!;
    drivenHips.position.set(1.426, 1.8, 2.292);
    manager.resetRootMotion(a);
    expect(drivenHips.position.asArray()).toEqual([0, 1.061, 0]);
    expect(hips.position.asArray()).toEqual([0, 1.061, 0]);
  });

  it("a late joiner starts from the source pose, not an existing player's animation", () => {
    const a = manager.createInstance("a")!;
    manager.playAnimation(a, "lean");
    a.masterGroup!.goToFrame(30);
    const b = manager.createInstance("late-joiner")!;
    expect(b.skeleton!.bones[1].getTransformNode()!.rotation.x).toBe(0);
    expect(a.skeleton!.bones[1].getTransformNode()!.rotation.x).toBeCloseTo(1);
    expect(a.masterGroup!.isPlaying).toBe(true);
  });

  it("preserves joint offsets beneath RootNode", () => {
    const a = manager.createInstance("a")!;
    const spine = a.skeleton!.bones[1].getTransformNode()!;
    expect(spine.name).not.toContain("RootNode");
    manager.resetRootMotion(a);
    expect(spine.position.y).toBeCloseTo(0.1);
  });

  it("preserves nonzero channel counts and rejects targets outside the container", () => {
    const a = manager.createInstance("a")!;
    expect(a.anims).toHaveLength(container.animationGroups.length);
    expect(a.anims[0].animations).toHaveLength(container.animationGroups[0].targetedAnimations.length);
    expect(a.anims[0].animations.length).toBeGreaterThan(0);
    const foreign = new TransformNode("foreign", scene);
    container.animationGroups[0].targetedAnimations[0].target = foreign;
    const meshCount = scene.meshes.length;
    const skeletonCount = scene.skeletons.length;
    expect(() => manager.createInstance("invalid")).toThrow("Unmapped player animation target");
    expect(scene.meshes).toHaveLength(meshCount);
    expect(scene.skeletons).toHaveLength(skeletonCount);
  });
});

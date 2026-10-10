import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import savedRecipe from "../../../benchmarks/recipes/player-crowd-v1.json";
import { PlayerModelManager } from "../animation/PlayerModelManager";
import { CrowdActors, crowdSchedule, validateCrowdRecipe } from "../rendering/CrowdBenchmark";

describe("fixed player crowd benchmark", () => {
  it("rejects invalid workloads and alternates the saved finite schedule without changing its recipe", () => {
    const recipe = structuredClone(savedRecipe);
    validateCrowdRecipe(recipe);
    const before = JSON.stringify(recipe),
      plan = crowdSchedule(recipe);
    expect(plan).toHaveLength(40);
    expect(plan.slice(0, 2)).toEqual([
      { repetition: 1, count: 0, outline: 1 },
      { repetition: 1, count: 0, outline: 0 },
    ]);
    expect(plan.slice(8, 10)).toEqual([
      { repetition: 2, count: 10, outline: 0 },
      { repetition: 2, count: 10, outline: 1 },
    ]);
    expect(JSON.stringify(recipe)).toBe(before);
    for (const change of [
      { counts: [11] },
      { counts: [5, 5] },
      { repeats: 0 },
      { outlines: [2] },
      { measuredFrames: 0 },
      { animation: { ...recipe.animation, poseHz: 29 } },
    ]) {
      expect(() => validateCrowdRecipe({ ...recipe, ...change })).toThrow("Invalid player crowd recipe");
    }
  });

  it("clones independent rigs, repeats the exact pose ticks, verifies active coverage, and retires all clones", () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      manager = new PlayerModelManager(scene);
    const mesh = CreateBox("body", { size: 1 }, scene);
    mesh.material = new StandardMaterial("bodyMaterial", scene);
    const hips = new TransformNode("mixamorig:Hips", scene);
    hips.parent = mesh;
    hips.position.y = 1;
    const skeleton = new Skeleton("rig", "rig", scene);
    const bone = new Bone("mixamorig:Hips", skeleton, null, Matrix.Translation(0, 1, 0));
    bone.linkTransformNode(hips);
    mesh.skeleton = skeleton;
    const curve = new Animation("pose", "rotation.x", 30, Animation.ANIMATIONTYPE_FLOAT);
    curve.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    const group = new AnimationGroup("run", scene);
    group.addTargetedAnimation(curve, hips);
    const container = new AssetContainer(scene);
    container.meshes = [mesh];
    container.transformNodes = [hips];
    container.skeletons = [skeleton];
    container.animationGroups = [group];
    container.materials = [mesh.material];
    container.removeAllFromScene();
    Object.assign(manager, { sourceContainer: container });
    const camera = new FreeCamera("camera", new Vector3(0, 100, -400), scene);
    camera.setTarget(new Vector3(0, 42, 70));
    camera.fov = Math.PI / 2;
    let actors: CrowdActors | undefined;
    try {
      const recipe = structuredClone(savedRecipe);
      validateCrowdRecipe(recipe);
      actors = new CrowdActors(manager, recipe);
      expect(actors.instances).toHaveLength(10);
      expect(new Set(actors.instances.map((i) => i.skeleton)).size).toBe(10);
      actors.configure(2, 1);
      const node = actors.instances[0].skeleton!.bones[0].getTransformNode()!;
      actors.pose(16);
      const first = node.rotation.x;
      actors.pose(17);
      expect(node.rotation.x).toBe(first); // 30 Hz, not another wall-clock pose.
      actors.pose(40);
      expect(node.rotation.x).not.toBe(first);
      actors.configure(0, 0);
      scene.render();
      expect(actors.coverage(scene)).toEqual({ actors: 0, bodyParts: 0 });
      actors.configure(2, 1);
      actors.pose(16);
      expect(node.rotation.x).toBeCloseTo(first);
      expect(actors.expectedDraws(2)).toBe(8);
      scene.render();
      expect(actors.coverage(scene)).toEqual({ actors: 2, bodyParts: 2 });
      actors.configure(10, 0);
      scene.render();
      expect(actors.coverage(scene)).toEqual({ actors: 10, bodyParts: 10 });
      expect(actors.expectedDraws(2)).toBe(12);
      expect(() => actors!.configure(7, 0)).toThrow("outside the saved recipe");
      const instances = [...actors.instances];
      actors.dispose();
      expect(instances.every((i) => i.mesh.isDisposed() && i.anchor.isDisposed())).toBe(true);
      expect(actors.inventory()).toEqual([]);
    } finally {
      actors?.dispose();
      manager.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});

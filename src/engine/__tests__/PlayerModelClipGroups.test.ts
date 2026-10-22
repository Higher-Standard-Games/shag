import { Animation } from "@babylonjs/core/Animations/animation";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { disposePlayerModel, type PlayerModelInstance, PlayerModelManager } from "../animation/PlayerModelManager";

function clip(name: string, to: number): Animation {
  const animation = new Animation(
    name,
    "position.x",
    30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CYCLE,
  );
  animation.setKeys([
    { frame: 0, value: 0 },
    { frame: 30, value: to },
  ]);
  return animation;
}

function setup() {
  const scene = new Scene(new NullEngine());
  scene.useConstantAnimationDeltaTime = true;
  const anchor = new TransformNode("anchor", scene);
  const mesh = new Mesh("__root__", scene);
  mesh.parent = anchor;
  const joint = new TransformNode("joint", scene);
  joint.parent = mesh;
  const instance = {
    id: "p",
    anchor,
    mesh,
    skeleton: null,
    anims: [
      { name: "idle", animations: [{ animation: clip("idle", 3), target: joint }] },
      { name: "run", animations: [{ animation: clip("run", 30), target: joint }] },
    ],
    masterGroup: null,
    currentAnim: "",
    oneshotUntil: 0,
  } as unknown as PlayerModelInstance;
  return { scene, joint, instance };
}

it("reuses one group per clip across switches, restarting it as a fresh one would", () => {
  const { scene, joint, instance } = setup();
  PlayerModelManager.playAnimationOn(instance, "run");
  const run = instance.masterGroup!;
  run.speedRatio = 2.5; // a caller's speed for that stretch of running
  for (let i = 0; i < 10; i++) scene.animate();

  PlayerModelManager.playAnimationOn(instance, "idle");
  const idle = instance.masterGroup!;
  expect(idle).not.toBe(run);
  expect(run.isPlaying).toBe(false);

  const groupsBefore = scene.animationGroups.length;
  PlayerModelManager.playAnimationOn(instance, "run");
  expect(instance.masterGroup).toBe(run); // the same group, not a rebuilt one
  expect(scene.animationGroups.length).toBe(groupsBefore);
  expect(run.isPlaying).toBe(true);
  expect(run.speedRatio).toBe(1);
  scene.animate();
  expect(joint.position.x).toBeLessThan(2); // back at the start of the clip

  disposePlayerModel(instance);
  expect(scene.animationGroups.length).toBe(0);
  expect(instance.masterGroup).toBeNull();
});

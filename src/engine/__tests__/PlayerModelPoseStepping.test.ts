import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { type PlayerModelInstance, PlayerModelManager, wrapFrame } from "../animation/PlayerModelManager";

/** A 30-frame, 30 fps loop that moves a joint's x from 0 to 30: x equals the frame. */
function setup() {
  const scene = new Scene(new NullEngine());
  scene.useConstantAnimationDeltaTime = true; // 16 ms per animate()
  const anchor = new TransformNode("anchor", scene);
  const mesh = new Mesh("__root__", scene);
  mesh.parent = anchor;
  const joint = new TransformNode("joint", scene);
  joint.parent = mesh;
  const clip = new Animation("run", "position.x", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  clip.setKeys([
    { frame: 0, value: 0 },
    { frame: 30, value: 30 },
  ]);
  const group = new AnimationGroup("run", scene);
  group.addTargetedAnimation(clip, joint);
  group.play(true);
  const instance = {
    id: "p",
    anchor,
    mesh,
    skeleton: null,
    anims: [],
    masterGroup: group,
    currentAnim: "run",
    oneshotUntil: 0,
  } as PlayerModelInstance;
  return { scene, joint, group, instance, manager: new PlayerModelManager(scene) };
}

describe("wrapFrame", () => {
  it("wraps forwards and backwards into the loop", () => {
    expect(wrapFrame(35, 0, 30)).toBeCloseTo(5);
    expect(wrapFrame(-2, 0, 30)).toBeCloseTo(28);
    expect(wrapFrame(12, 10, 10)).toBe(10);
    expect(wrapFrame(Number.NaN, 0, 30)).toBe(0);
  });
});

describe("PlayerModelManager.stepAnimation", () => {
  it("keeps the clip's speed but poses only when a step is due", () => {
    const { scene, joint, group, instance, manager } = setup();
    // 0.25 s at a 30 Hz pose rate on a 62.5 Hz clock: about every other frame.
    const writes: number[] = [];
    let last = joint.position.x;
    for (let i = 0; i < 16; i++) {
      manager.stepAnimation(instance, 0.016, 1 / 30);
      scene.animate();
      if (joint.position.x !== last) writes.push(i);
      last = joint.position.x;
    }
    expect(group.isPlaying).toBe(false);
    expect(writes.length).toBeGreaterThanOrEqual(7);
    expect(writes.length).toBeLessThanOrEqual(9);
    // 16 x 16 ms at 30 fps is 7.68 frames; the last write lags by under one step.
    expect(joint.position.x).toBeGreaterThan(7.68 - 1.01);
    expect(joint.position.x).toBeLessThanOrEqual(7.68 + 1e-6);
  });

  it("follows the speed ratio, including backwards", () => {
    const { joint, group, instance, manager } = setup();
    group.speedRatio = -2;
    for (let i = 0; i < 10; i++) manager.stepAnimation(instance, 0.05, 0);
    // 10 x 0.05 s x 30 fps x -2 = -30 frames: one full loop back to the start.
    expect(joint.position.x).toBeCloseTo(0, 4);
    manager.stepAnimation(instance, 0.05, 0);
    expect(joint.position.x).toBeCloseTo(27, 4);
  });

  it("resumes at full rate from the stepped phase, not where it paused", () => {
    const { scene, joint, group, instance, manager } = setup();
    for (let i = 0; i < 10; i++) manager.stepAnimation(instance, 0.05, 0);
    expect(joint.position.x).toBeCloseTo(15, 4);
    manager.setAnimationActive(instance, true);
    expect(group.isPlaying).toBe(true);
    scene.animate();
    scene.animate();
    expect(joint.position.x).toBeGreaterThan(15);
    expect(joint.position.x).toBeLessThan(17);
  });

  it("does not re-pose a stepped skeleton when only the speed changes", () => {
    const { joint, group, instance, manager } = setup();
    manager.stepAnimation(instance, 0.2, 0);
    const posed = joint.position.x;
    joint.position.x = -1; // a marker any re-pose would overwrite
    for (const speed of [1.3, 0.7, 2]) group.speedRatio = speed;
    expect(joint.position.x).toBe(-1);
    manager.stepAnimation(instance, 0, 0);
    expect(joint.position.x).toBeCloseTo(posed, 4);
  });

  it("leaves the bones to a one-shot while it plays", () => {
    const { joint, instance, manager } = setup();
    (manager as unknown as { activeOneShots: Map<unknown, unknown> }).activeOneShots.set(instance, {});
    manager.stepAnimation(instance, 0.5, 0);
    expect(joint.position.x).toBe(0);
  });
});

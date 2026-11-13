import { Animation } from "@babylonjs/core/Animations/animation";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { expect, it } from "vitest";
import { disposePlayerModel, type PlayerModelInstance, PlayerModelManager } from "../animation/PlayerModelManager";

function setup() {
  const scene = new Scene(new NullEngine());
  scene.useConstantAnimationDeltaTime = true;
  const manager = new PlayerModelManager(scene);
  function actor(id: string) {
    const anchor = new TransformNode(`${id}/anchor`, scene),
      mesh = new Mesh(`${id}/body`, scene);
    mesh.parent = anchor;
    const skeleton = new Skeleton(id, id, scene);
    const hips = new TransformNode(`${id}/hips`, scene),
      leg = new TransformNode(`${id}/leg`, scene);
    const spine = new TransformNode(`${id}/spine`, scene),
      hand = new TransformNode(`${id}/hand`, scene);
    hips.parent = mesh;
    leg.parent = hips;
    spine.parent = hips;
    hand.parent = spine;
    new Bone("mixamorig:Spine", skeleton).linkTransformNode(spine);
    const nodes = [hips, leg, spine, hand];
    const anims = ["jump", "run", "blade_slash", "taunt_2"].map((name, index) => ({
      name,
      animations: nodes.map((target, i) => {
        const animation = new Animation(`${name}/${i}`, "position.x", 30, Animation.ANIMATIONTYPE_FLOAT);
        const offset = index * 100 + i * 10;
        animation.setKeys([
          { frame: 0, value: offset },
          { frame: 30, value: offset + 30 },
        ]);
        return { target, animation };
      }),
    }));
    const instance = {
      id,
      anchor,
      mesh,
      skeleton,
      anims,
      masterGroup: null,
      currentAnim: "",
      oneshotUntil: 0,
    } as PlayerModelInstance;
    return { instance, hips, leg, spine, hand };
  }
  return { scene, manager, a: actor("swing"), b: actor("control") };
}

it("keeps airborne hips/legs advancing at their original phase while the blade owns spine and arms", () => {
  const { scene, manager, a, b } = setup();
  try {
    manager.playAnimation(a.instance, "jump");
    manager.playAnimation(b.instance, "jump");
    for (let i = 0; i < 10; i++) scene.animate();
    expect(manager.playOnce(a.instance, "blade_slash", 2)).toBe(true);
    expect(a.instance.masterGroup!.isPlaying).toBe(true);
    expect(
      a.instance
        .masterGroup!.targetedAnimations.filter((c) => a.instance.masterGroup!.mask!.retainsTarget(c.target.name))
        .map((c) => c.target),
    ).toEqual([a.hips, a.leg]);
    for (let i = 0; i < 10; i++) {
      scene.animate();
      expect(a.hips.position.x).toBeCloseTo(b.hips.position.x, 4);
      expect(a.leg.position.x).toBeCloseTo(b.leg.position.x, 4);
    }
    expect(a.hand.position.x).toBeGreaterThan(200);
    expect(a.spine.position.x).toBeGreaterThan(200);
    const phase = a.leg.position.x;
    manager.stopOneShot(a.instance);
    expect(a.leg.position.x).toBeCloseTo(phase, 4);
    for (let i = 0; i < 5; i++) {
      scene.animate();
      expect(a.leg.position.x).toBeCloseTo(b.leg.position.x, 4);
      expect(a.hand.position.x).toBeCloseTo(b.hand.position.x, 4);
    }
  } finally {
    disposePlayerModel(a.instance);
    disposePlayerModel(b.instance);
    manager.dispose();
    scene.getEngine().dispose();
  }
});

it("keeps movement transitions, reverse/frozen playback and stepped poses during repeated swings", () => {
  const { scene, manager, a, b } = setup();
  try {
    manager.playAnimation(a.instance, "run");
    manager.playAnimation(b.instance, "run");
    for (let repeat = 0; repeat < 4; repeat++) {
      manager.playOnce(a.instance, "blade_slash", 2);
      manager.playAnimation(a.instance, "jump");
      manager.playAnimation(b.instance, "jump");
      for (const speed of [-1, 0, 2]) {
        a.instance.masterGroup!.speedRatio = b.instance.masterGroup!.speedRatio = speed;
        for (let i = 0; i < 4; i++) {
          manager.stepAnimation(a.instance, 0.016, 0);
          manager.stepAnimation(b.instance, 0.016, 0);
          scene.animate();
          expect(a.leg.position.x).toBeCloseTo(b.leg.position.x, 4);
          expect(a.hand.position.x).toBeGreaterThan(200);
        }
      }
      manager.stopOneShot(a.instance);
      manager.playAnimation(a.instance, "run");
      manager.playAnimation(b.instance, "run");
    }
    expect(a.instance.clipGroups!.size).toBe(2);
  } finally {
    disposePlayerModel(a.instance);
    disposePlayerModel(b.instance);
    manager.dispose();
    expect(scene.animationGroups).toHaveLength(0);
    scene.getEngine().dispose();
  }
});

it("ends a swing naturally and restores upper locomotion without restarting the legs", () => {
  const { scene, manager, a, b } = setup();
  try {
    manager.playAnimation(a.instance, "jump");
    manager.playAnimation(b.instance, "jump");
    for (let i = 0; i < 8; i++) scene.animate();
    const group = a.instance.masterGroup;
    manager.playOnce(a.instance, "blade_slash", 2);
    for (let i = 0; i < 45; i++) {
      scene.animate();
      expect(a.leg.position.x).toBeCloseTo(b.leg.position.x, 4);
    }
    expect(manager.isOneShotPlaying(a.instance)).toBe(false);
    expect(a.instance.masterGroup).toBe(group);
    expect(group!.mask).toBeNull();
    expect(a.instance.oneshotUntil).toBe(0);
  } finally {
    disposePlayerModel(a.instance);
    disposePlayerModel(b.instance);
    manager.dispose();
    scene.getEngine().dispose();
  }
});

it("plays a taunt over the spine and arms while the legs keep running, and names it while it plays", () => {
  const { scene, manager, a, b } = setup();
  try {
    manager.playAnimation(a.instance, "run");
    manager.playAnimation(b.instance, "run");
    for (let i = 0; i < 5; i++) scene.animate();
    expect(manager.playOnce(a.instance, "taunt_2")).toBe(true);
    expect(manager.activeOneShot(a.instance)).toBe("taunt_2");
    expect(manager.isFullBodyOneShotPlaying(a.instance)).toBe(false);
    for (let i = 0; i < 10; i++) {
      scene.animate();
      expect(a.leg.position.x).toBeCloseTo(b.leg.position.x, 4);
    }
    expect(a.hand.position.x).toBeGreaterThan(300);
    manager.stopOneShot(a.instance);
    expect(manager.activeOneShot(a.instance)).toBeNull();
    for (let i = 0; i < 3; i++) {
      scene.animate();
      expect(a.hand.position.x).toBeCloseTo(b.hand.position.x, 4);
    }
  } finally {
    disposePlayerModel(a.instance);
    disposePlayerModel(b.instance);
    manager.dispose();
    scene.getEngine().dispose();
  }
});

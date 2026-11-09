import { Animation } from "@babylonjs/core/Animations/animation";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, expect, it } from "vitest";
import { type PlayerModelInstance, PlayerModelManager } from "../animation/PlayerModelManager";

let scene: Scene;
afterEach(() => scene.getEngine().dispose());

/** A clip moving `property` of each target by one unit per frame, from 0. */
function clip(name: string, property: string, targets: TransformNode[]) {
  return {
    name,
    animations: targets.map((target, i) => {
      const animation = new Animation(`${name}/${i}`, property, 30, Animation.ANIMATIONTYPE_FLOAT);
      animation.setKeys([
        { frame: 0, value: 0 },
        { frame: 300, value: 300 },
      ]);
      return { target, animation };
    }),
  };
}

/** Locomotion moves every joint's x, the stance the upper joints' y, the swing their z. */
function setup() {
  scene = new Scene(new NullEngine());
  scene.useConstantAnimationDeltaTime = true;
  const manager = new PlayerModelManager(scene);
  const anchor = new TransformNode("anchor", scene);
  const mesh = new Mesh("body", scene);
  mesh.parent = anchor;
  const skeleton = new Skeleton("rig", "rig", scene);
  const hips = new TransformNode("hips", scene);
  const leg = new TransformNode("leg", scene);
  const spine = new TransformNode("spine", scene);
  const hand = new TransformNode("hand", scene);
  hips.parent = mesh;
  leg.parent = hips;
  spine.parent = hips;
  hand.parent = spine;
  new Bone("mixamorig:Spine", skeleton).linkTransformNode(spine);
  const instance = {
    id: "holder",
    anchor,
    mesh,
    skeleton,
    anims: [
      clip("run", "position.x", [hips, leg, spine, hand]),
      clip("blade_idle", "position.y", [hips, leg, spine, hand]),
      clip("blade_slash", "position.z", [spine, hand]),
    ],
    masterGroup: null,
    currentAnim: "",
    oneshotUntil: 0,
  } as PlayerModelInstance;
  manager.playAnimation(instance, "run");
  return { manager, instance, leg, spine, hand };
}

const advance = (frames: number) => {
  for (let i = 0; i < frames; i++) scene.animate();
};

it("loops the stance on the upper body while the legs keep running", () => {
  const { manager, instance, leg, spine, hand } = setup();
  advance(5);
  manager.setUpperBodyStance(instance, "blade_idle");
  advance(1);
  const start = { leg: leg.position.x, spineX: spine.position.x, spineY: spine.position.y };
  advance(20);
  expect(leg.position.x - start.leg).toBeGreaterThan(5);
  // Locomotion no longer moves the upper body; the stance does, and only the upper body
  expect(spine.position.x).toBe(start.spineX);
  expect(spine.position.y - start.spineY).toBeGreaterThan(5);
  expect(hand.position.y).toBeCloseTo(spine.position.y, 4);
  expect(leg.position.y).toBe(0);
});

it("gives the upper body back to locomotion when the stance ends", () => {
  const { manager, instance, leg, spine } = setup();
  manager.setUpperBodyStance(instance, "blade_idle");
  advance(10);
  manager.setUpperBodyStance(instance, null);
  advance(1);
  const stanceY = spine.position.y;
  advance(10);
  expect(spine.position.y).toBe(stanceY);
  // Back on the legs' phase, within the one frame the mask release takes
  expect(Math.abs(spine.position.x - leg.position.x)).toBeLessThan(0.5);
  expect(scene.animationGroups.some((group) => group.name.endsWith("_stance"))).toBe(false);
});

it("pauses the stance under a swing and resumes it, still masked, when the swing ends", () => {
  const { manager, instance, leg, spine } = setup();
  manager.setUpperBodyStance(instance, "blade_idle");
  advance(5);
  expect(manager.playOnce(instance, "blade_slash")).toBe(true);
  advance(1);
  const during = { y: spine.position.y, z: spine.position.z };
  advance(20);
  expect(spine.position.y).toBe(during.y);
  expect(spine.position.z - during.z).toBeGreaterThan(5);

  manager.stopOneShot(instance);
  const after = { leg: leg.position.x, spineX: spine.position.x, spineY: spine.position.y };
  advance(20);
  expect(leg.position.x - after.leg).toBeGreaterThan(5);
  expect(spine.position.x).toBe(after.spineX);
  expect(spine.position.y - after.spineY).toBeGreaterThan(5);
});

it("steps the stance with the legs at a reduced pose rate", () => {
  const { manager, instance, spine } = setup();
  manager.setUpperBodyStance(instance, "blade_idle");
  advance(1);
  // A second of clip per step at 30 frames per second
  manager.stepAnimation(instance, 1, 0.5);
  const first = spine.position.y;
  manager.stepAnimation(instance, 1, 0.5);
  expect(spine.position.y - first).toBeCloseTo(30, 3);
  manager.setAnimationActive(instance, true);
  const resumed = spine.position.y;
  advance(10);
  expect(spine.position.y).toBeGreaterThan(resumed);
});

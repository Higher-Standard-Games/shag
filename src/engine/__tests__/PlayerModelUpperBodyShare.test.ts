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

/** A rig whose run clip moves each joint's x by one unit per frame, from 0. */
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
  const run = {
    name: "run",
    animations: [hips, leg, spine, hand].map((target, i) => {
      const animation = new Animation(`run/${i}`, "position.x", 30, Animation.ANIMATIONTYPE_FLOAT);
      animation.setKeys([
        { frame: 0, value: 0 },
        { frame: 300, value: 300 },
      ]);
      return { target, animation };
    }),
  };
  const instance = {
    id: "runner",
    anchor,
    mesh,
    skeleton,
    anims: [run],
    masterGroup: null,
    currentAnim: "",
    oneshotUntil: 0,
  } as PlayerModelInstance;
  manager.playAnimation(instance, "run");
  return { manager, instance, leg, spine, hand };
}

it("plays the spine and arms at their share of the clip's speed, the legs at the clip's", () => {
  const { manager, instance, leg, spine, hand } = setup();
  instance.masterGroup!.speedRatio = 2;
  manager.setUpperBodyShare(instance, 0.5);
  scene.animate();
  const start = { leg: leg.position.x, spine: spine.position.x };
  for (let i = 0; i < 20; i++) scene.animate();
  const legs = leg.position.x - start.leg;
  expect(legs).toBeGreaterThan(5);
  expect(spine.position.x - start.spine).toBeCloseTo(legs / 2, 3);
  expect(hand.position.x).toBeCloseTo(spine.position.x, 4);

  // A new clip speed puts every joint on it; the share applies again on top
  instance.masterGroup!.speedRatio = 1;
  manager.setUpperBodyShare(instance, 1);
  const again = { leg: leg.position.x, spine: spine.position.x };
  for (let i = 0; i < 20; i++) scene.animate();
  expect(spine.position.x - again.spine).toBeCloseTo(leg.position.x - again.leg, 3);
});

it("keeps the upper body's own phase while posed at a reduced rate", () => {
  const { manager, instance, leg, spine } = setup();
  manager.setUpperBodyShare(instance, 0.5);
  // Stepped from the start: one pose per call, a second of clip each
  for (let i = 0; i < 4; i++) manager.stepAnimation(instance, 1, 0);
  expect(leg.position.x).toBeCloseTo(120, 3);
  expect(spine.position.x).toBeCloseTo(60, 3);

  // Back to played: each half resumes where it was
  manager.setAnimationActive(instance, true);
  scene.animate();
  expect(leg.position.x).toBeCloseTo(120, 0);
  expect(spine.position.x).toBeCloseTo(60, 0);
});

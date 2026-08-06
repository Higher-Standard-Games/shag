/**
 * PlayerModelRootMotion.test.ts — regression guard for the remote-player
 * "warping / floating body" bug.
 *
 * The Mixamo clips carry large root motion on `mixamorig:Hips` (measured against
 * MODEL_SCALE 36: run 82u forward, strafes 39-51u sideways, slide 246u).
 * `RemotePlayerRenderer` parents the model to an anchor that it rotates to the
 * player's yaw, so any leftover Hips displacement lives in the anchor's LOCAL
 * space and the yaw rotates it — the body traces a circle around the position it
 * should be standing on. Headless repro measured a 97.5u offset swinging through
 * a full turn.
 *
 * The guard `resetRootMotion` was written against exactly this, but walked only
 * DIRECT descendants. vanguard.glb nests as `__root__ > RootNode > mixamorig:Hips`,
 * so the walk saw only `RootNode` and the Hips branch never executed. These tests
 * lock in the full-subtree traversal and the bind-pose restore.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { beforeEach, describe, expect, it } from "vitest";
import { type PlayerModelInstance, PlayerModelManager } from "../animation/PlayerModelManager";

/** Bind-pose hip height in model units (vanguard.glb: 1.061). */
const HIPS_BIND_Y = 1.061;

/**
 * Rebuild vanguard.glb's node nesting: the Hips are a GRANDCHILD of the mesh
 * root, which is what defeated the original direct-descendants-only walk.
 */
function makeInstance(scene: Scene): {
  instance: PlayerModelInstance;
  hips: TransformNode;
  rootNode: TransformNode;
} {
  const anchor = new TransformNode("anchor", scene);
  const mesh = new Mesh("__root__", scene);
  mesh.parent = anchor;

  const rootNode = new TransformNode("RootNode", scene);
  rootNode.parent = mesh;

  const hips = new TransformNode("mixamorig:Hips", scene);
  hips.parent = rootNode;
  hips.position.set(0, HIPS_BIND_Y, 0);

  // A deeper bone, to confirm the recursive walk does not touch ordinary bones.
  const spine = new TransformNode("mixamorig:Spine", scene);
  spine.parent = hips;
  spine.position.set(0, 0.1, 0);

  const instance: PlayerModelInstance = {
    id: "test",
    anchor,
    mesh,
    skeleton: null,
    anims: [],
    masterGroup: null,
    currentAnim: "",
    oneshotUntil: 0,
    hipsBind: { node: hips, x: 0, y: HIPS_BIND_Y, z: 0 },
  };

  return { instance, hips, rootNode };
}

describe("PlayerModelManager.resetRootMotion", () => {
  let scene: Scene;
  let manager: PlayerModelManager;

  beforeEach(() => {
    const engine = new NullEngine();
    scene = new Scene(engine);
    manager = new PlayerModelManager(scene);
  });

  it("cancels horizontal root motion on Hips nested below the mesh root", () => {
    const { instance, hips } = makeInstance(scene);

    // "rifle run" + "strafe left" peak displacement, in model units.
    hips.position.set(1.426, HIPS_BIND_Y, 2.292);

    manager.resetRootMotion(instance);

    expect(hips.position.x).toBeCloseTo(0, 5);
    expect(hips.position.z).toBeCloseTo(0, 5);
  });

  it("restores the Hips bind height instead of zeroing it", () => {
    const { instance, hips } = makeInstance(scene);

    // Vertical bob from a jump/slide clip.
    hips.position.set(0, HIPS_BIND_Y + 0.739, 0);

    manager.resetRootMotion(instance);

    // Zeroing Y would collapse the skeleton to the feet and sink the legs
    // through the floor; the bind height must come back exactly.
    expect(hips.position.y).toBeCloseTo(HIPS_BIND_Y, 5);
  });

  it("keeps the mesh root and RootNode pinned at the origin", () => {
    const { instance, rootNode } = makeInstance(scene);

    instance.mesh.position.set(5, 6, 7);
    rootNode.position.set(1, 2, 3);

    manager.resetRootMotion(instance);

    expect(instance.mesh.position.asArray()).toEqual([0, 0, 0]);
    expect(rootNode.position.asArray()).toEqual([0, 0, 0]);
  });

  it("leaves ordinary bones alone", () => {
    const { instance, hips } = makeInstance(scene);
    const spine = hips.getChildTransformNodes(true)[0];
    spine.position.set(0, 0.1, 0);

    manager.resetRootMotion(instance);

    // Only root/armature/hips nodes are managed — animation must still drive
    // every other bone.
    expect(spine.position.y).toBeCloseTo(0.1, 5);
  });

  it("does not drift across repeated frames of root motion", () => {
    const { instance, hips } = makeInstance(scene);

    for (let frame = 0; frame < 60; frame++) {
      hips.position.set(1.426, HIPS_BIND_Y + 0.739, 2.292);
      manager.resetRootMotion(instance);
    }

    expect(hips.position.x).toBeCloseTo(0, 5);
    expect(hips.position.z).toBeCloseTo(0, 5);
    expect(hips.position.y).toBeCloseTo(HIPS_BIND_Y, 5);
  });
});

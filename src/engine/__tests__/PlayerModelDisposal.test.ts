/**
 * A player model goes with everything it owns, and nothing it shares (NullEngine).
 *
 * The visibility style clones each material per player, and every removal path
 * disposed the meshes only, so two materials leaked per death (E5). The hand
 * weapon's loader leftovers leaked with every weapon (R5).
 */

import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { disposePlayerModel, type PlayerModelInstance } from "../animation/PlayerModelManager";
import { bindLoaderLeftovers } from "../loader/model/ModelSourceCache";

let scene: Scene;

afterEach(() => scene.getEngine().dispose());

function playerModel(id: string, shared: StandardMaterial): PlayerModelInstance {
  const anchor = new TransformNode(`anchor_${id}`, scene);
  const body = MeshBuilder.CreateBox("body", { size: 1 }, scene);
  body.parent = anchor;
  const head = MeshBuilder.CreateBox("head", { size: 1 }, scene);
  head.parent = body;
  body.material = shared.clone(`playerMat_${id}_body`);
  head.material = shared.clone(`playerMat_${id}_head`);
  const gun = MeshBuilder.CreateBox("gun", { size: 1 }, scene);
  const loaderRoot = new TransformNode("__root__", scene);
  new TransformNode("RootNode", scene).parent = loaderRoot;
  bindLoaderLeftovers(gun, loaderRoot, [new AnimationGroup("idle", scene)]);
  return {
    id,
    anchor,
    mesh: body,
    skeleton: null,
    masterGroup: null,
    attachedWeapon: gun,
  } as unknown as PlayerModelInstance;
}

describe("disposing a player model", () => {
  it("takes its own cloned materials and keeps the shared one and another player's", () => {
    scene = new Scene(new NullEngine());
    const shared = new StandardMaterial("vanguard", scene);
    playerModel("p2", shared);

    disposePlayerModel(playerModel("p1", shared));

    const names = scene.materials.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["vanguard", "playerMat_p2_body", "playerMat_p2_head"]));
    expect(names).not.toContain("playerMat_p1_body");
    expect(names).not.toContain("playerMat_p1_head");
  });

  it("leaves nothing of the weapon or what its load left behind", () => {
    scene = new Scene(new NullEngine());
    const shared = new StandardMaterial("vanguard", scene);
    const counts = () => [
      scene.transformNodes.length,
      scene.meshes.length,
      scene.materials.length,
      scene.animationGroups.length,
    ];
    const before = counts();
    disposePlayerModel(playerModel("p1", shared));
    expect(counts()).toEqual(before);
  });
});

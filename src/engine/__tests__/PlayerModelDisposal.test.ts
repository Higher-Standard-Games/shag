/**
 * A player model goes with everything it owns, and nothing it shares (NullEngine).
 *
 * The visibility style clones each material per player, and every removal path
 * disposed the meshes only, so two materials leaked per death (E5). The hand
 * weapon's loader leftovers leaked with every weapon (R5).
 */

import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { disposePlayerModel, type PlayerModelInstance, PlayerModelManager } from "../animation/PlayerModelManager";
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
  it("shares the source's textures across respawns and keeps them for the source and surviving players", () => {
    scene = new Scene(new NullEngine());
    const manager = new PlayerModelManager(scene);
    const source = new PBRMaterial("vanguard", scene);
    source.albedoTexture = new Texture(null, scene);
    source.bumpTexture = new Texture(null, scene);
    const style = {
      tintColor: Color3.White(),
      fullbrightEnabled: false,
      fullbrightIntensity: 0,
      outlineEnabled: false,
      outlineColor: Color3.White(),
      outlineWidth: 0,
    };
    const spawn = (id: string) => {
      const mesh = MeshBuilder.CreateBox(id, {}, scene);
      mesh.material = source;
      const instance = { id, mesh, skeleton: null, masterGroup: null } as unknown as PlayerModelInstance;
      manager.applyVisualStyle(instance, style);
      return instance;
    };
    const sourceTextures = [...scene.textures];
    const survivor = spawn("survivor");
    const survivorTextures = survivor.mesh.material!.getActiveTextures();
    const before = scene.textures.length;
    // A player's style material samples the source's own textures: no copy to
    // decode and upload again on each respawn
    expect(survivorTextures).toEqual(source.getActiveTextures());
    for (let i = 0; i < 100; i++) {
      const player = spawn(`respawn_${i}`);
      expect(scene.textures.length).toBe(before);
      manager.applyVisualStyle(player, style);
      disposePlayerModel(player);
      expect(scene.textures.length).toBe(before);
      expect(scene.textures).toEqual(expect.arrayContaining([...source.getActiveTextures(), ...survivorTextures]));
    }
    disposePlayerModel(survivor);
    expect(scene.textures).toHaveLength(sourceTextures.length);
    expect(scene.textures).toEqual(expect.arrayContaining(sourceTextures));
    manager.dispose();
  });

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

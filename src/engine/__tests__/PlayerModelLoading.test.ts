import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayerModelManager } from "../animation/PlayerModelManager";

/** Minimal skinned glTF with a Spine rotation clip; exercises the actual loader. */
function modelAsset(): string {
  const arrays = [
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint16Array(12),
    new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    new Float32Array([0, 1]),
    new Float32Array([0, 0, 0, 1, Math.sin(0.5), 0, 0, Math.cos(0.5)]),
  ];
  let byteOffset = 0;
  const bufferViews = arrays.map((array) => {
    const view = { buffer: 0, byteOffset, byteLength: array.byteLength };
    byteOffset += array.byteLength;
    return view;
  });
  const bytes = new Uint8Array(byteOffset);
  arrays.forEach((array, index) => {
    bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), bufferViews[index].byteOffset);
  });
  return `data:${JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "RootNode", children: [1, 3] },
      { name: "mixamorig:Hips", translation: [0, 1.061, 0], children: [2] },
      { name: "mixamorig:Spine", translation: [0, 0.1, 0] },
      { name: "Body", mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [1, 2], skeleton: 1 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    animations: [
      {
        name: "lean",
        samplers: [{ input: 3, output: 4 }],
        channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "VEC4" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 4, componentType: 5126, count: 2, type: "VEC4" },
    ],
    bufferViews,
    buffers: [
      {
        byteLength: bytes.length,
        uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`,
      },
    ],
  })}`;
}

describe("player model loading in a shared scene", () => {
  let engine: NullEngine;
  let scene: Scene;
  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it("loading the teleport ghost manager leaves an existing player's animation alive", async () => {
    const asset = modelAsset();
    const players = new PlayerModelManager(scene);
    await players.loadModel("", asset, [{ name: "idle", file: asset }]);
    const player = players.createInstance("player")!;
    players.playAnimation(player, "idle");
    const group = player.masterGroup!;
    const ghosts = new PlayerModelManager(scene);
    await ghosts.loadModel("", asset, [{ name: "idle", file: asset }]);
    expect(scene.animationGroups).toContain(group);
    expect(group.isPlaying).toBe(true);
    expect(group.targetedAnimations).toHaveLength(1);
    group.goToFrame(group.to);
    expect(player.skeleton!.bones[1].getTransformNode()!.rotationQuaternion!.x).toBeCloseTo(Math.sin(0.5));
    players.disposeInstance(player);
    players.dispose();
    ghosts.dispose();
  });

  it("concurrent managers preserve every clip and retarget all channels to their own instances", async () => {
    const asset = modelAsset();
    const managers = [new PlayerModelManager(scene), new PlayerModelManager(scene)];
    await Promise.all(managers.map((manager) => manager.loadModel("", asset, [{ name: "idle", file: asset }])));
    const instances = managers.map((manager, index) => manager.createInstance(`player${index}`)!);
    for (const instance of instances) {
      expect(instance.anims.map((clip) => clip.name)).toEqual(["embedded", "idle"]);
      for (const clip of instance.anims) {
        expect(clip.animations).toHaveLength(1);
        expect(clip.animations[0].target.isDescendantOf(instance.mesh)).toBe(true);
      }
    }
    expect(instances[0].anims[1].animations[0].target).not.toBe(instances[1].anims[1].animations[0].target);
    managers.forEach((manager, index) => {
      manager.disposeInstance(instances[index]);
      manager.dispose();
    });
  });
});

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VANGUARD_ANIMATIONS, VANGUARD_MODEL, VANGUARD_ROOT } from "../animation/PlayerModelAssets";
import { PlayerModelManager } from "../animation/PlayerModelManager";
import { PK3Loader } from "../loader/pk3/PK3Loader";

/**
 * Minimal skinned glTF with a Spine rotation clip; exercises the actual loader.
 * `skins` mirrors real exports, which emit one skin per skinned submesh over a
 * single shared rig — vanguard.glb ships three.
 */
function modelAsset(skins: number = 1): string {
  const arrays = [
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint16Array(12),
    new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    new Float32Array([0, 1]),
    // Both keys are rotated, so the clip's FIRST frame already differs from the
    // bind pose — which is what settling a fresh body has to prove it reached.
    new Float32Array([Math.sin(0.25), 0, 0, Math.cos(0.25), Math.sin(0.5), 0, 0, Math.cos(0.5)]),
  ];
  let byteOffset = 0;
  const bufferViews = arrays.map((array) => {
    const view = { buffer: 0, byteOffset, byteLength: array.byteLength };
    byteOffset += array.byteLength;
    return view;
  });
  const submeshes = Array.from({ length: skins });
  const bytes = new Uint8Array(byteOffset);
  arrays.forEach((array, index) => {
    bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), bufferViews[index].byteOffset);
  });
  return `data:${JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "RootNode", children: [1, ...submeshes.map((_, index) => 3 + index)] },
      { name: "mixamorig:Hips", translation: [0, 1.061, 0], children: [2] },
      { name: "mixamorig:Spine", translation: [0, 0.1, 0] },
      ...submeshes.map((_, index) => ({ name: index === 0 ? "Body" : `Part_${index}`, mesh: index, skin: index })),
    ],
    // Every skin names the same joints, which is what makes them collapsible.
    skins: submeshes.map(() => ({ joints: [1, 2], skeleton: 1 })),
    meshes: submeshes.map(() => ({ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] })),
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

  it("loads the default player and ghost from PK3 bytes, retaining independently owned clips", async () => {
    const json = Buffer.from(modelAsset(3).slice("data:".length));
    const length = Math.ceil(json.length / 4) * 4;
    const glb = Buffer.alloc(20 + length, 32);
    glb.writeUInt32LE(0x46546c67, 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    glb.set(json, 20);
    const glbBytes = new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength);
    const zip = new JSZip();
    zip.file(VANGUARD_ROOT + VANGUARD_MODEL, glbBytes);
    for (const clip of VANGUARD_ANIMATIONS.filter((clip) => !clip.optional))
      zip.file(VANGUARD_ROOT + clip.file, glbBytes);
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const fetchMock = vi.fn(async () => new Response(bytes));
    const loader = PK3Loader.getInstance();
    loader.unloadAll();
    loader.configure({ basePath: "data/", additionalPaths: [] });
    vi.stubGlobal("fetch", fetchMock);
    const players = new PlayerModelManager(scene);
    const ghosts = new PlayerModelManager(scene);
    try {
      await Promise.all([
        players.loadModel(),
        ghosts.loadModel(undefined, undefined, [{ name: "idle", file: "rifle aiming idle.glb" }]),
      ]);
      expect(players.isLoaded).toBe(true);
      expect(ghosts.isLoaded).toBe(true);
      const player = players.createInstance("player")!;
      const ghost = ghosts.createInstance("ghost")!;
      expect(player.anims).toHaveLength(18);
      expect(ghost.anims).toHaveLength(2);
      players.playAnimation(player, "idle");
      ghosts.playAnimation(ghost, "idle");
      expect(player.anims[1].animations[0].target).not.toBe(ghost.anims[1].animations[0].target);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      ghosts.dispose();
      expect(player.masterGroup!.isPlaying).toBe(true);
      players.disposeInstance(player);
    } finally {
      players.dispose();
      ghosts.dispose();
      loader.unloadAll();
      vi.unstubAllGlobals();
    }
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

  it("settles a freshly built body off its bind pose without waiting for a frame", async () => {
    // The corpse handed to the ragdoll is built and physicalised inside one
    // tick. play() only schedules an animatable, so without settling, physics
    // lays its bone bodies out from the bind pose and the body stays a T-pose.
    // The source model used to be posed by accident, loaded into the live scene
    // with the glTF default start mode; it now loads animations-off.
    const asset = modelAsset();
    const manager = new PlayerModelManager(scene);
    await manager.loadModel("", asset, [{ name: "idle", file: asset }]);
    const instance = manager.createInstance("corpse")!;
    const spine = instance.skeleton!.bones[1].getTransformNode()!;

    manager.playAnimation(instance, "idle");
    const beforeSettle = spine.rotationQuaternion?.clone() ?? null;

    manager.settlePose(instance);
    const afterSettle = spine.rotationQuaternion;
    expect(afterSettle).toBeTruthy();
    expect(afterSettle!.x).toBeCloseTo(Math.sin(0.25));
    expect(beforeSettle?.equals(afterSettle!) ?? false).toBe(false);

    manager.disposeInstance(instance);
    manager.dispose();
  });

  it("loads an export that ships one skin per submesh, onto a single shared skeleton", async () => {
    // vanguard.glb carries three skins over one rig. Demanding exactly one
    // skeleton rejected the real asset outright, and the load error left every
    // remote player without a model at all.
    const asset = modelAsset(3);
    const manager = new PlayerModelManager(scene);
    await manager.loadModel("", asset, [{ name: "idle", file: asset }]);
    expect(manager.isLoaded).toBe(true);

    const instance = manager.createInstance("player");
    expect(instance).not.toBeNull();
    const skinnedMeshes = [instance!.mesh, ...instance!.mesh.getChildMeshes()].filter((child) => child.skeleton);
    expect(skinnedMeshes.length).toBeGreaterThan(1);
    // Redundant skins must not survive as extra skeletons: each one is evaluated
    // every frame, over bones another skeleton has already computed.
    expect(new Set(skinnedMeshes.map((child) => child.skeleton))).toEqual(new Set([instance!.skeleton]));
    expect(scene.skeletons).toHaveLength(1);

    manager.playAnimation(instance!, "idle");
    instance!.masterGroup!.goToFrame(instance!.masterGroup!.to);
    expect(instance!.skeleton!.bones[1].getTransformNode()!.rotationQuaternion!.x).toBeCloseTo(Math.sin(0.5));

    manager.disposeInstance(instance!);
    manager.dispose();
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

import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationEvent } from "@babylonjs/core/Animations/animationEvent";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import "@babylonjs/core/Animations/animatable";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import * as sceneLoader from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityRegistry } from "../../../shared/entities/EntityRegistry";
import { EntityType } from "../../../shared/entities/EntityType";
import { AssetPreloader } from "../AssetPreloader";
import type { BspFile } from "../bsp/BspLoader";
import * as modelAsset from "../model/ModelAsset";

vi.mock("@babylonjs/core/Loading/sceneLoader", async (original) => ({
  ...(await original<typeof sceneLoader>()),
  ImportMeshAsync: vi.fn(),
}));

const MODEL = "/data/models/weapons/test/test.glb";
const BSP = { entities: [{ classname: "weapon_test" }] } as unknown as BspFile;
let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  vi.mocked(sceneLoader.ImportMeshAsync).mockReset();
  engine = new NullEngine();
  scene = new Scene(engine);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(EntityRegistry.getInstance(), "getByClassname").mockReturnValue({
    type: EntityType.WEAPON,
    modelPath: MODEL,
  } as never);
  vi.spyOn(modelAsset, "resolveModelAsset").mockResolvedValue({ source: "test.glb", options: { rootUrl: "" } });
});

afterEach(() => {
  AssetPreloader.getInstance().clearCache();
  engine.dispose();
  vi.restoreAllMocks();
});

function source(kind: "constant" | "moving" | "cubic" | "events" | "blending" = "constant") {
  const root = new Mesh("__root__", scene);
  const mesh = MeshBuilder.CreateBox("body", {}, scene);
  mesh.parent = root;
  mesh.material = new StandardMaterial("body_material", scene);
  const node = new TransformNode("joint", scene);
  node.parent = root;
  node.position.set(-10, -20, -30);
  const skeleton = new Skeleton("rig", "rig", scene);
  const bone = new Bone("joint", skeleton, null, Matrix.Identity());
  bone.linkTransformNode(node);
  mesh.skeleton = skeleton;
  const pose = new Vector3(2, 3, 4);
  const animation = new Animation("position", "position", 30, Animation.ANIMATIONTYPE_VECTOR3);
  animation.setKeys([
    { frame: 0, value: pose.clone(), ...(kind === "cubic" ? { outTangent: Vector3.One() } : {}) },
    {
      frame: 30,
      value: kind === "moving" ? new Vector3(5, 6, 7) : pose.clone(),
      ...(kind === "cubic" ? { inTangent: Vector3.One() } : {}),
    },
  ]);
  if (kind === "events") animation.addEvent(new AnimationEvent(15, () => {}, false));
  if (kind === "blending") animation.enableBlending = true;
  const rotation = new Animation("rotation", "rotationQuaternion", 30, Animation.ANIMATIONTYPE_QUATERNION);
  const orientation = Quaternion.FromEulerAngles(0.2, 0.4, 0.6);
  rotation.setKeys([
    { frame: 0, value: orientation.clone() },
    { frame: 30, value: orientation.clone() },
  ]);
  const group = new AnimationGroup("AWeapon", scene);
  group.addTargetedAnimation(animation, node);
  group.addTargetedAnimation(rotation, node);
  group.start(true);
  vi.mocked(sceneLoader.ImportMeshAsync).mockResolvedValue({
    meshes: [root, mesh],
    transformNodes: [node],
    animationGroups: [group],
    skeletons: [skeleton],
    particleSystems: [],
    geometries: [],
    lights: [],
    spriteManagers: [],
  });
  return { group, mesh, node, skeleton, pose, orientation };
}

describe("pickup cache animation ownership", () => {
  it("settles constant curves before the first tick and keeps a shared clone skeleton in that pose", async () => {
    const model = source();
    const ended = vi.fn();
    // Runtime animatable callbacks must not turn cache retirement into an animation end.
    model.group.animatables[0].onAnimationEndObservable.add(ended);
    const preloader = AssetPreloader.getInstance();
    await preloader.preloadFromBsp(BSP, scene);
    expect(model.node.position.equals(model.pose)).toBe(true);
    expect(model.node.rotationQuaternion?.equals(model.orientation)).toBe(true);
    expect(model.group.isStarted).toBe(false);
    expect(scene.animatables).toHaveLength(0);
    expect(ended).not.toHaveBeenCalled();

    const clone = preloader.cloneCachedModel(MODEL, scene);
    expect(clone?.meshes[0].skeleton).toBe(model.skeleton);
    model.skeleton.prepare();
    const matrices = [...model.skeleton.getTransformMatrices(model.mesh)];
    for (let frame = 0; frame < 4; frame++) {
      scene.animate();
      model.skeleton.prepare();
      expect([...model.skeleton.getTransformMatrices(model.mesh)]).toEqual(matrices);
    }
    expect(scene.animatables).toHaveLength(0);
    expect(clone?.meshes[0].isEnabled()).toBe(true);
    preloader.clearCache();
    expect(scene.animatables).toHaveLength(0);
    expect(clone?.meshes[0].isDisposed()).toBe(false);
    expect(scene.skeletons).toContain(model.skeleton);
  });

  it.each(["moving", "cubic", "events", "blending"] as const)(
    "preserves custom source playback for %s curves",
    async (kind) => {
      const model = source(kind);
      await AssetPreloader.getInstance().preloadFromBsp(BSP, scene);
      expect(model.group.isPlaying).toBe(true);
      expect(scene.animatables.length).toBeGreaterThan(0);
      model.group.goToFrame(10);
      if (kind === "moving" || kind === "cubic") expect(model.node.position.equals(model.pose)).toBe(false);
      AssetPreloader.getInstance().clearCache();
      expect(scene.animatables).toHaveLength(0);
    },
  );

  it("leaves unrelated scene animation running and reuses the settled source on another preload", async () => {
    const model = source();
    const target = new TransformNode("held_barrel", scene);
    const animation = new Animation("spin", "rotation.y", 30, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    const held = new AnimationGroup("held_barrel_spin", scene);
    held.addTargetedAnimation(animation, target);
    held.start(true);
    const preloader = AssetPreloader.getInstance();
    await preloader.preloadFromBsp(BSP, scene);
    await preloader.preloadFromBsp(BSP, scene);
    expect(sceneLoader.ImportMeshAsync).toHaveBeenCalledTimes(1);
    expect(model.group.isStarted).toBe(false);
    expect(held.isPlaying).toBe(true);
    held.goToFrame(15);
    expect(target.rotation.y).toBeCloseTo(0.5);
    expect(scene.animatables).toHaveLength(1);
  });
});

import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import "@babylonjs/core/Animations/animatable";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelInstanceCache } from "../loader/model/ModelInstanceCache";
import type { ModelLoadResult } from "../loader/model/ModelLoader";
import { disposeModelResources } from "../loader/model/ModelSourceCache";

let engine: NullEngine, scene: Scene;
function model(multi = false): ModelLoadResult {
  const root = new TransformNode("model", scene);
  const authored = new TransformNode("authored", scene);
  authored.parent = root;
  authored.position.set(2, 3, 4);
  authored.rotation.y = 0.4;
  const gun = MeshBuilder.CreateBox("gun", {}, scene);
  gun.parent = authored;
  const barrel = new TransformNode("barrel", scene);
  barrel.parent = gun;
  const flash = new TransformNode("tag_flash", scene);
  flash.parent = barrel;
  flash.position.z = 5;
  const material = new StandardMaterial("weapon", scene);
  material.diffuseTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  if (multi) {
    const mm = new MultiMaterial("parts", scene);
    mm.subMaterials = [material];
    gun.material = mm;
  } else gun.material = material;
  const skeleton = new Skeleton("rig", "rig", scene);
  const bone = new Bone("barrel", skeleton, null, Matrix.Identity());
  bone.linkTransformNode(barrel);
  gun.skeleton = skeleton;
  const animation = new Animation("spin", "rotation.y", 30, Animation.ANIMATIONTYPE_FLOAT);
  animation.setKeys([
    { frame: 0, value: 0 },
    { frame: 30, value: 1 },
  ]);
  const group = new AnimationGroup("spin", scene);
  group.addTargetedAnimation(animation, barrel);
  return { root, meshes: [gun], skeletons: [skeleton], animationGroups: [group] };
}
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

describe("model instance sources", () => {
  it("shares opted-in static PBR materials while rigs remain independent and releases only the last user", async () => {
    const source = model();
    const oldMaterial = source.meshes[0].material!;
    const material = new PBRMaterial("shared weapon", scene);
    source.meshes[0].material = material;
    oldMaterial.dispose();
    const cache = new ModelInstanceCache(scene, async () => source, { shareStaticMaterials: true });
    const a = (await cache.createInstance("gun.glb", 1))!;
    const b = (await cache.createInstance("gun.glb", 1))!;
    expect(a.meshes[0].material).toBe(material);
    expect(b.meshes[0].material).toBe(material);
    expect(a.skeletons[0]).not.toBe(b.skeletons[0]);
    expect(a.animationGroups[0].targetedAnimations[0].target).not.toBe(
      b.animationGroups[0].targetedAnimations[0].target,
    );
    disposeModelResources([a.root], a);
    expect(scene.materials).toContain(material);
    cache.dispose();
    expect(scene.materials).toContain(material);
    expect(b.meshes[0].isDisposed()).toBe(false);
    disposeModelResources([b.root], b);
    expect(scene.materials).not.toContain(material);
  });

  it("keeps animated materials and the default PBR path independent", async () => {
    for (const animated of [false, true]) {
      const source = model();
      const material = new PBRMaterial("weapon", scene);
      source.meshes[0].material = material;
      if (animated) {
        const fade = new Animation("fade", "alpha", 30, Animation.ANIMATIONTYPE_FLOAT);
        fade.setKeys([
          { frame: 0, value: 1 },
          { frame: 30, value: 0 },
        ]);
        source.animationGroups[0].addTargetedAnimation(fade, material);
      }
      const cache = new ModelInstanceCache(scene, async () => source, { shareStaticMaterials: animated });
      const a = (await cache.createInstance("gun.glb", 1))!;
      expect(a.meshes[0].material).not.toBe(material);
      disposeModelResources([a.root], a);
      cache.dispose();
    }
  });

  it.each(["material animation", "texture animation", "custom clone"])("does not share %s", async (kind) => {
    const source = model();
    const material = new PBRMaterial("weapon", scene);
    source.meshes[0].material = material;
    const animation = new Animation("fade", "alpha", 30, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([
      { frame: 0, value: 1 },
      { frame: 30, value: 0 },
    ]);
    if (kind === "material animation") material.animations = [animation];
    if (kind === "texture animation") {
      material.albedoTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
      material.albedoTexture.animations = [animation];
    }
    const clone = kind === "custom clone" ? vi.spyOn(material, "clone") : null;
    const cache = new ModelInstanceCache(scene, async () => source, { shareStaticMaterials: true });
    const instance = (await cache.createInstance("gun.glb", 1))!;
    expect(instance.meshes[0].material).not.toBe(material);
    if (clone) expect(clone).toHaveBeenCalledOnce();
    disposeModelResources([instance.root], instance);
    cache.dispose();
  });
  it("deduplicates concurrent imports while preserving authored tags, rigs and independent materials", async () => {
    const source = model();
    source.animationGroups[0].start(true);
    const load = vi.fn(async () => source);
    const cache = new ModelInstanceCache(scene, load);
    const [a, b] = await Promise.all([cache.createInstance("gun.glb", 1), cache.createInstance("/gun.glb", 1)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(source.root.isEnabled()).toBe(false);
    expect(source.animationGroups[0].isPlaying).toBe(false);
    expect(a!.animationGroups[0].isPlaying).toBe(true);
    expect(b!.animationGroups[0].isPlaying).toBe(true);
    expect(a!.root.isEnabled()).toBe(true);
    expect(a!.meshes[0].geometry).toBe(b!.meshes[0].geometry);
    expect(a!.meshes[0].material).not.toBe(b!.meshes[0].material);
    const tag = (m: ModelLoadResult) =>
      m.root.getDescendants(false).find((n) => n.name === "tag_flash") as TransformNode;
    expect(tag(a!).parent!.name).toBe("barrel");
    expect(tag(a!).computeWorldMatrix(true).asArray()).toEqual(tag(source).computeWorldMatrix(true).asArray());
    expect(a!.skeletons[0]).not.toBe(b!.skeletons[0]);
    expect(a!.skeletons[0].bones[0].getTransformNode()!.isDescendantOf(a!.root)).toBe(true);
    expect(a!.animationGroups[0].targetedAnimations[0].target.isDescendantOf(a!.root)).toBe(true);
    expect(a!.animationGroups[0].targetedAnimations[0].target).not.toBe(
      b!.animationGroups[0].targetedAnimations[0].target,
    );
    disposeModelResources([a!.root], a!);
    disposeModelResources([b!.root], b!);
    cache.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.skeletons).toHaveLength(0);
    expect(scene.animationGroups).toHaveLength(0);
  });
  it("keeps live clone textures after retiring sources, and releases independent multimaterials without mutating the source", async () => {
    const source = model(true);
    const mm = source.meshes[0].material as MultiMaterial;
    const child = mm.subMaterials[0]!,
      texture = child.getActiveTextures()[0];
    const sceneDefault = scene.defaultMaterial;
    const baselineObservers = scene.onDisposeObservable.observers.length;
    const cache = new ModelInstanceCache(scene, async () => source);
    const a = (await cache.createInstance("gun.glb", 1))!;
    expect(mm.subMaterials[0]).toBe(child);
    expect((a.meshes[0].material as MultiMaterial).subMaterials[0]).not.toBe(child);
    const cloneTexture = (a.meshes[0].material as MultiMaterial).subMaterials[0]!.getActiveTextures()[0];
    expect(cloneTexture.getInternalTexture()).toBe(texture.getInternalTexture());
    cache.dispose();
    expect(a.meshes[0].isDisposed()).toBe(false);
    expect(cloneTexture.getScene()).toBe(scene);
    expect(cloneTexture.getInternalTexture()).not.toBeNull();
    disposeModelResources([a.root], a);
    expect(scene.materials).toEqual([sceneDefault]);
    expect(scene.multiMaterials).toHaveLength(0);
    expect(cloneTexture.getScene()).toBeNull();
    expect(scene.onDisposeObservable.observers.filter((o) => !o._willBeUnregistered).length).toBe(baselineObservers);
  });
  it("releases a source whose import finishes after the owner is disposed", async () => {
    let finish!: (model: ModelLoadResult) => void;
    const cache = new ModelInstanceCache(
      scene,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = cache.createInstance("gun.glb", 1);
    cache.dispose();
    const source = model();
    finish(source);
    expect(await request).toBeNull();
    expect(source.root.isDisposed()).toBe(true);
    expect(scene.meshes).toHaveLength(0);
    expect(scene.skeletons).toHaveLength(0);
    expect(scene.animationGroups).toHaveLength(0);
  });
  it("reloads invalidated sources after map clearing or released textures, and retries failed loads", async () => {
    const load = vi.fn(async () => model());
    const cache = new ModelInstanceCache(scene, load);
    const a = (await cache.createInstance("gun.glb", 1))!;
    disposeModelResources([a.root], a);
    const previous = (await load.mock.results[0].value) as ModelLoadResult;
    previous.root.dispose();
    const b = (await cache.createInstance("gun.glb", 1))!;
    expect(load).toHaveBeenCalledTimes(2);
    disposeModelResources([b.root], b);
    const source = await load.mock.results[1].value;
    source.meshes[0].material!.getActiveTextures()[0].dispose();
    const c = (await cache.createInstance("gun.glb", 1))!;
    expect(load).toHaveBeenCalledTimes(3);
    disposeModelResources([c.root], c);
    cache.dispose();
    const retry = vi
      .fn<() => Promise<ModelLoadResult | null>>()
      .mockResolvedValueOnce(null)
      .mockImplementation(async () => model());
    const retryCache = new ModelInstanceCache(scene, retry);
    expect(await retryCache.createInstance("other.glb", 1)).toBeNull();
    const d = (await retryCache.createInstance("other.glb", 1))!;
    expect(retry).toHaveBeenCalledTimes(2);
    disposeModelResources([d.root], d);
    retryCache.dispose();
  });
});

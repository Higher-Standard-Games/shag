import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLADE } from "../../shared/entities/definitions/weapons/blade";
import { PLASMAGUN } from "../../shared/entities/definitions/weapons/plasmagun";
import { RIOTGUN } from "../../shared/entities/definitions/weapons/riotgun";
import { EntityRegistry } from "../../shared/entities/EntityRegistry";
import type { MD3LoadResult } from "../loader/model/MD3Loader";
import { parseTags } from "../loader/model/TagsLoader";
import { WeaponViewManager } from "../weapon/WeaponViewManager";

const imports = vi.hoisted(() => vi.fn());
vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({ ImportMeshAsync: imports }));
vi.mock("../weapon/HitscanEffects", () => ({
  getHitscanEffects: () => ({
    init: vi.fn(),
    stopBeam: vi.fn(),
    stopLightning: vi.fn(),
    setMuzzleAnchorResolver: vi.fn(),
  }),
}));
vi.mock("../weapon/ProjectileManager", () => ({ getProjectileManager: () => ({ init: vi.fn() }) }));
vi.mock("../loader/model/TagsLoader", async (original) => ({
  ...(await original<typeof import("../loader/model/TagsLoader")>()),
  loadTags: async () => parseTags('tag "tag_barrel2" "tag_barrel" 0 0 0 0 0 0'),
}));

type Internals = {
  currentWeapon: MD3LoadResult;
  muzzleSocket: TransformNode;
  weaponBarrels: { barrels: { root: TransformNode }[] };
};
let engine: NullEngine, scene: Scene, view: WeaponViewManager;
function imported(file: string, target: Scene) {
  const root = new Mesh("__root__", target);
  root.scaling.set(1, 1, -1);
  const body = MeshBuilder.CreateBox(file, {}, target);
  body.parent = root;
  const material = new PBRMaterial(file, target);
  material.albedoTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, target);
  body.material = material;
  const muzzle = new TransformNode("tag_flash", target);
  muzzle.parent = root;
  muzzle.position.z = 2;
  const socket = new TransformNode("tag_barrel2", target);
  socket.parent = root;
  socket.position.set(3, 4, 5);
  const skeleton = new Skeleton("weaponRig", "weaponRig", target);
  const bone = new Bone("tag_barrel2", skeleton, null, Matrix.Identity());
  bone.linkTransformNode(socket);
  body.skeleton = skeleton;
  return { meshes: [root, body], transformNodes: [muzzle, socket], skeletons: [skeleton], animationGroups: [] };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const internals = () => view as unknown as Internals;
const counts = () => [
  scene.meshes.length,
  scene.materials.length,
  scene.textures.length,
  scene.skeletons.length,
  scene.transformNodes.length,
];
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  view = new WeaponViewManager();
  view.init(scene, new FreeCamera("main", Vector3.Zero(), scene));
  EntityRegistry.getInstance().clear();
  for (const weapon of [PLASMAGUN, RIOTGUN, BLADE]) EntityRegistry.getInstance().register(weapon);
  imports.mockReset();
  imports.mockImplementation(async (file, target) => imported(file, target));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 })),
  );
});
afterEach(async () => {
  view.dispose();
  await settle();
  scene.dispose();
  engine.dispose();
  EntityRegistry.getInstance().clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("first-person prepared model sources", () => {
  it("guards cloned WebGPU view/barrel caps against later glTF raises and disables shader hot swapping", async () => {
    Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
    vi.spyOn(engine, "getCaps").mockReturnValue({ ...engine.getCaps(), texelFetch: true });
    await view.loadWeapon("plasmagun");
    await settle();
    const main = internals().currentWeapon.meshes.find((mesh) => mesh.material)!.material as PBRMaterial;
    expect(main.maxSimultaneousLights).toBe(2);
    expect(main.allowShaderHotSwapping).toBe(false);
    main.maxSimultaneousLights = 99;
    expect(main.maxSimultaneousLights).toBe(2);
    for (const barrel of internals().weaponBarrels.barrels) {
      const material = barrel.root.getChildMeshes(false)[0].material as PBRMaterial;
      expect(material.maxSimultaneousLights).toBe(4);
      expect(material.allowShaderHotSwapping).toBe(false);
      material.maxSimultaneousLights = 99;
      expect(material.maxSimultaneousLights).toBe(4);
    }
  });

  it("keeps another view's model, material and camera pair intact when this view is disposed", async () => {
    await view.loadWeapon("riotgun");
    const liveWeapon = internals().currentWeapon;
    const liveMaterial = liveWeapon.meshes.find((mesh) => mesh.material)!.material!;
    const demo = new WeaponViewManager();
    demo.init(scene, new FreeCamera("demo", Vector3.Zero(), scene));
    try {
      await demo.loadWeapon("riotgun");
      demo.dispose();
      await settle();
      view.reassertCameras();
      expect(liveWeapon.root.isDisposed()).toBe(false);
      expect(scene.materials.includes(liveMaterial)).toBe(true);
      expect(view.isWeaponModelLoaded).toBe(true);
      expect(imports).toHaveBeenCalledTimes(2); // Sources are view-owned, not global.
    } finally {
      demo.dispose();
    }
  });

  it("reloads a source invalidated by map cleanup and retries failed imports", async () => {
    imports.mockRejectedValueOnce(new Error("missing file"));
    expect(await view.loadWeapon("riotgun")).toBe(false);
    expect(await view.loadWeapon("riotgun")).toBe(true);
    for (const mesh of [...scene.meshes]) mesh.dispose(false, true);
    expect(await view.loadWeapon("riotgun")).toBe(true);
    expect(view.isWeaponModelLoaded).toBe(true);
    expect(imports).toHaveBeenCalledTimes(3);
  });

  it("imports each main/barrel source once across switches, preserves the rig/tags and bounds resources", async () => {
    expect(await view.loadWeapon("plasmagun")).toBe(true);
    await settle();
    const first = internals().currentWeapon;
    const geometry = first.meshes.find((mesh) => mesh.getTotalVertices() > 0)!.geometry;
    expect(first.root.getChildMeshes(false)[0].scaling.z).toBe(-1);
    expect(first.root.getChildMeshes(false)[0].rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(internals().muzzleSocket.isDescendantOf(first.root)).toBe(true);
    const barrels = internals().weaponBarrels.barrels;
    expect(barrels).toHaveLength(2);
    expect(barrels.map((barrel) => barrel.root.position.asArray())).toEqual([
      [3, 4, 1],
      [3, 4, 5],
    ]);
    expect(barrels[0].root.getChildMeshes(false)[0].material).not.toBe(
      barrels[1].root.getChildMeshes(false)[0].material,
    );
    for (let i = 0; i < 2; ++i) {
      await view.loadWeapon("riotgun");
      await view.loadWeapon("plasmagun");
      await settle();
    }
    const warmed = counts();
    for (let i = 0; i < 5; ++i) {
      await view.loadWeapon("riotgun");
      await view.loadWeapon("plasmagun");
      await settle();
    }
    expect(counts()).toEqual(warmed);
    expect(imports.mock.calls.map(([file]) => file).sort()).toEqual([
      "plasmagun.glb",
      "plasmagun_barrel.glb",
      "riotgun.glb",
    ]);
    expect(first.root.isDisposed()).toBe(true);
    const active = internals().currentWeapon;
    expect(active.meshes.find((mesh) => mesh.getTotalVertices() > 0)!.geometry).toBe(geometry);
    expect(
      active.meshes
        .find((mesh) => mesh.skeleton)!
        .skeleton!.bones[0].getTransformNode()!
        .isDescendantOf(active.root),
    ).toBe(true);
    view.dispose();
    await settle();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.skeletons).toHaveLength(0);
    expect(scene.textures.filter((texture) => texture !== GetEnvironmentBRDFTexture(scene))).toHaveLength(0);
  });

  it("deduplicates A-B-A in-flight requests and prevents the stale request from replacing the latest weapon", async () => {
    let complete!: (result: ReturnType<typeof imported>) => void;
    const waiting = new Promise<ReturnType<typeof imported>>((resolve) => {
      complete = resolve;
    });
    imports.mockImplementation((file, target) =>
      file === "plasmagun.glb" ? waiting : Promise.resolve(imported(file, target)),
    );
    const first = view.loadWeapon("plasmagun");
    expect(await view.loadWeapon("riotgun")).toBe(true);
    const latest = view.loadWeapon("plasmagun");
    complete(imported("plasmagun.glb", scene));
    expect(await first).toBe(false);
    expect(await latest).toBe(true);
    await settle();
    expect(imports.mock.calls.filter(([file]) => file === "plasmagun.glb")).toHaveLength(1);
    expect(view.getWeaponInfo()?.name).toBe("plasmagun");
  });

  it("clear cancels an in-flight main load without discarding the reusable source", async () => {
    let complete!: (result: ReturnType<typeof imported>) => void;
    imports.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const load = view.loadWeapon("riotgun");
    view.clear();
    complete(imported("riotgun.glb", scene));
    expect(await load).toBe(false);
    expect(view.isWeaponModelLoaded).toBe(false);
    expect(await view.loadWeapon("riotgun")).toBe(true);
    expect(imports).toHaveBeenCalledTimes(1);
  });

  it("re-init retires an in-flight source and preserves the replacement camera pair", async () => {
    let complete!: (result: ReturnType<typeof imported>) => void;
    imports.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const load = view.loadWeapon("riotgun");
    const camera = new FreeCamera("replacement", Vector3.Zero(), scene);
    view.init(scene, camera);
    const pair = [...scene.activeCameras!];
    complete(imported("riotgun.glb", scene));
    expect(await load).toBe(false);
    expect(view.isWeaponModelLoaded).toBe(false);
    expect(scene.activeCameras?.map((item) => item.uniqueId)).toEqual(pair.map((item) => item.uniqueId));
    expect(scene.meshes).toHaveLength(0);
    expect(scene.skeletons).toHaveLength(0);
  });

  it("reuses blade appearance while keeping hidden-on-death state and powerup outlines", async () => {
    view.setVisible(false);
    expect(await view.loadWeapon("blade")).toBe(true);
    expect(internals().currentWeapon.root.isEnabled()).toBe(false);
    expect(
      internals()
        .currentWeapon.meshes.find((mesh) => mesh.material)!
        .material!.getClassName(),
    ).toBe("StandardMaterial");
    view.setPowerupOutlineOverride(true, new Color3(1, 0.3, 0), 0.3);
    await view.loadWeapon("riotgun");
    await view.loadWeapon("blade");
    expect(internals().currentWeapon.meshes.every((mesh) => mesh.renderOutline)).toBe(true);
    expect(internals().currentWeapon.root.getChildMeshes(false)[0].rotation.x).toBeCloseTo(Math.PI);
    expect(imports.mock.calls.filter(([file]) => file === "blade.glb")).toHaveLength(1);
  });

  it("cancels a barrel import on disposal and leaves no imported resources", async () => {
    let complete!: (result: ReturnType<typeof imported>) => void;
    imports.mockImplementation((file, target) =>
      file.includes("_barrel")
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve(imported(file, target)),
    );
    await view.loadWeapon("plasmagun");
    await settle();
    view.dispose();
    complete(imported("plasmagun_barrel.glb", scene));
    await settle();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.skeletons).toHaveLength(0);
    expect(scene.textures.filter((texture) => texture !== GetEnvironmentBRDFTexture(scene))).toHaveLength(0);
  });
});

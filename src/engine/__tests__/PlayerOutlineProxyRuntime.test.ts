import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, expect, it, vi } from "vitest";
import { disposePlayerModel, PlayerModelManager } from "../animation/PlayerModelManager";
import { PlayerOutlineProxyRuntime } from "../rendering/PlayerOutlineProxyRuntime";

vi.mock("@babylonjs/core/Loading/sceneLoader", async (original) => ({
  ...(await original<object>()),
  LoadAssetContainerAsync: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function model(scene: Scene) {
  const mesh = CreateBox("body", {}, scene),
    hips = new TransformNode("hips", scene);
  hips.parent = mesh;
  mesh.material = new StandardMaterial("bodyMaterial", scene);
  mesh.skeleton = new Skeleton("rig", "rig", scene);
  new Bone("hips", mesh.skeleton, null, Matrix.Identity()).linkTransformNode(hips);
  const animation = new Animation("pose", "rotation.x", 30, Animation.ANIMATIONTYPE_FLOAT);
  animation.setKeys([
    { frame: 0, value: 0 },
    { frame: 1, value: 1 },
  ]);
  const group = new AnimationGroup("idle", scene);
  group.addTargetedAnimation(animation, hips);
  const container = new AssetContainer(scene);
  container.meshes = [mesh];
  container.transformNodes = [hips];
  container.skeletons = [mesh.skeleton];
  container.materials = [mesh.material];
  container.animationGroups = [group];
  container.removeAllFromScene();
  return container;
}

async function assets(scene: Scene) {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(url.endsWith(".json") ? JSON.stringify({ sourceSha256: hash, proxySha256: hash }) : bytes),
    ),
  );
  const proxy = model(scene);
  vi.mocked(LoadAssetContainerAsync).mockResolvedValue(proxy);
  return proxy;
}

it("loads only after opt-in, shares one scene adapter, follows late spawns and retires detached corpses and owners", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    a = new PlayerModelManager(scene),
    b = new PlayerModelManager(scene);
  Object.assign(a, { sourceContainer: model(scene) });
  Object.assign(b, { sourceContainer: model(scene) });
  const first = a.createInstance("player_a")!,
    second = b.createInstance("player_b")!;
  const original = scene.getOutlineRenderer().render;
  try {
    await a.setOutlineProxyEnabled(false);
    expect(PlayerOutlineProxyRuntime.existing(scene)).toBeUndefined();
    const proxy = await assets(scene),
      dispose = vi.spyOn(proxy, "dispose");
    await Promise.all([a.setOutlineProxyEnabled(true), b.setOutlineProxyEnabled(true)]);
    expect(LoadAssetContainerAsync).toHaveBeenCalledTimes(1);
    const runtime = PlayerOutlineProxyRuntime.existing(scene)!;
    expect(runtime.diagnostics()).toMatchObject({ status: "ready", attachedParts: 2, rejectedRoots: 0 });
    a.createInstance("player_new");
    expect(runtime.diagnostics().attachedParts).toBe(3);
    disposePlayerModel(first); // Ragdoll ownership bypasses manager.disposeInstance.
    expect(runtime.diagnostics().attachedParts).toBe(2);
    await a.setOutlineProxyEnabled(false);
    expect(runtime.diagnostics().status).toBe("disabled");
    await a.setOutlineProxyEnabled(true);
    expect(LoadAssetContainerAsync).toHaveBeenCalledTimes(1);
    a.dispose();
    expect(runtime.diagnostics().attachedParts).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(second.mesh.isDisposed()).toBe(false);
    b.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.getOutlineRenderer().render).toBe(original);
    expect(PlayerOutlineProxyRuntime.existing(scene)).toBeUndefined();
  } finally {
    a.dispose();
    b.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it("keeps full outlines on provenance failure and disposes a source that completes after its last owner", async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    manager = new PlayerModelManager(scene);
  const original = scene.getOutlineRenderer().render;
  try {
    await assets(scene);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await manager.setOutlineProxyEnabled(true);
    expect(PlayerOutlineProxyRuntime.existing(scene)?.diagnostics().status).toBe("failed");
    expect(scene.getOutlineRenderer().render).toBe(original);
    manager.dispose();
    const lateManager = new PlayerModelManager(scene),
      proxy = await assets(scene),
      dispose = vi.spyOn(proxy, "dispose");
    let deliver!: (value: AssetContainer) => void;
    vi.mocked(LoadAssetContainerAsync).mockReturnValue(
      new Promise((resolve) => {
        deliver = resolve;
      }),
    );
    const pending = lateManager.setOutlineProxyEnabled(true);
    await vi.waitFor(() => expect(deliver).toBeTypeOf("function"));
    lateManager.dispose();
    deliver(proxy);
    await pending;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.getOutlineRenderer().render).toBe(original);
    expect(PlayerOutlineProxyRuntime.existing(scene)).toBeUndefined();
  } finally {
    manager.dispose();
    scene.dispose();
    engine.dispose();
  }
});

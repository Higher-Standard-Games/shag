import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEntityRegistry } from "../../../shared/entities";
import { getMD3Loader } from "../../loader/model/MD3Loader";
import * as ModelAsset from "../../loader/model/ModelAsset";
import { ProjectileManager } from "../ProjectileManager";

afterEach(() => vi.restoreAllMocks());

describe("projectile preparation", () => {
  it("loads each projectile and compiles every material its model has", async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    const withMaterial = CreateBox("projectile", {}, scene);
    withMaterial.material = new StandardMaterial("projectile", scene);
    const compile = vi.spyOn(withMaterial.material, "isReadyForSubMesh").mockReturnValue(true);
    const models = new Map([
      ["rocket", { meshes: [withMaterial, { material: null }] }],
      ["grenade", { meshes: [withMaterial] }],
    ]);
    const manager = Object.assign(Object.create(ProjectileManager.prototype), {
      scene,
      modelCache: { get: (id: string) => models.get(id) },
      preloadModel: vi.fn(async () => true),
    }) as ProjectileManager & { preloadModel: ReturnType<typeof vi.fn> };

    try {
      await manager.prepare(scene, ["rocket", "grenade", "plasma_bolt"]);

      expect(manager.preloadModel.mock.calls.map(([id]) => id)).toEqual(["rocket", "grenade", "plasma_bolt"]);
      // Two meshes with a material; a model that did not load has none to compile
      expect(compile).toHaveBeenCalledTimes(2);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("rejects a required model that failed to load", async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    const manager = Object.assign(Object.create(ProjectileManager.prototype), {
      scene,
      modelCache: new Map(),
      preloadModel: vi.fn(async () => false),
    }) as ProjectileManager;
    try {
      await expect(manager.prepare(scene, ["rocket"])).rejects.toThrow("rocket");
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it.each(["clear", "scene"])("does not parse or publish an old model after %s supersedes its read", async (mode) => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      replacement = new Scene(engine);
    const manager = ProjectileManager.getInstance();
    vi.spyOn(getEntityRegistry(), "get").mockReturnValue({ id: "review", modelPath: "models/review.md3" } as never);
    let release!: (bytes: ArrayBuffer) => void;
    vi.spyOn(ModelAsset, "readIndexedModelAsset").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const parse = vi.spyOn(getMD3Loader(), "parseMD3");
    try {
      manager.init(scene);
      const old = manager.preloadModel("review");
      await vi.waitFor(() => expect(release).toBeDefined());
      if (mode === "clear") manager.clear();
      else manager.init(replacement);
      release(new ArrayBuffer(0));
      expect(await old).toBe(false);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      manager.clear();
      scene.dispose();
      replacement.dispose();
      engine.dispose();
    }
  });
});

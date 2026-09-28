import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadEffectShaders, revalidateMaterials } from "../EffectPreloader";

// The persistent gameplay light pool is outside fixture compilation ownership.
vi.mock("../PointLightPool", () => ({ getPointLightPool: () => ({ init: vi.fn() }) }));
afterEach(() => vi.restoreAllMocks());

function readyTextureEngine(): NullEngine {
  const engine = new NullEngine();
  const createRawTexture = engine.createRawTexture.bind(engine);
  // NullEngine does not upload raw textures or flag them ready. Supply only
  // that hardware boundary; material readiness/compilation remains Babylon's.
  vi.spyOn(engine, "createRawTexture").mockImplementation((...args) => {
    const texture = createRawTexture(...args);
    texture.isReady = true;
    return texture;
  });
  return engine;
}

describe("effect shader warmup", () => {
  it.each([false, true])("compiles culled fixtures without a camera or render frame (WebGPU=%s)", async (webgpu) => {
    const engine = readyTextureEngine();
    if (webgpu) Object.defineProperty(engine, "isWebGPU", { value: true });
    const scene = new Scene(engine);
    const compiled: string[] = [];
    const original = StandardMaterial.prototype.forceCompilationAsync;
    vi.spyOn(StandardMaterial.prototype, "forceCompilationAsync").mockImplementation(async function (
      this: StandardMaterial,
      mesh,
      options,
    ) {
      const temporaryLight = scene.getLightByName("_warmup_pointlight")!;
      expect(temporaryLight.includedOnlyMeshes.map((item) => item.name)).toEqual(["_warmup_bsp_b"]);
      await original.call(this, mesh, options);
      compiled.push(this.name);
    });
    try {
      expect(scene.activeCamera).toBeFalsy();
      await preloadEffectShaders(scene);
      expect(compiled).toEqual([
        "_warmup_bsp_nolight",
        "_warmup_bsp_light",
        "_warmup_trail",
        "_warmup_fireball",
        "_warmup_ray",
        "_warmup_shockwave",
        "_warmup_impact",
      ]);
      expect(scene.meshes).toHaveLength(0);
      expect(scene.materials.filter((material) => material.name.startsWith("_warmup"))).toHaveLength(0);
      expect(scene.textures).toHaveLength(0);
      expect(scene.lights).toHaveLength(0);
      expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("rejects a fixture compilation error and releases all fixture resources", async () => {
    const engine = readyTextureEngine();
    const scene = new Scene(engine);
    // Babylon may invoke onCompiled after onError; its async API rejects first.
    vi.spyOn(StandardMaterial.prototype, "forceCompilation").mockImplementation(function (
      this: StandardMaterial,
      _mesh,
      compiled,
      _options,
      error,
    ) {
      error?.("fixture shader rejected");
      compiled?.(this);
    });
    try {
      await expect(preloadEffectShaders(scene)).rejects.toBe("fixture shader rejected");
      expect(scene.meshes).toHaveLength(0);
      expect(scene.materials.filter((material) => material.name.startsWith("_warmup"))).toHaveLength(0);
      expect(scene.textures).toHaveLength(0);
      expect(scene.lights).toHaveLength(0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it.each([
    "preload",
    "revalidate",
  ] as const)("propagates a world material error and removes the %s light", async (mode) => {
    const engine = readyTextureEngine();
    const scene = new Scene(engine);
    const mesh = CreateBox("world", {}, scene);
    const material = new StandardMaterial("world", scene);
    mesh.material = material;
    vi.spyOn(material, "forceCompilation").mockImplementation((_mesh, compiled, _options, error) => {
      error?.("world shader rejected");
      compiled?.(material);
    });
    try {
      await expect(mode === "preload" ? preloadEffectShaders(scene) : revalidateMaterials(scene)).rejects.toBe(
        "world shader rejected",
      );
      expect(scene.lights).toHaveLength(0);
      expect(scene.meshes).toEqual([mesh]);
      expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

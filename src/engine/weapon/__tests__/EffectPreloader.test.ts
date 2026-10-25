import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadEffectShaders, retireTemporaryLight, revalidateMaterials } from "../EffectPreloader";

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
    const original = StandardMaterial.prototype.isReadyForSubMesh;
    vi.spyOn(StandardMaterial.prototype, "isReadyForSubMesh").mockImplementation(function (
      this: StandardMaterial,
      mesh,
      subMesh,
      instances,
    ) {
      const temporaryLight = scene.getLightByName("_warmup_pointlight")!;
      expect(temporaryLight.includedOnlyMeshes.map((item) => item.name)).toEqual(["_warmup_bsp_b"]);
      const ready = original.call(this, mesh, subMesh, instances);
      if (ready) compiled.push(this.name);
      return ready;
    });
    try {
      expect(scene.activeCamera).toBeFalsy();
      await preloadEffectShaders(scene);
      expect(compiled).toEqual(["_warmup_bsp_nolight", "_warmup_bsp_light", "_warmup_trail", "_warmup_impact"]);
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
    vi.spyOn(StandardMaterial.prototype, "isReadyForSubMesh").mockImplementation(() => {
      throw new Error("fixture shader rejected");
    });
    try {
      await expect(preloadEffectShaders(scene)).rejects.toThrow("fixture shader rejected");
      expect(scene.meshes).toHaveLength(0);
      expect(scene.materials.filter((material) => material.name.startsWith("_warmup"))).toHaveLength(0);
      expect(scene.textures).toHaveLength(0);
      expect(scene.lights).toHaveLength(0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it.each(["preload", "revalidate"] as const)(
    "propagates a world material error and removes the %s light",
    async (mode) => {
      const engine = readyTextureEngine();
      const scene = new Scene(engine);
      const mesh = CreateBox("world", {}, scene);
      const material = new StandardMaterial("world", scene);
      mesh.material = material;
      vi.spyOn(material, "isReadyForSubMesh").mockImplementation(() => {
        throw new Error("world shader rejected");
      });
      try {
        await expect(mode === "preload" ? preloadEffectShaders(scene) : revalidateMaterials(scene)).rejects.toThrow(
          "world shader rejected",
        );
        expect(scene.lights).toHaveLength(0);
        expect(scene.meshes).toEqual([mesh]);
        expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
      } finally {
        scene.dispose();
        engine.dispose();
      }
    },
  );

  it("retires a compile light: disabled at once, disposed only after two rendered frames", async () => {
    const engine = readyTextureEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 0, -5), scene);
    const mesh = CreateBox("world", {}, scene);
    mesh.material = new StandardMaterial("world", scene);
    const light = new PointLight("compile-light", Vector3.Zero(), scene);
    const dispose = vi.spyOn(light, "dispose");
    try {
      const retired = retireTemporaryLight(scene, light);
      // Out of the light set straight away, so the next frame rebuilds every
      // material without it while its uniform buffer still exists.
      expect(light.isEnabled()).toBe(false);
      expect(mesh.lightSources).not.toContain(light);
      scene.render();
      await Promise.resolve();
      expect(dispose).not.toHaveBeenCalled();
      scene.render();
      await retired;
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(scene.lights).not.toContain(light);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("makes frozen materials rebuild without a retired compile light", async () => {
    vi.useFakeTimers();
    const engine = readyTextureEngine();
    const scene = new Scene(engine);
    const frozen = new StandardMaterial("frozen", scene);
    frozen.freeze();
    const live = new StandardMaterial("live", scene);
    const frozenDirty = vi.spyOn(frozen, "markDirty");
    const liveDirty = vi.spyOn(live, "markDirty");
    const light = new PointLight("compile-light", Vector3.Zero(), scene);
    try {
      const retired = retireTemporaryLight(scene, light);
      expect(frozenDirty).toHaveBeenCalledWith(true);
      expect(liveDirty).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      await retired;
    } finally {
      vi.useRealTimers();
      scene.dispose();
      engine.dispose();
    }
  });

  it("re-freezes only what it unfroze, leaving materials nobody froze live", async () => {
    const engine = readyTextureEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 0, -5), scene);
    const world = CreateBox("world", {}, scene);
    world.material = new StandardMaterial("world", scene);
    world.material.freeze();
    const gib = CreateBox("gib", {}, scene);
    const gibMaterial = new StandardMaterial("gib", scene);
    gib.material = gibMaterial;
    // revalidateMaterials waits on rendered frames
    const frames = setInterval(() => scene.render(), 5);
    try {
      await revalidateMaterials(scene);
      expect(world.material.isFrozen).toBe(true);
      // Frozen, a gib's material would keep the shader of today's light set,
      // and its draws fail once that set changes
      expect(gibMaterial.isFrozen).toBe(false);
    } finally {
      clearInterval(frames);
      scene.dispose();
      engine.dispose();
    }
  });

  it("retires a compile light without frames when nothing renders", async () => {
    vi.useFakeTimers();
    const engine = readyTextureEngine();
    const scene = new Scene(engine);
    const light = new PointLight("compile-light", Vector3.Zero(), scene);
    try {
      const retired = retireTemporaryLight(scene, light);
      await vi.advanceTimersByTimeAsync(500);
      await retired;
      expect(scene.lights).toHaveLength(0);
      expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
    } finally {
      vi.useRealTimers();
      scene.dispose();
      engine.dispose();
    }
  });

  it("restores frozen ownership and removes compile observers when recovery is cancelled", async () => {
    vi.useFakeTimers();
    const engine = readyTextureEngine(),
      scene = new Scene(engine);
    const world = CreateBox("world", {}, scene),
      material = new StandardMaterial("world", scene);
    world.material = material;
    material.freeze();
    vi.spyOn(material, "isReadyForSubMesh").mockReturnValue(false);
    const controller = new AbortController();
    const pending = revalidateMaterials(scene, controller.signal);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.dynamicImportSettled();
    controller.abort(new Error("cancelled"));
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(material.isFrozen).toBe(true);
    expect(scene.lights).toHaveLength(0);
    expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
    scene.dispose();
    engine.dispose();
    vi.useRealTimers();
  });
});

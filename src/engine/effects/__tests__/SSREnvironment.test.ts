import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/EventBus";
import RenderVars from "../../rendering/RenderVars";
import { SSREffect } from "../SSREffect";

// Stub only the GPU pipeline, keeping real scene/texture events and ownership.
const gpu = vi.hoisted(() => ({
  pipelines: [] as { environmentTexture: CubeTexture | null; dispose: ReturnType<typeof vi.fn> }[],
  failConfiguration: false,
}));
vi.mock("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline", () => ({
  SSRRenderingPipeline: class {
    isSupported = true;
    environmentTexture: CubeTexture | null = null;
    dispose = vi.fn();
    constructor() {
      gpu.pipelines.push(this);
    }
  },
}));
vi.mock("../../core/QualityDetector", () => ({
  QualityDetector: {
    getInstance: () => ({
      getDeviceInfo: () => {
        if (gpu.failConfiguration) throw new Error("configuration failed");
        return { gpuTier: 3 };
      },
    }),
  },
}));

let engine: NullEngine;
let scene: Scene;
function setup(webgpu: boolean) {
  engine = new NullEngine();
  Object.defineProperty(engine, "isWebGPU", { value: webgpu });
  scene = new Scene(engine);
  new FreeCamera("camera", Vector3.Zero(), scene);
  const vars = RenderVars.getInstance();
  const get = vars.get.bind(vars);
  vi.spyOn(vars, "get").mockImplementation((name) => (name === "r_ssr" ? 1 : get(name)));
  const effect = SSREffect.getInstance();
  effect.init(scene);
  return effect;
}

afterEach(() => {
  SSREffect.resetInstance();
  scene?.dispose();
  engine?.dispose();
  gpu.pipelines.length = 0;
  gpu.failConfiguration = false;
  vi.restoreAllMocks();
});

describe("SSR environment ownership", () => {
  it.each([false, true])("follows late maps, explicit environments and texture disposal (WebGPU=%s)", (webgpu) => {
    const effect = setup(webgpu);
    const pipeline = gpu.pipelines[0];
    expect(pipeline.environmentTexture).toBeNull();
    const sky = new Mesh("skybox", scene);
    const material = new StandardMaterial("sky", scene);
    sky.material = material;
    const first = new CubeTexture("", scene);
    material.reflectionTexture = first;
    EventBus.emit("map:loaded", { mapName: "first" });
    expect(pipeline.environmentTexture).toBe(first);
    const explicit = new CubeTexture("", scene);
    scene.environmentTexture = explicit;
    expect(pipeline.environmentTexture).toBe(explicit);
    explicit.dispose();
    expect(pipeline.environmentTexture).toBe(first);
    const second = new CubeTexture("", scene);
    material.reflectionTexture = second;
    EventBus.emit("map:loaded", { mapName: "second" });
    expect(pipeline.environmentTexture).toBe(second);
    first.dispose(); // Old map disposal must not clear the new map's binding.
    expect(pipeline.environmentTexture).toBe(second);
    second.dispose();
    expect(pipeline.environmentTexture).toBeNull();
    expect(gpu.pipelines).toHaveLength(1); // No full-pipeline rebuild per map.
    effect.dispose();
    expect(pipeline.dispose).toHaveBeenCalledOnce();
    EventBus.emit("map:loaded", { mapName: "after-dispose" });
    expect(gpu.pipelines).toHaveLength(1);
  });

  it("releases scene/texture subscriptions without disposing the shared environment", () => {
    const effect = setup(false);
    const texture = new CubeTexture("", scene);
    const dispose = vi.spyOn(texture, "dispose");
    const before = texture.onDisposeObservable.observers.length;
    scene.environmentTexture = texture;
    expect(texture.onDisposeObservable.observers.length).toBe(before + 1);
    effect.dispose();
    expect(texture.onDisposeObservable.observers.filter((o) => !o._willBeUnregistered)).toHaveLength(before);
    expect(dispose).not.toHaveBeenCalled();
    scene.environmentTexture = null;
    EventBus.emit("map:loaded", { mapName: "unused" });
    expect(gpu.pipelines).toHaveLength(1);
  });

  it("disposes its pipeline when the scene ends", () => {
    const effect = setup(false);
    scene.dispose();
    expect(effect.isEnabled()).toBe(false);
    expect(gpu.pipelines[0].dispose).toHaveBeenCalledOnce();
  });

  it("cleans up a pipeline when configuration fails", () => {
    gpu.failConfiguration = true;
    const effect = setup(false);
    expect(effect.isEnabled()).toBe(false);
    expect(gpu.pipelines[0].dispose).toHaveBeenCalledOnce();
  });
});

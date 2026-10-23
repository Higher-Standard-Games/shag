import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/EventBus";
import { ServiceLocator } from "../../core/ServiceLocator";
import { RenderVars } from "../../rendering/RenderVars";
import { PostProcessingManager } from "../PostProcessingManager";

const pipelines = vi.hoisted(() => ({ defaults: [] as FakePipeline[], ssao: [] as FakePipeline[] }));
interface FakePipeline {
  cameras: unknown[];
  bloomEnabled?: boolean;
  imageProcessingEnabled?: boolean;
  chromaticAberrationEnabled?: boolean;
  disposed: boolean;
}
vi.mock("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline", () => ({
  DefaultRenderingPipeline: class {
    disposed = false;
    imageProcessing = {};
    chromaticAberration = {};
    constructor(
      _name: string,
      _hdr: boolean,
      _scene: unknown,
      public cameras: unknown[],
    ) {
      pipelines.defaults.push(this);
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline", () => ({
  SSAO2RenderingPipeline: class {
    disposed = false;
    constructor(
      _name: string,
      _scene: unknown,
      _options: unknown,
      public cameras: unknown[],
    ) {
      pipelines.ssao.push(this);
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock("../CelOutlinePostProcess", () => ({
  CelOutlinePostProcess: { getInstance: () => new Proxy({}, { get: () => () => {} }) },
}));

let engine: NullEngine;
let scene: Scene;
let manager: PostProcessingManager;
beforeEach(() => {
  pipelines.defaults.length = 0;
  pipelines.ssao.length = 0;
  engine = new NullEngine();
  scene = new Scene(engine);
  manager = PostProcessingManager.getInstance();
});
afterEach(() => {
  manager.dispose();
  PostProcessingManager.resetInstance();
  ServiceLocator.getInstance().dispose();
  scene.dispose();
  engine.dispose();
  EventBus.clear();
});

describe("postprocessing ownership", () => {
  it("applies the default bloom-off value when scene render settings initialize", () => {
    manager.init(scene, new FreeCamera("world", Vector3.Zero(), scene));
    RenderVars.getInstance().init();
    expect(manager.getSettings().bloom.weight).toBe(0);
    expect(pipelines.defaults[0].bloomEnabled).toBe(false);
  });

  it("binds the existing camera through the scene service contract", async () => {
    const camera = new FreeCamera("world", Vector3.Zero(), scene);
    scene.activeCamera = camera;
    const services = ServiceLocator.getInstance();
    services.register({ name: "test-postprocessing", phase: "scene", factory: () => manager });
    await services.initScene(scene);
    expect(pipelines.defaults).toHaveLength(1);
    expect(pipelines.defaults[0].cameras).toEqual([camera]);
  });

  it("waits for the first camera and detaches when no camera remains", () => {
    manager.init(scene);
    expect(pipelines.defaults).toHaveLength(0);
    const camera = new FreeCamera("world", Vector3.Zero(), scene);
    scene.activeCamera = camera;
    expect(pipelines.defaults).toHaveLength(1);
    scene.activeCamera = null;
    expect(pipelines.defaults[0].disposed).toBe(true);
  });

  it("releases listeners across dispose/reinit", () => {
    const camera = new FreeCamera("world", Vector3.Zero(), scene);
    const before = EventBus.listenerCount("clock:tick");
    manager.init(scene, camera);
    manager.dispose();
    expect(EventBus.listenerCount("clock:tick")).toBe(before);
    manager.init(scene, camera);
    expect(EventBus.listenerCount("clock:tick")).toBe(before + 1);
    manager.dispose();
    const count = pipelines.defaults.length;
    scene.activeCamera = new FreeCamera("later", Vector3.Zero(), scene);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(pipelines.defaults).toHaveLength(count);
  });

  it("follows world camera pair replacements without attaching effects to the weapon", () => {
    const world = new FreeCamera("world", Vector3.Zero(), scene);
    const weapon = new FreeCamera("weapon", Vector3.Zero(), scene);
    scene.activeCameras = [world, weapon];
    manager.init(scene);
    scene.activeCamera = weapon;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(pipelines.defaults).toHaveLength(1);
    expect(pipelines.defaults[0].cameras).toEqual([world]);

    const demo = new FreeCamera("demo", Vector3.Zero(), scene);
    scene.activeCameras = [demo, weapon];
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(pipelines.defaults[0].disposed).toBe(true);
    expect(pipelines.defaults[1].cameras).toEqual([demo]);
  });

  it("stays on the view camera while a render target draws through its own camera", () => {
    const world = new FreeCamera("world", Vector3.Zero(), scene);
    scene.activeCamera = world;
    manager.init(scene);
    const portal = new FreeCamera("portal", Vector3.Zero(), scene);
    scene.customRenderTargets.push(new RenderTargetTexture("portal", 4, scene));
    scene.customRenderTargets[0].activeCamera = portal;
    scene.activeCamera = portal;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    scene.activeCamera = world;
    expect(pipelines.defaults).toHaveLength(1);
    expect(pipelines.defaults[0].disposed).toBe(false);
  });

  it("restores independent nested defaults", () => {
    manager.setBloomIntensity(0.73);
    manager.setSSAOIntensity(1.7);
    manager.resetToDefaults();
    expect(manager.getSettings().bloom.weight).toBe(0.3);
    expect(manager.getSettings().ssao.intensity).toBe(1);
  });

  it("does not retain caller-owned settings objects", () => {
    const bloom = { enabled: true, threshold: 0.8, weight: 0.4, kernel: 64, scale: 0.5 };
    manager.updateSettings({ bloom });
    bloom.weight = 0.99;
    expect(manager.getSettings().bloom.weight).toBe(0.4);
    manager.getSettings().bloom.weight = 0.88;
    expect(manager.getSettings().bloom.weight).toBe(0.4);
  });

  it("disables the bloom pass at zero weight and restores it at positive weight", () => {
    manager.init(scene, new FreeCamera("world", Vector3.Zero(), scene));
    manager.updateSettings({ bloom: { ...manager.getSettings().bloom, weight: 0 } });
    expect(pipelines.defaults[0].bloomEnabled).toBe(false);
    manager.updateSettings({ bloom: { ...manager.getSettings().bloom, weight: 0.3 } });
    expect(pipelines.defaults[0].bloomEnabled).toBe(true);
    manager.setBloomIntensity(0);
    expect(pipelines.defaults[0].bloomEnabled).toBe(false);
    manager.setBloomIntensity(0.3);
    expect(pipelines.defaults[0].bloomEnabled).toBe(true);
  });

  it("keeps requested effects dormant under the master switch and restores them", () => {
    manager.init(scene, new FreeCamera("world", Vector3.Zero(), scene));
    manager.setSSAOEnabled(true);
    expect(pipelines.ssao).toHaveLength(1);
    manager.setEnabled(false);
    expect(pipelines.ssao[0].disposed).toBe(true);
    manager.setBloomEnabled(true);
    manager.setVignetteEnabled(true);
    manager.setChromaticAberrationEnabled(true);
    manager.setSSAOEnabled(true);
    expect(pipelines.defaults[0].bloomEnabled).toBe(false);
    expect(pipelines.defaults[0].imageProcessingEnabled).toBe(false);
    expect(pipelines.defaults[0].chromaticAberrationEnabled).toBe(false);
    expect(pipelines.ssao).toHaveLength(1);
    manager.setEnabled(true);
    expect(pipelines.defaults[0].bloomEnabled).toBe(true);
    expect(pipelines.defaults[0].chromaticAberrationEnabled).toBe(true);
    expect(pipelines.ssao).toHaveLength(2);
  });
});

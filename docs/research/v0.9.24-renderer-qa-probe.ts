/** CPU-side observations only. No GPU compilation or visual acceptance implied. */
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { EventBus } from "../../src/engine/core/EventBus";
import { ServiceLocator } from "../../src/engine/core/ServiceLocator";
import { CelOutlinePostProcess } from "../../src/engine/effects/CelOutlinePostProcess";
import { PostProcessingManager } from "../../src/engine/effects/PostProcessingManager";
import { BspManager } from "../../src/engine/loader/bsp/BspManager";
import { createTextureFromKTX1, GL_FORMATS, type KTX1ParseResult } from "../../src/engine/loader/texture/KTX1Loader";

const engine = new NullEngine();
const scene = new Scene(engine);
const camera = new FreeCamera("qa-camera", Vector3.Zero(), scene);
scene.activeCamera = camera;
const manager = PostProcessingManager.getInstance();
const observations: Record<string, unknown> = {};

try {
  const locator = ServiceLocator.getInstance();
  locator.register({ name: "qa-postprocessing", factory: () => manager, phase: "scene" });
  const clockBefore = EventBus.listenerCount("clock:tick");
  await locator.initScene(scene);

  // Read private state for diagnosis, never as an application integration API.
  const state = manager as unknown as {
    camera: unknown;
    pipeline: { dispose?(): void } | null;
    ssaoPipeline: { dispose(): void } | null;
  };
  observations.serviceInit = {
    initialized: manager.isInitialized(),
    sceneHasCamera: !!scene.activeCamera,
    managerHasCamera: !!state.camera,
    managerHasPipeline: !!state.pipeline,
  };

  const initialBloom = manager.getSettings().bloom.weight;
  manager.setBloomIntensity(0.73);
  manager.resetToDefaults();
  observations.defaults = { initialBloom, afterReset: manager.getSettings().bloom.weight };

  // Install disposal sentinels to exercise manager control flow without an
  // unsupported NullEngine SSAO render pass. This is not real GPU SSAO coverage.
  let ssaoDisposals = 0;
  state.pipeline?.dispose?.();
  state.pipeline = {};
  state.ssaoPipeline = { dispose: () => ssaoDisposals++ };
  manager.setEnabled(false);
  observations.masterDisable = { ssaoDisposals, retainsSSAOPipeline: !!state.ssaoPipeline };
  state.pipeline = null;
  state.ssaoPipeline = null;

  locator.dispose();
  observations.subscriptions = { clockBefore, clockAfterDispose: EventBus.listenerCount("clock:tick") };

  const world = new Mesh("qa-bsp-world", scene);
  const child = new Mesh("qa-bsp-child", scene);
  child.parent = world;
  const material = new StandardMaterial("qa-bsp-material", scene);
  child.material = material;
  BspManager.getInstance().setMeshResult({ worldMesh: world, lightmapTextures: [] });
  BspManager.getInstance().clearRender();
  observations.clearRender = {
    worldDisposed: world.isDisposed(),
    childDisposed: child.isDisposed(),
    materialStillInScene: scene.materials.includes(material),
  };

  const cel = CelOutlinePostProcess.getInstance();
  cel.init(scene, camera);
  cel.setEnabled(true);
  const outlineTarget = camera.customRenderTargets[0];
  cel.setEnabled(false);
  const depthRenderers = (scene as unknown as {
    _depthRenderer: Record<string, { enabled: boolean }>;
  })._depthRenderer;
  observations.outlineDisable = {
    retainedDepthRenderers: Object.keys(depthRenderers ?? {}).length,
    anyDepthRendererEnabled: Object.values(depthRenderers ?? {}).some((renderer) => renderer.enabled),
    retainedCameraTarget: camera.customRenderTargets.includes(outlineTarget),
    retainedTexture: scene.textures.includes(outlineTarget),
  };
  cel.dispose();

  // Boundary sentinel only: verify asynchronous Babylon delegation, not a GPU.
  const source = new ArrayBuffer(0);
  const calls: unknown[][] = [];
  const internalTexture = { isReady: false };
  const uploadEngine = {
    getCaps: () => ({ s3tc: true }),
    createTexture: (...args: unknown[]) => {
      calls.push(args);
      queueMicrotask(() => {
        internalTexture.isReady = true;
        (args[5] as (texture: unknown) => void)(internalTexture);
      });
      return internalTexture;
    },
  } as unknown as AbstractEngine;
  const compressed = {
    source,
    littleEndian: true,
    header: { glInternalFormat: GL_FORMATS.COMPRESSED_RGB_S3TC_DXT1_EXT, pixelWidth: 4, pixelHeight: 4 },
    mipLevels: [{ width: 4, height: 4, data: new Uint8Array(8) }],
    isCompressed: true,
    formatName: "DXT1",
  } as KTX1ParseResult;
  const uploaded = await createTextureFromKTX1(uploadEngine, compressed, "qa-dxt1.ktx");
  observations.compressedKTX1 = {
    delegatedToBabylon: calls.length === 1,
    passedSourceBuffer: calls[0]?.[7] === source,
    forcedKTXLoader: calls[0]?.[10] === ".ktx",
    waitedForReady: uploaded === internalTexture && internalTexture.isReady,
  };
} finally {
  manager.dispose();
  PostProcessingManager.resetInstance();
  EventBus.clear();
  scene.dispose();
  engine.dispose();
}

console.log("RENDERER_QA_OBSERVATIONS " + JSON.stringify(observations, null, 2));

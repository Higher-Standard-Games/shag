import "@babylonjs/core/Animations/animatable";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import "@babylonjs/core/Engines/Extensions/engine.query";
import "@babylonjs/loaders/glTF";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { timedemoPercentiles } from "../../shared/benchmark/TimedemoFixture";
import { readPlayerModelAsset } from "../animation/PlayerModelAssets";
import { PlayerModelManager } from "../animation/PlayerModelManager";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { CrowdActors, type CrowdRecipe, crowdSchedule, validateCrowdRecipe } from "./CrowdBenchmark";
import { PlayerOutlineProxy } from "./PlayerOutlineProxy";
import { observeRendererDevice, waitForRendererGPU } from "./RendererDiagnostics";
import { createRenderingEngine, resolveRenderingBackend } from "./RenderingEngineFactory";
import { applySceneRendererPolicy } from "./SceneRendererPolicy";

interface Sample {
  tick: number;
  wallMs: number | null;
  cpuMs: number;
  poseCpuMs: number;
  drawCalls: number;
  actors: number;
  bodyParts: number;
  proxyPasses: number;
  proxyIndices: number;
}

interface CrowdRun {
  repetition: number;
  count: number;
  outline: number;
  geometry?: "full" | "proxy";
  valid: boolean;
  reasons: string[];
  expectedBodyParts: number;
  expectedDraws: number;
  expectedProxyIndices: number;
  shaderCompiles: number;
  summary: Record<string, ReturnType<typeof timedemoPercentiles>>;
  gpuSamplesMs: number[];
  samples: Sample[];
}

const report: {
  schemaVersion: number;
  status: string;
  progress: string;
  stage: string;
  tick: number;
  currentCase?: { repetition: number; count: number; outline: number; geometry?: "full" | "proxy" };
  recipe?: CrowdRecipe;
  environment: Record<string, unknown>;
  assets: { file: string; sha256: string }[];
  inventory: ReturnType<CrowdActors["inventory"]>;
  proxyInventory?: ReturnType<PlayerOutlineProxy["inventory"]>;
  review?: { view: string; poseTick: number; camera: number[]; target: number[]; occluder: boolean };
  runs: CrowdRun[];
  error?: string;
  limitations: string[];
} = {
  schemaVersion: 1,
  status: "loading",
  progress: "loading",
  stage: "loading",
  tick: 0,
  environment: {},
  assets: [],
  inventory: [],
  runs: [],
  limitations: [
    "Isolated actor render test, not map/gameplay FPS. No bots, network, weapons, postprocesses or reflections.",
    "Refresh-paced fixed presentation ticks; animation sequence is identical, playback speed can differ with refresh rate.",
    "CPU includes explicit pose updates and scene.render, excluding endFrame/present, polling and validation bookkeeping.",
    "GPU counters are asynchronous fresh samples, not assigned to individual presentation ticks; boundary samples may come from warmup.",
    "Active-body/draw coverage is not proof of pixel visibility or full outline/occlusion parity.",
  ],
};
const state = window as Window & {
  crowdBenchmark?: typeof report;
  abortCrowdBenchmark?: () => void;
  continueCrowdReview?: () => void;
};
state.crowdBenchmark = report;
let failure: Error | undefined;
state.abortCrowdBenchmark = () => {
  failure ??= new Error("Crowd benchmark aborted");
};
const label = document.getElementById("status")!;
const publish = (progress: string) => {
  report.progress = progress;
  label.textContent = `${progress} · Escape to stop`;
};
const hidden = () => {
  if (document.hidden) failure ??= new Error("Crowd benchmark tab became hidden");
};
const keyboard = (event: KeyboardEvent) => {
  if (event.key === "Escape") state.abortCrowdBenchmark?.();
};

async function measure(
  engine: AbstractEngine,
  scene: Scene,
  actors: CrowdActors,
  stats: SceneInstrumentation,
  gpu: EngineInstrumentation,
  item: { repetition: number; count: number; outline: number; geometry?: "full" | "proxy" },
  proxy?: PlayerOutlineProxy,
): Promise<CrowdRun> {
  const recipe = actors.recipe;
  report.stage = "prepare";
  actors.configure(item.count, item.outline);
  if (proxy) proxy.enabled = item.geometry === "proxy";
  await scene.whenReadyAsync(); // Outside timing: never invoke readiness during measured frames.
  const samples: Sample[] = [],
    gpuSamplesMs: number[] = [],
    reasons = new Set<string>();
  let frame = 0,
    previous: number | null = null,
    pending: Sample | null = null;
  let baseline = 0,
    gpuCount = gpu.gpuFrameTimeCounter?.count ?? 0;
  const expectedBodyParts = actors.expectedBodyParts(),
    expectedDraws = actors.expectedDraws(2);
  const expectedProxyIndices = proxy?.enabled ? proxy.expectedIndices() : 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      engine.stopRenderLoop(render);
      engine.onEndFrameObservable.remove(observer);
      if (error) reject(error);
      else resolve();
    };
    const observer = engine.onEndFrameObservable.add(() => {
      if (!pending) return;
      const coverage = actors.coverage(scene);
      pending.drawCalls = stats.drawCallsCounter.current;
      pending.actors = coverage.actors;
      pending.bodyParts = coverage.bodyParts;
      if (coverage.actors !== item.count || coverage.bodyParts !== expectedBodyParts)
        reasons.add("Visible active body coverage differs from recipe");
      if (pending.drawCalls !== expectedDraws)
        reasons.add("Actual draws differ from the opaque body/outline pass budget");
      if (
        proxy &&
        (proxy.fallbackPasses ||
          pending.proxyIndices !== expectedProxyIndices ||
          pending.proxyPasses !== (item.geometry === "proxy" && item.outline ? expectedBodyParts * 2 : 0))
      )
        reasons.add("Proxy pass coverage differs or used full-geometry fallback");
      const counter = gpu.gpuFrameTimeCounter;
      if (counter && counter.count > gpuCount) {
        gpuCount = counter.count;
        if (counter.current > 0) gpuSamplesMs.push(counter.current / 1e6);
      }
      samples.push(pending);
      pending = null;
      if (samples.length === recipe.measuredFrames) finish();
    });
    const timeout = setTimeout(() => finish(new Error("Crowd render loop timed out")), 120000);
    const render = () => {
      try {
        if (failure) throw failure;
        const measured = frame >= recipe.warmupFrames;
        const tick = measured ? frame - recipe.warmupFrames : frame;
        report.stage = measured ? "measure" : "warmup";
        report.tick = tick;
        const at = performance.now();
        if (tick === 0 && measured) {
          baseline = gpu.shaderCompilationTimeCounter.count;
          gpuCount = gpu.gpuFrameTimeCounter?.count ?? 0;
          previous = null;
        }
        const poseAt = performance.now();
        proxy?.resetCounters();
        actors.pose(tick);
        const poseCpuMs = performance.now() - poseAt;
        scene.render();
        if (measured) {
          pending = {
            tick,
            wallMs: previous === null ? null : at - previous,
            cpuMs: performance.now() - at,
            poseCpuMs,
            drawCalls: 0,
            actors: 0,
            bodyParts: 0,
            proxyPasses: proxy?.routedPasses ?? 0,
            proxyIndices: proxy?.routedIndices ?? 0,
          };
        }
        previous = at;
        frame++;
      } catch (error) {
        finish(error);
      }
    };
    engine.runRenderLoop(render);
  });
  await waitForRendererGPU(engine);
  if (failure) throw failure;
  const shaderCompiles = gpu.shaderCompilationTimeCounter.count - baseline;
  if (shaderCompiles) reasons.add("Shaders compiled during measurement");
  return {
    ...item,
    valid: !reasons.size,
    reasons: [...reasons],
    expectedBodyParts,
    expectedDraws,
    expectedProxyIndices,
    shaderCompiles,
    summary: Object.fromEntries(
      ["wallMs", "cpuMs", "poseCpuMs", "drawCalls", "actors", "bodyParts", "proxyPasses", "proxyIndices"].map((key) => [
        key,
        timedemoPercentiles(
          samples.map((s) => s[key as keyof Sample]).filter((n): n is number => typeof n === "number"),
        ),
      ]),
    ),
    gpuSamplesMs,
    samples,
  };
}

async function run(): Promise<void> {
  let scene: Scene | undefined, engine: AbstractEngine | undefined, actors: CrowdActors | undefined;
  let manager: PlayerModelManager | undefined,
    stats: SceneInstrumentation | undefined,
    gpu: EngineInstrumentation | undefined;
  let unobserve = () => {};
  let proxy: PlayerOutlineProxy | undefined, proxyContainer: AssetContainer | undefined;
  document.addEventListener("visibilitychange", hidden);
  document.addEventListener("keydown", keyboard);
  try {
    PK3Loader.getInstance().configure({ basePath: "/data/" });
    const response = await fetch("/benchmarks/recipes/player-crowd-v1.json");
    if (!response.ok) throw new Error("Crowd recipe unavailable");
    const recipe: unknown = await response.json();
    validateCrowdRecipe(recipe);
    const search = new URLSearchParams(location.search);
    if (search.has("repeats")) recipe.repeats = Number(search.get("repeats"));
    if (search.has("counts")) recipe.counts = search.get("counts")!.split(",").map(Number);
    if (search.get("outlineProxy") === "1") recipe.outlineGeometry = ["full", "proxy"];
    validateCrowdRecipe(recipe);
    report.recipe = recipe;
    const proxyFile = "/data/benchmarks/outline-proxy/player-outline-proxy-v1.glb";
    for (const file of [
      recipe.model.root + recipe.model.file,
      recipe.model.root + recipe.animation.file,
      ...(recipe.outlineGeometry ? [proxyFile, `${proxyFile}.json`] : []),
    ]) {
      const bytes = await readPlayerModelAsset(file);
      if (!bytes) throw new Error(`Missing crowd asset ${file}`);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      report.assets.push({ file, sha256: [...hash].map((n) => n.toString(16).padStart(2, "0")).join("") });
    }
    const requested = resolveRenderingBackend(false, location.search);
    const result = await createRenderingEngine(document.getElementById("crowd") as HTMLCanvasElement, requested);
    engine = result.engine;
    if (result.backend !== requested) throw new Error(`Crowd renderer fallback: ${result.fallbackReason}`);
    engine.setSize(recipe.render.width, recipe.render.height);
    scene = new Scene(engine);
    scene.clearColor = new Color4(0.05, 0.07, 0.1, 1);
    applySceneRendererPolicy(scene);
    unobserve = observeRendererDevice(engine, (error) => {
      failure ??= new Error(String(error));
    });
    const camera = new FreeCamera("crowdCamera", Vector3.FromArray(recipe.camera.position), scene);
    camera.setTarget(Vector3.FromArray(recipe.camera.target));
    camera.fov = (recipe.render.fov * Math.PI) / 180;
    camera.minZ = 1;
    camera.maxZ = 2000;
    scene.activeCamera = camera;
    new HemisphericLight("crowdAmbient", Vector3.Up(), scene).intensity = 1;
    const floor = CreateBox("floor", { width: 800, depth: 800, height: 2 }, scene);
    floor.position.y = -2;
    const wall = CreateBox("wall", { width: 800, depth: 2, height: 180 }, scene);
    wall.position.set(0, 88, 300);
    const neutral = new StandardMaterial("neutral", scene);
    neutral.diffuseColor = new Color3(0.2, 0.24, 0.3);
    floor.material = neutral;
    wall.material = neutral;
    const occluder =
      search.get("visual") === "1"
        ? CreateBox("reviewOccluder", { width: 45, height: 44, depth: 8 }, scene)
        : undefined;
    if (occluder) {
      occluder.position.set(-180, 20, -210);
      occluder.material = neutral;
      occluder.setEnabled(false);
    }
    manager = new PlayerModelManager(scene);
    await manager.loadModel(recipe.model.root, recipe.model.file, [
      { name: recipe.animation.name, file: recipe.animation.file },
    ]);
    if (!manager.isLoaded) throw new Error("Crowd player model failed to load");
    actors = new CrowdActors(manager, recipe);
    report.inventory = actors.inventory();
    if (recipe.outlineGeometry) {
      const manifest = await (await fetch(`${proxyFile}.json`)).json();
      if (manifest.sourceSha256 !== report.assets[0].sha256 || manifest.proxySha256 !== report.assets[2].sha256)
        throw new Error("Outline proxy provenance differs from measured assets");
      proxyContainer = await LoadAssetContainerAsync(proxyFile, scene, {
        pluginOptions: { gltf: { animationStartMode: 0 } },
      });
      proxy = new PlayerOutlineProxy(scene);
      proxy.attachContainer(actors.bodyMeshes(), proxyContainer);
      report.proxyInventory = proxy.inventory();
    }
    stats = new SceneInstrumentation(scene);
    gpu = new EngineInstrumentation(engine);
    gpu.captureGPUFrameTime = true;
    gpu.captureShaderCompilationTime = true;
    report.environment = {
      requestedBackend: requested,
      backend: result.backend,
      babylonVersion: Engine.Version,
      viewport: [innerWidth, innerHeight],
      render: [engine.getRenderWidth(), engine.getRenderHeight()],
      dpr: devicePixelRatio,
      browser: navigator.userAgent,
      compatibilityMode: engine.compatibilityMode ?? null,
      timerQuery: !!engine.getCaps().timerQuery,
    };
    report.status = "running";
    for (const item of crowdSchedule(recipe)) {
      report.currentCase = item;
      publish(
        `Run ${item.repetition}/${recipe.repeats}: ${item.count} players, outline ${item.outline}, ${item.geometry ?? "full"} geometry`,
      );
      report.runs.push(await measure(engine, scene, actors, stats, gpu, item, proxy));
      if (occluder && item.count === 10 && item.outline === 1 && item.repetition === 1) {
        for (const view of ["overview", "near", "occluded"]) {
          const position = view === "overview" ? recipe.camera.position : [-180, 60, -285];
          const target = view === "overview" ? recipe.camera.target : [-180, 42, -160];
          camera.position.copyFromFloats(position[0], position[1], position[2]);
          camera.setTarget(Vector3.FromArray(target));
          occluder.setEnabled(view === "occluded");
          actors.pose(30, true);
          engine.beginFrame();
          scene.render();
          engine.endFrame();
          await waitForRendererGPU(engine);
          report.review = { view, poseTick: 30, camera: position, target, occluder: view === "occluded" };
          report.stage = "review";
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              delete state.continueCrowdReview;
              reject(new Error("Visual review timed out"));
            }, 60000);
            state.continueCrowdReview = () => {
              clearTimeout(timeout);
              delete state.continueCrowdReview;
              report.stage = "prepare";
              resolve();
            };
          });
        }
        camera.position.copyFromFloats(recipe.camera.position[0], recipe.camera.position[1], recipe.camera.position[2]);
        camera.setTarget(Vector3.FromArray(recipe.camera.target));
        occluder.setEnabled(false);
        delete report.review;
      }
    }
    report.status = "complete";
    publish(`Complete: ${report.runs.filter((r) => r.valid).length}/${report.runs.length} valid runs`);
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    publish(report.error);
  } finally {
    document.removeEventListener("visibilitychange", hidden);
    document.removeEventListener("keydown", keyboard);
    unobserve();
    stats?.dispose();
    gpu?.dispose();
    proxy?.dispose();
    proxyContainer?.dispose();
    actors?.dispose();
    manager?.dispose();
    scene?.dispose();
    engine?.dispose();
  }
}

void run();

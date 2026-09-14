/** Browser diagnostic fixture; launched by bsp-performance-check.mjs. */
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import "@babylonjs/core/Engines/Extensions/engine.query";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { horizontalFovToVerticalRadians } from "../src/engine/camera/FovSettings";
import { GamePaths } from "../src/engine/core/GamePaths";
import { GameTimer } from "../src/engine/core/GameTimer";
import { PostProcessingManager } from "../src/engine/effects/PostProcessingManager";
import { BspManager } from "../src/engine/loader/bsp/BspManager";
import { MapLoader } from "../src/engine/loader/map/MapLoader";
import { PK3Index } from "../src/engine/loader/pk3/PK3Index";
import { DEFAULT_VIEWHEIGHT } from "../src/engine/physics/PlayerPhysicsConstants";
import { captureRendererPerformance, percentile } from "../src/engine/rendering/RendererPerformanceCapture";
import RenderVars from "../src/engine/rendering/RenderVars";

const params = new URLSearchParams(location.search);
const map = params.get("map") ?? "wbomb6";
const cellSize = Number(params.get("cell") ?? 0);
const canvas = document.querySelector("canvas")!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const camera = new FreeCamera("world", Vector3.Zero(), scene);
camera.minZ = 1;
camera.maxZ = 10000;
camera.fov = horizontalFovToVerticalRadians(90);
camera.layerMask = 0x0fffffff;
const weapon = new FreeCamera("weapon", Vector3.Zero(), scene);
weapon.layerMask = 0x10000000;
scene.activeCameras = [camera, weapon];
const vars = RenderVars.getInstance();
vars.getVar("r_bsp_cellsize")!.value = cellSize;
PostProcessingManager.getInstance().init(scene, camera);
let frames = 0;
let ready = false;
let failure: string | undefined;
let sweepStart: number | undefined;
let sweepDuration = 0;
let baseYaw = 0;
let capturing = false;
let spawns: { position: number[]; yaw: number }[] = [];
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

engine.runRenderLoop(() => {
  GameTimer.getInstance().update();
  if (sweepStart !== undefined) {
    camera.rotation.y = baseYaw + Math.min(1, (performance.now() - sweepStart) / sweepDuration) * Math.PI * 2;
  }
  weapon.position.copyFrom(camera.position);
  weapon.rotation.copyFrom(camera.rotation);
  scene.render();
  frames++;
});

function setView(index: number): void {
  const spawn = spawns[index];
  if (!spawn) throw new Error(`Missing spawn ${index}`);
  sweepStart = undefined;
  camera.position.copyFromFloats(spawn.position[0], spawn.position[1], spawn.position[2]);
  baseYaw = spawn.yaw;
  camera.rotation.set(0, baseYaw, 0);
}

function state() {
  return {
    ready: ready && scene.isReady(), failure, frames, map, cellSize, spawns,
    gl: engine.getGlInfo(), webGLVersion: engine.webGLVersion,
    gpuTimerSupported: !!engine.getCaps().timerQuery,
    viewport: [engine.getRenderWidth(), engine.getRenderHeight()],
    horizontalFov: 90, eyeHeight: DEFAULT_VIEWHEIGHT,
    cameraClip: [camera.minZ, camera.maxZ],
    renderVars: Object.fromEntries(vars.getAll().map((v) => [v.name, v.value])),
    postProcessing: PostProcessingManager.getInstance().getSettings(),
    meshes: scene.meshes.length,
    pvs: BspManager.getInstance().getPVSCuller()?.getStats(),
    shaderErrors: scene.meshes.flatMap((mesh) => (mesh.subMeshes ?? [])
      .filter((sub) => sub.effect?.getCompilationError())
      .map((sub) => ({ mesh: mesh.name, error: sub.effect!.getCompilationError() }))),
  };
}

Object.assign(window, { bspPerformance: {
  state, setView,
  async warmup(index: number, seconds: number) {
    setView(index);
    sweepDuration = seconds * 1000;
    sweepStart = performance.now();
    await delay(sweepDuration);
    setView(index);
    await delay(1000);
  },
  async capture(index: number, seconds: number, sweep = false) {
    if (capturing) throw new Error("A capture is already running");
    capturing = true;
    setView(index);
    // Settle the PVS, cached probes and active-mesh state before measuring.
    await delay(500);
    const intervals: number[] = [];
    const worldMeshes: number[] = [];
    let last: number | undefined;
    const before = scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      if (last !== undefined) intervals.push(now - last);
      last = now;
    });
    const afterCamera = scene.onAfterCameraRenderObservable.add((view) => {
      if (view === camera) worldMeshes.push(scene.getActiveMeshes().length);
    });
    const start = performance.now();
    if (sweep) {
      sweepDuration = seconds * 1000;
      sweepStart = start;
    }
    try {
      const report = await captureRendererPerformance(scene, seconds, { map, ktx2: !!vars.get("r_ktx2") });
      const elapsedSeconds = (performance.now() - start) / 1000;
      return {
        index, sweep, cellSize, position: spawns[index].position, yaw: baseYaw,
        elapsedSeconds, observedFps: report.frames / elapsedSeconds,
        frameIntervalMs: { p50: percentile(intervals, 0.5), p95: percentile(intervals, 0.95) },
        worldActiveMeshes: { p50: percentile(worldMeshes, 0.5), p95: percentile(worldMeshes, 0.95) },
        report,
      };
    } finally {
      scene.onBeforeRenderObservable.remove(before);
      scene.onAfterCameraRenderObservable.remove(afterCamera);
      sweepStart = undefined;
      capturing = false;
    }
  },
} });

try {
  await GamePaths.getInstance().init();
  await PK3Index.getInstance().ensureIndex();
  const result = await MapLoader.getInstance().loadMap(map, scene);
  if (!result.success || !result.bsp) throw new Error(result.error ?? "No BSP returned");
  spawns = result.bsp.entities.filter((entity) => entity.classname === "info_player_deathmatch")
    .map((entity) => {
      const origin = entity.properties.origin?.trim().split(/\s+/).map(Number);
      const angle = Number(entity.properties.angle ?? 0);
      if (!origin || origin.length !== 3 || !origin.every(Number.isFinite) || !Number.isFinite(angle)) {
        throw new Error("Invalid authored spawn");
      }
      const [x, y, z] = origin;
      return { position: [x, z + DEFAULT_VIEWHEIGHT, y], yaw: Math.PI / 2 - angle * Math.PI / 180 };
    });
  setView(0);
  ready = true;
} catch (error) {
  failure = String(error);
  console.error(error);
}

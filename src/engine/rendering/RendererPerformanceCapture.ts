import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { Scene } from "@babylonjs/core/scene";

export interface PerformanceMetric {
  p50: number | null;
  p95: number | null;
}

export interface RendererPerformanceReport {
  backend: "webgpu" | "webgl2";
  map: string;
  ktx2: boolean;
  durationSeconds: number;
  frames: number;
  frameTimeMs: PerformanceMetric;
  cpuRenderMs: PerformanceMetric;
  gpuFrameMs: PerformanceMetric;
  activeMeshesEvaluationMs: PerformanceMetric;
  particlesRenderMs: PerformanceMetric;
  animationsMs: PerformanceMetric;
  physicsMs: PerformanceMetric;
  drawCalls: PerformanceMetric;
  activeMeshes: PerformanceMetric;
  triangles: PerformanceMetric;
  shaderCompilation: {
    count: number;
    totalMs: number;
  };
  webgpuBundles: {
    created: number;
    reused: number;
  } | null;
}

export interface RendererPerformanceMetadata {
  map?: string | null;
  ktx2?: boolean;
}

interface WebGPUFrameCounters {
  numBundleCreationNonCompatMode: number;
  numBundleReuseNonCompatMode: number;
}

interface WebGPUCounterEngine {
  countersLastFrame?: WebGPUFrameCounters;
}

const NS_TO_MS = 0.000001;

export function percentile(values: readonly number[], quantile: number): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  if (finite.length === 1) return finite[0];

  const position = Math.max(0, Math.min(1, quantile)) * (finite.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return finite[lower] * (1 - weight) + finite[upper] * weight;
}

function metric(values: readonly number[]): PerformanceMetric {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

/**
 * Capture complete rendered frames for a short, bounded interval. Instrumentation
 * and the render observer are always disposed, including when collection fails.
 */
export async function captureRendererPerformance(
  scene: Scene,
  durationSeconds: number,
  metadata: RendererPerformanceMetadata = {},
): Promise<RendererPerformanceReport> {
  const duration = Math.max(1, Math.min(60, durationSeconds));
  const engine = scene.getEngine();
  const engineInstrumentation = new EngineInstrumentation(engine);
  const sceneInstrumentation = new SceneInstrumentation(scene);

  engineInstrumentation.captureGPUFrameTime = true;
  engineInstrumentation.captureShaderCompilationTime = true;
  sceneInstrumentation.captureFrameTime = true;
  sceneInstrumentation.captureRenderTime = true;
  sceneInstrumentation.captureActiveMeshesEvaluationTime = true;
  sceneInstrumentation.captureParticlesRenderTime = true;
  sceneInstrumentation.captureAnimationsTime = true;
  sceneInstrumentation.capturePhysicsTime = true;

  const frameTimeMs: number[] = [];
  const cpuRenderMs: number[] = [];
  const gpuFrameMs: number[] = [];
  const activeMeshesEvaluationMs: number[] = [];
  const particlesRenderMs: number[] = [];
  const animationsMs: number[] = [];
  const physicsMs: number[] = [];
  const drawCalls: number[] = [];
  const activeMeshes: number[] = [];
  const triangles: number[] = [];
  let bundleCreated = 0;
  let bundleReused = 0;

  const observer = scene.onAfterRenderObservable.add(() => {
    frameTimeMs.push(sceneInstrumentation.frameTimeCounter.current);
    cpuRenderMs.push(sceneInstrumentation.renderTimeCounter.current);
    activeMeshesEvaluationMs.push(sceneInstrumentation.activeMeshesEvaluationTimeCounter.current);
    particlesRenderMs.push(sceneInstrumentation.particlesRenderTimeCounter.current);
    animationsMs.push(sceneInstrumentation.animationsTimeCounter.current);
    physicsMs.push(sceneInstrumentation.physicsTimeCounter.current);
    drawCalls.push(sceneInstrumentation.drawCallsCounter.current);
    activeMeshes.push(scene.getActiveMeshes().length);
    triangles.push(Math.floor(scene.getActiveIndices() / 3));

    const gpuTime = engineInstrumentation.gpuFrameTimeCounter.current * NS_TO_MS;
    if (gpuTime > 0 && Number.isFinite(gpuTime)) gpuFrameMs.push(gpuTime);

    const counters = (engine as WebGPUCounterEngine).countersLastFrame;
    if (counters) {
      bundleCreated += counters.numBundleCreationNonCompatMode;
      bundleReused += counters.numBundleReuseNonCompatMode;
    }
  });

  try {
    await new Promise<void>((resolve) => setTimeout(resolve, duration * 1000));

    const shaderCounter = engineInstrumentation.shaderCompilationTimeCounter;
    return {
      backend: engine.isWebGPU ? "webgpu" : "webgl2",
      map: metadata.map || "none",
      ktx2: metadata.ktx2 ?? false,
      durationSeconds: duration,
      frames: frameTimeMs.length,
      frameTimeMs: metric(frameTimeMs),
      cpuRenderMs: metric(cpuRenderMs),
      gpuFrameMs: metric(gpuFrameMs),
      activeMeshesEvaluationMs: metric(activeMeshesEvaluationMs),
      particlesRenderMs: metric(particlesRenderMs),
      animationsMs: metric(animationsMs),
      physicsMs: metric(physicsMs),
      drawCalls: metric(drawCalls),
      activeMeshes: metric(activeMeshes),
      triangles: metric(triangles),
      shaderCompilation: {
        count: shaderCounter.count,
        totalMs: shaderCounter.total,
      },
      webgpuBundles: engine.isWebGPU ? { created: bundleCreated, reused: bundleReused } : null,
    };
  } finally {
    scene.onAfterRenderObservable.remove(observer);
    sceneInstrumentation.dispose();
    engineInstrumentation.captureGPUFrameTime = false;
    engineInstrumentation.captureShaderCompilationTime = false;
    engineInstrumentation.dispose();
  }
}

function formatMetric(value: PerformanceMetric, unit: string): string {
  if (value.p50 === null || value.p95 === null) return "unavailable";
  return `p50 ${value.p50.toFixed(2)}${unit}, p95 ${value.p95.toFixed(2)}${unit}`;
}

export function formatRendererPerformanceReport(report: RendererPerformanceReport): string {
  const lines = [
    `Renderer capture: ${report.durationSeconds.toFixed(1)}s, ${report.frames} frames`,
    `  Backend: ${report.backend}; map: ${report.map}; KTX2: ${report.ktx2 ? "on" : "off"}`,
    `  Frame: ${formatMetric(report.frameTimeMs, "ms")}`,
    `  CPU render: ${formatMetric(report.cpuRenderMs, "ms")}`,
    `  GPU frame: ${formatMetric(report.gpuFrameMs, "ms")}`,
    `  Active mesh evaluation: ${formatMetric(report.activeMeshesEvaluationMs, "ms")}`,
    `  Particles: ${formatMetric(report.particlesRenderMs, "ms")}`,
    `  Animations: ${formatMetric(report.animationsMs, "ms")}`,
    `  Physics: ${formatMetric(report.physicsMs, "ms")}`,
    `  Draw calls: ${formatMetric(report.drawCalls, "")}`,
    `  Active meshes: ${formatMetric(report.activeMeshes, "")}`,
    `  Triangles: ${formatMetric(report.triangles, "")}`,
    `  Shader compilation: ${report.shaderCompilation.count} compile(s), ${report.shaderCompilation.totalMs.toFixed(2)}ms total`,
  ];

  if (report.webgpuBundles) {
    lines.push(`  WebGPU bundles: ${report.webgpuBundles.created} created, ${report.webgpuBundles.reused} reused`);
  }

  return lines.join("\n");
}

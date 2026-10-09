import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { type ActualRenderingBackend, getRenderingBackend, type RenderingBackend } from "./RenderingEngineFactory";

export interface RendererFailure {
  stage: string;
  message: string;
  material?: string;
  mesh?: string;
  pass?: string;
}

export interface RendererQAReport {
  scope:
    | "standard-pbr-smoke"
    | "standard-pbr-lights"
    | "standard-pbr-lights-refresh"
    | "clustered-lighting"
    | "environment-lighting"
    | "weather-particles";
  requestedBackend: RenderingBackend;
  actualBackend?: ActualRenderingBackend;
  babylonVersion: string;
  status: "running" | "passed" | "fallback" | "failed";
  stage: string;
  frames: number;
  fixtures: {
    material: string;
    phase: string;
    cap: number;
    activeLights: number;
    compiledLights: number;
    frozen: boolean;
    clusterLights?: number;
    compiledClusters?: number;
    rgb?: number[];
    skinned?: boolean;
    readbackFormat?: string;
    roughness?: number;
    expectedChannels?: number[];
    viewport?: { width: number; height: number };
    particleBackend?: "gpu" | "cpu";
    activeParticles?: number;
    litPixels?: number;
  }[];
  fallbackReason?: string;
  fallbackStage?: string;
  /** WebGPU render bundles (Babylon non-compatibility mode) were active. */
  nonCompatibilityMode?: boolean;
  capabilities?: Record<string, number | boolean>;
  deviceLimits?: Record<string, number>;
  firstFailure?: RendererFailure;
}

/** Fixed fields: GPU limit properties may be prototype getters, not own keys. */
const LIMIT_NAMES = [
  "maxUniformBuffersPerShaderStage",
  "maxStorageBuffersPerShaderStage",
  "maxSampledTexturesPerShaderStage",
  "maxSamplersPerShaderStage",
  "maxBindGroups",
  "maxBindingsPerBindGroup",
  "maxUniformBufferBindingSize",
  "maxTextureDimension2D",
] as const;

/** Bounded, serializable evidence. Never treats NullEngine as GPU acceptance. */
export class RendererDiagnostics {
  private readonly state: RendererQAReport;
  private context: Omit<RendererFailure, "stage" | "message"> = {};

  constructor(
    requestedBackend: RenderingBackend,
    private readonly publish: (report: RendererQAReport) => void = () => {},
    scope: RendererQAReport["scope"] = "standard-pbr-smoke",
  ) {
    this.state = {
      scope,
      requestedBackend,
      babylonVersion: Engine.Version,
      status: "running",
      stage: "startup",
      frames: 0,
      fixtures: [],
    };
    this.emit();
  }

  get report(): RendererQAReport {
    return structuredClone(this.state);
  }

  private emit(): void {
    this.publish(this.report);
  }

  attachEngine(engine: AbstractEngine, fallbackReason?: string, fallbackStage?: string): void {
    const caps = engine.getCaps();
    this.state.actualBackend = getRenderingBackend(engine);
    this.state.fallbackReason = fallbackReason;
    this.state.fallbackStage = fallbackStage;
    this.state.capabilities = {
      maxTexturesImageUnits: caps.maxTexturesImageUnits,
      maxTextureSize: caps.maxTextureSize,
      textureFloatRender: caps.textureFloatRender,
      textureHalfFloatRender: caps.textureHalfFloatRender,
      s3tc: !!caps.s3tc,
      etc1: !!caps.etc1,
      etc2: !!caps.etc2,
      astc: !!caps.astc,
      supportTransformFeedbacks: !!caps.supportTransformFeedbacks,
      supportComputeShaders: !!caps.supportComputeShaders,
    };
    if (engine.isWebGPU) {
      const limits = (engine as WebGPUEngine).currentLimits;
      this.state.deviceLimits = {};
      for (const name of LIMIT_NAMES) {
        if (typeof limits?.[name] === "number") this.state.deviceLimits[name] = limits[name];
      }
    }
    this.emit();
  }

  noteNonCompatibilityMode(active: boolean): void {
    this.state.nonCompatibilityMode = active;
    this.emit();
  }

  fail(error: unknown): void {
    if (this.state.firstFailure) return;
    this.state.firstFailure = {
      ...this.context,
      stage: this.state.stage,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
    };
    this.state.status = "failed";
    this.emit();
  }

  async runStage<T>(
    stage: string,
    action: () => Promise<T>,
    context: typeof this.context = {},
    timeoutMs = 15000,
  ): Promise<T> {
    if (this.state.status === "failed") throw new Error(this.state.firstFailure!.message);
    this.state.stage = stage;
    this.context = context;
    this.emit();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(action),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${stage} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      if (this.state.firstFailure) throw new Error(this.state.firstFailure.message);
      return result;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  frame(): void {
    this.state.frames++;
  }

  fixture(result: RendererQAReport["fixtures"][number]): void {
    if (this.state.fixtures.length < 64) this.state.fixtures.push({ ...result });
    this.emit();
  }

  complete(): void {
    if (this.state.firstFailure) return;
    if (!this.state.actualBackend || this.state.actualBackend === "null" || this.state.frames === 0) {
      this.fail(new Error("No GPU frames were validated"));
      return;
    }
    this.state.status = this.state.actualBackend === this.state.requestedBackend ? "passed" : "fallback";
    this.state.stage = "complete";
    this.emit();
  }
}

/** The only diagnostic adapter touching Babylon's internal GPUDevice handle. */
export function observeRendererDevice(engine: AbstractEngine, fail: (error: unknown) => void): () => void {
  const observer = engine.onContextLostObservable.add(() => fail(new Error("Rendering context/device lost")));
  const device = engine.isWebGPU ? (engine as WebGPUEngine)._device : undefined;
  const onError = (event: Event) => fail((event as GPUUncapturedErrorEvent).error.message);
  device?.addEventListener("uncapturederror", onError);
  return () => {
    engine.onContextLostObservable.remove(observer);
    device?.removeEventListener("uncapturederror", onError);
  };
}

/** Flush submitted WebGPU work before declaring a render stage successful. */
export async function waitForRendererGPU(engine: AbstractEngine): Promise<void> {
  if (engine.isWebGPU) await (engine as WebGPUEngine)._device.queue.onSubmittedWorkDone();
}

/** Attribute asynchronous validation errors to the isolated material under test. */
export function beginRendererValidation(engine: AbstractEngine): () => Promise<void> {
  if (!engine.isWebGPU) return async () => {};
  const device = (engine as WebGPUEngine)._device;
  device.pushErrorScope("validation");
  let result: Promise<void> | undefined;
  return () => {
    result ??= device.popErrorScope().then((error) => {
      if (error) throw new Error(error.message);
    });
    return result;
  };
}

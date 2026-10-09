import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";

export type RenderingBackend = "webgl2" | "webgpu";
export type ActualRenderingBackend = RenderingBackend | "webgl1" | "null";

export function getRenderingBackend(engine: AbstractEngine): ActualRenderingBackend {
  if (engine instanceof NullEngine) return "null";
  if (engine.isWebGPU) return "webgpu";
  return engine.version >= 2 ? "webgl2" : "webgl1";
}

export interface RenderingEngineResult {
  engine: AbstractEngine;
  backend: ActualRenderingBackend;
  /** Controls must bind this canvas: recovery may replace the original. */
  canvas: HTMLCanvasElement;
  fallbackStage?: "support" | "initialization";
  fallbackReason?: string;
  /** WebGPU render-bundle submission (Babylon non-compatibility mode) is active. */
  nonCompatibilityMode: boolean;
}

export interface RenderingEngineOptions {
  /** Request WebGPU non-compatibility mode. Ignored by every other backend. */
  nonCompatibilityMode?: boolean;
}

export interface RenderingEngineFactories {
  createWebGL(canvas: HTMLCanvasElement): AbstractEngine;
  isWebGPUSupported(): Promise<boolean>;
  createWebGPU(canvas: HTMLCanvasElement): Promise<AbstractEngine>;
  replaceCanvas?(canvas: HTMLCanvasElement): HTMLCanvasElement;
}

/** Startup only, before input listeners are installed. Keep attributes/layout. */
function replaceCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  return fresh;
}

/** Preserve the primary error even if Babylon cannot dispose a partial engine. */
export async function initializeWebGPUWithCleanup(
  engine: AbstractEngine,
  initialize: () => Promise<void>,
): Promise<AbstractEngine> {
  try {
    await initialize();
    return engine;
  } catch (error) {
    try {
      engine.dispose();
    } catch (cleanupError) {
      console.warn("[Renderer] Partial WebGPU engine cleanup failed", cleanupError);
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Babylon's modular WebGPU entry omits extensions we use: DynamicTexture;
 * MultiRender, which the geometry buffer behind screen-space reflections
 * needs (without it `r_ssr 1` fails to start on WebGPU only; WebGL gets its
 * own multi-render extension through Babylon's imports); and compute shaders
 * plus the registered compute particle platform, which `GPUParticleSystem`
 * selects on WebGPU in place of WebGL2 transform feedback.
 */
export async function loadWebGPUBackend() {
  const [{ WebGPUEngine }] = await Promise.all([
    import("@babylonjs/core/Engines/webgpuEngine"),
    import("@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture"),
    import("@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender"),
    import("@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader"),
    import("@babylonjs/core/Particles/computeShaderParticleSystem"),
  ]);
  return WebGPUEngine;
}

async function isWebGPUSupported(): Promise<boolean> {
  const WebGPUEngine = await loadWebGPUBackend();
  return WebGPUEngine.IsSupportedAsync;
}

async function createWebGPUEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const [WebGPUEngine, glslangJs, glslangWasm, twgslJs, twgslWasm] = await Promise.all([
    loadWebGPUBackend(),
    import("@babylonjs/core/assets/glslang/glslang.js?url"),
    import("@babylonjs/core/assets/glslang/glslang.wasm?url"),
    import("@babylonjs/core/assets/twgsl/twgsl.js?url"),
    import("@babylonjs/core/assets/twgsl/twgsl.wasm?url"),
  ]);

  const engine = new WebGPUEngine(canvas, {
    antialias: true,
    adaptToDeviceRatio: false,
    stencil: false,
    powerPreference: "high-performance",
  });

  return initializeWebGPUWithCleanup(engine, () =>
    engine.initAsync(
      { jsPath: glslangJs.default, wasmPath: glslangWasm.default },
      { jsPath: twgslJs.default, wasmPath: twgslWasm.default },
    ),
  );
}

const DEFAULT_FACTORIES: RenderingEngineFactories = {
  createWebGL: (canvas) => new Engine(canvas, true, { stencil: false }),
  isWebGPUSupported,
  createWebGPU: createWebGPUEngine,
};

/**
 * Resolve the startup renderer. URL selection is session-only and wins over
 * the persisted cvar, which makes A/B testing possible without rewriting the
 * user's settings.
 */
export function resolveRenderingBackend(webGPUCvarEnabled: boolean, search = ""): RenderingBackend {
  const override = new URLSearchParams(search).get("renderer")?.toLowerCase();
  if (override === "webgpu") return "webgpu";
  if (override === "webgl" || override === "webgl2") return "webgl2";
  return webGPUCvarEnabled ? "webgpu" : "webgl2";
}

/**
 * Session-only opt-in to WebGPU non-compatibility mode, `?ncm=1`. Babylon then
 * records and replays render bundles, trading bundle construction for cheaper
 * submission. Startup only: materials read the mode when they are built.
 */
export function resolveWebGPUNonCompatibilityMode(search = ""): boolean {
  return new URLSearchParams(search).get("ncm") === "1";
}

/** Whether materials may use `separateCullingPass`, which NCM cannot record. */
export function supportsSeparateCullingPass(engine: AbstractEngine): boolean {
  return engine.compatibilityMode !== false;
}

/**
 * Recover from WebGPU support/initialization failures before scene creation.
 * Later shader or device failures are outside this startup transaction.
 * WebGL failure is terminal and is never retried on the same canvas.
 */
export async function createRenderingEngine(
  canvas: HTMLCanvasElement,
  requestedBackend: RenderingBackend,
  factories: RenderingEngineFactories = DEFAULT_FACTORIES,
  options: RenderingEngineOptions = {},
): Promise<RenderingEngineResult> {
  const webgl = (target: HTMLCanvasElement): RenderingEngineResult => {
    const engine = factories.createWebGL(target);
    return { engine, backend: getRenderingBackend(engine), canvas: target, nonCompatibilityMode: false };
  };
  if (requestedBackend === "webgl2") {
    return webgl(canvas);
  }

  let stage: "support" | "initialization" = "support";
  let fallbackReason: string;
  try {
    if (!(await factories.isWebGPUSupported())) {
      fallbackReason = "WebGPU is not supported by this browser or GPU adapter";
    } else {
      stage = "initialization";
      const engine = await factories.createWebGPU(canvas);
      if (options.nonCompatibilityMode) engine.compatibilityMode = false;
      return {
        engine,
        backend: getRenderingBackend(engine),
        canvas,
        nonCompatibilityMode: engine.compatibilityMode === false,
      };
    }
  } catch (error) {
    fallbackReason = `WebGPU ${stage} failed: ${errorMessage(error)}`;
  }
  // A canvas cannot acquire a WebGL context after acquiring a WebGPU context.
  // Conservatively replace it after any attempted WebGPU initialization.
  const target = stage === "initialization" ? (factories.replaceCanvas ?? replaceCanvas)(canvas) : canvas;
  return { ...webgl(target), fallbackReason, fallbackStage: stage };
}

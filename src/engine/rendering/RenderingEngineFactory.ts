import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";

export type RenderingBackend = "webgl2" | "webgpu";

export interface RenderingEngineResult {
  engine: AbstractEngine;
  backend: RenderingBackend;
  fallbackReason?: string;
}

export interface RenderingEngineFactories {
  createWebGL(canvas: HTMLCanvasElement): AbstractEngine;
  isWebGPUSupported(): Promise<boolean>;
  createWebGPU(canvas: HTMLCanvasElement): Promise<AbstractEngine>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function isWebGPUSupported(): Promise<boolean> {
  const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
  return WebGPUEngine.IsSupportedAsync;
}

async function createWebGPUEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const [{ WebGPUEngine }, glslangJs, glslangWasm, twgslJs, twgslWasm] = await Promise.all([
    import("@babylonjs/core/Engines/webgpuEngine"),
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

  try {
    await engine.initAsync(
      { jsPath: glslangJs.default, wasmPath: glslangWasm.default },
      { jsPath: twgslJs.default, wasmPath: twgslWasm.default },
    );
    return engine;
  } catch (error) {
    engine.dispose();
    throw error;
  }
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
 * Create the requested renderer. WebGPU is experimental and must never make
 * startup fail: unsupported adapters and initialization/compiler failures all
 * fall back to the established WebGL2 engine.
 */
export async function createRenderingEngine(
  canvas: HTMLCanvasElement,
  requestedBackend: RenderingBackend,
  factories: RenderingEngineFactories = DEFAULT_FACTORIES,
): Promise<RenderingEngineResult> {
  if (requestedBackend === "webgl2") {
    return { engine: factories.createWebGL(canvas), backend: "webgl2" };
  }

  try {
    if (!(await factories.isWebGPUSupported())) {
      return {
        engine: factories.createWebGL(canvas),
        backend: "webgl2",
        fallbackReason: "WebGPU is not supported by this browser or GPU adapter",
      };
    }

    return { engine: await factories.createWebGPU(canvas), backend: "webgpu" };
  } catch (error) {
    return {
      engine: factories.createWebGL(canvas),
      backend: "webgl2",
      fallbackReason: `WebGPU initialization failed: ${errorMessage(error)}`,
    };
  }
}

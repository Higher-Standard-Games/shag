import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { describe, expect, it, vi } from "vitest";
import {
  createRenderingEngine,
  initializeWebGPUWithCleanup,
  loadWebGPUBackend,
  type RenderingEngineFactories,
  resolveRenderingBackend,
} from "../rendering/RenderingEngineFactory";

function fakeEngine(name: string): AbstractEngine {
  return { name, getClassName: () => "Engine", isWebGPU: name === "webgpu", version: 2 } as unknown as AbstractEngine;
}

function factories(overrides: Partial<RenderingEngineFactories> = {}): RenderingEngineFactories {
  return {
    createWebGL: vi.fn(() => fakeEngine("webgl")),
    isWebGPUSupported: vi.fn(async () => true),
    createWebGPU: vi.fn(async () => fakeEngine("webgpu")),
    ...overrides,
  };
}

const canvas = document.createElement("canvas");

describe("RenderingEngineFactory", () => {
  it("registers the dynamic texture methods required by weapon displays on WebGPU", async () => {
    const WebGPUEngine = await loadWebGPUBackend();
    expect(WebGPUEngine.prototype.createDynamicTexture).toBeTypeOf("function");
    expect(WebGPUEngine.prototype.updateDynamicTexture).toBeTypeOf("function");
  });

  it("registers the multi-render targets screen-space reflections need on WebGPU", async () => {
    const WebGPUEngine = await loadWebGPUBackend();
    expect(WebGPUEngine.prototype.createMultipleRenderTarget).toBeTypeOf("function");
    expect(WebGPUEngine.prototype.bindAttachments).toBeTypeOf("function");
  });

  it("resolves the persisted preference and honors session URL overrides", () => {
    expect(resolveRenderingBackend(false)).toBe("webgl2");
    expect(resolveRenderingBackend(true)).toBe("webgpu");
    expect(resolveRenderingBackend(false, "?renderer=webgpu")).toBe("webgpu");
    expect(resolveRenderingBackend(true, "?renderer=webgl2")).toBe("webgl2");
  });

  it("does not probe WebGPU when WebGL2 is requested", async () => {
    const deps = factories();
    const result = await createRenderingEngine(canvas, "webgl2", deps);

    expect(result.backend).toBe("webgl2");
    expect(deps.isWebGPUSupported).not.toHaveBeenCalled();
    expect(deps.createWebGPU).not.toHaveBeenCalled();
  });

  it("returns WebGPU when support and initialization succeed", async () => {
    const deps = factories();
    const result = await createRenderingEngine(canvas, "webgpu", deps);

    expect(result.backend).toBe("webgpu");
    expect(result.fallbackReason).toBeUndefined();
    expect(deps.createWebGL).not.toHaveBeenCalled();
  });

  it("falls back when WebGPU is unsupported", async () => {
    const deps = factories({ isWebGPUSupported: vi.fn(async () => false) });
    const result = await createRenderingEngine(canvas, "webgpu", deps);

    expect(result.backend).toBe("webgl2");
    expect(result.fallbackReason).toContain("not supported");
    expect(deps.createWebGPU).not.toHaveBeenCalled();
  });

  it("falls back when WebGPU initialization throws", async () => {
    const deps = factories({ createWebGPU: vi.fn(async () => Promise.reject(new Error("adapter lost"))) });
    const result = await createRenderingEngine(canvas, "webgpu", deps);

    expect(result.backend).toBe("webgl2");
    expect(result.fallbackReason).toContain("adapter lost");
    expect(deps.createWebGL).toHaveBeenCalledOnce();
    expect(result.canvas).not.toBe(canvas);
    expect(deps.createWebGL).toHaveBeenCalledWith(result.canvas);
    expect(result.fallbackStage).toBe("initialization");
  });

  it("preserves canvas attributes and replaces the DOM node after context acquisition", async () => {
    const original = document.createElement("canvas");
    original.id = "renderCanvas";
    original.width = 123;
    original.className = "game";
    document.body.append(original);
    const result = await createRenderingEngine(
      original,
      "webgpu",
      factories({
        createWebGPU: vi.fn(async () => {
          throw new Error("context acquired, compiler failed");
        }),
      }),
    );
    expect(document.getElementById("renderCanvas")).toBe(result.canvas);
    expect(original.isConnected).toBe(false);
    expect(result.canvas.width).toBe(123);
    expect(result.canvas.className).toBe("game");
    result.canvas.remove();
  });

  it("keeps the canvas if only the support probe fails", async () => {
    const deps = factories({
      isWebGPUSupported: vi.fn(async () => {
        throw new Error("probe failed");
      }),
    });
    const result = await createRenderingEngine(canvas, "webgpu", deps);
    expect(result.canvas).toBe(canvas);
    expect(result.fallbackStage).toBe("support");
    expect(deps.createWebGPU).not.toHaveBeenCalled();
  });

  it("does not retry a failed WebGL fallback", async () => {
    const error = new Error("WebGL unavailable");
    const deps = factories({
      isWebGPUSupported: vi.fn(async () => false),
      createWebGL: vi.fn(() => {
        throw error;
      }),
    });
    await expect(createRenderingEngine(canvas, "webgpu", deps)).rejects.toBe(error);
    expect(deps.createWebGL).toHaveBeenCalledOnce();
  });

  it("reports WebGL1 when Babylon downgraded the requested WebGL2 engine", async () => {
    const engine = { ...fakeEngine("webgl"), version: 1 } as AbstractEngine;
    const result = await createRenderingEngine(canvas, "webgl2", factories({ createWebGL: () => engine }));
    expect(result.backend).toBe("webgl1");
  });

  it("preserves initialization errors if partial cleanup also fails", async () => {
    const error = new Error("translator failed");
    const dispose = vi.fn(() => {
      throw new Error("missing device");
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        initializeWebGPUWithCleanup({ dispose } as unknown as AbstractEngine, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(dispose).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });
});
// @vitest-environment jsdom

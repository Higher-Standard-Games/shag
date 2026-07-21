import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { describe, expect, it, vi } from "vitest";
import {
  createRenderingEngine,
  type RenderingEngineFactories,
  resolveRenderingBackend,
} from "../rendering/RenderingEngineFactory";

function fakeEngine(name: string): AbstractEngine {
  return { name } as unknown as AbstractEngine;
}

function factories(overrides: Partial<RenderingEngineFactories> = {}): RenderingEngineFactories {
  return {
    createWebGL: vi.fn(() => fakeEngine("webgl")),
    isWebGPUSupported: vi.fn(async () => true),
    createWebGPU: vi.fn(async () => fakeEngine("webgpu")),
    ...overrides,
  };
}

const canvas = {} as HTMLCanvasElement;

describe("RenderingEngineFactory", () => {
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
  });
});

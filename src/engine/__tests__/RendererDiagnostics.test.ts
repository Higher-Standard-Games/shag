import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Observable } from "@babylonjs/core/Misc/observable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginRendererValidation, observeRendererDevice, RendererDiagnostics } from "../rendering/RendererDiagnostics";

afterEach(() => vi.useRealTimers());

function gpuEngine(isWebGPU = true): AbstractEngine {
  return {
    getClassName: () => "Engine",
    isWebGPU,
    version: 2,
    getCaps: () => ({
      maxTextureSize: 8192,
      maxTexturesImageUnits: 16,
      textureFloatRender: true,
      textureHalfFloatRender: true,
    }),
    currentLimits: Object.create({ maxUniformBuffersPerShaderStage: 12 }),
  } as unknown as AbstractEngine;
}

describe("renderer diagnostic evidence", () => {
  it("reports scoped GPU validation errors and pops each scope only once", async () => {
    const device = { pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => ({ message: "too many bindings" })) };
    const close = beginRendererValidation({ ...gpuEngine(), _device: device } as unknown as AbstractEngine);
    expect(device.pushErrorScope).toHaveBeenCalledWith("validation");
    await expect(close()).rejects.toThrow("too many bindings");
    await expect(close()).rejects.toThrow("too many bindings");
    expect(device.popErrorScope).toHaveBeenCalledOnce();
  });
  it("captures negotiated limits including prototype getters and serializable snapshots", () => {
    const diagnostics = new RendererDiagnostics("webgpu");
    diagnostics.attachEngine(gpuEngine());
    expect(diagnostics.report.deviceLimits?.maxUniformBuffersPerShaderStage).toBe(12);
    diagnostics.report.deviceLimits!.maxUniformBuffersPerShaderStage = 99;
    expect(JSON.parse(JSON.stringify(diagnostics.report)).deviceLimits.maxUniformBuffersPerShaderStage).toBe(12);
  });

  it("keeps the first error with material/mesh/pass context and bounded text", async () => {
    const diagnostics = new RendererDiagnostics("webgpu");
    await expect(
      diagnostics.runStage(
        "shader-compilation",
        async () => {
          diagnostics.fail("x".repeat(8000));
          throw new Error("later failure");
        },
        { material: "water", mesh: "pool", pass: "reflection" },
      ),
    ).rejects.toThrow();
    expect(diagnostics.report.firstFailure).toMatchObject({
      stage: "shader-compilation",
      material: "water",
      mesh: "pool",
      pass: "reflection",
    });
    expect(diagnostics.report.firstFailure?.message).toHaveLength(4096);
    diagnostics.complete();
    expect(diagnostics.report.status).toBe("failed");
  });

  it("turns a stalled stage into a terminal timeout and ignores late success", async () => {
    vi.useFakeTimers();
    const diagnostics = new RendererDiagnostics("webgpu");
    let resolve!: () => void;
    const run = diagnostics.runStage(
      "compile",
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
      {},
      50,
    );
    const rejection = expect(run).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    resolve();
    diagnostics.complete();
    expect(diagnostics.report.status).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("distinguishes a working fallback from successful requested-backend coverage", () => {
    const diagnostics = new RendererDiagnostics("webgpu");
    diagnostics.attachEngine(gpuEngine(false), "unsupported", "support");
    diagnostics.frame();
    diagnostics.complete();
    expect(diagnostics.report).toMatchObject({
      status: "fallback",
      actualBackend: "webgl2",
      fallbackReason: "unsupported",
    });
  });

  it("never passes NullEngine as GPU evidence", () => {
    const engine = new NullEngine();
    try {
      const diagnostics = new RendererDiagnostics("webgl2");
      diagnostics.attachEngine(engine);
      diagnostics.frame();
      diagnostics.complete();
      expect(diagnostics.report.status).toBe("failed");
      expect(diagnostics.report.actualBackend).toBe("null");
    } finally {
      engine.dispose();
    }
  });

  it("removes device and context-loss listeners", () => {
    const device = new EventTarget();
    const onContextLostObservable = new Observable<AbstractEngine>();
    const engine = { ...gpuEngine(), _device: device, onContextLostObservable } as unknown as AbstractEngine;
    const fail = vi.fn();
    const stop = observeRendererDevice(engine, fail);
    const event = new Event("uncapturederror");
    Object.assign(event, { error: { message: "invalid bind group" } });
    device.dispatchEvent(event);
    onContextLostObservable.notifyObservers(engine);
    expect(fail).toHaveBeenCalledTimes(2);
    stop();
    device.dispatchEvent(event);
    onContextLostObservable.notifyObservers(engine);
    expect(fail).toHaveBeenCalledTimes(2);
  });
});

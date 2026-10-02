// @vitest-environment jsdom
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRendererQA } from "../rendering/RendererQA";
import type { RenderingEngineResult } from "../rendering/RenderingEngineFactory";

const createEngine = vi.hoisted(() => vi.fn());
vi.mock("../rendering/RenderingEngineFactory", async (original) => ({
  ...(await original<typeof import("../rendering/RenderingEngineFactory")>()),
  createRenderingEngine: createEngine,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  createEngine.mockReset();
  document.body.replaceChildren();
});

describe("isolated renderer QA entry", () => {
  it("reports a startup timeout and disposes an engine that arrives after the deadline", async () => {
    vi.useFakeTimers();
    let resolve!: (result: RenderingEngineResult) => void;
    createEngine.mockReturnValue(
      new Promise<RenderingEngineResult>((done) => {
        resolve = done;
      }),
    );
    const canvas = document.createElement("canvas");
    const run = runRendererQA(canvas, "?renderer=webgpu");
    await vi.advanceTimersByTimeAsync(15000);
    const report = await run;
    expect(report.status).toBe("failed");
    expect(report.firstFailure?.stage).toBe("engine-initialization");
    expect(document.getElementById("renderer-qa-report")?.textContent).toContain("timed out");
    const engine = new NullEngine();
    const dispose = vi.spyOn(engine, "dispose");
    resolve({ engine, canvas, backend: "null" });
    await vi.advanceTimersByTimeAsync(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs both fixture materials, releases the scene, and rejects NullEngine as GPU evidence", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const canvas = document.createElement("canvas");
    const engine = new NullEngine();
    const dispose = vi.spyOn(engine, "dispose");
    createEngine.mockResolvedValue({ engine, canvas, backend: "null" });
    const report = await runRendererQA(canvas, "?renderer=webgl2");
    expect(report.frames).toBe(6);
    expect(report.status).toBe("failed");
    expect(report.firstFailure?.message).toBe("No GPU frames were validated");
    expect(dispose).toHaveBeenCalledOnce();
    expect(engine.scenes).toHaveLength(0);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("checks frozen light layouts (WGSL=%s, explicit refresh=%s)", async (webgpu, refresh) => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const engine = new NullEngine();
    // Keep real material defines/readiness. Stub only the GPU boundary; this
    // run must still end as failed because NullEngine cannot validate draws.
    if (webgpu) {
      Object.defineProperty(engine, "isWebGPU", { value: true });
      Object.assign(engine, {
        _device: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          pushErrorScope: vi.fn(),
          popErrorScope: vi.fn(async () => null),
          queue: { onSubmittedWorkDone: vi.fn(async () => {}) },
        },
      });
    }
    createEngine.mockResolvedValue({ engine, canvas: document.createElement("canvas"), backend: "null" });
    const testCase = refresh ? "lights-refresh" : "lights";
    const report = await runRendererQA(document.createElement("canvas"), `?rendererqa=1&rendererqacase=${testCase}`);
    expect(report.scope).toBe(`standard-pbr-${testCase}`);
    if (!refresh) {
      // Babylon 9.17 reproducer: toggling lights marks defines dirty but does
      // not invalidate a frozen draw wrapper's previous readiness shortcut.
      expect(report.firstFailure).toMatchObject({
        stage: "fixture-evidence",
        pass: "frozen-one",
        material: "qa-standard",
        message: `Fixture compiled ${webgpu ? 2 : 6} lights; expected 1 with cap ${webgpu ? 2 : 6}`,
      });
      expect(report.frames).toBe(12);
      expect(report.fixtures.at(-1)).toMatchObject({ activeLights: 1, compiledLights: webgpu ? 2 : 6, frozen: true });
      expect(engine.scenes).toHaveLength(0);
      return;
    }
    expect(report.firstFailure?.message).toBe("No GPU frames were validated");
    expect(report.frames).toBe(30);
    expect(report.fixtures).toHaveLength(10);
    for (const [index, cap] of (webgpu ? [2, 1] : [6, 4]).entries()) {
      const results = report.fixtures.slice(index * 5, index * 5 + 5);
      expect(results.map((result) => result.compiledLights)).toEqual([1, cap, cap, 1, cap]);
      expect(results.map((result) => result.activeLights)).toEqual([1, 11, 11, 1, 11]);
      expect(results.map((result) => result.frozen)).toEqual([false, false, true, true, true]);
    }
    expect(engine.scenes).toHaveLength(0);
  });

  it("routes the environment case to its own fixture and scope", async () => {
    // NullEngine cannot upload a raw cube, so the fixture fails inside its
    // own setup stage: enough to show the case reached it.
    const engine = new NullEngine();
    createEngine.mockResolvedValue({ engine, canvas: document.createElement("canvas"), backend: "null" });
    const report = await runRendererQA(document.createElement("canvas"), "?rendererqa=1&rendererqacase=environment");
    expect(report.scope).toBe("environment-lighting");
    expect(report.firstFailure?.stage).toBe("environment-setup");
    expect(engine.scenes).toHaveLength(0);
  });
});

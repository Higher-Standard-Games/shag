import { describe, expect, it } from "vitest";
import {
  formatRendererPerformanceReport,
  percentile,
  type RendererPerformanceReport,
} from "../rendering/RendererPerformanceCapture";

describe("RendererPerformanceCapture", () => {
  it("calculates interpolated percentiles without mutating the source", () => {
    const values = [4, 1, 3, 2];
    expect(percentile(values, 0.5)).toBe(2.5);
    expect(percentile(values, 0.95)).toBeCloseTo(3.85);
    expect(values).toEqual([4, 1, 3, 2]);
    expect(percentile([], 0.5)).toBeNull();
  });

  it("formats unsupported GPU timing explicitly", () => {
    const metric = { p50: 1, p95: 2 };
    const report: RendererPerformanceReport = {
      backend: "webgl2",
      map: "wdm2",
      ktx2: true,
      durationSeconds: 5,
      frames: 625,
      frameTimeMs: metric,
      cpuRenderMs: metric,
      gpuFrameMs: { p50: null, p95: null },
      activeMeshesEvaluationMs: metric,
      particlesRenderMs: metric,
      animationsMs: metric,
      physicsMs: metric,
      drawCalls: metric,
      activeMeshes: metric,
      triangles: metric,
      shaderCompilation: { count: 2, totalMs: 3.5 },
      webgpuBundles: null,
    };

    const output = formatRendererPerformanceReport(report);
    expect(output).toContain("Backend: webgl2; map: wdm2; KTX2: on");
    expect(output).toContain("GPU frame: unavailable");
    expect(output).toContain("2 compile(s), 3.50ms total");
  });
});

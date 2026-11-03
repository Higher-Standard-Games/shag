import { describe, expect, it } from "vitest";
import { installStableWebGPULabels, stableWebGPULabel } from "../WebGPULabels";

describe("stable WebGPU labels", () => {
  it("drops Babylon's frame stamp and keeps one string per text", () => {
    const first = stableWebGPULabel(`[12|40] - ${"Main"}RenderPass`);
    const later = stableWebGPULabel(`[13|44] - ${"Main"}RenderPass`);
    expect(first).toBe("MainRenderPass");
    expect(later).toBe(first);
    expect(stableWebGPULabel("depth - Color Attachment View")).toBe("depth - Color Attachment View");
    expect(stableWebGPULabel("[x] not a stamp")).toBe("[x] not a stamp");
  });

  it("routes per-frame descriptors through it, once per page", () => {
    const seen: (string | undefined)[] = [];
    class GPUDevice {
      createCommandEncoder(descriptor?: { label?: string }) {
        seen.push(descriptor?.label);
        return descriptor;
      }
    }
    class GPUCommandEncoder {
      beginRenderPass(descriptor: { label?: string }) {
        seen.push(descriptor.label);
      }
    }
    const globals = { GPUDevice, GPUCommandEncoder } as Record<string, unknown>;
    installStableWebGPULabels(globals);
    installStableWebGPULabels(globals);
    new GPUDevice().createCommandEncoder({ label: "[1|2] - RenderEncoder" });
    new GPUDevice().createCommandEncoder();
    new GPUCommandEncoder().beginRenderPass({ label: "[1|3] - shadow - RenderPass" });
    expect(seen).toEqual(["RenderEncoder", undefined, "shadow - RenderPass"]);
  });

  it("leaves a browser without WebGPU alone", () => {
    expect(() => installStableWebGPULabels({})).not.toThrow();
  });
});

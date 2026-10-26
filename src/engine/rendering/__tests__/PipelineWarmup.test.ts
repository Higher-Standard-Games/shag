import { WebGPUStencilStateComposer } from "@babylonjs/core/Engines/WebGPU/webgpuStencilStateComposer";
import { Observable } from "@babylonjs/core/Misc/observable";
import { StencilState } from "@babylonjs/core/States/stencilState";
import { describe, expect, it, vi } from "vitest";
import { warmRenderPipelines } from "../PipelineWarmup";
import { stabilizeDisabledStencilKeys } from "../WebGPUStencilKey";

function fakeScene(isWebGPU: boolean) {
  const created: unknown[] = [];
  const device = Object.create({
    createRenderPipeline(descriptor: unknown) {
      created.push(descriptor);
      return {};
    },
  }) as { createRenderPipeline(descriptor: unknown): unknown; queue: { onSubmittedWorkDone(): Promise<void> } };
  device.queue = { onSubmittedWorkDone: vi.fn(async () => {}) };
  const scene = {
    skipFrustumClipping: false,
    onAfterRenderObservable: new Observable<unknown>(),
    getEngine: () => ({ isWebGPU, _device: isWebGPU ? device : undefined }),
  };
  return { scene, device, created };
}

describe("render pipeline warmup", () => {
  it("draws two frames with frustum clipping skipped, then restores it and drains the queue", async () => {
    const { scene, device, created } = fakeScene(true);
    const clippingDuringFrames: boolean[] = [];
    const run = warmRenderPipelines(scene as never);
    for (let frame = 0; frame < 2; frame++) {
      await vi.waitFor(() => expect(scene.onAfterRenderObservable.hasObservers()).toBe(true));
      clippingDuringFrames.push(scene.skipFrustumClipping);
      device.createRenderPipeline({ frame });
      scene.onAfterRenderObservable.notifyObservers(scene);
    }
    expect(await run).toBe(2);
    expect(created).toHaveLength(2);
    expect(clippingDuringFrames).toEqual([true, true]);
    expect(scene.skipFrustumClipping).toBe(false);
    expect(Object.getOwnPropertyDescriptor(device, "createRenderPipeline")).toBeUndefined();
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
  });

  it("does nothing on WebGL", async () => {
    const { scene } = fakeScene(false);
    expect(await warmRenderPipelines(scene as never)).toBe(0);
    expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
  });

  it("restores clipping when the load is cancelled", async () => {
    const { scene } = fakeScene(true);
    const controller = new AbortController();
    const run = warmRenderPipelines(scene as never, controller.signal);
    await vi.waitFor(() => expect(scene.onAfterRenderObservable.hasObservers()).toBe(true));
    controller.abort(new Error("cancelled"));
    await expect(run).rejects.toThrow("cancelled");
    expect(scene.skipFrustumClipping).toBe(false);
    expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
  });
});

describe("disabled stencil pipeline keys", () => {
  it("returns the masks to their defaults once stencil is disabled", () => {
    expect(stabilizeDisabledStencilKeys()).toBe(true);
    const writeMasks: number[] = [];
    const readMasks: number[] = [];
    const cache = new Proxy(
      {
        setStencilWriteMask: (mask: number) => writeMasks.push(mask),
        setStencilReadMask: (mask: number) => readMasks.push(mask),
      } as Record<string, unknown>,
      { get: (target, name: string) => target[name] ?? (() => {}) },
    );
    const composer = new WebGPUStencilStateComposer(cache as never);
    const global = new StencilState();
    composer.stencilGlobal = global;

    // OutlineRenderer's stencil-only draw
    global.stencilTest = true;
    global.mask = 0x04;
    global.funcMask = 0x04;
    composer.apply();
    expect(writeMasks.at(-1)).toBe(0x04);
    expect(readMasks.at(-1)).toBe(0x04);

    global.stencilTest = false;
    composer.apply();
    expect(writeMasks.at(-1)).toBe(0xff);
    expect(readMasks.at(-1)).toBe(0xff);

    global.stencilTest = true;
    composer.apply();
    expect(writeMasks.at(-1)).toBe(0x04);
  });
});

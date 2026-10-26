/**
 * WebGPU builds a render pipeline the first time a material draws with a new
 * combination of effect, vertex layout, render states and target formats.
 * Babylon creates them synchronously at draw time, and the browser compiles
 * each one before the frame can finish, so a map's surfaces coming into view
 * for the first time stall play for seconds. WebGL2 links programs when the
 * effect compiles and has no such cost.
 *
 * Before the loading screen closes, draw every enabled mesh once with frustum
 * clipping skipped, so those pipelines are built behind it. The GPU queue is
 * drained afterwards so their compilation is not left to the first frames of
 * play. Meshes that are disabled now (pooled effects, unheld weapons) still
 * build their pipelines when they first draw.
 */

import type { Scene } from "@babylonjs/core/scene";

/** Frames drawn with clipping skipped; the second catches meshes whose first draw changed their state. */
const WARM_FRAMES = 2;
/** Longest wait for one rendered frame; a stopped render loop cannot warm anything. */
const FRAME_TIMEOUT_MS = 5000;
/** Longest wait for the GPU to finish the warm frames. */
const DRAIN_TIMEOUT_MS = 15000;

interface WarmDevice {
  createRenderPipeline(...args: unknown[]): unknown;
  queue: { onSubmittedWorkDone(): Promise<void> };
}

function nextRenderedFrame(scene: Scene, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const finish = (rendered: boolean) => {
      clearTimeout(timer);
      scene.onAfterRenderObservable.remove(observer);
      signal?.removeEventListener("abort", aborted);
      resolve(rendered);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(false), FRAME_TIMEOUT_MS);
    const observer = scene.onAfterRenderObservable.addOnce(() => finish(true));
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) finish(false);
  });
}

/**
 * Draw the whole scene for a few frames and wait for the GPU. Returns the
 * number of render pipelines created, or 0 on backends without them.
 */
export async function warmRenderPipelines(scene: Scene, signal?: AbortSignal): Promise<number> {
  const engine = scene.getEngine() as { isWebGPU?: boolean; _device?: WarmDevice };
  const device = engine.isWebGPU ? engine._device : undefined;
  if (!device) return 0;
  // A hidden tab renders no frames; the pipelines are then built in play
  if (typeof document !== "undefined" && document.hidden) return 0;

  // Count the pipelines the warm frames create, for the load log
  let created = 0;
  const own = Object.getOwnPropertyDescriptor(device, "createRenderPipeline");
  const create = device.createRenderPipeline;
  device.createRenderPipeline = function (this: WarmDevice, ...args: unknown[]) {
    created++;
    return create.apply(this, args);
  };
  const skipped = scene.skipFrustumClipping;
  scene.skipFrustumClipping = true;
  try {
    for (let frame = 0; frame < WARM_FRAMES; frame++) {
      if (!(await nextRenderedFrame(scene, signal))) break;
    }
  } finally {
    scene.skipFrustumClipping = skipped;
    if (own) Object.defineProperty(device, "createRenderPipeline", own);
    else delete (device as Partial<WarmDevice>).createRenderPipeline;
  }
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    device.queue.onSubmittedWorkDone().catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, DRAIN_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  return created;
}

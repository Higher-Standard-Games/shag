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
 * play. Meshes that are hidden at that point (pooled effects, unheld weapons)
 * are drawn later by `warmHiddenMeshes`, once the game has created them.
 */

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { getSnapshotFrames } from "./SnapshotFrames";

/** Frames drawn with clipping skipped; the second catches meshes whose first draw changed their state. */
const WARM_FRAMES = 2;
/** Longest wait for one rendered frame; a stopped render loop cannot warm anything. */
const FRAME_TIMEOUT_MS = 5000;
/** The same for the hidden-mesh frames, which callers make in more places and some without a loop running yet. */
const HIDDEN_FRAME_TIMEOUT_MS = 1000;
/** Longest wait for the GPU to finish the warm frames. */
const DRAIN_TIMEOUT_MS = 15000;

interface WarmDevice {
  createRenderPipeline(...args: unknown[]): unknown;
  queue: { onSubmittedWorkDone(): Promise<void> };
}

/**
 * Wait for `frames` frames to render. False when one does not arrive within
 * `timeoutMs` (a stopped render loop, a hidden tab) or the wait is aborted.
 */
export async function renderFrames(
  scene: Scene,
  frames: number,
  signal?: AbortSignal,
  timeoutMs = FRAME_TIMEOUT_MS,
): Promise<boolean> {
  for (let frame = 0; frame < frames; frame++) {
    if (!(await nextRenderedFrame(scene, signal, timeoutMs))) return false;
  }
  return true;
}

function nextRenderedFrame(scene: Scene, signal?: AbortSignal, timeoutMs = FRAME_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const finish = (rendered: boolean) => {
      clearTimeout(timer);
      scene.onAfterRenderObservable.remove(observer);
      signal?.removeEventListener("abort", aborted);
      resolve(rendered);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
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
  return warmFrames(scene, signal, () => () => {});
}

/** A hidden mesh's state, put back after the warm frames. */
interface ShownMesh {
  mesh: AbstractMesh;
  enabled: boolean;
  visible: boolean;
  visibility: number;
  alwaysSelected: boolean;
  instances: number | null;
}

/**
 * Draw what is hidden now for a few frames: pooled effects, model templates,
 * parked weapons and projectiles, each with its ancestors enabled, a
 * thin-instance batch with at least one instance, wherever it stands. Their
 * render pipelines are then built behind the loading screen instead of on
 * their first appearance in play, where each stalled a frame (by up to half a
 * second in Firefox, which builds them synchronously). Everything is put back
 * as it was. `meshes` defaults to the whole scene. Returns the number of
 * render pipelines created, or 0 on backends without them.
 */
export async function warmHiddenMeshes(
  scene: Scene,
  signal?: AbortSignal,
  meshes: readonly AbstractMesh[] = scene.meshes,
): Promise<number> {
  return warmFrames(
    scene,
    signal,
    () => {
      const shown: ShownMesh[] = [];
      const ancestors: Node[] = [];
      for (const mesh of meshes) {
        if (mesh.isDisposed() || mesh.getTotalVertices() === 0) continue;
        const storage = (
          mesh as unknown as { _thinInstanceDataStorage?: { instancesCount: number; matrixBuffer?: unknown } }
        )._thinInstanceDataStorage;
        const batch = storage?.matrixBuffer ? (mesh as Mesh) : null;
        shown.push({
          mesh,
          enabled: mesh.isEnabled(false),
          visible: mesh.isVisible,
          visibility: mesh.visibility,
          alwaysSelected: mesh.alwaysSelectAsActiveMesh,
          instances: batch ? batch.thinInstanceCount : null,
        });
        for (let node = mesh.parent; node; node = node.parent) {
          if (!node.isEnabled(false)) {
            ancestors.push(node);
            node.setEnabled(true);
          }
        }
        if (!mesh.isEnabled(false)) mesh.setEnabled(true);
        mesh.isVisible = true;
        if (mesh.visibility <= 0) mesh.visibility = 1;
        mesh.alwaysSelectAsActiveMesh = true;
        if (batch && batch.thinInstanceCount < 1) batch.thinInstanceCount = 1;
      }
      return () => {
        for (const state of shown) {
          const { mesh } = state;
          if (mesh.isDisposed()) continue;
          if (state.instances !== null) (mesh as Mesh).thinInstanceCount = state.instances;
          mesh.alwaysSelectAsActiveMesh = state.alwaysSelected;
          mesh.visibility = state.visibility;
          mesh.isVisible = state.visible;
          if (!state.enabled) mesh.setEnabled(false);
        }
        for (const node of ancestors) if (!node.isDisposed()) node.setEnabled(false);
      };
    },
    HIDDEN_FRAME_TIMEOUT_MS,
  );
}

/**
 * Draw a few frames with frustum clipping skipped, with what `show` sets up
 * for them (undone by the function it returns), and wait for the GPU to
 * finish them. Returns the number of render pipelines created.
 */
async function warmFrames(
  scene: Scene,
  signal: AbortSignal | undefined,
  show: () => () => void,
  frameTimeoutMs = FRAME_TIMEOUT_MS,
): Promise<number> {
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
  // Snapshot replays would draw the recording instead of these frames
  const snapshots = getSnapshotFrames(scene);
  const replaying = snapshots?.enabled ?? false;
  if (snapshots) snapshots.enabled = false;
  const hide = show();
  try {
    await renderFrames(scene, WARM_FRAMES, signal, frameTimeoutMs);
  } finally {
    hide();
    if (snapshots) snapshots.enabled = replaying;
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

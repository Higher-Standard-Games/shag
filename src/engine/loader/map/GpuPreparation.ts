import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { waitForAsync } from "../../core/AsyncWait";

/** Readiness observation owned by one load, without Babylon's uncancellable polling promises. */
export function waitForGpuCondition(
  scene: Scene,
  ready: () => boolean,
  stage: string,
  signal?: AbortSignal,
  timeoutMs = 10000,
  visibleOnly = true,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let poll: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let remaining = timeoutMs;
    let activeSince: number | undefined;
    let frozen = false;
    const doc =
      typeof document !== "undefined" && typeof document.addEventListener === "function" ? document : undefined;
    const lostObservable = scene.getEngine().onContextLostObservable;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(poll);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", aborted);
      doc?.removeEventListener("visibilitychange", visibility);
      doc?.removeEventListener("freeze", visibility);
      doc?.removeEventListener("resume", visibility);
      scene.onDisposeObservable.remove(disposed);
      lostObservable?.remove(lost);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const aborted = () => finish(signal?.reason ?? new Error(`Cancelled: ${stage}`));
    const disposed = scene.onDisposeObservable.addOnce(() => finish(new Error(`Scene disposed: ${stage}`)));
    const lost = lostObservable?.add(() => finish(new Error(`Rendering context/device lost: ${stage}. Please retry.`)));
    const visibility = (event?: Event) => {
      if (event?.type === "freeze") frozen = true;
      if (event?.type === "resume") frozen = false;
      clearTimeout(poll);
      clearTimeout(deadline);
      if (activeSince !== undefined) remaining -= performance.now() - activeSince;
      activeSince = undefined;
      check();
    };
    const check = () => {
      try {
        if (signal?.aborted) return aborted();
        if (scene.isDisposed) return finish(new Error(`Scene disposed: ${stage}`));
        if (visibleOnly && (doc?.hidden || frozen)) return;
        if (activeSince === undefined) {
          activeSince = performance.now();
          deadline = setTimeout(() => finish(new Error(`GPU preparation timed out: ${stage}`)), Math.max(0, remaining));
        }
        if (ready()) return finish();
        poll = setTimeout(check, 16);
      } catch (error) {
        finish(error);
      }
    };
    signal?.addEventListener("abort", aborted, { once: true });
    doc?.addEventListener("visibilitychange", visibility);
    doc?.addEventListener("freeze", visibility);
    doc?.addEventListener("resume", visibility);
    check();
  });
}

/** Compile the actual mesh layout, keeping frozen readiness caches disabled until preparation ends. */
export async function prepareMaterial(material: Material, mesh: AbstractMesh, signal?: AbortSignal): Promise<void> {
  const scene = mesh.getScene();
  // Frozen PBR readiness can reuse the previous draw's ready flag after its
  // effect was replaced with an asynchronously compiling one. Keep normal
  // readiness checks active until the replacement can actually draw.
  const wasFrozen = material.isFrozen;
  if (wasFrozen) material.unfreeze();
  try {
    await waitForGpuCondition(
      scene,
      () => {
        if (mesh.isDisposed()) throw new Error(`Mesh disposed: ${mesh.name}`);
        const hotSwapping = material.allowShaderHotSwapping;
        material.allowShaderHotSwapping = false;
        try {
          const subMeshes = mesh.subMeshes ?? [];
          const ready =
            material._storeEffectOnSubMeshes && subMeshes.length
              ? subMeshes.map((subMesh) => material.isReadyForSubMesh(mesh, subMesh, false)).every(Boolean)
              : material.isReady(mesh);
          for (const subMesh of subMeshes) {
            const effect = subMesh.effect;
            const error = effect?.getCompilationError();
            if (error && effect?.allFallbacksProcessed()) throw new Error(`Shader ${material.name}: ${error}`);
          }
          return ready;
        } finally {
          material.allowShaderHotSwapping = hotSwapping;
        }
      },
      `${material.name} on ${mesh.name}`,
      signal,
    );
  } finally {
    if (wasFrozen && !scene.isDisposed && scene.materials.includes(material)) material.freeze();
  }
}

/** Detach a load from shared async preparation; its resource owner must reject stale completion. */
export async function waitForPreparation<T>(
  work: Promise<T>,
  scene: Scene,
  stage: string,
  signal?: AbortSignal,
  timeoutMs = 30000,
): Promise<T> {
  const controller = new AbortController();
  const aborted = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", aborted, { once: true });
  const disposed = scene.onDisposeObservable.addOnce(() => controller.abort(new Error(`Scene disposed: ${stage}`)));
  if (signal?.aborted) aborted();
  if (scene.isDisposed) controller.abort(new Error(`Scene disposed: ${stage}`));
  try {
    return await waitForAsync(work, controller.signal, timeoutMs, stage);
  } finally {
    signal?.removeEventListener("abort", aborted);
    scene.onDisposeObservable.remove(disposed);
  }
}

/** Match Babylon's out-of-frame readiness checks while retaining our own cancellable lifetime. */
export function sceneGpuReady(scene: Scene): boolean {
  const previous = scene.activeCamera;
  scene.activeCamera = scene.activeCameras?.[0] ?? previous;
  try {
    scene.incrementRenderId();
    return scene.isReady();
  } finally {
    scene.activeCamera = previous;
  }
}

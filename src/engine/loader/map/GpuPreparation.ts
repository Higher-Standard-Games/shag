import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

/** Readiness observation owned by one load, without Babylon's uncancellable polling promises. */
export function waitForGpuCondition(
  scene: Scene,
  ready: () => boolean,
  stage: string,
  signal?: AbortSignal,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let poll: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(poll);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", aborted);
      scene.onDisposeObservable.remove(disposed);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const aborted = () => finish(signal?.reason ?? new Error(`Cancelled: ${stage}`));
    const disposed = scene.onDisposeObservable.addOnce(() => finish(new Error(`Scene disposed: ${stage}`)));
    const check = () => {
      try {
        if (signal?.aborted) return aborted();
        if (scene.isDisposed) return finish(new Error(`Scene disposed: ${stage}`));
        if (ready()) return finish();
        poll = setTimeout(check, 16);
      } catch (error) {
        finish(error);
      }
    };
    signal?.addEventListener("abort", aborted, { once: true });
    deadline = setTimeout(() => finish(new Error(`GPU preparation timed out: ${stage}`)), timeoutMs);
    check();
  });
}

/** Compile the actual mesh layout and restore the material's policy after each synchronous check. */
export function prepareMaterial(material: Material, mesh: AbstractMesh, signal?: AbortSignal): Promise<void> {
  const scene = mesh.getScene();
  return waitForGpuCondition(
    scene,
    () => {
      if (mesh.isDisposed()) throw new Error(`Mesh disposed: ${mesh.name}`);
      const hotSwapping = material.allowShaderHotSwapping;
      material.allowShaderHotSwapping = false;
      try {
        const subMeshes = mesh.subMeshes ?? [];
        const ready =
          material._storeEffectOnSubMeshes && subMeshes.length
            ? subMeshes.map((subMesh) => material.isReadyForSubMesh(mesh, subMesh)).every(Boolean)
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
}

/** Detach a load from shared async preparation; its resource owner must reject stale completion. */
export async function waitForPreparation<T>(
  work: Promise<T>,
  scene: Scene,
  stage: string,
  signal?: AbortSignal,
  timeoutMs = 30000,
): Promise<T> {
  let result: { value: T } | { error: unknown } | undefined;
  const observed = work.then(
    (value) => {
      result = { value };
    },
    (error: unknown) => {
      result = { error };
    },
  );
  await waitForGpuCondition(scene, () => result !== undefined, stage, signal, timeoutMs);
  await observed;
  if (!result || "error" in result) throw result?.error ?? new Error(`Preparation failed: ${stage}`);
  return result.value;
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

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { installSceneMeshFilter } from "./SceneMeshCandidates";

interface PoolEntry {
  leases: number;
  forget: () => void;
}
const pools = new WeakMap<Scene, PooledMeshCandidates>();

/** One filter per scene, even when several independent owners register pools. */
class PooledMeshCandidates {
  private readonly entries = new Map<AbstractMesh, PoolEntry>();
  private readonly idle = new Set<AbstractMesh>();
  private readonly releaseFilter;
  private readonly sceneObserver;
  private disposed = false;

  constructor(private readonly scene: Scene) {
    this.releaseFilter = installSceneMeshFilter(scene, {
      enabled: () => this.idle.size > 0,
      // Read the actual state: an external enable must never leave a pooled mesh hidden.
      keep: (mesh) => !this.idle.has(mesh) || mesh.isEnabled(),
    });
    this.sceneObserver = scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  register(mesh: AbstractMesh): () => void {
    let entry = this.entries.get(mesh);
    if (!entry) {
      const update = () => {
        if (mesh.isEnabled()) this.idle.delete(mesh);
        else this.idle.add(mesh);
      };
      update();
      const enabledObserver = mesh.onEffectiveEnabledStateChangedObservable.add(update);
      const created: PoolEntry = {
        leases: 0,
        forget: () => {
          if (this.entries.get(mesh) !== created) return;
          this.entries.delete(mesh);
          this.idle.delete(mesh);
          mesh.onDisposeObservable.remove(observer);
          mesh.onEffectiveEnabledStateChangedObservable.remove(enabledObserver);
          if (this.entries.size === 0) this.dispose();
        },
      };
      const observer = mesh.onDisposeObservable.addOnce(created.forget);
      this.entries.set(mesh, created);
      entry = created;
    }
    const registration = entry;
    registration.leases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--registration.leases === 0) registration.forget();
    };
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.forget();
    this.releaseFilter();
    this.scene.onDisposeObservable.remove(this.sceneObserver);
    pools.delete(this.scene);
  }
}

/** Declare a pool-owned mesh. Disposal releases ownership; the token can release it earlier. */
export function registerPooledMeshCandidate(mesh: AbstractMesh): () => void {
  const scene = mesh.getScene();
  if (mesh.isDisposed() || scene.isDisposed) return () => {};
  let pool = pools.get(scene);
  if (!pool) {
    pool = new PooledMeshCandidates(scene);
    pools.set(scene, pool);
  }
  return pool.register(mesh);
}

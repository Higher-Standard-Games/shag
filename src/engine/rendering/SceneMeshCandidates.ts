import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

interface CandidateFilter {
  camera?: Camera;
  enabled: (camera: Camera) => boolean;
  keep: (mesh: AbstractMesh, camera: Camera) => boolean;
}
interface Registration extends CandidateFilter {
  release: () => void;
}
const runtimes = new WeakMap<Scene, SceneMeshCandidateProvider>();

/** Composes camera filters through one scene hook; callbacks preserve source order. */
class SceneMeshCandidateProvider {
  private readonly original: Scene["getActiveMeshCandidates"];
  private readonly registrations = new Set<Registration>();
  private buffers = new WeakMap<Camera, { data: AbstractMesh[]; length: number; filters: Registration[] }>();
  private disposed = false;
  private readonly sceneObserver;
  private readonly provider = () => {
    const source = this.original.call(this.scene);
    const camera = this.scene.activeCamera;
    if (this.disposed || !camera || typeof this.scene.customLODSelector === "function") return source;
    let buffer = this.buffers.get(camera);
    if (!buffer) {
      buffer = { data: [], length: 0, filters: [] };
      this.buffers.set(camera, buffer);
    }
    buffer.filters.length = 0;
    for (const registration of this.registrations) {
      if ((!registration.camera || registration.camera === camera) && registration.enabled(camera))
        buffer.filters.push(registration);
    }
    if (buffer.filters.length === 0) {
      buffer.data.length = 0;
      buffer.length = 0;
      return source;
    }
    let count = 0;
    for (let i = 0; i < source.length; i++) {
      const mesh = source.data[i];
      // Babylon processes intersection actions before visibility/layer tests.
      let keep = true;
      if (!mesh.actionManager) {
        for (const filter of buffer.filters) {
          if (!filter.keep(mesh, camera)) {
            keep = false;
            break;
          }
        }
      }
      if (keep) buffer.data[count++] = mesh;
    }
    buffer.data.length = count;
    buffer.length = count;
    return buffer;
  };
  constructor(private readonly scene: Scene) {
    this.original = scene.getActiveMeshCandidates;
    scene.getActiveMeshCandidates = this.provider;
    this.sceneObserver = scene.onDisposeObservable.addOnce(() => this.dispose());
  }
  register(filter: CandidateFilter): () => void {
    let released = false;
    const entry: Registration = {
      ...filter,
      release: () => {
        if (released) return;
        released = true;
        filter.camera?.onDisposeObservable.remove(observer ?? null);
        this.registrations.delete(entry);
        if (this.registrations.size === 0) this.dispose();
      },
    };
    const observer = filter.camera?.onDisposeObservable.addOnce(entry.release);
    this.registrations.add(entry);
    return entry.release;
  }
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.registrations) entry.release();
    this.registrations.clear();
    this.buffers = new WeakMap();
    if (this.scene.getActiveMeshCandidates === this.provider) this.scene.getActiveMeshCandidates = this.original;
    this.scene.onDisposeObservable.remove(this.sceneObserver);
    runtimes.delete(this.scene);
  }
}
export function installSceneMeshFilter(scene: Scene, filter: CandidateFilter): () => void {
  if (scene.isDisposed || filter.camera?.isDisposed()) return () => {};
  let runtime = runtimes.get(scene);
  if (!runtime) {
    runtime = new SceneMeshCandidateProvider(scene);
    runtimes.set(scene, runtime);
  }
  return runtime.register(filter);
}

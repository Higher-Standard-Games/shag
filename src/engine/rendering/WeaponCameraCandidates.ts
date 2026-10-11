import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../core/Cvar";

Cvar.register("r_weapon_candidates", 0, {
  type: "int",
  min: 0,
  max: 1,
  persist: false,
  description: "Experimental camera-layer filtering before first-person weapon mesh evaluation",
});

interface Registration {
  enabled: () => boolean;
  release: () => void;
}

const runtimes = new WeakMap<Scene, WeaponCameraCandidateProvider>();

/** One provider per scene; live and demo weapon cameras have independent leases. */
class WeaponCameraCandidateProvider {
  private readonly original: Scene["getActiveMeshCandidates"];
  private readonly cameras = new Map<Camera, Set<Registration>>();
  private readonly filtered = { data: [] as AbstractMesh[], length: 0 };
  private disposed = false;
  private readonly sceneObserver;

  private readonly provider = () => {
    const source = this.original.call(this.scene);
    const camera = this.scene.activeCamera;
    const registrations = camera ? this.cameras.get(camera) : undefined;
    let enabled = false;
    if (registrations) {
      for (const registration of registrations) {
        if (registration.enabled()) {
          enabled = true;
          break;
        }
      }
    }
    if (this.disposed || !camera || !registrations || typeof this.scene.customLODSelector === "function" || !enabled) {
      this.filtered.data.length = 0;
      this.filtered.length = 0;
      return source;
    }
    let count = 0;
    for (let i = 0; i < source.length; i++) {
      const mesh = source.data[i];
      // Babylon processes intersection actions before its layer test. Keep
      // these meshes even outside the weapon layer so those actions still run.
      if ((mesh.layerMask & camera.layerMask) !== 0 || mesh.actionManager) this.filtered.data[count++] = mesh;
    }
    this.filtered.data.length = count;
    this.filtered.length = count;
    return this.filtered;
  };

  constructor(private readonly scene: Scene) {
    this.original = scene.getActiveMeshCandidates;
    scene.getActiveMeshCandidates = this.provider;
    this.sceneObserver = scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  register(camera: Camera, enabled: () => boolean): () => void {
    const entries = this.cameras.get(camera) ?? new Set<Registration>();
    this.cameras.set(camera, entries);
    let released = false;
    const entry: Registration = {
      enabled,
      release: () => {
        if (released) return;
        released = true;
        camera.onDisposeObservable.remove(observer);
        entries.delete(entry);
        if (entries.size === 0) this.cameras.delete(camera);
        if (this.cameras.size === 0) this.dispose();
      },
    };
    const observer = camera.onDisposeObservable.addOnce(entry.release);
    entries.add(entry);
    return entry.release;
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entries of this.cameras.values()) for (const entry of entries) entry.release();
    this.cameras.clear();
    this.filtered.data.length = 0;
    this.filtered.length = 0;
    if (this.scene.getActiveMeshCandidates === this.provider) this.scene.getActiveMeshCandidates = this.original;
    this.scene.onDisposeObservable.remove(this.sceneObserver);
    runtimes.delete(this.scene);
  }
}

export function installWeaponCameraCandidates(
  scene: Scene,
  camera: Camera,
  enabled: () => boolean = () => Cvar.getBool("r_weapon_candidates"),
): () => void {
  if (scene.isDisposed || camera.isDisposed()) return () => {};
  let runtime = runtimes.get(scene);
  if (!runtime) {
    runtime = new WeaponCameraCandidateProvider(scene);
    runtimes.set(scene, runtime);
  }
  return runtime.register(camera, enabled);
}

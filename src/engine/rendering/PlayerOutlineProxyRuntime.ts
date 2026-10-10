import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { PlayerModelInstance } from "../animation/PlayerModelManager";
import { PlayerOutlineProxy } from "./PlayerOutlineProxy";

export const PLAYER_OUTLINE_PROXY_URL = "/data/benchmarks/outline-proxy/player-outline-proxy-v1.glb";
const runtimes = new WeakMap<Scene, PlayerOutlineProxyRuntime>();
const sha256 = async (bytes: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");

/** One scene adapter shared by live/demo managers. Sources load only after explicit opt-in. */
export class PlayerOutlineProxyRuntime {
  private readonly owners = new Map<object, Set<PlayerModelInstance>>();
  private readonly parts = new Map<PlayerModelInstance, Mesh[]>();
  private readonly rejected = new Set<PlayerModelInstance>();
  private container?: AssetContainer;
  private adapter?: PlayerOutlineProxy;
  private pending?: Promise<void>;
  private disposed = false;
  private enabled = false;
  private status: "loading" | "ready" | "failed" = "loading";
  private error?: string;
  private assets?: { sourceSha256: string; proxySha256: string };
  private readonly sceneDispose;

  static existing(scene: Scene): PlayerOutlineProxyRuntime | undefined {
    return runtimes.get(scene);
  }

  static acquire(scene: Scene): PlayerOutlineProxyRuntime {
    let runtime = runtimes.get(scene);
    if (!runtime) {
      runtime = new PlayerOutlineProxyRuntime(scene);
      runtimes.set(scene, runtime);
    }
    return runtime;
  }

  private constructor(private readonly scene: Scene) {
    this.sceneDispose = scene.onDisposeObservable.add(() => this.dispose());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.adapter) this.adapter.enabled = enabled;
  }

  prepare(owner: object, modelUrl: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.owners.has(owner)) this.owners.set(owner, new Set());
    this.pending ??= this.load(modelUrl);
    return this.pending;
  }

  private async load(modelUrl: string): Promise<void> {
    let container: AssetContainer | undefined;
    try {
      const [manifestResponse, proxyResponse, sourceResponse] = await Promise.all([
        fetch(`${PLAYER_OUTLINE_PROXY_URL}.json`),
        fetch(PLAYER_OUTLINE_PROXY_URL),
        fetch(modelUrl),
      ]);
      if (![manifestResponse, proxyResponse, sourceResponse].every((r) => r.ok))
        throw new Error("Missing outline proxy/source asset; run benchmark:outline-proxy:build");
      const [manifest, proxyBytes, sourceBytes] = await Promise.all([
        manifestResponse.json(),
        proxyResponse.arrayBuffer(),
        sourceResponse.arrayBuffer(),
      ]);
      const [proxyHash, sourceHash] = await Promise.all([sha256(proxyBytes), sha256(sourceBytes)]);
      if (manifest.proxySha256 !== proxyHash || manifest.sourceSha256 !== sourceHash)
        throw new Error("Outline proxy provenance does not match the player asset");
      container = await LoadAssetContainerAsync(new Uint8Array(proxyBytes), this.scene, {
        pluginExtension: ".glb",
        pluginOptions: { gltf: { animationStartMode: 0 } },
      });
      if (this.disposed) {
        container.dispose();
        return;
      }
      this.container = container;
      this.assets = { sourceSha256: sourceHash, proxySha256: proxyHash };
      this.adapter = new PlayerOutlineProxy(this.scene);
      this.adapter.enabled = this.enabled;
      this.status = "ready";
      for (const instances of this.owners.values()) for (const instance of instances) this.attach(instance);
    } catch (error) {
      if (this.disposed) {
        container?.dispose();
        return;
      }
      this.status = "failed";
      this.error = String(error);
      console.warn(`[PlayerOutlineProxy] ${this.error}; retaining full outlines`);
    }
  }

  register(owner: object, instance: PlayerModelInstance): void {
    const instances = this.owners.get(owner);
    if (!instances || instance.mesh.isDisposed()) return;
    instances.add(instance);
    if (this.status === "ready") this.attach(instance);
  }

  private attach(instance: PlayerModelInstance): void {
    if (
      !this.adapter ||
      !this.container ||
      this.parts.has(instance) ||
      this.rejected.has(instance) ||
      instance.mesh.isDisposed()
    )
      return;
    const parts = [instance.mesh, ...instance.mesh.getChildMeshes()].filter(
      (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0 && m.skeleton === instance.skeleton,
    );
    try {
      if (!parts.length) throw new Error("Player has no eligible outline body parts");
      this.adapter.attachContainer(parts, this.container);
      this.parts.set(instance, parts);
    } catch (error) {
      for (const part of parts) this.adapter.detach(part);
      this.rejected.add(instance);
      this.error ??= String(error);
    }
  }

  unregister(owner: object, instance: PlayerModelInstance): void {
    this.owners.get(owner)?.delete(instance);
    for (const part of this.parts.get(instance) ?? []) this.adapter?.detach(part);
    this.parts.delete(instance);
    this.rejected.delete(instance);
  }

  release(owner: object): void {
    for (const instance of this.owners.get(owner) ?? []) this.unregister(owner, instance);
    this.owners.delete(owner);
    if (!this.owners.size) this.dispose();
  }

  resetCounters(): void {
    this.adapter?.resetCounters();
  }

  diagnostics() {
    return {
      requested: this.enabled,
      status: this.enabled ? this.status : "disabled",
      error: this.error ?? null,
      assets: this.assets ?? null,
      attachedParts: this.adapter?.attachedParts ?? 0,
      rejectedRoots: this.rejected.size,
      routedPasses: this.adapter?.routedPasses ?? 0,
      routedIndices: this.adapter?.routedIndices ?? 0,
      fallbackPasses: this.adapter?.fallbackPasses ?? 0,
      unsupportedPasses: this.adapter?.unsupportedPasses ?? 0,
    };
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onDisposeObservable.remove(this.sceneDispose);
    this.adapter?.dispose();
    this.container?.dispose();
    this.owners.clear();
    this.parts.clear();
    this.rejected.clear();
    if (runtimes.get(this.scene) === this) runtimes.delete(this.scene);
  }
}

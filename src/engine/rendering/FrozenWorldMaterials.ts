import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Keeps frozen world materials in step with the scene state their shaders
 * depend on.
 *
 * A frozen material skips its define check and its material uniforms on every
 * draw, which is most of what an unfrozen world surface costs. It also stops
 * hearing the dirty flags Babylon raises when a light is added, removed,
 * enabled or disabled, or when the scene ambient changes: its shader would keep
 * the old light set (a clustered container created after the map loaded would
 * never light the walls) and its old ambient term.
 *
 * The light order matters as much as the set: a shader binds each light by its
 * slot, and a light in the wrong slot binds a uniform buffer of the wrong size,
 * which WebGPU rejects with the whole frame. Babylon appends a light that is
 * switched on to the end of each mesh's list, and re-sorts every list into
 * scene order whenever any light is added, even one no world surface receives.
 * World surfaces do not all receive the same lights either: lightmapped ones
 * take only the clustered container.
 *
 * So once per frame this hashes the light list of every tracked surface, in
 * order, with the scene ambient. On a change each tracked frozen material is
 * checked and bound once more. Lights no world surface receives (a loaded
 * model's own light, the weapon view's lights) appear in no surface's list, so
 * they cost nothing unless they re-sort one. Pooled lights that join a
 * clustered container within one task never appear either.
 */
class FrozenWorldMaterialWatcher {
  private readonly materials = new Set<Material>();
  private surfaces: AbstractMesh[] = [];
  private readonly observer: Observer<Scene> | null;
  private signature = "";

  constructor(private readonly scene: Scene) {
    this.signature = this.read();
    this.observer = scene.onBeforeRenderObservable.add(() => this.check());
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  replace(materials: Iterable<Material>): void {
    this.materials.clear();
    for (const material of materials) {
      this.materials.add(material);
      material.onDisposeObservable.addOnce(() => this.materials.delete(material));
    }
    const surfaces = new Set<AbstractMesh>();
    for (const material of this.materials) {
      for (const mesh of material.getBindedMeshes()) surfaces.add(mesh);
    }
    this.surfaces = [...surfaces];
    this.signature = this.read();
  }

  private read(): string {
    const ambient = this.scene.ambientColor;
    let hash = 0;
    for (const surface of this.surfaces) {
      if (surface.isDisposed()) continue;
      const lights = surface.lightSources;
      hash = (Math.imul(hash, 31) + lights.length) | 0;
      for (const light of lights) hash = (Math.imul(hash, 31) + light.uniqueId) | 0;
    }
    return `${ambient.r},${ambient.g},${ambient.b}|${hash}`;
  }

  private check(): void {
    if (this.materials.size === 0) return;
    const signature = this.read();
    if (signature === this.signature) return;
    this.signature = signature;
    for (const material of this.materials) {
      if (material.isFrozen) material.markDirty(true);
    }
  }

  dispose(): void {
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer);
    this.materials.clear();
    this.surfaces = [];
    watchers.delete(this.scene);
  }
}

const watchers = new WeakMap<Scene, FrozenWorldMaterialWatcher>();

/** Track the map's frozen world materials, replacing the previous map's. */
export function trackFrozenWorldMaterials(scene: Scene, materials: Iterable<Material>): void {
  let watcher = watchers.get(scene);
  if (!watcher) {
    watcher = new FrozenWorldMaterialWatcher(scene);
    watchers.set(scene, watcher);
  }
  watcher.replace(materials);
}

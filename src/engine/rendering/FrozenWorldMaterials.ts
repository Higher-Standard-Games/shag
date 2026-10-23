import type { Light } from "@babylonjs/core/Lights/light";
import type { Material } from "@babylonjs/core/Materials/material";
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
 * Once per frame this compares a signature of exactly that state. On a change
 * each tracked frozen material is checked and bound once more. Pooled lights
 * that join a clustered container within one task never appear in the
 * signature, so they cost nothing. Nor do lights no world surface can receive:
 * one scoped to its own meshes (a loaded model's light) or to a layer the world
 * is not on (the weapon view's lights, which the blade switches on and off).
 * Re-checking every world material for those cost fights a frame each time.
 */
class FrozenWorldMaterialWatcher {
  private readonly materials = new Set<Material>();
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
    this.signature = this.read();
  }

  private read(): string {
    const ambient = this.scene.ambientColor;
    let signature = `${ambient.r},${ambient.g},${ambient.b}`;
    for (const light of this.scene.lights) {
      if (reachesWorld(light)) signature += `|${light.uniqueId}:${light.isEnabled() ? 1 : 0}`;
    }
    return signature;
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
    watchers.delete(this.scene);
  }
}

/** The layer mask Babylon gives every mesh, the map's world surfaces included. */
const WORLD_LAYER_MASK = 0x0fffffff;

/** Whether a light can reach a world surface, by the rules Light.canAffectMesh applies. */
function reachesWorld(light: Light): boolean {
  if (light.includedOnlyMeshes.length > 0) return false;
  const only = light.includeOnlyWithLayerMask;
  return only === 0 || (only & WORLD_LAYER_MASK) !== 0;
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

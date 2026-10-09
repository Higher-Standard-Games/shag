/**
 * ModelSourceCache — cached model sources that other code clones.
 *
 * A cache outlives the code that disposes scene content. The scene clear that
 * runs before each client map load disposes every mesh with its materials and
 * textures, and a map unload disposes the texture caches. A clone of a disposed
 * mesh has no vertices, and a clone of a mesh whose material or texture was
 * disposed renders without it. So an entry is checked before it is handed out,
 * and one that lost anything it renders with is dropped for its owner to load
 * again.
 */

import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { Material } from "@babylonjs/core/Materials/material";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";

/** A detached root, the meshes clones are made from, and what they animate with. */
export interface ModelSource {
  root: Node;
  meshes: readonly AbstractMesh[];
  animationGroups?: readonly AnimationGroup[];
  skeletons?: readonly Skeleton[];
}

/** Resources a released model owned beyond what its nodes still reference. */
export interface ModelResources {
  materials?: readonly (Material | null)[];
  animationGroups?: readonly AnimationGroup[];
  skeletons?: readonly Skeleton[];
}

/** Babylon clears a disposed texture's scene and GPU texture; one still loading keeps its scene. */
export function isTextureReleased(texture: BaseTexture): boolean {
  return texture.getScene() === null && texture.getInternalTexture() === null;
}

/**
 * Whether clones of these meshes still render with the materials they were
 * cached with. Babylon detaches a disposed material from every mesh bound to it.
 * Textures in `alreadyReleased` were released before caching and are not counted.
 */
export function isModelSourceUsable(
  meshes: readonly AbstractMesh[],
  materials: readonly (Material | null)[],
  alreadyReleased: ReadonlySet<BaseTexture> = new Set(),
): boolean {
  if (meshes.length !== materials.length) return false;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (mesh.isDisposed() || mesh.material !== materials[i]) return false;
    for (const texture of mesh.material?.getActiveTextures() ?? []) {
      if (isTextureReleased(texture) && !alreadyReleased.has(texture)) return false;
    }
  }
  return true;
}

/** What a load left behind for a model whose meshes were moved off the loader's tree. */
interface LoaderLeftovers {
  roots: Node[];
  animationGroups: AnimationGroup[];
}

const loaderLeftovers = new WeakMap<Node, LoaderLeftovers>();

/**
 * Keep a loader's leftovers with the model they came from, so disposing the
 * model with `disposeModelResources` takes them too.
 *
 * Code that moves a loaded model's meshes onto something else (a hand bone, a
 * physics root) is left with the loader's root: glTF's `__root__`, empty nodes,
 * bones and animation groups. Those may still drive the moved meshes (a
 * skinned weapon's bones live there), so they cannot go at once; left alone
 * they stayed in the scene for good, one set per load.
 */
export function bindLoaderLeftovers(
  model: Node,
  root: Node | null | undefined,
  animationGroups: readonly AnimationGroup[] = [],
): void {
  const bound = loaderLeftovers.get(model) ?? { roots: [], animationGroups: [] };
  if (root && root !== model) bound.roots.push(root);
  bound.animationGroups.push(...animationGroups);
  loaderLeftovers.set(model, bound);
}

/**
 * Dispose a model's nodes, then whatever only they used.
 *
 * Clones share their source's materials, textures and skeleton, and a scene
 * clear may already have disposed some of them. A material is released only
 * when no remaining mesh renders with it, a texture only when no remaining
 * material samples it, and a skeleton only when no remaining mesh is skinned
 * by it. The scene's environment texture is never released.
 */
export function disposeModelResources(nodes: readonly (Node | null | undefined)[], owned: ModelResources = {}): void {
  let scene: Scene | null = null;
  const materials = new Set<Material>();
  const skeletons = new Set<Skeleton>(owned.skeletons);
  const animationGroups = [...(owned.animationGroups ?? [])];
  const disposed: (Node | null | undefined)[] = [...nodes];
  for (const node of nodes) {
    const bound = node ? loaderLeftovers.get(node) : undefined;
    if (!node || !bound) continue;
    loaderLeftovers.delete(node);
    disposed.push(...bound.roots);
    animationGroups.push(...bound.animationGroups);
  }
  for (const material of owned.materials ?? []) {
    if (material) materials.add(material);
  }

  for (const node of disposed) {
    if (!node || node.isDisposed()) continue;
    scene ??= node.getScene();
    const meshes = node.getChildMeshes(false);
    if (node instanceof AbstractMesh) meshes.push(node);
    for (const mesh of meshes) {
      if (mesh.material) materials.add(mesh.material);
      if (mesh.skeleton) skeletons.add(mesh.skeleton);
    }
    node.dispose(false, false);
  }
  for (const group of animationGroups) group.dispose();

  const activeScene = scene ?? [...materials][0]?.getScene() ?? [...skeletons][0]?.getScene() ?? null;
  if (!activeScene) return;

  const renderedWith = new Set<Material>();
  const skinnedBy = new Set<Skeleton>();
  for (const mesh of activeScene.meshes) {
    if (mesh.material) renderedWith.add(mesh.material);
    if (mesh.skeleton) skinnedBy.add(mesh.skeleton);
  }
  for (const skeleton of skeletons) {
    if (!skinnedBy.has(skeleton) && activeScene.skeletons.includes(skeleton)) skeleton.dispose();
  }

  const released = [...materials].filter(
    (material) => !renderedWith.has(material) && activeScene.materials.includes(material),
  );
  if (released.length === 0) return;

  const releasedSet = new Set(released);
  const sampled = new Set<BaseTexture>();
  if (activeScene.environmentTexture) sampled.add(activeScene.environmentTexture);
  for (const material of activeScene.materials) {
    if (releasedSet.has(material)) continue;
    for (const texture of material.getActiveTextures()) sampled.add(texture);
  }

  const textures = new Set<BaseTexture>();
  for (const material of released) {
    for (const texture of material.getActiveTextures()) {
      if (!sampled.has(texture)) textures.add(texture);
    }
    material.dispose(false, false);
  }
  for (const texture of textures) texture.dispose();
}

interface Entry<T> {
  model: T;
  /** Each source mesh's material when cached. */
  materials: (Material | null)[];
  /** Textures already released when cached, so they cannot cause a reload on every lookup. */
  alreadyReleased: Set<BaseTexture>;
}

export class ModelSourceCache<T extends ModelSource> {
  private readonly entries = new Map<string, Entry<T>>();

  /** @param owner Log prefix naming the owning system. */
  constructor(private readonly owner: string) {}

  get size(): number {
    return this.entries.size;
  }

  /** The cached model, or undefined when it is missing or can no longer render. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (isModelSourceUsable(entry.model.meshes, entry.materials, entry.alreadyReleased)) return entry.model;
    console.warn(`[${this.owner}] Cached model "${key}" lost a mesh, material or texture; it will be reloaded`);
    this.delete(key);
    return undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, model: T): void {
    const previous = this.entries.get(key);
    if (previous && previous.model !== model) this.release(previous);
    const alreadyReleased = new Set<BaseTexture>();
    for (const mesh of model.meshes) {
      for (const texture of mesh.material?.getActiveTextures() ?? []) {
        if (isTextureReleased(texture)) alreadyReleased.add(texture);
      }
    }
    this.entries.set(key, { model, materials: model.meshes.map((mesh) => mesh.material), alreadyReleased });
  }

  /** Release one entry. Whatever a live clone still uses stays. */
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.release(entry);
  }

  /** Release every entry. Whatever a live clone still uses stays. */
  clear(): void {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) this.release(entry);
  }

  private release({ model, materials }: Entry<T>): void {
    disposeModelResources([model.root, ...model.meshes], {
      materials,
      animationGroups: model.animationGroups,
      skeletons: model.skeletons,
    });
  }
}

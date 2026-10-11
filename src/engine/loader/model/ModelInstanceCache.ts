import { AssetContainer } from "@babylonjs/core/assetContainer";
import "@babylonjs/core/Animations/animatable";
import type { Material } from "@babylonjs/core/Materials/material";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { cloneModelMaterial } from "../../rendering/MaterialCloneBatch";
import type { ModelLoadResult } from "./ModelLoader";
import { disposeModelResources, ModelSourceCache } from "./ModelSourceCache";

interface CachedModel extends ModelLoadResult {
  autoPlaying: boolean[];
}

/** Scene-local sources with independent hierarchy/rig/material instances. */
export class ModelInstanceCache {
  private readonly sources = new ModelSourceCache<CachedModel>("ModelInstanceCache");
  private readonly pending = new Map<string, Promise<CachedModel | null>>();
  private readonly container: AssetContainer;
  private readonly disposeObservers: Observer<Scene>[];
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly load: (path: string, scale: number) => Promise<ModelLoadResult | null>,
  ) {
    // One empty scratch container, not a new container/scene observer per switch.
    // Babylon registers an anonymous scene-disposal observer in its constructor.
    const previous = new Set(scene.onDisposeObservable.observers);
    this.container = new AssetContainer(scene);
    this.disposeObservers = scene.onDisposeObservable.observers.filter((observer) => !previous.has(observer));
    const observer = scene.onDisposeObservable.addOnce(() => this.dispose());
    if (observer) this.disposeObservers.push(observer);
  }

  async createInstance(path: string, scale: number): Promise<ModelLoadResult | null> {
    if (this.disposed || this.scene.isDisposed) return null;
    const key = `${scale}:${path.replace(/^\//, "")}`;
    let source = this.sources.get(key);
    if (!source) {
      let loading = this.pending.get(key);
      if (!loading) {
        loading = this.load(path, scale).then((model) => {
          if (!model) return null;
          if (this.disposed || this.scene.isDisposed || model.root.getScene() !== this.scene) {
            disposeModelResources([model.root], model);
            return null;
          }
          const cached = { ...model, autoPlaying: model.animationGroups.map((group) => group.isPlaying) };
          model.root.setEnabled(false);
          for (const group of model.animationGroups) group.stop();
          this.sources.set(key, cached);
          return cached;
        });
        this.pending.set(key, loading);
      }
      try {
        source = (await loading) ?? undefined;
      } finally {
        if (this.pending.get(key) === loading) this.pending.delete(key);
      }
    }
    if (!source || this.disposed || this.scene.isDisposed) return null;
    // Map clearing can dispose a source during the asynchronous load boundary.
    if (this.sources.get(key) !== source) return null;
    return this.clone(source);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear(); // Late loads see disposed and release their own result.
    this.sources.clear(); // Shared textures survive while live instances use them.
    this.container.dispose();
    for (const observer of this.disposeObservers) this.scene.onDisposeObservable.remove(observer);
  }

  private clone(source: CachedModel): ModelLoadResult {
    const container = this.container;
    container.meshes = source.meshes;
    container.transformNodes = [
      source.root,
      ...source.root
        .getDescendants(false)
        .filter((node): node is TransformNode => node instanceof TransformNode && !(node instanceof AbstractMesh)),
    ];
    container.skeletons = source.skeletons;
    container.animationGroups = source.animationGroups;
    let entries: ReturnType<AssetContainer["instantiateModelsToScene"]>;
    try {
      // Preserve authored names (tag_flash), parents, bone links and clip targets.
      // Clone materials separately: Babylon 9.17's container MultiMaterial clone
      // path mutates the source's subMaterials array.
      entries = container.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
    } finally {
      container.meshes = [];
      container.transformNodes = [];
      container.skeletons = [];
      container.animationGroups = [];
    }
    const root = entries.rootNodes[0];
    try {
      if (entries.rootNodes.length !== 1 || !(root instanceof TransformNode))
        throw new Error("Cached model must have one transform root");
      const meshes = root.getChildMeshes(false).filter((mesh): mesh is Mesh => mesh instanceof Mesh);
      const materials = new Map<Material, Material>();
      for (const mesh of meshes) {
        const original = mesh.material;
        if (!original) continue;
        let material = materials.get(original);
        if (!material) {
          material = cloneModelMaterial(original, original.name, true) ?? undefined;
          if (!material) throw new Error(`Cannot clone material ${original.name}`);
          materials.set(original, material);
        }
        mesh.material = material;
      }
      root.setEnabled(true);
      for (const [index, group] of entries.animationGroups.entries()) {
        if (source.autoPlaying[index])
          group.start(group.loopAnimation, group.speedRatio, group.from, group.to, group.isAdditive);
      }
      const attachmentPoints = Object.fromEntries(
        Object.entries(source.attachmentPoints ?? {}).map(([name, point]) => [
          name,
          {
            position: point.position.clone(),
            rotation: point.rotation.clone(),
            rotationQuaternion: point.rotationQuaternion ? { ...point.rotationQuaternion } : null,
          },
        ]),
      );
      return {
        root,
        meshes,
        skeletons: entries.skeletons,
        animationGroups: entries.animationGroups,
        lights: [],
        attachmentPoints,
        textureLoadPromises: source.textureLoadPromises,
      };
    } catch (error) {
      disposeModelResources(entries.rootNodes, entries);
      throw error;
    }
  }
}

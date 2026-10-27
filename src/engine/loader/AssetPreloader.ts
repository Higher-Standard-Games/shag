/**
 * AssetPreloader - Preload pickup assets when map entities are discovered
 *
 * Scans BSP entities for weapons/ammo, collects unique model paths,
 * and preloads them to avoid loading hitches during gameplay.
 */

import { Animation } from "@babylonjs/core/Animations/animation";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Material } from "@babylonjs/core/Materials/material";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { EntityRegistry } from "../../shared/entities/EntityRegistry";
import { EntityType } from "../../shared/entities/EntityType";
import { devLog } from "../core/DevLog";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import type { BspFile } from "./bsp/BspLoader";
import { waitForPreparation } from "./map/GpuPreparation";
import { resolveModelAsset } from "./model/ModelAsset";
import {
  collectModelAttachmentPoints,
  type ModelAttachmentPoint,
  ModelLoader,
  type ModelLoadResult,
} from "./model/ModelLoader";
import { disposeModelResources, ModelSourceCache } from "./model/ModelSourceCache";

export interface PreloadProgress {
  current: number;
  total: number;
  modelPath: string;
}

export type PreloadProgressCallback = (progress: PreloadProgress) => void;

export class AssetPreloader {
  private static instance: AssetPreloader;

  /** Preloaded models by path. An entry that lost what it renders with is dropped on lookup. */
  private modelCache = new ModelSourceCache<ModelLoadResult>("AssetPreloader");
  private scene: Scene | null = null;
  private generation = 0;
  private preparation: AbortController | null = null;
  private constructor() {}

  static getInstance(): AssetPreloader {
    if (!AssetPreloader.instance) {
      AssetPreloader.instance = new AssetPreloader();
    }
    return AssetPreloader.instance;
  }

  /**
   * Check if a model is cached and can still be cloned
   */
  hasModel(modelPath: string): boolean {
    return this.modelCache.has(modelPath);
  }

  /**
   * Get a cached model (returns null if not cached)
   */
  getCachedModel(modelPath: string): ModelLoadResult | null {
    return this.modelCache.get(modelPath) ?? null;
  }

  /**
   * Release every cached model (call when unloading a map, after its pickups).
   * Materials and textures a remaining clone still uses are kept.
   */
  clearCache(): void {
    this.generation++;
    this.preparation?.abort(new Error("Pickup preparation cleared"));
    this.preparation = null;
    const count = this.modelCache.size;
    this.modelCache.clear();
    if (count > 0) devLog(`[AssetPreloader] Released ${count} cached models`);
  }

  /**
   * Scan BSP entities and preload all pickup models
   */
  async preloadFromBsp(
    bsp: BspFile,
    scene: Scene,
    onProgress?: PreloadProgressCallback,
    signal?: AbortSignal,
  ): Promise<number> {
    if (this.scene !== scene) this.clearCache();
    this.scene = scene;
    this.preparation?.abort(new Error("Pickup preparation superseded"));
    const controller = new AbortController();
    this.preparation = controller;
    const generation = ++this.generation;
    const aborted = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
    const disposed = scene.onDisposeObservable.addOnce(() => controller.abort(new Error("Pickup scene disposed")));
    const check = () => {
      controller.signal.throwIfAborted();
      if (generation !== this.generation || scene.isDisposed) throw new Error("Pickup preparation superseded");
    };
    try {
      check();
      const registry = EntityRegistry.getInstance();

      // Collect unique model paths from BSP entities
      const modelPaths = new Set<string>();

      for (const entity of bsp.entities) {
        const classname = entity.classname;
        if (!classname) continue;

        // Look up entity definition by classname
        const def = registry.getByClassname(classname);
        if (!def) continue;

        // Only preload weapons and ammo
        if (def.type !== EntityType.WEAPON && def.type !== EntityType.AMMO) continue;

        // Get model path
        const modelPath = def.modelPath;
        if (modelPath) {
          modelPaths.add(modelPath);
        }
      }

      if (modelPaths.size === 0) {
        devLog("[AssetPreloader] No pickup entities found in BSP");
        return 0;
      }

      devLog(`[AssetPreloader] Found ${modelPaths.size} unique pickup models to preload`);

      // Preload models in parallel batches for faster loading
      const loader = ModelLoader.getInstance();
      loader.init(scene);

      let loaded = 0;
      const total = modelPaths.size;
      const BATCH_SIZE = 4;

      const loadOneModel = async (modelPath: string): Promise<void> => {
        check();
        // Skip if already cached and still renderable
        if (this.modelCache.has(modelPath)) {
          loaded++;
          return;
        }

        onProgress?.({ current: loaded, total, modelPath });

        let result: ModelLoadResult | null = null;
        let active = true;
        try {
          const work = (async (): Promise<ModelLoadResult | null> => {
            // GLB models use SceneLoader instead of PK3+MD3 ModelLoader
            if (modelPath.endsWith(".glb") || modelPath.endsWith(".gltf")) {
              const { ImportMeshAsync } = await import("@babylonjs/core/Loading/sceneLoader");
              await import("@babylonjs/loaders/glTF");

              const asset = await resolveModelAsset(modelPath);
              check();
              const glbResult = await ImportMeshAsync(asset.source, scene, asset.options);
              const root = glbResult.meshes[0];
              const meshes = glbResult.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];

              // Configure PBR materials for clustered lighting, matching ModelLoader's
              // GLB path: cap simultaneous lights, and disable physical light falloff
              // (GLB PBR + ClusteredLightContainer renders wrong with it on).
              for (const m of glbResult.meshes) {
                const mat = m.material as (Material & { usePhysicalLightFalloff?: boolean }) | null;
                if (mat && "maxSimultaneousLights" in mat) {
                  applySafeMaxSimultaneousLights(mat);
                }
                if (mat && "usePhysicalLightFalloff" in mat) {
                  mat.usePhysicalLightFalloff = false;
                }
              }

              this.settleConstantSourceAnimations(root, glbResult.animationGroups);
              result = {
                root,
                meshes,
                animationGroups: glbResult.animationGroups || [],
                skeletons: glbResult.skeletons || [],
                lights: [],
                attachmentPoints: collectModelAttachmentPoints(glbResult.transformNodes),
              };
            } else {
              result = await loader.loadModel(modelPath, {
                position: new Vector3(0, -10000, 0), // Load offscreen
                scale: 1.0,
                hasCollision: false,
                applyLighting: false, // Preloaded models don't need per-model lights
                signal: controller.signal,
              });
            }

            try {
              check();
              if (!active) throw new Error("Pickup preparation retired");
            } catch (error) {
              if (result) disposeModelResources([result.root], result);
              result = null;
              throw error;
            }
            return result;
          })();
          result = await waitForPreparation(work, scene, `pickup ${modelPath}`, controller.signal);

          if (result) {
            // Wait for all textures to finish loading
            if (result.textureLoadPromises && result.textureLoadPromises.length > 0) {
              await waitForPreparation(
                Promise.all(result.textureLoadPromises),
                scene,
                `pickup textures ${modelPath}`,
                controller.signal,
              );
            }
            check();

            // Hide the preloaded model (it's just for caching).
            // For GLB models, setEnabled(false) on the root __root__ mesh does NOT
            // cascade to real weapon meshes (they're children of TransformNodes,
            // not children of the __root__ mesh). Explicitly disable every mesh.
            result.root.setEnabled(false);
            for (const mesh of result.meshes) {
              mesh.setEnabled(false);
              mesh.isVisible = false;
            }
            this.modelCache.set(modelPath, result);
          } else if (
            bsp.entities.some((entity) => {
              const def = registry.getByClassname(entity.classname);
              return def?.type === EntityType.WEAPON && def.modelPath === modelPath;
            })
          ) {
            throw new Error(`Required pickup model unavailable: ${modelPath}`);
          }
        } catch (e) {
          active = false;
          if (result && this.modelCache.get(modelPath) !== result) disposeModelResources([result.root], result);
          check();
          console.warn(`[AssetPreloader] Failed to preload ${modelPath}:`, e);
          if (
            bsp.entities.some((entity) => {
              const def = registry.getByClassname(entity.classname);
              return def?.type === EntityType.WEAPON && def.modelPath === modelPath;
            })
          )
            throw e;
        }

        loaded++;
      };

      // Process in batches of BATCH_SIZE for bounded concurrency
      const pathArray = Array.from(modelPaths);
      for (let i = 0; i < pathArray.length; i += BATCH_SIZE) {
        const batch = pathArray.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map((p) => loadOneModel(p)));
      }

      devLog(`[AssetPreloader] Preloaded ${this.modelCache.size} models`);
      return this.modelCache.size;
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      signal?.removeEventListener("abort", aborted);
      scene.onDisposeObservable.remove(disposed);
      if (this.preparation === controller) this.preparation = null;
    }
  }

  /**
   * Clone a cached model for use in gameplay
   */
  cloneCachedModel(modelPath: string, scene: Scene): ModelLoadResult | null {
    const cached = this.modelCache.get(modelPath);
    if (!cached) return null;
    if (cached.root.getScene() !== scene) return null;

    try {
      // Create a new root for the cloned model
      const clonedRoot = new TransformNode(`${cached.root.name}_clone_${Date.now()}`, scene);
      const clonedMeshes: Mesh[] = [];

      // Babylon clones a mesh together with its children, so a cached mesh that
      // sits under another cached mesh already arrives inside that one's clone.
      // Cloning it again would draw the same geometry twice in the same place.
      const sources = new Set<unknown>(cached.meshes);
      const carriedByAnother = (mesh: Mesh): boolean => {
        let parent = mesh.parent;
        while (parent) {
          if (sources.has(parent)) return true;
          parent = parent.parent;
        }
        return false;
      };

      // Clone each mesh from the cached model
      for (const mesh of cached.meshes) {
        if (!mesh.clone || carriedByAnother(mesh)) continue;
        const clonedMesh = mesh.clone(`${mesh.name}_clone`, clonedRoot);
        if (!clonedMesh) continue;
        // Sources are cached hidden, and a clone inherits that for its whole
        // subtree — not just the mesh named in the clone call. A child left
        // hidden is a weapon body that never draws while the barrels loaded
        // fresh beside it do.
        for (const node of [clonedMesh, ...clonedMesh.getChildMeshes(false)]) {
          node.setEnabled(true);
          node.isVisible = true;
          clonedMeshes.push(node as Mesh);
        }
      }

      devLog(`[AssetPreloader] Cloned ${clonedMeshes.length} meshes from cache`);

      return {
        root: clonedRoot,
        meshes: clonedMeshes,
        animationGroups: [],
        skeletons: [],
        lights: [],
        attachmentPoints: this.cloneAttachmentPoints(cached.attachmentPoints),
      };
    } catch (e) {
      console.warn(`[AssetPreloader] Failed to clone cached model:`, e);
      return null;
    }
  }

  /** Constant pickup clips supply a pose; animated sources still drive their shared clone skeletons. */
  private settleConstantSourceAnimations(root: TransformNode, groups: readonly AnimationGroup[]): void {
    const active = groups.filter((group) => group.isStarted);
    // Preserve the whole active set when clips can interact or carry timed behavior.
    if (
      active.some(
        (group) =>
          group.isAdditive ||
          group.weight !== -1 ||
          group.enableBlending ||
          group.onAnimationGroupEndObservable.hasObservers() ||
          group.onAnimationGroupLoopObservable.hasObservers() ||
          group.targetedAnimations.length === 0 ||
          !group.targetedAnimations.every(({ target, animation }) => {
            if (
              !(target instanceof TransformNode) ||
              (target !== root && !target.isDescendantOf(root)) ||
              target.animationPropertiesOverride ||
              !["position", "rotation", "rotationQuaternion", "scaling"].includes(animation.targetProperty) ||
              animation.loopMode !== Animation.ANIMATIONLOOPMODE_CYCLE ||
              animation.enableBlending ||
              animation.getEvents().length > 0
            )
              return false;
            const keys = animation.getKeys();
            const first: unknown = keys[0]?.value;
            return (
              (first instanceof Vector3 || first instanceof Quaternion) &&
              keys.every((key) => {
                // Equal cubic endpoints can still move between keys. Unknown curve types stay active.
                if (key.inTangent !== undefined || key.outTangent !== undefined) return false;
                const value: unknown = key.value;
                return first instanceof Vector3
                  ? value instanceof Vector3 && first.equals(value)
                  : value instanceof Quaternion && first.equals(value);
              })
            );
          }),
      )
    )
      return;
    for (const group of active) {
      // Apply the authored pose even when caching finishes before the first animation tick.
      group.goToFrame(group.from);
      group.stop(true);
    }
  }

  private cloneAttachmentPoints(
    points?: Record<string, ModelAttachmentPoint>,
  ): Record<string, ModelAttachmentPoint> | undefined {
    if (!points) return undefined;
    return Object.fromEntries(
      Object.entries(points).map(([name, point]) => [
        name,
        {
          position: point.position.clone(),
          rotation: point.rotation.clone(),
          rotationQuaternion: point.rotationQuaternion ? { ...point.rotationQuaternion } : null,
        },
      ]),
    );
  }
}

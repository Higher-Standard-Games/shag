/**
 * AssetPreloader - Preload pickup assets when map entities are discovered
 *
 * Scans BSP entities for weapons/ammo, collects unique model paths,
 * and preloads them to avoid loading hitches during gameplay.
 */

import type { Material } from "@babylonjs/core/Materials/material";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { EntityRegistry } from "../../shared/entities/EntityRegistry";
import { EntityType } from "../../shared/entities/EntityType";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import type { BspFile } from "./bsp/BspLoader";
import { ModelLoader, type ModelLoadResult } from "./model/ModelLoader";

export interface PreloadProgress {
  current: number;
  total: number;
  modelPath: string;
}

export type PreloadProgressCallback = (progress: PreloadProgress) => void;

export class AssetPreloader {
  private static instance: AssetPreloader;

  /** Cache of preloaded models by path */
  private modelCache: Map<string, ModelLoadResult> = new Map();

  private constructor() {}

  static getInstance(): AssetPreloader {
    if (!AssetPreloader.instance) {
      AssetPreloader.instance = new AssetPreloader();
    }
    return AssetPreloader.instance;
  }

  /**
   * Check if a model is already cached
   */
  hasModel(modelPath: string): boolean {
    return this.modelCache.has(modelPath);
  }

  /**
   * Get a cached model (returns null if not cached)
   */
  getCachedModel(modelPath: string): ModelLoadResult | null {
    return this.modelCache.get(modelPath) || null;
  }

  /**
   * Clear the cache (call when unloading map)
   */
  clearCache(): void {
    // Dispose all cached model roots and meshes
    for (const [path, result] of this.modelCache) {
      console.log(`[AssetPreloader] Disposing cached model: ${path}`);
      // Dispose individual meshes (GLB meshes may not be children of root)
      for (const mesh of result.meshes) {
        mesh.dispose();
      }
      result.root.dispose();
    }
    this.modelCache.clear();
  }

  /**
   * Scan BSP entities and preload all pickup models
   */
  async preloadFromBsp(bsp: BspFile, scene: Scene, onProgress?: PreloadProgressCallback): Promise<number> {
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
      // biome-ignore lint/suspicious/noExplicitAny: Babylon loader internals
      const modelPath = (def as any).modelPath;
      if (modelPath) {
        modelPaths.add(modelPath);
      }
    }

    if (modelPaths.size === 0) {
      console.log("[AssetPreloader] No pickup entities found in BSP");
      return 0;
    }

    console.log(`[AssetPreloader] Found ${modelPaths.size} unique pickup models to preload`);

    // Preload models in parallel batches for faster loading
    const loader = ModelLoader.getInstance();
    if (!loader.isInitialized()) {
      loader.init(scene);
    }

    let loaded = 0;
    const total = modelPaths.size;
    const BATCH_SIZE = 4;

    const loadOneModel = async (modelPath: string): Promise<void> => {
      // Skip if already cached
      if (this.modelCache.has(modelPath)) {
        loaded++;
        return;
      }

      onProgress?.({ current: loaded, total, modelPath });

      try {
        let result: ModelLoadResult | null = null;

        // GLB models use SceneLoader instead of PK3+MD3 ModelLoader
        if (modelPath.endsWith(".glb") || modelPath.endsWith(".gltf")) {
          const { ImportMeshAsync } = await import("@babylonjs/core/Loading/sceneLoader");
          await import("@babylonjs/loaders/glTF");

          const lastSlash = modelPath.lastIndexOf("/");
          const dir = modelPath.substring(0, lastSlash + 1);
          const file = modelPath.substring(lastSlash + 1);

          const glbResult = await ImportMeshAsync(file, scene, { rootUrl: dir });
          // biome-ignore lint/suspicious/noExplicitAny: Babylon loader internals
          const root = glbResult.meshes[0] as any;
          const meshes = glbResult.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];

          // Configure PBR materials for clustered lighting, matching ModelLoader's
          // GLB path: cap simultaneous lights, and disable physical light falloff
          // (GLB PBR + ClusteredLightContainer renders wrong with it on).
          for (const m of glbResult.meshes) {
            const mat = m.material as (Material & { usePhysicalLightFalloff?: boolean }) | null;
            if (mat && "maxSimultaneousLights" in mat) {
              // biome-ignore lint/suspicious/noExplicitAny: Babylon material introspection
              applySafeMaxSimultaneousLights(mat as any);
            }
            if (mat && "usePhysicalLightFalloff" in mat) {
              mat.usePhysicalLightFalloff = false;
            }
            // DIAGNOSTIC (temporary): force unlit to bypass all lighting/clusters.
            // If weapon pickups then appear, the mesh/geometry/position are fine
            // and the invisibility is PBR-under-clustered-lighting shading. If they
            // stay invisible, the mesh isn't drawing at all (not a shading issue).
            if (mat && "unlit" in mat) {
              (mat as { unlit?: boolean }).unlit = true;
            }
          }

          result = {
            root,
            meshes,
            animationGroups: glbResult.animationGroups || [],
            skeletons: glbResult.skeletons || [],
            lights: [],
          };
        } else {
          result = await loader.loadModel(modelPath, {
            position: new Vector3(0, -10000, 0), // Load offscreen
            scale: 1.0,
            hasCollision: false,
            applyLighting: false, // Preloaded models don't need per-model lights
          });
        }

        if (result) {
          // Wait for all textures to finish loading
          // biome-ignore lint/suspicious/noExplicitAny: Babylon loader internals
          if ((result as any).textureLoadPromises && (result as any).textureLoadPromises.length > 0) {
            // biome-ignore lint/suspicious/noExplicitAny: Babylon loader internals
            await Promise.all((result as any).textureLoadPromises);
          }

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
        }
      } catch (e) {
        console.warn(`[AssetPreloader] Failed to preload ${modelPath}:`, e);
      }

      loaded++;
    };

    // Process in batches of BATCH_SIZE for bounded concurrency
    const pathArray = Array.from(modelPaths);
    for (let i = 0; i < pathArray.length; i += BATCH_SIZE) {
      const batch = pathArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((p) => loadOneModel(p)));
    }

    console.log(`[AssetPreloader] Preloaded ${this.modelCache.size} models`);
    return this.modelCache.size;
  }

  /**
   * Clone a cached model for use in gameplay
   */
  cloneCachedModel(modelPath: string, scene: Scene): ModelLoadResult | null {
    const cached = this.modelCache.get(modelPath);
    if (!cached) return null;

    try {
      // Create a new root for the cloned model
      const clonedRoot = new TransformNode(`${cached.root.name}_clone_${Date.now()}`, scene);
      const clonedMeshes: Mesh[] = [];

      // Clone each mesh from the cached model
      for (const mesh of cached.meshes) {
        if (mesh.clone) {
          const clonedMesh = mesh.clone(`${mesh.name}_clone`, clonedRoot);
          if (clonedMesh) {
            clonedMesh.setEnabled(true);
            clonedMesh.isVisible = true;
            clonedMeshes.push(clonedMesh);
          }
        }
      }

      console.log(`[AssetPreloader] Cloned ${clonedMeshes.length} meshes from cache`);

      return {
        root: clonedRoot,
        meshes: clonedMeshes,
        animationGroups: [],
        skeletons: [],
        lights: [],
      };
    } catch (e) {
      console.warn(`[AssetPreloader] Failed to clone cached model:`, e);
      return null;
    }
  }
}

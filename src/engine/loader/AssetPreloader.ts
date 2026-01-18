/**
 * AssetPreloader - Preload pickup assets when map entities are discovered
 * 
 * Scans BSP entities for weapons/ammo, collects unique model paths,
 * and preloads them to avoid loading hitches during gameplay.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EntityRegistry } from '../../shared/entities/EntityRegistry';
import { EntityType } from '../../shared/entities/EntityType';
import { ModelLoader, type ModelLoadResult } from './model/ModelLoader';
import type { BspFile } from './bsp/BspLoader';

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

    private constructor() { }

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
        // Dispose all cached model roots
        for (const [path, result] of this.modelCache) {
            console.log(`[AssetPreloader] Disposing cached model: ${path}`);
            result.root.dispose();
        }
        this.modelCache.clear();
    }

    /**
     * Scan BSP entities and preload all pickup models
     */
    async preloadFromBsp(
        bsp: BspFile,
        scene: Scene,
        onProgress?: PreloadProgressCallback
    ): Promise<number> {
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
            const modelPath = (def as any).modelPath;
            if (modelPath) {
                modelPaths.add(modelPath);
            }
        }

        if (modelPaths.size === 0) {
            console.log('[AssetPreloader] No pickup entities found in BSP');
            return 0;
        }

        console.log(`[AssetPreloader] Found ${modelPaths.size} unique pickup models to preload`);

        // Preload each model
        const loader = ModelLoader.getInstance();
        if (!loader.isInitialized()) {
            loader.init(scene);
        }

        let loaded = 0;
        const total = modelPaths.size;

        for (const modelPath of modelPaths) {
            // Skip if already cached
            if (this.modelCache.has(modelPath)) {
                console.log(`[AssetPreloader] Already cached: ${modelPath}`);
                loaded++;
                continue;
            }

            onProgress?.({ current: loaded, total, modelPath });

            try {
                console.log(`[AssetPreloader] Preloading: ${modelPath}`);
                const result = await loader.loadModel(modelPath, {
                    position: new Vector3(0, -10000, 0), // Load offscreen
                    scale: 1.0,
                    hasCollision: false,
                });

                if (result) {
                    // Hide the preloaded model (it's just for caching)
                    result.root.setEnabled(false);
                    this.modelCache.set(modelPath, result);
                    console.log(`[AssetPreloader] Cached: ${modelPath}`);
                }
            } catch (e) {
                console.warn(`[AssetPreloader] Failed to preload ${modelPath}:`, e);
            }

            loaded++;
        }

        console.log(`[AssetPreloader] Preloaded ${this.modelCache.size} models`);
        return this.modelCache.size;
    }

    /**
     * Clone a cached model for use in gameplay
     */
    cloneCachedModel(modelPath: string, _scene: Scene): ModelLoadResult | null {
        const cached = this.modelCache.get(modelPath);
        if (!cached) return null;

        // TODO: Implement proper cloning of mesh hierarchy
        // For now, return null to fall back to fresh loading
        // This is a placeholder for future optimization
        return null;
    }
}

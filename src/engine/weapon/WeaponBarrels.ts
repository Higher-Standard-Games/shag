/**
 * WeaponBarrels — Loading and spinning of barrel sub-model attachments
 *
 * Handles GLB barrel sub-models (spinning chambers, rolling clips)
 * that attach to the main weapon model. Uses weapon def `barrels` config.
 *
 * Used by: WeaponViewManager
 */

import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

// Layer mask for weapon-only rendering (must match WeaponViewManager)
const WEAPON_LAYER_MASK = 0x10000000;

export interface BarrelDef {
    modelPath: string;
    spinSpeed: number;
    spinDirection?: number;
}

interface BarrelInstance {
    root: TransformNode;
    spinSpeed: number;
    spinDirection: number;
    rotation: number;
}

/**
 * Manages spinning barrel sub-models attached to a weapon.
 */
export class WeaponBarrels {
    private barrels: BarrelInstance[] = [];

    /** Dispose all barrel meshes and clear state */
    dispose(): void {
        for (const b of this.barrels) b.root.dispose();
        this.barrels = [];
    }

    /** Update barrel spin (call each frame) */
    update(deltaTime: number): void {
        for (const barrel of this.barrels) {
            barrel.rotation += barrel.spinSpeed * barrel.spinDirection * deltaTime;
            barrel.root.rotation.x = barrel.rotation;
        }
    }

    /** Number of loaded barrels */
    get count(): number {
        return this.barrels.length;
    }

    /**
     * Load barrel sub-model GLBs and attach to the weapon's GLB root.
     * Safe for concurrent loads — checks loadGen to bail if weapon changed.
     */
    async load(
        barrelDefs: BarrelDef[],
        glbRoot: TransformNode,
        weaponName: string,
        scene: Scene,
        loadGen: number,
        currentLoadGen: () => number
    ): Promise<void> {
        const { SceneLoader } = await import('@babylonjs/core/Loading/sceneLoader');

        for (let i = 0; i < barrelDefs.length; i++) {
            const barrelDef = barrelDefs[i];
            try {
                // Check if weapon was switched during async load
                if (currentLoadGen() !== loadGen) return;

                const lastSlash = barrelDef.modelPath.lastIndexOf('/');
                const dir = barrelDef.modelPath.substring(0, lastSlash + 1);
                const file = barrelDef.modelPath.substring(lastSlash + 1);

                const result = await SceneLoader.ImportMeshAsync('', dir, file, scene);

                // Check again after async
                if (currentLoadGen() !== loadGen) {
                    result.meshes[0]?.dispose(false, false);
                    return;
                }

                const barrelRoot = result.meshes[0];
                if (!barrelRoot) continue;

                // Parent to the weapon's GLB root (inherits orientation)
                barrelRoot.parent = glbRoot;
                if (barrelRoot.rotationQuaternion) barrelRoot.rotationQuaternion = null;
                barrelRoot.rotation.setAll(0);
                barrelRoot.position.setAll(0);

                // Set weapon render layer for all barrel meshes
                for (const mesh of result.meshes) {
                    mesh.renderingGroupId = 1;
                    mesh.layerMask = WEAPON_LAYER_MASK;
                    if (mesh.rotationQuaternion) mesh.rotationQuaternion = null;

                    // Boost PBR environment for self-lit look (same as main weapon)
                    if (mesh.material && mesh.material.getClassName() === 'PBRMaterial') {
                        const pbr = mesh.material as any;
                        pbr.environmentIntensity = 2.0;
                        pbr.directIntensity = 1.0;
                        pbr.backFaceCulling = false;
                        pbr.maxSimultaneousLights = 4; // Prevent shader overflow from projectile PointLights
                    }
                }

                this.barrels.push({
                    root: barrelRoot as TransformNode,
                    spinSpeed: barrelDef.spinSpeed,
                    spinDirection: barrelDef.spinDirection ?? 1,
                    rotation: 0,
                });

                console.log(`[WeaponBarrels] Loaded barrel ${i} for ${weaponName}: ${file}`);
            } catch (e) {
                console.warn(`[WeaponBarrels] Failed to load barrel ${i} for ${weaponName}:`, e);
            }
        }
    }
}

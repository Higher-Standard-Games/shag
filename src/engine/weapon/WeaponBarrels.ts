/**
 * WeaponBarrels — Loading and spinning of barrel sub-model attachments
 *
 * Handles GLB barrel sub-models (spinning chambers, rolling clips)
 * that attach to the main weapon model. Uses tags.txt for positioning
 * and weapon def `barrels` config for spin behavior.
 *
 * Used by: WeaponViewManager
 */

import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { loadTags, findTag, type TagDef } from '../loader/model/TagsLoader';

// Layer mask for weapon-only rendering (must match WeaponViewManager)
const WEAPON_LAYER_MASK = 0x10000000;

export interface BarrelDef {
    modelPath: string;
    spinSpeed: number;
    spinDirection?: number;
    /** Offset from weapon origin (x, y, z in model space) */
    offset?: { x: number; y: number; z: number };
    /** Spin axis: 'x' (default), 'y', or 'z' */
    spinAxis?: 'x' | 'y' | 'z';
}

interface BarrelInstance {
    root: TransformNode;
    spinSpeed: number;
    spinDirection: number;
    spinAxis: 'x' | 'y' | 'z';
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
            switch (barrel.spinAxis) {
                case 'y': barrel.root.rotation.y = barrel.rotation; break;
                case 'z': barrel.root.rotation.z = barrel.rotation; break;
                default: barrel.root.rotation.x = barrel.rotation; break;
            }
        }
    }

    /** Number of loaded barrels */
    get count(): number {
        return this.barrels.length;
    }

    /**
     * Load barrel sub-model GLBs and attach to the weapon's GLB root.
     * Reads tags.txt from the weapon model directory for positioning.
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

        // Derive model directory from first barrel path for tags.txt lookup
        const firstPath = barrelDefs[0]?.modelPath;
        if (!firstPath) return;
        const modelDir = firstPath.substring(0, firstPath.lastIndexOf('/') + 1);

        // Load tags.txt from the weapon model directory
        const tags = await loadTags(modelDir);
        const barrelTag = findTag(tags, 'tag_barrel');

        if (barrelTag) {
            console.log(`[WeaponBarrels] Found tag_barrel: bone="${barrelTag.boneName}" offset=(${barrelTag.offset.x},${barrelTag.offset.y},${barrelTag.offset.z})`);
        } else {
            console.log(`[WeaponBarrels] No tag_barrel in tags.txt, using model origin`);
        }

        // Debug: log all skeleton bones in scene to find IQM tags
        for (const skeleton of scene.skeletons) {
            const boneNames = skeleton.bones.map(b => b.name);
            console.log(`[WeaponBarrels] Skeleton "${skeleton.name}": ${boneNames.length} bones: [${boneNames.join(', ')}]`);
        }

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

                // Always parent barrel to glbRoot (weapon view hierarchy).
                // Bone transform nodes are at scene root, NOT under glbRoot,
                // so parenting to them would break weapon camera rendering.
                barrelRoot.parent = glbRoot;
                if (barrelRoot.rotationQuaternion) barrelRoot.rotationQuaternion = null;

                // Read bone position for offset (if tag references a bone)
                let boneOffX = 0, boneOffY = 0, boneOffZ = 0;
                if (barrelTag?.boneName) {
                    for (const skeleton of scene.skeletons) {
                        const bone = skeleton.bones.find(b => b.name === barrelTag.boneName);
                        if (bone) {
                            const boneNode = bone.getTransformNode();
                            if (boneNode) {
                                // Read the bone's local position (within skeleton space)
                                boneOffX = boneNode.position.x;
                                boneOffY = boneNode.position.y;
                                boneOffZ = boneNode.position.z;
                                console.log(`[WeaponBarrels] Bone ${barrelTag.boneName} position: (${boneOffX.toFixed(2)},${boneOffY.toFixed(2)},${boneOffZ.toFixed(2)})`);
                                break;
                            }
                        }
                    }
                }

                // Apply: bone position + tag offset + per-barrel BarrelDef offset
                const tagOff = barrelTag?.offset;
                const defOff = barrelDef.offset;
                barrelRoot.position.set(
                    boneOffX + (tagOff?.x ?? 0) + (defOff?.x ?? 0),
                    boneOffY + (tagOff?.y ?? 0) + (defOff?.y ?? 0),
                    boneOffZ + (tagOff?.z ?? 0) + (defOff?.z ?? 0)
                );
                if (tagOff) {
                    // Barrel inherits glbRoot's rotation; only apply tag rotation delta
                    barrelRoot.rotation.set(
                        barrelTag!.rotation.x,
                        barrelTag!.rotation.y,
                        barrelTag!.rotation.z
                    );
                } else {
                    barrelRoot.rotation.setAll(0);
                }

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
                        // zOffset pushes barrel forward in depth buffer so it shows
                        // through weapon body openings instead of being occluded
                        pbr.zOffset = -2;
                        pbr.backFaceCulling = false;
                        pbr.maxSimultaneousLights = 4;
                    }
                }

                this.barrels.push({
                    root: barrelRoot as TransformNode,
                    spinSpeed: barrelDef.spinSpeed,
                    spinDirection: barrelDef.spinDirection ?? 1,
                    spinAxis: barrelDef.spinAxis ?? 'x',
                    rotation: 0,
                });

                console.log(`[WeaponBarrels] Loaded barrel ${i} for ${weaponName}: ${file} (${result.meshes.length} meshes, pos: (${barrelRoot.position.x.toFixed(1)},${barrelRoot.position.y.toFixed(1)},${barrelRoot.position.z.toFixed(1)}))`);
            } catch (e) {
                console.warn(`[WeaponBarrels] Failed to load barrel ${i} for ${weaponName}:`, e);
            }
        }
    }
}

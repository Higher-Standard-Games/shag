/**
 * WeaponViewManager - Manages first-person weapon view models
 * 
 * Handles loading, positioning, and displaying weapon models
 * attached to the camera for first-person view.
 */

import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { getMD3Loader, MD3LoadResult } from '../loader/model/MD3Loader';
import { PK3Loader } from '../loader/pk3/PK3Loader';

// Weapon position presets
export interface WeaponPosition {
    offset: Vector3;      // Position offset from camera
    rotation: Vector3;    // Euler rotation
    scale: number;        // Uniform scale
}

export const DEFAULT_POSITIONS: Record<string, WeaponPosition> = {
    hip: {
        offset: new Vector3(0.15, -0.12, 0.3),
        rotation: new Vector3(0, Math.PI, 0),
        scale: 0.02,
    },
    ads: {
        offset: new Vector3(0, -0.08, 0.2),
        rotation: new Vector3(0, Math.PI, 0),
        scale: 0.02,
    },
    lowered: {
        offset: new Vector3(0.2, -0.25, 0.25),
        rotation: new Vector3(0.2, Math.PI, 0),
        scale: 0.02,
    },
};

export class WeaponViewManager {
    private static instance: WeaponViewManager;

    private scene: Scene | null = null;
    private weaponRoot: TransformNode | null = null;
    private currentWeapon: MD3LoadResult | null = null;
    private currentPosition: WeaponPosition = DEFAULT_POSITIONS.hip;

    // Debug
    private debugEnabled: boolean = false;

    private constructor() { }

    public static getInstance(): WeaponViewManager {
        if (!WeaponViewManager.instance) {
            WeaponViewManager.instance = new WeaponViewManager();
        }
        return WeaponViewManager.instance;
    }

    /**
     * Initialize with scene and camera
     */
    public init(scene: Scene, camera: FreeCamera): void {
        this.scene = scene;

        // Initialize MD3 loader
        getMD3Loader().init(scene);

        // Create weapon root node attached to camera
        this.weaponRoot = new TransformNode('weaponView', scene);
        this.weaponRoot.parent = camera;

        console.log('[WeaponViewManager] Initialized');
    }

    /**
     * Load a weapon from pk3
     */
    public async loadWeapon(
        weaponName: string,
        pk3Path?: string
    ): Promise<boolean> {
        if (!this.scene || !this.weaponRoot) {
            console.error('[WeaponViewManager] Not initialized');
            return false;
        }

        const pk3 = PK3Loader.getInstance();

        // Load pk3 if specified and not already loaded
        if (pk3Path) {
            try {
                await pk3.loadPK3FromUrl(pk3Path);
                console.log(`[WeaponViewManager] Loaded pk3: ${pk3Path}`);
            } catch (e) {
                console.error(`[WeaponViewManager] Failed to load pk3: ${pk3Path}`, e);
                return false;
            }
        }

        // Construct paths
        const modelPath = `models/weapons/${weaponName}/${weaponName}.md3`;
        const texturePath = `models/weapons/${weaponName}/${weaponName}.jpg`;

        // Check if model exists
        if (!pk3.hasFile(modelPath)) {
            console.error(`[WeaponViewManager] Model not found: ${modelPath}`);
            console.log('[WeaponViewManager] Available files:', pk3.listDirectory(`models/weapons/${weaponName}`));
            return false;
        }

        // Load model data
        const modelBuffer = await pk3.getFile(modelPath);
        if (!modelBuffer) {
            console.error(`[WeaponViewManager] Failed to load model: ${modelPath}`);
            return false;
        }

        // Parse MD3
        const md3 = getMD3Loader();
        const model = md3.parseMD3(modelBuffer);

        // Remove previous weapon
        if (this.currentWeapon) {
            this.currentWeapon.root.dispose();
            this.currentWeapon = null;
        }

        // Create meshes
        this.currentWeapon = md3.createMeshes(model, weaponName);
        if (!this.currentWeapon) {
            console.error('[WeaponViewManager] Failed to create meshes');
            return false;
        }

        // Parent to weapon root
        this.currentWeapon.root.parent = this.weaponRoot;

        // Load texture
        if (pk3.hasFile(texturePath)) {
            const textureUrl = await pk3.getFileAsURL(texturePath, 'image/jpeg');
            if (textureUrl) {
                for (const mesh of this.currentWeapon.meshes) {
                    const mat = new StandardMaterial(`${weaponName}_mat`, this.scene);
                    mat.diffuseTexture = new Texture(textureUrl, this.scene);
                    mat.specularColor.set(0.2, 0.2, 0.2);
                    mat.backFaceCulling = true;
                    mesh.material = mat;
                }
            }
        }

        // Apply default position
        this.applyPosition(this.currentPosition);

        console.log(`[WeaponViewManager] Loaded weapon: ${weaponName}`);
        console.log(`[WeaponViewManager] Model: ${model.header.numSurfaces} surfaces, ${model.header.numFrames} frames`);

        return true;
    }

    /**
     * Set weapon position
     */
    public setPosition(preset: 'hip' | 'ads' | 'lowered' | WeaponPosition): void {
        if (typeof preset === 'string') {
            this.currentPosition = DEFAULT_POSITIONS[preset] || DEFAULT_POSITIONS.hip;
        } else {
            this.currentPosition = preset;
        }
        this.applyPosition(this.currentPosition);
    }

    /**
     * Manually adjust offset
     */
    public setOffset(x: number, y: number, z: number): void {
        this.currentPosition = {
            ...this.currentPosition,
            offset: new Vector3(x, y, z),
        };
        this.applyPosition(this.currentPosition);
    }

    /**
     * Manually adjust scale
     */
    public setScale(scale: number): void {
        this.currentPosition = {
            ...this.currentPosition,
            scale,
        };
        this.applyPosition(this.currentPosition);
    }

    /**
     * Get current weapon info
     */
    public getWeaponInfo(): { name: string; frames: number; surfaces: number } | null {
        if (!this.currentWeapon) return null;
        return {
            name: this.currentWeapon.model.header.name,
            frames: this.currentWeapon.model.header.numFrames,
            surfaces: this.currentWeapon.model.header.numSurfaces,
        };
    }

    /**
     * Toggle weapon visibility
     */
    public setVisible(visible: boolean): void {
        if (this.currentWeapon) {
            this.currentWeapon.root.setEnabled(visible);
        }
    }

    /**
     * Clear current weapon
     */
    public clear(): void {
        if (this.currentWeapon) {
            this.currentWeapon.root.dispose();
            this.currentWeapon = null;
        }
    }

    private applyPosition(pos: WeaponPosition): void {
        if (!this.currentWeapon) return;

        const root = this.currentWeapon.root;
        root.position.copyFrom(pos.offset);
        root.rotation.copyFrom(pos.rotation);
        root.scaling.setAll(pos.scale);

        if (this.debugEnabled) {
            console.log(`[WeaponViewManager] Position: (${pos.offset.x.toFixed(3)}, ${pos.offset.y.toFixed(3)}, ${pos.offset.z.toFixed(3)}) scale=${pos.scale}`);
        }
    }

    public enableDebug(enabled: boolean): void {
        this.debugEnabled = enabled;
    }

    /**
     * Update per frame (for animations, sway, etc.)
     */
    public update(_deltaTime: number): void {
        // Future: weapon sway, bob, animations
    }
}

// Convenience function
export function getWeaponViewManager(): WeaponViewManager {
    return WeaponViewManager.getInstance();
}

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
import { getMD3Loader, MD3LoadResult, MD3Coords } from '../loader/model/MD3Loader';
import { PK3Loader } from '../loader/pk3/PK3Loader';
import { MovementVars } from '../movement/MovementVars';

// Weapon position presets
export interface WeaponPosition {
    offset: Vector3;      // Position offset from camera
    rotation: Vector3;    // Euler rotation
    scale: number;        // Uniform scale
}

// Note: MD3 models are in Quake units (~1 unit = 1 inch)
// Using MD3Coords helpers for proper orientation

// Handedness presets (cg_handedness style)
export const HAND_OFFSETS = {
    right: 12,   // Right side of screen
    center: 0,   // Centered
    left: -12,   // Left side of screen
};

export const DEFAULT_POSITIONS: Record<string, WeaponPosition> = {
    hip: {
        // Right hand, lower on screen (right=12, down=25, forward=21)
        offset: MD3Coords.viewModelOffset(HAND_OFFSETS.right, 25, 21),
        rotation: MD3Coords.viewModelRotation(),
        scale: 2.0,
    },
    ads: {
        // Centered, less low, closer (right=0, down=15, forward=25)
        offset: MD3Coords.viewModelOffset(0, 15, 25),
        rotation: MD3Coords.viewModelRotation(),
        scale: 2.0,
    },
    lowered: {
        // More to right, much lower (right=15, down=35, forward=30)
        offset: MD3Coords.viewModelOffset(15, 35, 30),
        rotation: new Vector3(0.4, -Math.PI / 2, 0),
        scale: 2.0,
    },
};

export class WeaponViewManager {
    private static instance: WeaponViewManager;

    private scene: Scene | null = null;
    private weaponRoot: TransformNode | null = null;
    private currentWeapon: MD3LoadResult | null = null;
    private currentPosition: WeaponPosition = DEFAULT_POSITIONS.hip;

    // CVar tracking for live updates
    private lastHandedness: number = 1;
    private cvarCheckTimer: number = 0;
    private static readonly CVAR_CHECK_INTERVAL = 0.1; // Check 10x/sec, not every frame

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

        // Configure rendering group 1 for weapons:
        // - Clear depth buffer before rendering (prevents wall clipping)
        // - Keep color buffer (world is already rendered)
        // Args: (groupId, autoClear, depth, stencil)
        scene.setRenderingAutoClearDepthStencil(1, true, true, false);

        // Register update loop
        scene.onBeforeRenderObservable.add(() => {
            const deltaTime = scene.getEngine().getDeltaTime() / 1000;
            this.update(deltaTime);
        });

        console.log('[WeaponViewManager] Initialized with depth-cleared weapon layer');
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

        // Set rendering group to 1 (renders after world, with depth cleared)
        // This prevents weapon from clipping through walls
        for (const mesh of this.currentWeapon.meshes) {
            mesh.renderingGroupId = 1;
        }

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
     * Get current position settings
     */
    public getCurrentPosition(): WeaponPosition {
        return this.currentPosition;
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

        // Get handedness from CVar: 0=left, 1=right, 2=center
        let handOffset = HAND_OFFSETS.right;  // Default
        try {
            const mv = MovementVars.getInstance();
            const hand = mv.get('cg_handedness');
            handOffset = hand === 0 ? HAND_OFFSETS.left
                : hand === 2 ? HAND_OFFSETS.center
                    : HAND_OFFSETS.right;
        } catch {
            // Use default if MovementVars not available
        }

        // Apply position with dynamic handedness
        root.position.set(
            handOffset,           // X from handedness
            pos.offset.y,         // Y from preset
            pos.offset.z          // Z from preset
        );
        root.rotation.copyFrom(pos.rotation);
        root.scaling.setAll(pos.scale);

        if (this.debugEnabled) {
            console.log(`[WeaponViewManager] Position: (${root.position.x.toFixed(3)}, ${root.position.y.toFixed(3)}, ${root.position.z.toFixed(3)}) scale=${pos.scale}`);
        }
    }

    public enableDebug(enabled: boolean): void {
        this.debugEnabled = enabled;
    }

    /**
     * Update per frame (for animations, sway, CVar changes)
     */
    public update(deltaTime: number): void {
        if (!this.currentWeapon) return;

        // Throttle CVar checking - 10 times per second max
        this.cvarCheckTimer += deltaTime;
        if (this.cvarCheckTimer >= WeaponViewManager.CVAR_CHECK_INTERVAL) {
            this.cvarCheckTimer = 0;
            this.checkCVarChanges();
        }

        // Future: weapon sway, bob, animations
    }

    private checkCVarChanges(): void {
        try {
            const mv = MovementVars.getInstance();
            const currentHand = mv.get('cg_handedness');

            if (currentHand !== this.lastHandedness) {
                this.lastHandedness = currentHand;
                this.applyPosition(this.currentPosition);
                console.log(`[WeaponViewManager] Handedness changed to ${currentHand}`);
            }
        } catch (e) {
            // MovementVars not available
            if (this.debugEnabled) {
                console.warn('[WeaponViewManager] CVar check failed:', e);
            }
        }
    }
}

// Convenience function
export function getWeaponViewManager(): WeaponViewManager {
    return WeaponViewManager.getInstance();
}

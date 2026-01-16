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
import { BspManager } from '../loader/bsp/BspManager';
import { ViewportEffectsManager } from '../viewport/ViewportEffectsManager';

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
        // Right hand, lower on screen (right=12, down=25, forward=19)
        offset: MD3Coords.viewModelOffset(HAND_OFFSETS.right, 25, 19),
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

// Layer mask for weapon-only rendering
const WEAPON_LAYER_MASK = 0x10000000;

export class WeaponViewManager {
    private static instance: WeaponViewManager;

    private scene: Scene | null = null;
    private weaponCamera: FreeCamera | null = null;
    private weaponRoot: TransformNode | null = null;
    private currentWeapon: MD3LoadResult | null = null;
    private currentPosition: WeaponPosition = DEFAULT_POSITIONS.hip;

    // CVar tracking for live updates
    private lastHandedness: number = 1;
    private lastWeaponFov: number = 60;
    private cvarCheckTimer: number = 0;
    private static readonly CVAR_CHECK_INTERVAL = 0.1; // Check 10x/sec, not every frame

    // Lighting smoothing
    private currentLightR: number = 1.0;
    private currentLightG: number = 1.0;
    private currentLightB: number = 1.0;
    private static readonly LIGHT_LERP_SPEED = 5.0;  // How fast to interpolate (higher = faster)
    private static readonly LIGHT_INFLUENCE = 0.6;   // 0-1, how much lightgrid affects weapon (0.6 = 60%)

    // Weapon bob state
    private currentBobOffsetX: number = 0;
    private currentBobOffsetY: number = 0;
    private currentSprintTilt: number = 0;    // X-axis pitch up
    private currentSprintRoll: number = 0;    // Z-axis roll sideways
    private currentSprintYaw: number = 0;     // Y-axis yaw (barrel points inward)
    private effectiveBasePosition: Vector3 = Vector3.Zero();  // Base position with handedness
    private static readonly BOB_LERP_SPEED = 8.0;  // Smooth bob transitions

    // Jump/land bob state (time-based animation)
    private jumpLandBobTarget: number = 0;     // Target bob value
    private jumpLandBobCurrent: number = 0;    // Smoothed current value
    private jumpLandCooldown: number = 0;      // Cooldown to prevent rapid triggers
    private wasGroundedLastFrame: boolean = true;
    private static readonly JUMP_LAND_LERP = 12.0;   // How fast to reach target
    private static readonly JUMP_LAND_RECOVER = 4.0; // How fast to recover to 0
    private static readonly JUMP_LAND_COOLDOWN = 0.15; // Minimum seconds between triggers

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

        // Get initial weapon FOV from CVar
        try {
            const mv = MovementVars.getInstance();
            this.lastWeaponFov = mv.get('cg_weaponfov');
        } catch {
            this.lastWeaponFov = 90;
        }

        // Create weapon camera with separate FOV
        // This camera only sees weapon layer and renders after main camera
        this.weaponCamera = new FreeCamera('weaponCamera', camera.position.clone(), scene);
        this.weaponCamera.fov = this.lastWeaponFov * Math.PI / 180;
        this.weaponCamera.minZ = 0.1;
        this.weaponCamera.maxZ = 1000;
        this.weaponCamera.layerMask = WEAPON_LAYER_MASK;  // Only sees weapon layer
        this.weaponCamera.parent = camera;  // Follows main camera

        // Main camera should not see weapon layer
        camera.layerMask = camera.layerMask & ~WEAPON_LAYER_MASK;

        // Set up multi-camera rendering
        scene.activeCameras = [camera, this.weaponCamera];

        // Create weapon root node attached to weapon camera
        this.weaponRoot = new TransformNode('weaponView', scene);
        this.weaponRoot.parent = this.weaponCamera;

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

        console.log(`[WeaponViewManager] Initialized with weapon FOV ${this.lastWeaponFov}°`);
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

        // Set rendering group and layer mask for each mesh
        // - renderingGroupId 1: renders after world with depth cleared
        // - layerMask: only visible to weapon camera (separate FOV)
        for (const mesh of this.currentWeapon.meshes) {
            mesh.renderingGroupId = 1;
            mesh.layerMask = WEAPON_LAYER_MASK;
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

        // Store effective base position for bob to use
        this.effectiveBasePosition.set(handOffset, pos.offset.y, pos.offset.z);

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

        // Update lighting every frame for smooth transitions
        this.updateLightingFromBsp(deltaTime);

        // Update weapon bob (synced with view bob)
        this.updateWeaponBob(deltaTime);
    }

    /**
     * Update weapon bob animation synced with view bob
     */
    private updateWeaponBob(deltaTime: number): void {
        if (!this.currentWeapon || !this.weaponRoot) return;

        const mv = MovementVars.getInstance();
        const bobEnabled = mv.get('cg_gunbob') > 0;

        // Get player state from viewport manager
        const viewportManager = ViewportEffectsManager.getInstance();
        const state = viewportManager.getCurrentState();

        // Calculate target bob offsets
        let targetBobX = 0;
        let targetBobY = 0;
        let targetTilt = 0;
        let targetRoll = 0;
        let targetInward = 0;

        const amplitude = mv.get('cg_gunbob_amplitude');
        const speedMult = mv.get('cg_gunbob_speed');
        const sprintTilt = mv.get('cg_gunbob_sprint_tilt');
        const sprintInward = mv.get('cg_gunbob_sprint_inward');

        // Use shared bobCycle from view bob (synced!)
        const bobCycle = (state.bobCycle ?? 0) * speedMult;

        // Speed factor for intensity
        const speedFactor = Math.min(state.horizontalSpeed / 320, 2.0);

        // === WALK BOB (grounded only) ===
        // Vertical and horizontal sway - only when feet on ground
        if (bobEnabled && state.isGrounded && state.horizontalSpeed > 10) {
            // Vertical bob (up/down)
            targetBobY = Math.sin(bobCycle * 2) * amplitude * speedFactor;

            // Horizontal sway (left/right) - 90° offset
            targetBobX = Math.sin(bobCycle) * amplitude * 0.5 * speedFactor;
        }

        // === SPRINT TILT (speed-based, NOT grounded check) ===
        // Maintains sprint pose even while jumping/bunnyhopping
        // Two-phase scaling:
        //   Phase 1: 320-420 (sprint speed) = 0% to 100% of CVar value
        //   Phase 2: 420+ (strafe bunny) = 100% to 120% max (slower growth)
        const baseSpeed = 320;
        const sprintSpeed = 420;  // 100% point
        const maxExtraSpeed = 800;  // 120% point (beyond this, capped)

        let sprintRatio: number;
        if (state.horizontalSpeed <= sprintSpeed) {
            // Phase 1: linear scale to 100%
            sprintRatio = Math.max(0, (state.horizontalSpeed - baseSpeed) / (sprintSpeed - baseSpeed));
        } else {
            // Phase 2: slower growth from 100% to 120%
            const extraRatio = (state.horizontalSpeed - sprintSpeed) / (maxExtraSpeed - sprintSpeed);
            sprintRatio = 1.0 + Math.min(0.2, extraRatio * 0.2);  // Max 120%
        }

        if (bobEnabled && state.horizontalSpeed > baseSpeed * 0.8) {  // Above 80% of base speed
            targetTilt = -sprintTilt * sprintRatio;    // Negative = tilt up
            targetRoll = sprintTilt * 1.5 * sprintRatio;  // Roll to the side
            // Yaw: rotate barrel toward chest
            const handSign = this.effectiveBasePosition.x > 0 ? -1 : 1;
            targetInward = handSign * sprintInward * sprintRatio;  // Yaw degrees
        }

        // Smooth lerp to targets
        const lerpFactor = Math.min(1.0, deltaTime * WeaponViewManager.BOB_LERP_SPEED);
        this.currentBobOffsetX += (targetBobX - this.currentBobOffsetX) * lerpFactor;
        this.currentBobOffsetY += (targetBobY - this.currentBobOffsetY) * lerpFactor;
        this.currentSprintTilt += (targetTilt - this.currentSprintTilt) * lerpFactor;
        this.currentSprintRoll += (targetRoll - this.currentSprintRoll) * lerpFactor;
        this.currentSprintYaw += (targetInward - this.currentSprintYaw) * lerpFactor;

        // === JUMP/LAND BOB (time-based triggered animation) ===
        const jumpBobIntensity = mv.get('cg_gunbob_jump');
        const landBobIntensity = mv.get('cg_gunbob_land');

        // Decrease cooldown
        if (this.jumpLandCooldown > 0) {
            this.jumpLandCooldown -= deltaTime;
        }

        // Detect jump (leaving ground) - only if not on cooldown
        if (this.jumpLandCooldown <= 0 && this.wasGroundedLastFrame && !state.isGrounded && state.velocity.y > 50) {
            // Trigger jump animation - bob down then recover
            this.jumpLandBobTarget = -jumpBobIntensity;
            this.jumpLandCooldown = WeaponViewManager.JUMP_LAND_COOLDOWN;
        }

        // Detect landing (hitting ground) - only if not on cooldown
        if (this.jumpLandCooldown <= 0 && !this.wasGroundedLastFrame && state.isGrounded) {
            // Trigger land animation - bob down based on impact
            const impactStrength = Math.min(1.0, Math.abs(state.landingVelocity ?? 0) / 500);
            this.jumpLandBobTarget = -landBobIntensity * (0.5 + impactStrength * 0.5);
            this.jumpLandCooldown = WeaponViewManager.JUMP_LAND_COOLDOWN;
        }

        // Smoothly move current toward target
        const jumpLerpFactor = Math.min(1.0, deltaTime * WeaponViewManager.JUMP_LAND_LERP);
        this.jumpLandBobCurrent += (this.jumpLandBobTarget - this.jumpLandBobCurrent) * jumpLerpFactor;

        // Recover target back to 0 (slower than the initial movement)
        const recoverFactor = Math.min(1.0, deltaTime * WeaponViewManager.JUMP_LAND_RECOVER);
        this.jumpLandBobTarget *= (1.0 - recoverFactor);

        // Track grounded state for next frame
        this.wasGroundedLastFrame = state.isGrounded;

        // Apply to weapon root (on top of base position with handedness)
        const root = this.currentWeapon.root;
        const basePos = this.effectiveBasePosition;

        // Apply position offset (bob + jump/land)
        root.position.set(
            basePos.x + this.currentBobOffsetX,
            basePos.y + this.currentBobOffsetY + this.jumpLandBobCurrent,
            basePos.z
        );

        // Apply rotation (base + sprint: pitch X, yaw Y, roll Z)
        const baseRot = this.currentPosition.rotation;
        root.rotation.set(
            baseRot.x + (this.currentSprintTilt * Math.PI / 180),  // Pitch up
            baseRot.y + (this.currentSprintYaw * Math.PI / 180),   // Yaw barrel toward chest
            baseRot.z + (this.currentSprintRoll * Math.PI / 180)   // Roll sideways
        );
    }

    /**
     * Sample BSP lightgrid at camera position and apply to weapon materials (smoothed)
     */
    private updateLightingFromBsp(deltaTime: number): void {
        if (!this.currentWeapon || !this.scene) return;

        try {
            // Get main camera position (first in activeCameras array)
            const cameras = this.scene.activeCameras;
            if (!cameras || cameras.length === 0) return;

            const mainCamera = cameras[0];
            const worldPos = mainCamera.globalPosition;

            // Sample lighting from BSP lightgrid
            const bspManager = BspManager.getInstance();
            const lighting = bspManager.getLightingAt(worldPos);

            // Calculate target brightness from lightgrid
            let targetR = 1.0, targetG = 1.0, targetB = 1.0;

            if (lighting) {
                // Combine ambient + directional for total light level
                const rawR = (lighting.ambient[0] + lighting.directional[0]) / 255;
                const rawG = (lighting.ambient[1] + lighting.directional[1]) / 255;
                const rawB = (lighting.ambient[2] + lighting.directional[2]) / 255;

                // Calculate overall brightness (0-1)
                const brightness = (rawR + rawG + rawB) / 3;

                // Clamp brightness to range (0.15 - 1.0) - lower allows blacker weapon
                const minLight = 0.15;
                const clampedBrightness = Math.min(1.0, Math.max(minLight, brightness));

                // Apply brightness scaling to colors while preserving color tint
                const colorScale = clampedBrightness / Math.max(0.01, brightness);
                const scaledR = Math.min(1.0, Math.max(minLight, rawR * colorScale));
                const scaledG = Math.min(1.0, Math.max(minLight, rawG * colorScale));
                const scaledB = Math.min(1.0, Math.max(minLight, rawB * colorScale));

                // Blend with white based on influence (0.7 = 70% lightgrid, 30% base)
                const influence = WeaponViewManager.LIGHT_INFLUENCE;
                targetR = 1.0 * (1 - influence) + scaledR * influence;
                targetG = 1.0 * (1 - influence) + scaledG * influence;
                targetB = 1.0 * (1 - influence) + scaledB * influence;
            }

            // Smooth lerp toward target
            const lerpFactor = Math.min(1.0, deltaTime * WeaponViewManager.LIGHT_LERP_SPEED);
            this.currentLightR += (targetR - this.currentLightR) * lerpFactor;
            this.currentLightG += (targetG - this.currentLightG) * lerpFactor;
            this.currentLightB += (targetB - this.currentLightB) * lerpFactor;

            // Apply smoothed lighting to weapon materials
            for (const mesh of this.currentWeapon.meshes) {
                const mat = mesh.material as StandardMaterial;
                if (mat && mat.diffuseColor) {
                    mat.diffuseColor.set(this.currentLightR, this.currentLightG, this.currentLightB);
                }
            }
        } catch {
            // BspManager not available - use default lighting
        }
    }

    private checkCVarChanges(): void {
        try {
            const mv = MovementVars.getInstance();

            // Check handedness
            const currentHand = mv.get('cg_handedness');
            if (currentHand !== this.lastHandedness) {
                this.lastHandedness = currentHand;
                this.applyPosition(this.currentPosition);
                console.log(`[WeaponViewManager] Handedness changed to ${currentHand}`);
            }

            // Check weapon FOV
            const currentFov = mv.get('cg_weaponfov');
            if (currentFov !== this.lastWeaponFov && this.weaponCamera) {
                this.lastWeaponFov = currentFov;
                this.weaponCamera.fov = currentFov * Math.PI / 180;
                console.log(`[WeaponViewManager] Weapon FOV changed to ${currentFov}°`);
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

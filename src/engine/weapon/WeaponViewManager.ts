/**
 * WeaponViewManager - Manages first-person weapon view models
 * 
 * Handles loading, positioning, and displaying weapon models
 * attached to the camera for first-person view.
 */

import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { getMD3Loader, MD3LoadResult, MD3Coords } from '../loader/model/MD3Loader';
import { PK3Loader } from '../loader/pk3/PK3Loader';
import { MovementVars } from '../movement/MovementVars';
import { BspManager } from '../loader/bsp/BspManager';
import { ViewportEffectsManager } from '../viewport/ViewportEffectsManager';
import { getEntityRegistry, WeaponDef } from '../../shared/entities';
import { getProjectileManager } from './ProjectileManager';

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
    private mainCamera: FreeCamera | null = null;  // Main player camera for aim direction
    private weaponRoot: TransformNode | null = null;
    private currentWeapon: MD3LoadResult | null = null;
    private currentWeaponDef: WeaponDef | null = null;  // Entity definition for current weapon
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

    // ADS (Aiming Down Sights) state
    private adsProgress: number = 0;  // 0 = hip, 1 = fully ADS

    // Muzzle flash state
    private muzzleFlashLight: PointLight | null = null;
    private muzzleFlashModel: TransformNode | null = null;  // Flash MD3 model at tag_flash
    private muzzleFlashIntensity: number = 0;  // Current flash intensity (fades out)
    private static readonly MUZZLE_FLASH_MAX_INTENSITY = 15.0;  // Peak brightness
    private static readonly MUZZLE_FLASH_DECAY = 45.0;  // How fast it fades (higher = faster)
    private static readonly MUZZLE_FLASH_OPACITY = 0.75; // Max opacity (0.75 = 75% visible)
    private static readonly MUZZLE_FLASH_RANGE = 30;  // Light range in units
    // Weapon recoil
    private recoilOffset: number = 0;  // Current recoil (kicks back then returns)
    private static readonly RECOIL_KICK = 1.5;  // Max recoil distance
    private static readonly RECOIL_RECOVER = 20.0;  // How fast recoil recovers

    // Reload animation state
    private reloadState = {
        active: false,
        startTime: 0,
        duration: 1.0,  // Will be set from weapon def
    };
    private static readonly RELOAD_ROLL_MAX = Math.PI / 3;  // 60 degrees
    private static readonly RELOAD_Y_OFFSET = -10;  // Down offset
    private static readonly RELOAD_Z_BACK = -8;   // Pull back
    private static readonly RELOAD_Z_FORWARD = 3;  // Push forward
    private static readonly RELOAD_X_CHEST = -8;  // Pull toward chest (left/center)

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
        this.mainCamera = camera;  // Store for aim direction

        // Initialize MD3 loader
        getMD3Loader().init(scene);

        // Initialize projectile manager
        getProjectileManager().init(scene);

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
     * @param weaponName - Either a weapon ID (looks up in registry) or folder name
     */
    public async loadWeapon(
        weaponName: string,
        pk3Path?: string
    ): Promise<boolean> {
        if (!this.scene || !this.weaponRoot) {
            console.error('[WeaponViewManager] Not initialized');
            return false;
        }

        // Try to look up weapon definition from entity registry
        const registry = getEntityRegistry();
        const weaponDef = registry.get<WeaponDef>(weaponName);
        if (weaponDef) {
            this.currentWeaponDef = weaponDef;
            console.log(`[WeaponViewManager] Found weapon definition: ${weaponDef.name}`);
        } else {
            this.currentWeaponDef = null;
            console.log(`[WeaponViewManager] No definition found for '${weaponName}', using defaults`);
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

        // Construct paths - use definition if available
        const modelPath = weaponDef?.viewModel?.modelPath
            ?? `models/weapons/${weaponName}/${weaponName}.md3`;
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

        // Load muzzle flash model (e.g., plasmagun_flash.md3)
        const flashModelPath = weaponDef?.viewModel?.flashModelPath
            ?? `models/weapons/${weaponName}/${weaponName}_flash.md3`;
        if (pk3.hasFile(flashModelPath)) {
            const flashData = await pk3.getFile(flashModelPath);
            if (flashData) {
                try {
                    const flashMd3 = md3.parseMD3(flashData);
                    const flashResult = md3.createMeshes(flashMd3, `${weaponName}_flash`);
                    if (flashResult) {
                        // Parent flash to weapon root
                        flashResult.root.parent = this.currentWeapon.root;
                        this.muzzleFlashModel = flashResult.root;

                        // Scale the flash model appropriately
                        flashResult.root.scaling.setAll(1.5);

                        // Set up flash meshes
                        for (const mesh of flashResult.meshes) {
                            mesh.renderingGroupId = 1;
                            mesh.layerMask = WEAPON_LAYER_MASK;
                            mesh.isPickable = false;

                            // Ensure lighting is disabled for flash
                            const mat = mesh.material as StandardMaterial;
                            if (mat) {
                                mat.disableLighting = true;
                                mat.backFaceCulling = false;
                            }
                        }

                        // Position at tag_flash and align rotation
                        const flashTag = this.currentWeapon.getTag('tag_flash');
                        if (flashTag) {
                            flashResult.root.position = flashTag.origin.clone();

                            // Apply rotation from tag properties
                            if (!flashResult.root.rotationQuaternion) {
                                flashResult.root.rotationQuaternion = new Quaternion();
                            }
                            Quaternion.FromRotationMatrixToRef(flashTag.axis, flashResult.root.rotationQuaternion);
                        }
                        flashResult.root.setEnabled(false);
                        console.log(`[WeaponViewManager] Loaded flash model: ${flashModelPath}`);
                    }
                } catch (e) {
                    console.warn(`[WeaponViewManager] Failed to load flash model: ${flashModelPath}`, e);
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

        // Update muzzle flash
        this.updateMuzzleFlash(deltaTime);

        // Update projectiles
        getProjectileManager().update(deltaTime);
    }

    /**
     * Update weapon bob animation synced with view bob
     */
    private updateWeaponBob(deltaTime: number): void {
        if (!this.currentWeapon || !this.weaponRoot) return;

        const mv = MovementVars.getInstance();
        const bobEnabled = mv.get('cl_gunbob') > 0;

        // Get player state from viewport manager
        const viewportManager = ViewportEffectsManager.getInstance();
        const state = viewportManager.getCurrentState();

        // Calculate target bob offsets
        let targetBobX = 0;
        let targetBobY = 0;
        let targetTilt = 0;
        let targetRoll = 0;
        let targetInward = 0;

        const amplitude = mv.get('cl_gunbob_amplitude');
        const speedMult = mv.get('cl_gunbob_speed');
        const sprintTilt = mv.get('cl_gunbob_sprint_tilt');
        const sprintInward = mv.get('cl_gunbob_sprint_inward');

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

        // Dampen entirely if reloading
        if (this.reloadState.active) {
            targetBobX = 0;
            targetBobY = 0;
            targetTilt = 0;
            targetRoll = 0;
            targetInward = 0;
        }

        // Smooth lerp to targets
        const lerpFactor = Math.min(1.0, deltaTime * WeaponViewManager.BOB_LERP_SPEED);
        this.currentBobOffsetX += (targetBobX - this.currentBobOffsetX) * lerpFactor;
        this.currentBobOffsetY += (targetBobY - this.currentBobOffsetY) * lerpFactor;
        this.currentSprintTilt += (targetTilt - this.currentSprintTilt) * lerpFactor;
        this.currentSprintRoll += (targetRoll - this.currentSprintRoll) * lerpFactor;
        this.currentSprintYaw += (targetInward - this.currentSprintYaw) * lerpFactor;

        // === JUMP/LAND BOB (time-based triggered animation) ===
        const jumpBobIntensity = mv.get('cl_gunbob_jump');
        const landBobIntensity = mv.get('cl_gunbob_land');

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

        // === ADS (Aiming Down Sights) ===
        const adsTime = mv.get('cl_ads_time');
        const adsOffsetY = mv.get('cl_ads_offset_y');

        // Lerp ADS progress based on aim state
        // Force ADS off during reload
        const adsSpeed = 1.0 / Math.max(0.05, adsTime);  // Inverse of time = speed
        const targetAds = (state.isAiming && !this.reloadState.active) ? 1.0 : 0.0;
        const adsLerp = Math.min(1.0, deltaTime * adsSpeed);
        this.adsProgress += (targetAds - this.adsProgress) * adsLerp;

        // Calculate ADS position (lerp toward center)
        // X: lerp from hip position toward center (0)
        // Y: add upward offset
        const adsX = basePos.x * (1.0 - this.adsProgress);  // Lerp toward 0 (center)
        const adsY = adsOffsetY * this.adsProgress;          // Move up

        // Get reload animation offsets
        const reloadOffsets = this.getReloadAnimationOffsets();

        // Apply position offset (bob + jump/land + ADS + recoil + reload)
        root.position.set(
            adsX + this.currentBobOffsetX + reloadOffsets.xOffset,  // REMOVED RECOIL FROM X
            basePos.y + this.currentBobOffsetY + this.jumpLandBobCurrent + adsY + reloadOffsets.yOffset,
            basePos.z + reloadOffsets.zOffset - this.recoilOffset   // Recoil kicks back on Z (backward)
        );

        // Apply rotation (base + sprint: pitch X, yaw Y, roll Z + reload roll)
        // Reduce sprint effects when ADS (weapon should be more stable)
        // FIX: Plasmagun is rotated -90 Y. 
        // - Local X aligns with World Z (Roll).
        // - Local Z aligns with World X (Pitch).
        // So recoil pitch must be applied to Z!
        const sprintFactor = 1.0 - this.adsProgress * 0.8;  // 80% reduction when fully ADS
        const baseRot = this.currentPosition.rotation;
        root.rotation.set(
            baseRot.x + (this.currentSprintTilt * sprintFactor * Math.PI / 180) + reloadOffsets.pitch,
            baseRot.y + (this.currentSprintYaw * sprintFactor * Math.PI / 180),
            baseRot.z + (this.currentSprintRoll * sprintFactor * Math.PI / 180) + reloadOffsets.roll + this.recoilOffset * 0.06  // Recoil on Z (Pitch due to Y-90)
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

    /**
     * Trigger weapon fire effect and projectile
     * Called by controller when logic permits (ammo, fire rate, etc.)
     */
    public fire(): void {
        // this.lastFireTime = performance.now() / 1000;

        // FIRE! Trigger muzzle flash
        const flashDef = this.currentWeaponDef?.muzzleFlash;
        const maxIntensity = flashDef?.intensity ?? WeaponViewManager.MUZZLE_FLASH_MAX_INTENSITY;
        this.muzzleFlashIntensity = maxIntensity;

        // Show muzzle flash model
        if (this.muzzleFlashModel) {
            this.muzzleFlashModel.setEnabled(true);
            if (this.muzzleFlashModel instanceof TransformNode) {
                this.muzzleFlashModel.getChildMeshes().forEach(m => m.visibility = WeaponViewManager.MUZZLE_FLASH_OPACITY);
            }
        }

        // Trigger recoil
        this.recoilOffset = WeaponViewManager.RECOIL_KICK;

        // Spawn projectile
        if (this.mainCamera && this.currentWeaponDef?.projectileId) {
            const projMgr = getProjectileManager();
            const origin = this.mainCamera.position.clone();
            const forward = this.mainCamera.getDirection(Vector3.Forward());
            origin.addInPlace(forward.scale(2));  // 2 units in front
            projMgr.spawn(this.currentWeaponDef.projectileId, origin, forward);
        }

        // Create/Update light
        if (!this.muzzleFlashLight) {
            this.muzzleFlashLight = new PointLight('muzzleFlash', Vector3.Zero(), this.scene!);
        }

        const color = flashDef?.color ?? { r: 1.0, g: 0.8, b: 0.3 };
        const range = flashDef?.range ?? WeaponViewManager.MUZZLE_FLASH_RANGE;
        this.muzzleFlashLight.diffuse = new Color3(color.r, color.g, color.b);
        this.muzzleFlashLight.specular = new Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5);
        this.muzzleFlashLight.range = range;

        // Ensure light is on
        this.muzzleFlashLight.intensity = 1.0;
        this.muzzleFlashLight.setEnabled(true);
    }

    /**
     * Update muzzle flash effect decay and recoil recovery
     */
    private updateMuzzleFlash(deltaTime: number): void {
        if (!this.scene) return;

        // Decay flash intensity
        if (this.muzzleFlashIntensity > 0) {
            this.muzzleFlashIntensity -= WeaponViewManager.MUZZLE_FLASH_DECAY * deltaTime;
            if (this.muzzleFlashIntensity < 0) this.muzzleFlashIntensity = 0;

            const max = WeaponViewManager.MUZZLE_FLASH_MAX_INTENSITY;
            const normalizedIntensity = this.muzzleFlashIntensity / max;

            // Update model visibility (fade out)
            if (this.muzzleFlashModel && this.muzzleFlashModel.isEnabled()) {
                const opacity = normalizedIntensity * WeaponViewManager.MUZZLE_FLASH_OPACITY;
                if (this.muzzleFlashModel instanceof TransformNode) {
                    this.muzzleFlashModel.getChildMeshes().forEach(m => m.visibility = opacity);
                }

                if (this.muzzleFlashIntensity <= 0) {
                    this.muzzleFlashModel.setEnabled(false);
                }
            }

            // Update light intensity and position
            if (this.muzzleFlashLight) {
                this.muzzleFlashLight.intensity = normalizedIntensity;

                if (this.muzzleFlashIntensity <= 0) {
                    this.muzzleFlashLight.setEnabled(false);
                } else {
                    // Update position if attached to tag
                    const tag = this.currentWeapon?.getTag('tag_flash');
                    if (tag && this.weaponRoot) {
                        const localPos = tag.origin;
                        const worldPos = Vector3.TransformCoordinates(localPos, this.weaponRoot.getWorldMatrix());
                        this.muzzleFlashLight.position = worldPos;
                    }
                }
            }
        }

        // Recover recoil
        if (this.recoilOffset > 0) {
            this.recoilOffset -= WeaponViewManager.RECOIL_RECOVER * deltaTime;
            if (this.recoilOffset < 0) this.recoilOffset = 0;
        }
    }

    // ==================== RELOAD ANIMATION ====================

    /**
     * Start reload animation
     * @param _duration - Reload time from weapon def (ignored, using fixed 600ms animation)
     */
    public startReload(_duration: number): void {
        // Use provided duration (from weapon def)
        this.reloadState = {
            active: true,
            startTime: performance.now() / 1000,
            duration: _duration,
        };
        console.log(`[WeaponViewManager] Starting reload animation (${_duration.toFixed(2)}s)`);
    }

    /**
     * Cancel reload animation (e.g., weapon switch)
     */
    public cancelReload(): void {
        if (this.reloadState.active) {
            this.reloadState.active = false;
            console.log(`[WeaponViewManager] Reload animation cancelled`);
        }
    }

    /**
     * Check if currently reloading
     */
    public isReloading(): boolean {
        return this.reloadState.active;
    }

    /**
     * Get reload progress (0-1)
     */
    public getReloadProgress(): number {
        if (!this.reloadState.active) return 0;
        const now = performance.now() / 1000;
        const elapsed = now - this.reloadState.startTime;
        return Math.min(1.0, elapsed / this.reloadState.duration);
    }

    /**
     * Calculate reload animation offsets based on progress
     * Returns { roll, yOffset, zOffset }
     * 
     * Animation sequence (1s):
     * Phase 1 (0-30%): Slow move UP + roll
     * Phase 2 (30-40%): Fast pump DOWN
     * Phase 3 (40-50%): Fast pump UP  
     * Phase 4 (50-100%): Slow roll back + return to normal
     */
    private getReloadAnimationOffsets(): { roll: number; pitch: number; xOffset: number; yOffset: number; zOffset: number } {
        if (!this.reloadState.active) {
            return { roll: 0, pitch: 0, xOffset: 0, yOffset: 0, zOffset: 0 };
        }

        const progress = this.getReloadProgress();

        // Check if reload is complete
        if (progress >= 1.0) {
            this.reloadState.active = false;
            return { roll: 0, pitch: 0, xOffset: 0, yOffset: 0, zOffset: 0 };
        }

        // Animation: fast_tilt -> pump_aligned
        const MAX_ROLL = Math.PI / 4;   // 45 degrees
        const MAX_PITCH = Math.PI / 8;  // 22.5 degrees up (increased)
        const DIP_Y = -4;
        const SLIDE_DIST = -9;          // Slide back amount

        let roll = 0;
        let pitch = 0;
        let xOffset = 0;
        let yOffset = 0;
        let zOffset = 0;

        let tilt = 0;

        // 1. Snappy Tilt (0.0 to 0.25)
        // User wants: "FAST and slow to the right tilt"
        if (progress < 0.25) {
            const t = progress / 0.25;
            // Cubic Ease Out (Fast start, smooth settle)
            tilt = 1 - Math.pow(1 - t, 3);
        } else if (progress > 0.75) {
            // Untilt (Smooth step)
            const t = (1.0 - progress) / 0.25;
            tilt = t * t * (3 - 2 * t);
        } else {
            tilt = 1.0;
        }

        roll = tilt * MAX_ROLL;
        pitch = tilt * MAX_PITCH;
        yOffset = tilt * DIP_Y;

        // 2. Pump Action (0.3 to 0.7) - Aligned with Barrel
        let pump = 0;
        if (progress > 0.3 && progress < 0.7) {
            if (progress < 0.45) {
                // Slide Back (Ease Out)
                const t = (progress - 0.3) / 0.15;
                pump = Math.sin(t * Math.PI / 2) * SLIDE_DIST;
            } else if (progress < 0.55) {
                // Hold
                pump = SLIDE_DIST;
            } else {
                // Slam Forward (Linear + Bounce)
                const t = (progress - 0.55) / 0.15;
                pump = (1 - t) * SLIDE_DIST;

                // Add Impact Jitter
                if (t < 0.3) {
                    const shake = (1 - t / 0.3) * 0.5;
                    xOffset += (Math.random() - 0.5) * shake;
                    yOffset += (Math.random() - 0.5) * shake;
                }
            }
        }

        // Apply Pump Vector - Screen Space Y (Down/Up)
        // User request: "lower on the screen and up", not "back and forth"

        // Pump (0 -> -9 -> 0)
        // Map directly to Y offset (Down then Up)
        yOffset += pump;

        // Add slight X movement to follow the tilt (Diagonal dip)
        xOffset += pump * -0.5;

        // Slight Z kick just for impact (much smaller)
        zOffset += pump * 0.2;

        return { roll, pitch, xOffset, yOffset, zOffset };
    }
}

// Convenience function
export function getWeaponViewManager(): WeaponViewManager {
    return WeaponViewManager.getInstance();
}

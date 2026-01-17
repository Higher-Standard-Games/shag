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
    private static readonly MUZZLE_FLASH_DECAY = 30.0;  // How fast it fades (higher = faster)
    private static readonly MUZZLE_FLASH_RANGE = 30;  // Light range in units
    private firePressed: boolean = false;  // Track mouse1 state to detect fire

    // Fire rate limiting
    private lastFireTime: number = 0;  // Timestamp of last fire

    // Weapon recoil
    private recoilOffset: number = 0;  // Current recoil (kicks back then returns)
    private static readonly RECOIL_KICK = 0.5;  // Max recoil distance
    private static readonly RECOIL_RECOVER = 15.0;  // How fast recoil recovers

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

                            // Align geometry: Rotate -90 degrees around Y (Right -> Forward)
                            // because MD3 meshes face X (Right), but we want them to face Z (Tag Forward)
                            const correction = Quaternion.FromEulerAngles(0, -Math.PI / 2, 0);
                            const tagRotation = Quaternion.FromRotationMatrix(flashTag.axis);
                            tagRotation.multiplyToRef(correction, flashResult.root.rotationQuaternion);
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
        const adsSpeed = 1.0 / Math.max(0.05, adsTime);  // Inverse of time = speed
        const targetAds = state.isAiming ? 1.0 : 0.0;
        const adsLerp = Math.min(1.0, deltaTime * adsSpeed);
        this.adsProgress += (targetAds - this.adsProgress) * adsLerp;

        // Calculate ADS position (lerp toward center)
        // X: lerp from hip position toward center (0)
        // Y: add upward offset
        const adsX = basePos.x * (1.0 - this.adsProgress);  // Lerp toward 0 (center)
        const adsY = adsOffsetY * this.adsProgress;          // Move up

        // Apply position offset (bob + jump/land + ADS + recoil)
        root.position.set(
            adsX + this.currentBobOffsetX,
            basePos.y + this.currentBobOffsetY + this.jumpLandBobCurrent + adsY,
            basePos.z - this.recoilOffset  // Recoil kicks weapon BACK toward player
        );

        // Apply rotation (base + sprint: pitch X, yaw Y, roll Z)
        // Reduce sprint effects when ADS (weapon should be more stable)
        const sprintFactor = 1.0 - this.adsProgress * 0.8;  // 80% reduction when fully ADS
        const baseRot = this.currentPosition.rotation;
        root.rotation.set(
            baseRot.x + (this.currentSprintTilt * sprintFactor * Math.PI / 180) + this.recoilOffset * 0.1,  // Pitch up on recoil
            baseRot.y + (this.currentSprintYaw * sprintFactor * Math.PI / 180),
            baseRot.z + (this.currentSprintRoll * sprintFactor * Math.PI / 180)
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
     * Update muzzle flash effect
     * Creates dynamic point light on fire, fades out quickly
     */
    private updateMuzzleFlash(deltaTime: number): void {
        if (!this.scene || !this.currentWeapon) return;

        // Get player state for fire input
        const viewportManager = ViewportEffectsManager.getInstance();
        const state = viewportManager.getCurrentState();

        // Check fire rate
        const now = performance.now() / 1000;  // Current time in seconds
        const fireRate = this.currentWeaponDef?.fireRate ?? 10;  // shots per second
        const fireDelay = 1.0 / fireRate;  // seconds between shots
        const canFire = (now - this.lastFireTime) >= fireDelay;

        // Detect fire (rising edge OR held with fire rate)
        const isFiring = state.isFiring ?? false;
        const shouldFire = isFiring && canFire && (!this.firePressed || (now - this.lastFireTime) >= fireDelay);

        if (shouldFire) {
            this.lastFireTime = now;

            // FIRE! Trigger muzzle flash
            // Use weapon definition or fallback to defaults
            const flashDef = this.currentWeaponDef?.muzzleFlash;
            const maxIntensity = flashDef?.intensity ?? WeaponViewManager.MUZZLE_FLASH_MAX_INTENSITY;
            this.muzzleFlashIntensity = maxIntensity;

            // Show muzzle flash model (already positioned at tag_flash during load)
            if (this.muzzleFlashModel) {
                this.muzzleFlashModel.setEnabled(true);
            }

            // Trigger recoil
            this.recoilOffset = WeaponViewManager.RECOIL_KICK;

            // Spawn projectile
            if (this.mainCamera && this.currentWeaponDef?.projectileId) {
                const projMgr = getProjectileManager();
                // Spawn slightly in front of camera
                const origin = this.mainCamera.position.clone();
                const forward = this.mainCamera.getDirection(Vector3.Forward());
                origin.addInPlace(forward.scale(2));  // 2 units in front
                projMgr.spawn(this.currentWeaponDef.projectileId, origin, forward);
            }

            // Create light if needed
            if (!this.muzzleFlashLight) {
                this.muzzleFlashLight = new PointLight(
                    'muzzleFlash',
                    Vector3.Zero(),
                    this.scene
                );
                console.log('[WeaponViewManager] Created muzzle flash light');
            }

            // Update light properties from definition
            const color = flashDef?.color ?? { r: 1.0, g: 0.8, b: 0.3 };
            const range = flashDef?.range ?? WeaponViewManager.MUZZLE_FLASH_RANGE;
            this.muzzleFlashLight.diffuse = new Color3(color.r, color.g, color.b);
            this.muzzleFlashLight.specular = new Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5);
            this.muzzleFlashLight.range = range;
        }
        this.firePressed = isFiring;

        // Recover recoil
        if (this.recoilOffset > 0) {
            this.recoilOffset -= deltaTime * WeaponViewManager.RECOIL_RECOVER;
            if (this.recoilOffset < 0) this.recoilOffset = 0;
        }

        // Decay flash intensity
        if (this.muzzleFlashIntensity > 0) {
            this.muzzleFlashIntensity -= deltaTime * WeaponViewManager.MUZZLE_FLASH_DECAY;
            if (this.muzzleFlashIntensity < 0) this.muzzleFlashIntensity = 0;

            // Hide flash model when intensity is low
            if (this.muzzleFlashIntensity < WeaponViewManager.MUZZLE_FLASH_MAX_INTENSITY * 0.3) {
                this.muzzleFlashModel?.setEnabled(false);
            }

            // Update light
            if (this.muzzleFlashLight) {
                this.muzzleFlashLight.intensity = this.muzzleFlashIntensity;

                // Position at weapon muzzle (try tag_flash, fallback to forward from weapon)
                const tag = this.currentWeapon.getTag('tag_flash');
                if (tag && this.weaponRoot) {
                    // Transform tag position to world space
                    const localPos = tag.origin;
                    const worldPos = Vector3.TransformCoordinates(localPos, this.weaponRoot.getWorldMatrix());
                    this.muzzleFlashLight.position = worldPos;
                } else if (this.weaponRoot) {
                    // Fallback: offset forward from weapon root
                    const forward = this.weaponRoot.forward.scale(5);
                    this.muzzleFlashLight.position = this.weaponRoot.position.add(forward);
                }
            }
        }
    }
}

// Convenience function
export function getWeaponViewManager(): WeaponViewManager {
    return WeaponViewManager.getInstance();
}

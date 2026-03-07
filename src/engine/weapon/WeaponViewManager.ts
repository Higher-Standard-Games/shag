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
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { getMD3Loader, MD3LoadResult, MD3Coords } from '../loader/model/MD3Loader';
import { PK3Loader } from '../loader/pk3/PK3Loader';
import { PK3TextureLoader } from '../loader/pk3/PK3TextureLoader';
import { MovementVars } from '../movement/MovementVars';
import { BspManager } from '../loader/bsp/BspManager';
import { ViewportEffectsManager } from '../viewport/ViewportEffectsManager';
import { getEntityRegistry, WeaponDef } from '../../shared/entities';
import { getProjectileManager } from './ProjectileManager';
import { getHitscanEffects } from './HitscanEffects';


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

// === Slash Animation Definitions ===

/** Parameters for a single slash animation swing */
interface SlashParams {
    // Rotation offsets (radians) at swing start and end
    startPitch: number;   // X rotation at swing start
    startRoll: number;    // Z rotation at swing start
    endPitch: number;     // X rotation at swing end
    endRoll: number;      // Z rotation at swing end
    startYaw: number;     // Y rotation at start (0 for most slashes)
    endYaw: number;       // Y rotation at end

    // Position offsets at swing start and end
    startOffset: { x: number; y: number; z: number };
    endOffset: { x: number; y: number; z: number };

    // Timing (ms)
    windupDuration: number;   // move to start pose
    swingDuration: number;    // the actual slash (fast)
    returnDuration: number;   // ease back to idle
}

/** Slash animation presets — cycled/randomized on each fire */
const SLASH_PRESETS: SlashParams[] = [
    // Slash 1: Big vertical down — raised high, sweeps down with lunge
    {
        startPitch: 0, startRoll: -2.0, startYaw: 0,
        endPitch: 0, endRoll: 1.4, endYaw: 0,
        startOffset: { x: 5, y: 30, z: -15 },    // raised way up, pulled back
        endOffset: { x: -5, y: -25, z: 18 },    // swept down, lunged forward hard
        windupDuration: 60,
        swingDuration: 160,
        returnDuration: 230,
    },
    // Slash 2: Diagonal upper-right to lower-left
    {
        startPitch: 0.7, startRoll: -1.8, startYaw: -0.4,
        endPitch: -0.7, endRoll: 1.2, endYaw: 0.4,
        startOffset: { x: -12, y: 28, z: -12 },
        endOffset: { x: 12, y: -22, z: 15 },
        windupDuration: 55,
        swingDuration: 165,
        returnDuration: 230,
    },
    // Slash 3: Diagonal upper-left to lower-right
    {
        startPitch: -0.7, startRoll: -1.8, startYaw: 0.4,
        endPitch: 0.7, endRoll: 1.2, endYaw: -0.4,
        startOffset: { x: 12, y: 28, z: -12 },
        endOffset: { x: -12, y: -22, z: 15 },
        windupDuration: 55,
        swingDuration: 165,
        returnDuration: 230,
    },
];

export class WeaponViewManager {
    private static instance: WeaponViewManager;

    private scene: Scene | null = null;

    /** Check if the weapon view manager has been initialized */
    public get isReady(): boolean {
        return this.scene !== null && this.weaponRoot !== null;
    }

    /**
     * Get the world-space position of the gun barrel/muzzle (for beam origin etc.)
     * 
     * The weapon is rendered in a separate camera layer (weaponCamera).
     * weaponRoot.position is in weapon-camera-local space, which mirrors
     * mainCamera orientation. Transform through mainCamera's world matrix
     * to get main-scene world-space coordinates.
     */
    public getMuzzleWorldPosition(): Vector3 | null {
        if (!this.mainCamera) return null;

        // Use camera direction offsets to approximate barrel position.
        // Lerp between hip (gun on right side) and ADS (centered) using adsProgress.
        const ads = this.adsProgress;  // 0 = hip, 1 = full ADS
        const forward = this.mainCamera.getDirection(Vector3.Forward());
        const right = this.mainCamera.getDirection(Vector3.Right());
        const up = this.mainCamera.getDirection(Vector3.Up());

        // Hip offsets: right 1.5, down 1.2, forward 5
        // ADS offsets: centered, down 0.8, forward 4
        const rightOff = 1.5 * (1 - ads);
        const downOff = 1.2 - 0.4 * ads;
        const fwdOff = 5 - 1 * ads;

        // Add dynamic weapon movement (bob, landing, recoil)
        // Suppress bob during beam charge/active for stability
        const chargeOrBeam = Math.max(this.beamChargeProgress, this.beamActive ? 1 : 0);
        const scale = 0.05 * (1 - chargeOrBeam * 0.8);  // lerp from 0.05 → 0.01
        const bobX = this.currentBobOffsetX * scale;
        const bobY = (this.currentBobOffsetY + this.jumpLandBobCurrent) * scale;
        const recoilZ = -this.recoilOffset * scale;

        const origin = this.mainCamera.position.clone();
        origin.addInPlace(forward.scale(fwdOff + recoilZ));
        origin.addInPlace(right.scale(rightOff + bobX));
        origin.addInPlace(up.scale(-downOff + bobY));
        return origin;
    }
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
    private static readonly MUZZLE_FLASH_DECAY = 150.0;  // How fast it fades (higher = faster)
    private static readonly MUZZLE_FLASH_OPACITY = 0.75; // Max opacity (0.75 = 75% visible)
    private static readonly MUZZLE_FLASH_RANGE = 30;  // Light range in units

    // Beam state (set by FPSPlayer, rendered here after position is finalized)
    private beamActive: boolean = false;
    private beamColor: Color3 = new Color3(1.0, 0.7, 0.1);
    private beamChargeProgress: number = 0;  // 0 = not charging, 1 = fully charged
    // Weapon recoil
    private recoilOffset: number = 0;  // Current recoil (kicks back then returns)
    private static readonly RECOIL_KICK = 1.5;  // Max recoil distance
    private static readonly RECOIL_RECOVER = 20.0;  // How fast recoil recovers

    // Blade charge state (client-side visual tracking)
    private chargeActive: boolean = false;
    private chargeStartTime: number = 0;  // performance.now() when charge started
    private chargeProgress: number = 0;   // 0-1 charge level (0=just started, 1=fully charged)
    private savedOutlineWidth: number = 0;
    private savedOutlineColor: Color3 = new Color3(0, 0, 0);
    private savedOutlineEnabled: boolean = false;

    // === Slash Animation System ===
    private slashState: {
        active: boolean;
        startTime: number;       // performance.now() when triggered
        params: SlashParams;     // current animation parameters
    } = { active: false, startTime: 0, params: SLASH_PRESETS[0] };
    private slashPresetIndex: number = 0;  // cycles through presets



    // Reload animation state
    private reloadState = {
        active: false,
        startTime: 0,
        duration: 1.0,  // Will be set from weapon def
    };

    // Weapon switch animation state
    private switchState: {
        phase: 'idle' | 'down' | 'load' | 'up';
        startTime: number;
        pendingWeaponId: string | null;
        pendingPk3Path?: string;
    } = {
            phase: 'idle',
            startTime: 0,
            pendingWeaponId: null,
        };
    // Switch animation tuning (ms)
    private static readonly SWITCH_DOWN_DURATION = 120;  // Slide current weapon down
    private static readonly SWITCH_UP_DURATION = 140;    // Slide new weapon up
    private static readonly SWITCH_Y_DROP = -45;         // How far down (Quake units)
    private static readonly SWITCH_ROLL = Math.PI / 6;   // Slight roll during switch

    // Debug
    private debugEnabled: boolean = false;

    // Weapon outline state (r_cel_weapon_* cvars)
    private _weaponOutlineEnabled = true;
    private _weaponOutlineWidth = 0.15;  // Actual Babylon value (cvar is *100 scale, default 15)
    private _weaponOutlineColor = new Color3(0, 0, 0);

    // Load generation counter — prevents concurrent loadWeapon calls from clobbering each other
    private _loadGeneration: number = 0;

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

        // Add dedicated weapon light for PBR GLB models
        // Only affects rendering group 1 (weapons), not the world
        const weaponLight = new HemisphericLight('weaponLight', new Vector3(0.3, 1, 0.5), scene);
        weaponLight.intensity = 1.2;
        weaponLight.diffuse = new Color3(1.0, 0.95, 0.9);    // Slightly warm white
        weaponLight.groundColor = new Color3(0.3, 0.3, 0.35); // Cool fill from below

        // Initialize hitscan effects system
        getHitscanEffects().init(scene);

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

        // Increment load generation — stale concurrent loads will check this and bail out
        const loadGen = ++(this as any)._loadGeneration;

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
        const weaponDir = `models/weapons/${weaponName}`;

        // === GLB MODEL LOADING ===
        // GLB models use Babylon's SceneLoader instead of PK3+MD3 parser.
        // We load the meshes, clean up SceneLoader side effects, then fall
        // through to the SAME weapon setup code that MD3 uses below.
        let isGlbWeapon = false;
        if (weaponDef?.viewModel?.viewModelFormat === 'glb') {
            console.log(`[WeaponViewManager] GLB path — loading ${weaponName}, modelPath: ${modelPath}`);

            const { SceneLoader } = await import('@babylonjs/core/Loading/sceneLoader');
            await import('@babylonjs/loaders/glTF');

            // Check if a newer load started while we were importing modules
            if (this._loadGeneration !== loadGen) {
                console.log(`[WeaponViewManager] GLB load for '${weaponName}' superseded (gen ${loadGen} < ${this._loadGeneration})`);
                return false;
            }

            // Remove previous weapon before loading new one
            if (this.currentWeapon) {
                this.currentWeapon.root.dispose();
                this.currentWeapon = null;
            }

            try {
                const lastSlash = modelPath.lastIndexOf('/');
                const dir = modelPath.substring(0, lastSlash + 1);
                const file = modelPath.substring(lastSlash + 1);

                // Save scene state — SceneLoader can add cameras/lights and set
                // scene.activeCamera, which breaks our dual-camera weapon rendering.
                const savedActiveCameras = this.scene!.activeCameras ? [...this.scene!.activeCameras] : null;
                const cameraCountBefore = this.scene!.cameras.length;

                const result = await SceneLoader.ImportMeshAsync('', dir, file, this.scene!);

                // Check if superseded during async import
                if (this._loadGeneration !== loadGen) {
                    for (const mesh of result.meshes) mesh.dispose();
                    return false;
                }

                // Restore scene camera state — GLB importer may have corrupted it
                if (savedActiveCameras) {
                    this.scene!.activeCameras = savedActiveCameras;
                }
                if (this.scene!.cameras.length > cameraCountBefore) {
                    const added = this.scene!.cameras.slice(cameraCountBefore);
                    for (const cam of added) cam.dispose();
                }
                (this.scene! as any).activeCamera = null;

                // Build weapon structure matching MD3 output:
                // root TransformNode + flat meshes array
                const weaponNode = new TransformNode(`weapon_${weaponName}`, this.scene!);
                const glbRoot = result.meshes[0];
                glbRoot.parent = weaponNode;
                if (glbRoot.rotationQuaternion) glbRoot.rotationQuaternion = null;

                // Apply weapon-specific GLB model orientation
                if (weaponName === 'blade') {
                    // Blade: flip barrel + tilt upward for melee carry
                    glbRoot.rotation.x = Math.PI;
                    glbRoot.rotation.y = 0.9;
                } else if (weaponName === 'voltaic') {
                    // Voltaic: Blender/Sketchfab export, already Y-up
                    glbRoot.rotation.set(0, 0, 0);
                } else {
                    // IQM→GLB weapons need TWO coordinate fixes:
                    // 1. z_up_to_y_up in converter: Z-up → Y-up (scope on top)
                    // 2. Y rotation here: barrel from +X → -Z (pointing forward)
                    glbRoot.rotation.set(0, -Math.PI / 2, 0);
                }
                // NOTE: GLB root may have scl:(1,1,-1) from Blender export — keep it,
                // the negative Z is needed for correct orientation. Use backFaceCulling=false
                // on materials to handle the flipped winding order.

                const glbMeshes: any[] = [];
                // Convert shared PBR materials to StandardMaterial ONCE per material
                const convertedMaterials = new Map<string, StandardMaterial>();
                const pbrMaterialsToDispose: any[] = [];

                for (const mesh of result.meshes) {
                    if (mesh.rotationQuaternion) mesh.rotationQuaternion = null;

                    // For blade: convert PBR → StandardMaterial (hand-tuned emissive textures)
                    // For guns: keep PBR material as-is, just boost environment for self-lit look
                    if (mesh.material && mesh.material.getClassName() === 'PBRMaterial') {
                        const pbr = mesh.material as any;

                        if (weaponName === 'blade') {
                            // Blade uses StandardMaterial with custom emissive
                            const matId = pbr.uniqueId || pbr.name;
                            if (!convertedMaterials.has(matId)) {
                                const stdMat = new StandardMaterial(`${pbr.name}_std`, this.scene!);
                                stdMat.disableLighting = true;
                                stdMat.diffuseColor = new Color3(1, 1, 1);

                                let albedoTex = pbr.albedoTexture;
                                if (!albedoTex) {
                                    const baseColorPath = `data/models/weapons/${weaponName}/textures/${weaponName}_BaseColor.png`;
                                    albedoTex = new Texture(baseColorPath, this.scene!);
                                }
                                stdMat.diffuseTexture = albedoTex;
                                stdMat.emissiveTexture = pbr.emissiveTexture || albedoTex;
                                stdMat.emissiveColor = new Color3(1, 1, 1);
                                stdMat.backFaceCulling = false;
                                convertedMaterials.set(matId, stdMat);

                                // Null out PBR texture refs before disposal
                                pbr.albedoTexture = null;
                                pbr.emissiveTexture = null;
                                pbr.metallicTexture = null;
                                pbr.reflectivityTexture = null;
                                pbr.microSurfaceTexture = null;
                                pbr.bumpTexture = null;
                                pbr.ambientTexture = null;
                                pbrMaterialsToDispose.push(pbr);

                                console.log(`[WeaponViewManager] Blade: converted PBR "${pbr.name}" → StandardMaterial`);
                            }
                            mesh.material = convertedMaterials.get(matId)!;
                        } else {
                            // Gun-type weapons: keep PBR material for proper metallic/roughness
                            // The albedo texture looks red without PBR shading — metallic/roughness
                            // interaction is what makes it look orange/metallic on Sketchfab
                            pbr.environmentIntensity = 2.0;
                            pbr.directIntensity = 1.0;
                            pbr.backFaceCulling = false;
                            console.log(`[WeaponViewManager] Gun: keeping PBR "${pbr.name}" (env=${pbr.environmentIntensity})`);
                        }
                    }

                    // Ensure ALL meshes have weapon layer mask
                    mesh.renderingGroupId = 1;
                    mesh.layerMask = WEAPON_LAYER_MASK;

                    // Include all meshes with geometry; only skip the root if it's
                    // a bare TransformNode (Blender/Sketchfab-style GLBs). IQM-converted
                    // GLBs may have the geometry on meshes[0] itself.
                    if (mesh !== glbRoot || (mesh.getTotalVertices && mesh.getTotalVertices() > 0)) {
                        glbMeshes.push(mesh);
                    }
                }

                // Dispose old PBR materials for blade (texture refs already nulled)
                for (const pbr of pbrMaterialsToDispose) {
                    pbr.dispose(false, false);
                }

                // Set currentWeapon to match MD3LoadResult shape, then fall through
                // to the shared setup code below (parenting, layerMask, position, etc.)
                this.currentWeapon = {
                    root: weaponNode,
                    meshes: glbMeshes,
                    model: { header: { name: weaponName, numSurfaces: glbMeshes.length, numFrames: 1, numTags: 0, numSkins: 0, filesize: 0, ident: 0, version: 0, framesOffset: 0, tagsOffset: 0, surfacesOffset: 0, eofOffset: 0 }, frames: [], tags: [], surfaces: [] },
                    getTag: () => null,
                } as any;

                isGlbWeapon = true;
                console.log(`[WeaponViewManager] GLB meshes loaded: ${weaponName} (${glbMeshes.length} meshes)`);
                // FALL THROUGH to shared weapon setup below ↓
            } catch (e) {
                console.error(`[WeaponViewManager] Failed to load GLB: ${modelPath}`, e);
                return false;
            }
        }

        // === MD3 MODEL LOADING (only when not loaded via GLB above) ===
        if (!isGlbWeapon) {
            // Check if a newer load started while we were loading PK3/model data
            if (this._loadGeneration !== loadGen) {
                console.log(`[WeaponViewManager] MD3 load for '${weaponName}' superseded (gen ${loadGen} < ${this._loadGeneration})`);
                return false;
            }

            // Check if model exists
            if (!pk3.hasFile(modelPath)) {
                console.error(`[WeaponViewManager] Model not found: ${modelPath}`);
                console.log('[WeaponViewManager] Available files:', pk3.listDirectory(weaponDir));
                return false;
            }

            // Debug: show which PK3 this model is actually loading from
            const sourcePk3 = (pk3 as any).fileIndex?.get(modelPath.toLowerCase().replace(/\\/g, '/'));
            console.log(`[WeaponViewManager] Loading model ${modelPath} from PK3: ${sourcePk3 || 'unknown'}`);

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

            // Load texture — route through PK3TextureLoader for unified KTX/TGA/PNG/JPG
            // handling with caching. Same texture instance is shared with pickup models.
            let textureLoaded = false;
            const texLoader = PK3TextureLoader.getInstance();

            // Try weapon-specific texture path first
            const weaponTexPath = `${weaponDir}/${weaponName}`;
            const diffuseTex = await texLoader.resolveAndLoadTexture(weaponTexPath);

            if (diffuseTex) {
                for (const mesh of this.currentWeapon.meshes) {
                    const mat = new StandardMaterial(`${weaponName}_mat`, this.scene!);
                    mat.specularColor.set(0.2, 0.2, 0.2);
                    mat.backFaceCulling = true;
                    mat.diffuseTexture = diffuseTex;
                    mesh.material = mat;
                }
                console.log(`[WeaponViewManager] Loaded texture via PK3TextureLoader: ${weaponTexPath}`);
                textureLoaded = true;
            } else {
                // Fallback: scan directory for any suitable image
                const pk3 = PK3Loader.getInstance();
                const dirFiles = pk3.listDirectory(weaponDir);
                const imageFile = dirFiles.find(f => {
                    const lower = f.toLowerCase();
                    return (lower.endsWith('.ktx') || lower.endsWith('.jpg') || lower.endsWith('.tga') ||
                        lower.endsWith('.png') || lower.endsWith('.jpeg')) &&
                        !lower.includes('_flash') && !lower.includes('_hand') &&
                        !lower.includes('_norm') && !lower.includes('_gloss');
                });
                if (imageFile) {
                    const fullPath = `${weaponDir}/${imageFile}`;
                    const fallbackTex = await texLoader.resolveAndLoadTexture(fullPath);
                    if (fallbackTex) {
                        for (const mesh of this.currentWeapon.meshes) {
                            const mat = new StandardMaterial(`${weaponName}_mat`, this.scene!);
                            mat.specularColor.set(0.2, 0.2, 0.2);
                            mat.backFaceCulling = true;
                            mat.diffuseTexture = fallbackTex;
                            mesh.material = mat;
                        }
                        console.log(`[WeaponViewManager] Loaded texture (fallback scan): ${fullPath}`);
                        textureLoaded = true;
                    }
                }
            }

            // --- Load normal map (_norm) and gloss map (_gloss) ---
            if (textureLoaded) {
                const normTex = await texLoader.resolveAndLoadTexture(`${weaponDir}/${weaponName}_norm`);
                if (normTex) {
                    for (const mesh of this.currentWeapon.meshes) {
                        const mat = mesh.material as StandardMaterial;
                        if (mat) {
                            mat.bumpTexture = normTex;
                            // MD3 UVs are V-flipped (1.0 - v) to convert from Quake's
                            // bottom-left origin. The normal map texture was authored for
                            // the original (non-flipped) UV space, so we need to:
                            // 1. Flip bump texture V sampling to match the flipped mesh UVs
                            // 2. Invert tangent space axes to correct the bump direction
                            (normTex as Texture).vScale = -1;
                            (normTex as Texture).vOffset = 1;
                            mat.invertNormalMapX = true;
                            mat.invertNormalMapY = true;
                        }
                    }
                    console.log(`[WeaponViewManager] Loaded normal map for ${weaponName}`);
                }

                const glossTex = await texLoader.resolveAndLoadTexture(`${weaponDir}/${weaponName}_gloss`);
                if (glossTex) {
                    for (const mesh of this.currentWeapon.meshes) {
                        const mat = mesh.material as StandardMaterial;
                        if (mat) {
                            mat.specularTexture = glossTex;
                            mat.specularColor.set(0.6, 0.6, 0.6);
                        }
                    }
                    console.log(`[WeaponViewManager] Loaded gloss map for ${weaponName}`);
                }
            }

            if (!textureLoaded) {
                console.warn(`[WeaponViewManager] No texture found for weapon: ${weaponName}`);
                console.log(`[WeaponViewManager] Searched in: ${weaponDir}`, pk3.listDirectory(weaponDir));
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
        }

        // === SHARED SETUP (runs for both MD3 and GLB weapons) ===
        if (!this.currentWeapon) {
            console.error('[WeaponViewManager] No weapon loaded');
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

        // Apply position — GLB weapons use their viewModel offsets,
        // MD3 weapons reset to default hip position
        if (isGlbWeapon && weaponDef?.viewModel) {
            const vm = weaponDef.viewModel;
            this.currentPosition = {
                offset: new Vector3(vm.hipOffset.x, vm.hipOffset.y, vm.hipOffset.z),
                rotation: new Vector3(vm.hipRotation.x, vm.hipRotation.y, vm.hipRotation.z),
                scale: vm.scale,
            };
        } else {
            this.currentPosition = DEFAULT_POSITIONS.hip;
        }
        this.applyPosition(this.currentPosition);

        // Apply weapon outlines if enabled
        this.applyWeaponOutlines();

        console.log(`[WeaponViewManager] Loaded weapon: ${weaponName} (${isGlbWeapon ? 'GLB' : 'MD3'})`);

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

    // ==================== Weapon Outlines ====================

    /**
     * Apply or remove renderOutline on all weapon meshes
     */
    public applyWeaponOutlines(): void {
        if (!this.currentWeapon) return;

        // GLB models are scaled much larger than MD3 (e.g. 30x), so outlines
        // appear proportionally thicker. Divide by root scale to normalize.
        const rootScale = this.currentWeapon.root.scaling.x || 1;
        const adjustedWidth = this._weaponOutlineWidth / rootScale;

        for (const mesh of this.currentWeapon.meshes) {
            mesh.renderOutline = this._weaponOutlineEnabled;
            mesh.outlineWidth = adjustedWidth;
            mesh.outlineColor = this._weaponOutlineColor;
        }
    }

    public setWeaponOutlineEnabled(enabled: boolean): void {
        this._weaponOutlineEnabled = enabled;
        this.applyWeaponOutlines();
    }

    public setWeaponOutlineWidth(width: number): void {
        // Cvar is 0-100 scale, Babylon expects small values (divide by 100)
        this._weaponOutlineWidth = Math.max(0.001, Math.min(1.0, width / 100));
        this.applyWeaponOutlines();
    }

    public setWeaponOutlineColor(r: number, g: number, b: number): void {
        this._weaponOutlineColor = new Color3(
            Math.max(0, Math.min(1, r)),
            Math.max(0, Math.min(1, g)),
            Math.max(0, Math.min(1, b))
        );
        this.applyWeaponOutlines();
    }

    public setWeaponOutlineColorFromString(colorStr: string): void {
        const parts = colorStr.trim().split(/\s+/).map(Number);
        if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
            this.setWeaponOutlineColor(parts[0], parts[1], parts[2]);
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

            // Debug CVar overrides (non-zero = override weapon def)
            const hipX = mv.get('cl_wep_hip_x');
            const hipY = mv.get('cl_wep_hip_y');
            const hipZ = mv.get('cl_wep_hip_z');
            const wepScale = mv.get('cl_wep_scale');

            const effectiveY = hipY !== 0 ? hipY : pos.offset.y;
            const effectiveZ = hipZ !== 0 ? hipZ : pos.offset.z;
            const effectiveScale = wepScale !== 0 ? wepScale : pos.scale;

            // Apply position with dynamic handedness (hipX overrides handedness if set)
            root.position.set(
                hipX !== 0 ? hipX : handOffset,
                effectiveY,
                effectiveZ
            );
            root.rotation.copyFrom(pos.rotation);
            root.scaling.setAll(effectiveScale);

            // Store effective base position for bob to use
            this.effectiveBasePosition.set(
                hipX !== 0 ? hipX : handOffset,
                effectiveY,
                effectiveZ
            );
        } catch {
            // Fallback if MovementVars not available
            root.position.set(handOffset, pos.offset.y, pos.offset.z);
            root.rotation.copyFrom(pos.rotation);
            root.scaling.setAll(pos.scale);
            this.effectiveBasePosition.set(handOffset, pos.offset.y, pos.offset.z);
        }

        if (this.debugEnabled) {
            console.log(`[WeaponViewManager] Position: (${root.position.x.toFixed(3)}, ${root.position.y.toFixed(3)}, ${root.position.z.toFixed(3)}) scale=${root.scaling.x}`);
        }
    }

    public enableDebug(enabled: boolean): void {
        this.debugEnabled = enabled;
    }

    /**
     * Update per frame (for animations, sway, CVar changes)
     */
    public update(deltaTime: number): void {
        // Process switch animation state transitions (even if no weapon loaded yet)
        this.updateSwitchAnimation();

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

        // Update hitscan effects (fade, cleanup)
        getHitscanEffects().update(deltaTime);

        // Update slash trail effect
        this.updateSlashTrail();
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
        const adsTime = this.currentWeaponDef?.ads?.time || mv.get('cl_ads_time');

        // Lerp ADS progress based on aim state
        // Force ADS off during reload
        const adsSpeed = 1.0 / Math.max(0.05, adsTime);  // Inverse of time = speed
        const targetAds = (state.isAiming && !this.reloadState.active) ? 1.0 : 0.0;
        const adsLerp = Math.min(1.0, deltaTime * adsSpeed);
        this.adsProgress += (targetAds - this.adsProgress) * adsLerp;

        // Get ADS target position from weapon def (or use CVar fallback)
        const defAdsOffset = this.currentWeaponDef?.viewModel?.adsOffset;
        // Debug CVar overrides for ADS (non-zero = override)
        const adsOverX = mv.get('cl_wep_ads_x');
        const adsOverY = mv.get('cl_wep_ads_y');
        const adsOverZ = mv.get('cl_wep_ads_z');
        const adsTargetX = adsOverX !== 0 ? adsOverX : (defAdsOffset ? defAdsOffset.x : 0);
        const adsTargetY = adsOverY !== 0 ? adsOverY : (defAdsOffset ? defAdsOffset.y : (basePos.y + mv.get('cl_ads_offset_y')));
        const adsTargetZ = adsOverZ !== 0 ? adsOverZ : (defAdsOffset ? defAdsOffset.z : basePos.z);

        // Lerp all axes from hip position toward ADS target
        const adsX = basePos.x + (adsTargetX - basePos.x) * this.adsProgress;
        const adsY = (adsTargetY - basePos.y) * this.adsProgress;  // Delta from base
        const adsZ = (adsTargetZ - basePos.z) * this.adsProgress;  // Delta from base

        // === Blade charge effects ===
        const isBladeCharging = state.isAiming && this.currentWeaponDef?.meleeRadius;
        let chargeShakeX = 0, chargeShakeY = 0;

        if (isBladeCharging) {
            const now = performance.now();
            if (!this.chargeActive) {
                // Just started charging — save current outline state
                this.chargeActive = true;
                this.chargeStartTime = now;
                this.savedOutlineWidth = this._weaponOutlineWidth;
                this.savedOutlineColor = this._weaponOutlineColor.clone();
                this.savedOutlineEnabled = this._weaponOutlineEnabled;
            }

            // Calculate charge progress (0-1 over chargeTime)
            const chargeTime = (this.currentWeaponDef?.chargeTime || 1.0) * 1000; // ms
            const elapsed = now - this.chargeStartTime;
            this.chargeProgress = Math.min(1.0, elapsed / chargeTime);

            // Shake: sinusoidal noise, intensity scales with charge
            const shakeIntensity = this.chargeProgress * 2.5; // max 2.5 units at full charge
            const shakeFreq = 20 + this.chargeProgress * 30; // faster shake as charge builds
            chargeShakeX = Math.sin(now * 0.001 * shakeFreq) * shakeIntensity;
            chargeShakeY = Math.cos(now * 0.001 * shakeFreq * 1.3) * shakeIntensity * 0.7;

            // Red pulsing outline
            const outlineMin = 0.3, outlineMax = 0.8;
            const scaledWidth = outlineMin + this.chargeProgress * (outlineMax - outlineMin);
            const rootScale = this.currentWeapon.root.scaling.x || 1;
            const pulseRate = 4 + this.chargeProgress * 8; // faster pulse at higher charge
            const pulse = 0.6 + 0.4 * Math.sin(now * 0.001 * pulseRate * Math.PI * 2);
            const red = new Color3(1.0 * pulse, 0.1 * pulse, 0.05 * pulse);

            for (const mesh of this.currentWeapon.meshes) {
                mesh.renderOutline = true;
                mesh.outlineWidth = scaledWidth / rootScale;
                mesh.outlineColor = red;
            }
        } else if (this.chargeActive) {
            // Charge released — restore original outline state
            this.chargeActive = false;
            this.chargeProgress = 0;
            this._weaponOutlineWidth = this.savedOutlineWidth;
            this._weaponOutlineColor = this.savedOutlineColor;
            this._weaponOutlineEnabled = this.savedOutlineEnabled;
            this.applyWeaponOutlines();
        }

        // Get reload animation offsets
        const reloadOffsets = this.getReloadAnimationOffsets();

        // Get switch animation offsets
        const switchOffsets = this.getSwitchAnimationOffsets();

        // Get slash animation offsets (melee weapons)
        const slashOffsets = this.getSlashAnimationOffsets();

        // Apply position offset (bob + jump/land + ADS + recoil + reload + switch + charge shake + slash)
        root.position.set(
            adsX + this.currentBobOffsetX + reloadOffsets.xOffset + switchOffsets.xOffset + chargeShakeX + slashOffsets.xOffset,
            basePos.y + this.currentBobOffsetY + this.jumpLandBobCurrent + adsY + reloadOffsets.yOffset + switchOffsets.yOffset + chargeShakeY + slashOffsets.yOffset,
            basePos.z + adsZ + reloadOffsets.zOffset - this.recoilOffset + switchOffsets.zOffset + slashOffsets.zOffset
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
            baseRot.x + (this.currentSprintTilt * sprintFactor * Math.PI / 180) + reloadOffsets.pitch + slashOffsets.pitch,
            baseRot.y + (this.currentSprintYaw * sprintFactor * Math.PI / 180) + slashOffsets.yaw,
            baseRot.z + (this.currentSprintRoll * sprintFactor * Math.PI / 180) + reloadOffsets.roll + switchOffsets.roll + this.recoilOffset * 0.06 + slashOffsets.roll
        );
    }

    /**
     * Get slash animation offsets for melee weapons.
     * 3-phase animation: windup → swing → return to idle.
     * Uses easeOut for swing (fast start, decel), easeInOut for return.
     */
    private getSlashAnimationOffsets(): {
        xOffset: number; yOffset: number; zOffset: number;
        pitch: number; yaw: number; roll: number;
    } {
        const zero = { xOffset: 0, yOffset: 0, zOffset: 0, pitch: 0, yaw: 0, roll: 0 };
        if (!this.slashState.active) return zero;

        const now = performance.now();
        const elapsed = now - this.slashState.startTime;
        const p = this.slashState.params;
        const totalDuration = p.windupDuration + p.swingDuration + p.returnDuration;

        if (elapsed >= totalDuration) {
            this.slashState.active = false;
            return zero;
        }

        let t: number; // 0-1 interpolation
        let fromPitch: number, fromRoll: number, fromYaw: number;
        let toPitch: number, toRoll: number, toYaw: number;
        let fromX: number, fromY: number, fromZ: number;
        let toX: number, toY: number, toZ: number;

        if (elapsed < p.windupDuration) {
            // Phase 1: Windup — idle to start pose
            t = p.windupDuration > 0 ? elapsed / p.windupDuration : 1;
            t = t * t; // easeIn (accelerate into start)
            fromPitch = 0; fromRoll = 0; fromYaw = 0;
            toPitch = p.startPitch; toRoll = p.startRoll; toYaw = p.startYaw;
            fromX = 0; fromY = 0; fromZ = 0;
            toX = p.startOffset.x; toY = p.startOffset.y; toZ = p.startOffset.z;
        } else if (elapsed < p.windupDuration + p.swingDuration) {
            // Phase 2: Swing — start pose to end pose (fast, easeOut)
            t = (elapsed - p.windupDuration) / p.swingDuration;
            t = 1 - (1 - t) * (1 - t); // easeOut (fast start, decel)
            fromPitch = p.startPitch; fromRoll = p.startRoll; fromYaw = p.startYaw;
            toPitch = p.endPitch; toRoll = p.endRoll; toYaw = p.endYaw;
            fromX = p.startOffset.x; fromY = p.startOffset.y; fromZ = p.startOffset.z;
            toX = p.endOffset.x; toY = p.endOffset.y; toZ = p.endOffset.z;
        } else {
            // Phase 3: Return — end pose back to idle (smooth, easeInOut)
            t = (elapsed - p.windupDuration - p.swingDuration) / p.returnDuration;
            t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOut
            fromPitch = p.endPitch; fromRoll = p.endRoll; fromYaw = p.endYaw;
            toPitch = 0; toRoll = 0; toYaw = 0;
            fromX = p.endOffset.x; fromY = p.endOffset.y; fromZ = p.endOffset.z;
            toX = 0; toY = 0; toZ = 0;
        }

        return {
            xOffset: fromX + (toX - fromX) * t,
            yOffset: fromY + (toY - fromY) * t,
            zOffset: fromZ + (toZ - fromZ) * t,
            pitch: fromPitch + (toPitch - fromPitch) * t,
            yaw: fromYaw + (toYaw - fromYaw) * t,
            roll: fromRoll + (toRoll - fromRoll) * t,
        };
    }

    // === Slash Trail Effect ===
    private slashTrails: {
        tipPoints: Vector3[];
        handlePoints: Vector3[];
        mesh: Mesh | null;
        material: StandardMaterial | null;
        fadeStart: number;         // 0 = still active, >0 = fading
        active: boolean;           // true = collecting points from current slash
    }[] = [];
    private slashTrailWasActive: boolean = false;
    private static readonly SLASH_TRAIL_FADE_MS = 800;

    /**
     * Update slash trail effect — supports multiple concurrent trail instances.
     * Each slash creates a new trail that collects points during animation,
     * then fades independently.
     */
    private updateSlashTrail(): void {
        if (!this.scene || !this.currentWeapon || !this.mainCamera) return;

        const now = performance.now();
        const isSlashing = this.slashState.active;

        // Edge detect: new slash started → create fresh trail instance
        if (isSlashing && !this.slashTrailWasActive) {
            // Finalize any previous active trail (start its fade)
            for (const trail of this.slashTrails) {
                if (trail.active) {
                    trail.active = false;
                    trail.fadeStart = now;
                }
            }
            // Create new trail instance
            this.slashTrails.push({
                tipPoints: [],
                handlePoints: [],
                mesh: null,
                material: null,
                fadeStart: 0,
                active: true,
            });
        }
        this.slashTrailWasActive = isSlashing;

        // Collect points for the active trail
        const activeTrail = this.slashTrails.find(t => t.active);
        if (activeTrail && isSlashing) {
            const cam = this.mainCamera;
            const forward = cam.getDirection(Vector3.Forward());
            const up = cam.getDirection(Vector3.Up());
            const right = cam.getDirection(Vector3.Right());

            const slashOff = this.getSlashAnimationOffsets();

            // Handle (pivot) — barely moves
            const handle = cam.position.clone()
                .addInPlace(forward.scale(15))
                .addInPlace(up.scale(-4))
                .addInPlace(right.scale(2))
                .addInPlace(up.scale(slashOff.yOffset * 0.04))
                .addInPlace(right.scale(slashOff.xOffset * 0.04));

            // Tip — sweeps wide
            const tip = cam.position.clone()
                .addInPlace(forward.scale(28))
                .addInPlace(up.scale(5))
                .addInPlace(right.scale(-2))
                .addInPlace(up.scale(slashOff.yOffset * 0.25))
                .addInPlace(right.scale(slashOff.xOffset * 0.25))
                .addInPlace(forward.scale(slashOff.zOffset * 0.1));

            activeTrail.tipPoints.push(tip);
            activeTrail.handlePoints.push(handle);

            // Build ribbon mesh during animation (visible immediately!)
            if (activeTrail.tipPoints.length >= 2) {
                this.buildTrailMesh(activeTrail);
            }
        }

        // When slash ends, start fading the active trail
        if (!isSlashing && activeTrail) {
            activeTrail.active = false;
            activeTrail.fadeStart = now;
        }

        // Update fading trails + clean up finished ones
        for (let i = this.slashTrails.length - 1; i >= 0; i--) {
            const trail = this.slashTrails[i];
            if (trail.active) continue; // Still collecting points

            if (trail.fadeStart > 0) {
                const fadeProgress = (now - trail.fadeStart) / WeaponViewManager.SLASH_TRAIL_FADE_MS;
                if (fadeProgress >= 1.0) {
                    // Fully faded — dispose and remove
                    if (trail.mesh) trail.mesh.dispose();
                    if (trail.material) trail.material.dispose();
                    this.slashTrails.splice(i, 1);
                } else {
                    // Fade alpha
                    if (trail.material) {
                        trail.material.alpha = 0.7 * (1.0 - fadeProgress);
                    }
                }
            }
        }
    }

    /**
     * Build/rebuild ribbon mesh for a specific trail instance.
     */
    private buildTrailMesh(trail: typeof this.slashTrails[0]): void {
        if (!this.scene || trail.tipPoints.length < 2) return;

        if (trail.mesh) {
            trail.mesh.dispose();
            trail.mesh = null;
        }

        trail.mesh = MeshBuilder.CreateRibbon('slashTrail', {
            pathArray: [trail.tipPoints, trail.handlePoints],
            updatable: false,
            sideOrientation: Mesh.DOUBLESIDE,
        }, this.scene);
        trail.mesh.isPickable = false;

        if (!trail.material) {
            const mat = new StandardMaterial('slashTrailMat', this.scene);
            mat.emissiveColor = new Color3(1.0, 0.15, 0.05);
            mat.diffuseColor = Color3.Black();
            mat.disableLighting = true;
            mat.backFaceCulling = false;
            mat.alpha = 0.7;
            trail.material = mat;
        }
        trail.material.alpha = 0.7;
        trail.mesh.material = trail.material;
    }

    /**
     * Clean up all slash trails.
     */
    private disposeSlashTrail(): void {
        for (const trail of this.slashTrails) {
            if (trail.mesh) trail.mesh.dispose();
            if (trail.material) trail.material.dispose();
        }
        this.slashTrails = [];
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

            // Apply smoothed lighting to weapon materials (all use StandardMaterial now)
            for (const mesh of this.currentWeapon.meshes) {
                const mat = mesh.material as StandardMaterial;
                if (mat?.diffuseColor) {
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

            // Check weapon position override CVars — re-apply if any changed
            const hipX = mv.get('cl_wep_hip_x');
            const hipY = mv.get('cl_wep_hip_y');
            const hipZ = mv.get('cl_wep_hip_z');
            const wepScale = mv.get('cl_wep_scale');
            const wepKey = `${hipX},${hipY},${hipZ},${wepScale}`;
            if (wepKey !== (this as any)._lastWepKey) {
                (this as any)._lastWepKey = wepKey;
                this.applyPosition(this.currentPosition);
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
    public fire(opts?: { isProjectileFire?: boolean }): void {
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

        // Trigger recoil (scaled per weapon — energy guns have very low recoil)
        const recoilScale = this.currentWeaponDef?.recoilScale ?? 1.0;
        this.recoilOffset = WeaponViewManager.RECOIL_KICK * recoilScale;

        // Trigger slash animation for melee weapons (skip for charged projectile fire)
        if (this.currentWeaponDef?.meleeRadius && !opts?.isProjectileFire) {
            const preset = SLASH_PRESETS[this.slashPresetIndex % SLASH_PRESETS.length];
            this.slashPresetIndex++;
            this.slashState = {
                active: true,
                startTime: performance.now(),
                params: preset,
            };
        }

        // Spawn projectile OR hitscan effect
        if (this.mainCamera && this.currentWeaponDef) {
            const origin = this.mainCamera.position.clone();
            const forward = this.mainCamera.getDirection(Vector3.Forward());
            origin.addInPlace(forward.scale(2));  // 2 units in front

            if (this.currentWeaponDef.hitscan && this.currentWeaponDef.hitscanType) {
                // Hitscan weapon → fire visual effect
                const fx = getHitscanEffects();
                const mfColor = this.currentWeaponDef.muzzleFlash?.color;
                const color = mfColor
                    ? new Color3(mfColor.r, mfColor.g, mfColor.b)
                    : undefined;
                const range = this.currentWeaponDef.range ?? 8192;

                switch (this.currentWeaponDef.hitscanType) {
                    case 'tracer':
                        fx.fireTracer({ origin, direction: forward, maxRange: range, color });
                        break;
                    case 'pellet': {
                        // Check ADS state for spread angle
                        const viewportManager = ViewportEffectsManager.getInstance();
                        const pState = viewportManager.getCurrentState();
                        const isAiming = pState.isAiming;
                        const spreadAngle = (isAiming && this.currentWeaponDef.adsSpread !== undefined)
                            ? this.currentWeaponDef.adsSpread
                            : (this.currentWeaponDef.spread ?? 12);
                        fx.firePellets({
                            origin, direction: forward, maxRange: range, color,
                            pelletCount: this.currentWeaponDef.burstCount ?? 20,
                            spreadAngle,
                        });
                        break;
                    }
                    case 'beam':
                        // Beam rendering is handled per-frame by FPSPlayer.updateFiring()
                        // Fire event only triggers muzzle flash (handled below)
                        break;
                    case 'bolt':
                        fx.fireBolt({ origin, direction: forward, maxRange: range, color });
                        break;
                }
            } else if (this.currentWeaponDef.projectileId) {
                // Projectile weapons: visuals now come from server entities (Q3-style)
                // No local prediction needed — server snapshot drives projectile rendering
            }
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

        // Beam rendering — runs AFTER position finalization so barrel position is current-frame
        if (this.beamActive && this.mainCamera) {
            const forward = this.mainCamera.getDirection(Vector3.Forward());
            const muzzlePos = this.getMuzzleWorldPosition();
            if (muzzlePos) {
                getHitscanEffects().updateBeam({
                    origin: muzzlePos,
                    direction: forward,
                    maxRange: this.currentWeaponDef?.range ?? 850,
                    color: this.beamColor,
                });
            }
        }
    }

    /** Called by FPSPlayer to start/stop beam rendering */
    public setBeamActive(active: boolean, color?: Color3): void {
        this.beamActive = active;
        if (color) this.beamColor = color;
        if (!active) {
            getHitscanEffects().stopBeam();
            this.beamChargeProgress = 0;
        } else {
            this.beamChargeProgress = 1;  // fully charged when beam is active
        }
    }

    /** Called by FPSPlayer during beam charge-up (0→1 progress) */
    public setBeamCharging(progress: number): void {
        this.beamChargeProgress = progress;
    }

    // ==================== WEAPON SWITCH ANIMATION ====================

    /**
     * Switch weapon with slide-down / swap / slide-up animation.
     * Cancels any in-progress switch or reload.
     */
    public async switchWeaponAnimated(weaponId: string, pk3Path?: string): Promise<void> {
        // Cancel reload
        this.cancelReload();

        // If already switching to the same weapon, ignore
        if (this.switchState.phase !== 'idle' && this.switchState.pendingWeaponId === weaponId) {
            return;
        }

        // Start (or restart) the switch-down phase
        this.switchState = {
            phase: 'down',
            startTime: performance.now(),
            pendingWeaponId: weaponId,
            pendingPk3Path: pk3Path,
        };
    }

    /**
     * Process switch animation state transitions.
     * Called every frame from update().
     */
    private updateSwitchAnimation(): void {
        const state = this.switchState;
        if (state.phase === 'idle') return;

        const now = performance.now();
        const elapsed = now - state.startTime;

        if (state.phase === 'down') {
            // Wait for slide-down to complete
            if (elapsed >= WeaponViewManager.SWITCH_DOWN_DURATION) {
                // Transition to load phase — swap the model at the bottom
                state.phase = 'load';
                state.startTime = now;

                if (state.pendingWeaponId) {
                    // Load the new weapon model (async, but we start slide-up immediately)
                    this.loadWeapon(state.pendingWeaponId, state.pendingPk3Path).then(() => {
                        // Model loaded — if still in 'load' or 'up' phase, we're good
                        if (this.switchState.pendingWeaponId === state.pendingWeaponId) {
                            // Ensure we transition to 'up' if still in 'load'
                            if (this.switchState.phase === 'load') {
                                this.switchState.phase = 'up';
                                this.switchState.startTime = performance.now();
                            }
                        }
                    });
                }
            }
        } else if (state.phase === 'load') {
            // If loadWeapon is fast (cached), it may have already transitioned to 'up'
            // Otherwise, give it a max wait of 200ms before starting slide-up anyway
            if (elapsed >= 200) {
                state.phase = 'up';
                state.startTime = now;
            }
        } else if (state.phase === 'up') {
            // Wait for slide-up to complete
            if (elapsed >= WeaponViewManager.SWITCH_UP_DURATION) {
                state.phase = 'idle';
                state.pendingWeaponId = null;
            }
        }
    }

    /**
     * Calculate switch animation offsets based on current phase.
     * Returns { yOffset, roll, xOffset, zOffset }
     */
    private getSwitchAnimationOffsets(): { yOffset: number; roll: number; xOffset: number; zOffset: number } {
        const state = this.switchState;
        if (state.phase === 'idle') {
            return { yOffset: 0, roll: 0, xOffset: 0, zOffset: 0 };
        }

        const now = performance.now();
        const elapsed = now - state.startTime;

        if (state.phase === 'down') {
            // Ease-out-cubic: fast start, smooth settle at bottom
            const t = Math.min(1.0, elapsed / WeaponViewManager.SWITCH_DOWN_DURATION);
            const eased = 1 - Math.pow(1 - t, 3);
            return {
                yOffset: eased * WeaponViewManager.SWITCH_Y_DROP,
                roll: eased * WeaponViewManager.SWITCH_ROLL,
                xOffset: 0,
                zOffset: 0,
            };
        }

        if (state.phase === 'load') {
            // Hold at bottom while model loads
            return {
                yOffset: WeaponViewManager.SWITCH_Y_DROP,
                roll: WeaponViewManager.SWITCH_ROLL,
                xOffset: 0,
                zOffset: 0,
            };
        }

        if (state.phase === 'up') {
            // Ease-out-cubic: slides up from bottom to rest position
            const t = Math.min(1.0, elapsed / WeaponViewManager.SWITCH_UP_DURATION);
            const eased = 1 - Math.pow(1 - t, 3);
            return {
                yOffset: WeaponViewManager.SWITCH_Y_DROP * (1 - eased),
                roll: WeaponViewManager.SWITCH_ROLL * (1 - eased),
                xOffset: 0,
                zOffset: 0,
            };
        }

        return { yOffset: 0, roll: 0, xOffset: 0, zOffset: 0 };
    }

    /**
     * Check if currently in a weapon switch animation (blocks firing)
     */
    public isSwitching(): boolean {
        return this.switchState.phase !== 'idle';
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

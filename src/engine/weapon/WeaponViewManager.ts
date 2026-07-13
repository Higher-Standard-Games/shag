/**
 * WeaponViewManager - Manages first-person weapon view models
 *
 * Handles loading, positioning, and displaying weapon models
 * attached to the camera for first-person view.
 */

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { applySafeMaxSimultaneousLights } from "../lighting/DynamicLightSafety";
import { getEntityRegistry, type WeaponDef } from "../../shared/entities";
import { getMD3Loader, MD3Coords, type MD3LoadResult } from "../loader/model/MD3Loader";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { PK3TextureLoader } from "../loader/pk3/PK3TextureLoader";
import { MovementVars } from "../movement/MovementVars";
import { ViewportEffectsManager } from "../viewport/ViewportEffectsManager";
import { AmmoCounterDisplay, parseAmmoCounter } from "./AmmoCounterDisplay";
import { getHitscanEffects } from "./HitscanEffects";
import { getProjectileManager } from "./ProjectileManager";
import { WeaponBarrels } from "./WeaponBarrels";
import { WeaponBob } from "./WeaponBob";
import { WeaponCharge } from "./WeaponCharge";
import { WeaponLighting } from "./WeaponLighting";
import { WeaponRecoil } from "./WeaponRecoil";
import { WeaponReloadAnim } from "./WeaponReloadAnim";
import { WeaponSlash } from "./WeaponSlash";
import { WeaponSwitchAnim } from "./WeaponSwitchAnim";

// Weapon position presets
export interface WeaponPosition {
  offset: Vector3; // Position offset from camera
  rotation: Vector3; // Euler rotation
  scale: number; // Uniform scale
}

// Note: MD3 models are in Quake units (~1 unit = 1 inch)
// Using MD3Coords helpers for proper orientation

// Handedness presets (cg_handedness style)
export const HAND_OFFSETS = {
  right: 12, // Right side of screen
  center: 0, // Centered
  left: -12, // Left side of screen
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

  /** Check if the weapon view manager has been initialized */
  public get isReady(): boolean {
    return this.scene !== null && this.weaponRoot !== null;
  }

  /** Returns true if init() has been called. Guards all demo-side WVM calls. */
  public isInitialized(): boolean {
    return this.scene !== null;
  }

  /**
   * Trigger first-person weapon recoil kick (used by DemoService for spectated fire events).
   */
  public triggerRecoil(scale: number): void {
    this.weaponRecoil.fire(scale, 0);
  }

  /**
   * Weapon bob for demo spectator mode.
   * Not implemented — WeaponBob.update requires a tracked bobCycle and deltaTime
   * from the live FPS controller. Bob during demo playback is a future polish item.
   */
  public updateBob(_hSpeed: number, _velY: number): void {
    // no-op until ViewportEffectsManager is wired for spectator state
  }

  /**
   * Re-parent the weapon camera to a different camera (e.g. SpectatorController's FreeCamera).
   * Updates scene.activeCameras to [newCamera, weaponCamera] so the weapon renders correctly.
   * Call restoreToFPSCamera() when demo playback ends.
   */
  public attachToCamera(camera: FreeCamera): void {
    if (!this.scene || !this.weaponCamera) return;
    this.mainCamera = camera;
    this.weaponCamera.parent = camera;
    // Weapon camera must come after world camera so depth doesn't clobber world geometry
    this.scene.activeCameras = [camera, this.weaponCamera];
  }

  /**
   * Restore weapon camera parent back to the camera passed to init() (live FPS camera).
   * Called when demo playback stops.
   */
  public restoreToFPSCamera(): void {
    if (!this.scene || !this.weaponCamera || !this._initCamera) return;
    this.mainCamera = this._initCamera;
    this.weaponCamera.parent = this._initCamera;
    this.scene.activeCameras = [this._initCamera, this.weaponCamera];
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
    const ads = this.adsProgress; // 0 = hip, 1 = full ADS
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
    const scale = 0.05 * (1 - chargeOrBeam * 0.8); // lerp from 0.05 → 0.01
    const bs = this.weaponBob.state;
    const bobX = bs.bobX * scale;
    const bobY = (bs.bobY + bs.jumpLandBob) * scale;
    const recoilZ = -this.weaponRecoil.offset * scale;

    const origin = this.mainCamera.position.clone();
    origin.addInPlace(forward.scale(fwdOff + recoilZ));
    origin.addInPlace(right.scale(rightOff + bobX));
    origin.addInPlace(up.scale(-downOff + bobY));
    return origin;
  }
  private weaponCamera: FreeCamera | null = null;
  private mainCamera: FreeCamera | null = null; // Main player camera for aim direction
  private _initCamera: FreeCamera | null = null; // Camera passed to init() — used for restore
  private weaponRoot: TransformNode | null = null;
  private currentWeapon: MD3LoadResult | null = null;
  private currentWeaponDef: WeaponDef | null = null; // Entity definition for current weapon
  /**
   * The weapon id the view is currently showing or switching toward. Set by
   * loadWeapon() and switchWeaponAnimated() so the server can reconcile a
   * mispredicted/stuck viewmodel against its authoritative weapon.
   */
  private _intendedWeaponId: string | null = null;
  /**
   * Sticky visibility. setVisible() records it here and every freshly loaded
   * weapon re-applies it — so hiding the viewmodel on death survives the weapon
   * reset to blade (which would otherwise re-show a fresh, enabled mesh).
   */
  private _visible = true;
  private currentPosition: WeaponPosition = DEFAULT_POSITIONS.hip;

  // CVar tracking for live updates
  private lastHandedness: number = 1;
  private lastWeaponFov: number = 60;
  private cvarCheckTimer: number = 0;
  private static readonly CVAR_CHECK_INTERVAL = 0.1; // Check 10x/sec, not every frame

  // Weapon lighting (extracted)
  private weaponLighting = new WeaponLighting();

  // Weapon bob (extracted)
  private weaponBob = new WeaponBob();
  private effectiveBasePosition: Vector3 = Vector3.Zero(); // Base position with handedness

  // ADS (Aiming Down Sights) state
  private adsProgress: number = 0; // 0 = hip, 1 = fully ADS

  // On-weapon ammo counter (Warsow tag_ammo bone + ammoCounter cfg). Only weapons
  // authored with the counter bones + cfg get one; null otherwise.
  private ammoCounter: AmmoCounterDisplay | null = null;
  private displayedAmmo = 0;

  // Muzzle flash state
  private muzzleFlashLight: PointLight | null = null;
  private muzzleFlashModel: TransformNode | null = null; // Flash MD3 model at tag_flash
  private muzzleFlashIntensity: number = 0; // Current flash intensity (fades out)
  private static readonly MUZZLE_FLASH_MAX_INTENSITY = 15.0; // Peak brightness
  private static readonly MUZZLE_FLASH_DECAY = 150.0; // How fast it fades (higher = faster)
  private static readonly MUZZLE_FLASH_OPACITY = 0.75; // Max opacity (0.75 = 75% visible)
  private static readonly MUZZLE_FLASH_RANGE = 30; // Light range in units

  // Beam state (set by FPSPlayer, rendered here after position is finalized)
  private beamActive: boolean = false;
  private beamColor: Color3 = new Color3(1.0, 0.7, 0.1);
  private beamChargeProgress: number = 0; // 0 = not charging, 1 = fully charged

  // Weapon recoil (extracted)
  private weaponRecoil = new WeaponRecoil();

  // Barrel sub-models (spinning chambers)
  private weaponBarrels = new WeaponBarrels();

  // Blade charge (extracted)
  private weaponCharge = new WeaponCharge();

  // Slash animation (extracted)
  private weaponSlash = new WeaponSlash();

  // Reload animation (extracted)
  private reloadAnim = new WeaponReloadAnim();

  // Weapon switch animation (extracted)
  private switchAnim = new WeaponSwitchAnim();

  // Babylon scene render observer — stored so re-init on a fresh scene
  // can detach the previous observer (prevents stale per-frame update()
  // calls on the previous scene).
  private updateObserver: Observer<Scene> | null = null;

  // Debug
  private debugEnabled: boolean = false;

  // Weapon outline state (r_cel_weapon_* cvars)
  private _weaponOutlineEnabled = true;
  private _weaponOutlineWidth = 0.15; // Actual Babylon value (cvar is *100 scale, default 15)
  private _weaponOutlineColor = new Color3(0, 0, 0);

  // Load generation counter — prevents concurrent loadWeapon calls from clobbering each other
  private _loadGeneration: number = 0;

  private constructor() {}

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
    // Detach previous-scene observer before swapping `this.scene` so a re-init
    // on a fresh scene doesn't leave a callback attached to the previous one.
    if (this.updateObserver && this.scene && this.scene !== scene) {
      this.scene.onBeforeRenderObservable.remove(this.updateObserver);
      this.updateObserver = null;
    }
    this.scene = scene;
    this.mainCamera = camera; // Store for aim direction
    this._initCamera = camera; // Store for restoreToFPSCamera()

    // Initialize MD3 loader
    getMD3Loader().init(scene);

    // Initialize projectile manager
    getProjectileManager().init(scene);

    // Get initial weapon FOV from CVar
    try {
      const mv = MovementVars.getInstance();
      this.lastWeaponFov = mv.get("cg_weaponfov");
    } catch {
      this.lastWeaponFov = 90;
    }

    // Create weapon camera with separate FOV
    // This camera only sees weapon layer and renders after main camera
    this.weaponCamera = new FreeCamera("weaponCamera", camera.position.clone(), scene);
    this.weaponCamera.fov = (this.lastWeaponFov * Math.PI) / 180;
    this.weaponCamera.minZ = 0.1;
    this.weaponCamera.maxZ = 1000;
    this.weaponCamera.layerMask = WEAPON_LAYER_MASK; // Only sees weapon layer
    this.weaponCamera.parent = camera; // Follows main camera

    // Main camera should not see weapon layer
    camera.layerMask = camera.layerMask & ~WEAPON_LAYER_MASK;

    // Set up multi-camera rendering
    scene.activeCameras = [camera, this.weaponCamera];

    // Create weapon root node attached to weapon camera
    this.weaponRoot = new TransformNode("weaponView", scene);
    this.weaponRoot.parent = this.weaponCamera;

    // Configure rendering group 1 for weapons:
    // - Clear depth buffer before rendering (prevents wall clipping)
    // - Keep color buffer (world is already rendered)
    // Args: (groupId, autoClear, depth, stencil)
    scene.setRenderingAutoClearDepthStencil(1, true, true, false);

    // Add dedicated weapon light for PBR GLB models
    // Only affects rendering group 1 (weapons), not the world
    const weaponLight = new HemisphericLight("weaponLight", new Vector3(0.3, 1, 0.5), scene);
    weaponLight.intensity = 1.2;
    weaponLight.diffuse = new Color3(1.0, 0.95, 0.9); // Slightly warm white
    weaponLight.groundColor = new Color3(0.3, 0.3, 0.35); // Cool fill from below

    // Initialize hitscan effects system
    getHitscanEffects().init(scene);

    // Create the muzzle-flash light EAGERLY and keep it permanently enabled,
    // parked at intensity 0. Creating it lazily on the first shot (or toggling
    // setEnabled per shot) changes the scene's enabled-light set → material
    // defines change → synchronous shader recompiles → first-shot hitch and
    // walls flickering invisible while their new effect compiles.
    if (this.muzzleFlashLight) this.muzzleFlashLight.dispose();
    this.muzzleFlashLight = new PointLight("muzzleFlash", Vector3.Zero(), scene);
    this.muzzleFlashLight.intensity = 0;
    this.muzzleFlashLight.range = WeaponViewManager.MUZZLE_FLASH_RANGE;

    // Register update loop. Previous-scene observer (if any) is already
    // detached above before `this.scene` was swapped.
    this.updateObserver = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000;
      this.update(deltaTime);
    });

    console.log(`[WeaponViewManager] Initialized with weapon FOV ${this.lastWeaponFov}°`);
  }

  /**
   * Load a weapon from pk3
   * @param weaponName - Either a weapon ID (looks up in registry) or folder name
   */
  public async loadWeapon(weaponName: string, pk3Path?: string): Promise<boolean> {
    if (!this.scene || !this.weaponRoot) {
      console.error("[WeaponViewManager] Not initialized");
      return false;
    }

    // Track the weapon the view is committing to (for server reconciliation).
    this._intendedWeaponId = weaponName;

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
    const modelPath = weaponDef?.viewModel?.modelPath ?? `models/weapons/${weaponName}/${weaponName}.md3`;
    const weaponDir = `models/weapons/${weaponName}`;

    // Load the weapon model (GLB or MD3)
    let isGlbWeapon = false;
    if (weaponDef?.viewModel?.viewModelFormat === "glb") {
      const ok = await this.loadGlbWeapon(weaponName, modelPath, loadGen);
      if (!ok) return false;
      isGlbWeapon = true;
    } else {
      const ok = await this.loadMd3Weapon(weaponName, modelPath, weaponDir, weaponDef, pk3, loadGen);
      if (!ok) return false;
    }

    // Shared final setup (parenting, layer mask, position, outlines)
    return this.setupWeapon(weaponName, isGlbWeapon, weaponDef);
  }

  // ==================== GLB Weapon Loading ====================

  /**
   * Load a GLB weapon model via Babylon SceneLoader.
   * Sets this.currentWeapon on success.
   */
  private async loadGlbWeapon(weaponName: string, modelPath: string, loadGen: number): Promise<boolean> {
    console.log(`[WeaponViewManager] GLB path — loading ${weaponName}, modelPath: ${modelPath}`);

    const { SceneLoader } = await import("@babylonjs/core/Loading/sceneLoader");
    await import("@babylonjs/loaders/glTF");

    // Check if a newer load started while we were importing modules
    if (this._loadGeneration !== loadGen) {
      console.log(
        `[WeaponViewManager] GLB load for '${weaponName}' superseded (gen ${loadGen} < ${this._loadGeneration})`,
      );
      return false;
    }

    // Remove previous weapon before loading new one
    this.disposeAmmoCounter();
    if (this.currentWeapon) {
      this.currentWeapon.root.dispose();
      this.currentWeapon = null;
    }
    // Clear previous barrel sub-models
    this.weaponBarrels.dispose();

    try {
      const lastSlash = modelPath.lastIndexOf("/");
      const dir = modelPath.substring(0, lastSlash + 1);
      const file = modelPath.substring(lastSlash + 1);

      // Save scene state — SceneLoader can add cameras/lights and set
      // scene.activeCamera, which breaks our dual-camera weapon rendering.
      const savedActiveCameras = this.scene!.activeCameras ? [...this.scene!.activeCameras] : null;
      const cameraCountBefore = this.scene!.cameras.length;

      const result = await SceneLoader.ImportMeshAsync("", dir, file, this.scene!);

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
      if (weaponName === "blade") {
        // Blade: flip barrel + tilt upward for melee carry
        glbRoot.rotation.x = Math.PI;
        glbRoot.rotation.y = 0.9;
      } else if (weaponName === "voltaic") {
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
        if (mesh.material && mesh.material.getClassName() === "PBRMaterial") {
          const pbr = mesh.material as any;

          if (weaponName === "blade") {
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
            applySafeMaxSimultaneousLights(pbr); // Prevent shader overflow from projectile PointLights
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

      // Set currentWeapon to match MD3LoadResult shape
      this.currentWeapon = {
        root: weaponNode,
        meshes: glbMeshes,
        model: {
          header: {
            name: weaponName,
            numSurfaces: glbMeshes.length,
            numFrames: 1,
            numTags: 0,
            numSkins: 0,
            filesize: 0,
            ident: 0,
            version: 0,
            framesOffset: 0,
            tagsOffset: 0,
            surfacesOffset: 0,
            eofOffset: 0,
          },
          frames: [],
          tags: [],
          surfaces: [],
        },
        getTag: () => null,
      } as any;

      console.log(`[WeaponViewManager] GLB meshes loaded: ${weaponName} (${glbMeshes.length} meshes)`);

      // Load barrel sub-models if defined
      if (this.currentWeaponDef?.barrels?.length) {
        this.weaponBarrels.load(
          this.currentWeaponDef.barrels,
          glbRoot,
          weaponName,
          this.scene!,
          loadGen,
          () => this._loadGeneration,
        );
      }

      // Build the on-weapon ammo counter if this model is authored for one.
      this.setupAmmoCounter(weaponName, glbRoot, loadGen).catch(() => {});

      return true;
    } catch (e) {
      console.error(`[WeaponViewManager] Failed to load GLB: ${modelPath}`, e);
      return false;
    }
  }

  // ==================== MD3 Weapon Loading ====================

  /**
   * Load an MD3 weapon model from PK3 archives.
   * Handles textures (diffuse/normal/gloss) and muzzle flash model.
   * Sets this.currentWeapon on success.
   */
  private async loadMd3Weapon(
    weaponName: string,
    modelPath: string,
    weaponDir: string,
    weaponDef: WeaponDef | null | undefined,
    pk3: PK3Loader,
    loadGen: number,
  ): Promise<boolean> {
    // Check if a newer load started while we were loading PK3/model data
    if (this._loadGeneration !== loadGen) {
      console.log(
        `[WeaponViewManager] MD3 load for '${weaponName}' superseded (gen ${loadGen} < ${this._loadGeneration})`,
      );
      return false;
    }

    // Check if model exists
    if (!pk3.hasFile(modelPath)) {
      console.error(`[WeaponViewManager] Model not found: ${modelPath}`);
      console.log("[WeaponViewManager] Available files:", pk3.listDirectory(weaponDir));
      return false;
    }

    // Debug: show which PK3 this model is actually loading from
    const sourcePk3 = (pk3 as any).fileIndex?.get(modelPath.toLowerCase().replace(/\\/g, "/"));
    console.log(`[WeaponViewManager] Loading model ${modelPath} from PK3: ${sourcePk3 || "unknown"}`);

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
      console.error("[WeaponViewManager] Failed to create meshes");
      return false;
    }

    // Load textures
    await this.loadMd3Textures(weaponName, weaponDir);

    // Load muzzle flash model (e.g., plasmagun_flash.md3)
    await this.loadMuzzleFlashModel(weaponName, weaponDef, pk3, md3);

    return true;
  }

  /**
   * Load diffuse, normal, and gloss textures for an MD3 weapon.
   */
  private async loadMd3Textures(weaponName: string, weaponDir: string): Promise<void> {
    if (!this.currentWeapon) return;

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
      const imageFile = dirFiles.find((f) => {
        const lower = f.toLowerCase();
        return (
          (lower.endsWith(".ktx") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".tga") ||
            lower.endsWith(".png") ||
            lower.endsWith(".jpeg")) &&
          !lower.includes("_flash") &&
          !lower.includes("_hand") &&
          !lower.includes("_norm") &&
          !lower.includes("_gloss")
        );
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

    // Load normal map (_norm) and gloss map (_gloss)
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
      console.log(`[WeaponViewManager] Searched in: ${weaponDir}`, PK3Loader.getInstance().listDirectory(weaponDir));
    }
  }

  /**
   * Load the muzzle flash MD3 model and position it at tag_flash.
   */
  private async loadMuzzleFlashModel(
    weaponName: string,
    weaponDef: WeaponDef | null | undefined,
    pk3: PK3Loader,
    md3: ReturnType<typeof getMD3Loader>,
  ): Promise<void> {
    if (!this.currentWeapon) return;

    const flashModelPath =
      weaponDef?.viewModel?.flashModelPath ?? `models/weapons/${weaponName}/${weaponName}_flash.md3`;
    if (!pk3.hasFile(flashModelPath)) return;

    const flashData = await pk3.getFile(flashModelPath);
    if (!flashData) return;

    try {
      const flashMd3 = md3.parseMD3(flashData);
      const flashResult = md3.createMeshes(flashMd3, `${weaponName}_flash`);
      if (!flashResult) return;

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
      const flashTag = this.currentWeapon.getTag("tag_flash");
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
    } catch (e) {
      console.warn(`[WeaponViewManager] Failed to load flash model: ${flashModelPath}`, e);
    }
  }

  private updateMuzzleFlashLightScope(): void {
    if (!this.muzzleFlashLight || !this.currentWeapon) return;

    const meshes: AbstractMesh[] = [...this.currentWeapon.meshes];
    if (this.muzzleFlashModel) {
      meshes.push(...this.muzzleFlashModel.getChildMeshes());
    }
    this.muzzleFlashLight.includedOnlyMeshes = meshes;
  }
  // ==================== Shared Weapon Setup ====================

  /**
   * Final setup after loading a weapon (GLB or MD3):
   * parenting, layer mask, position, and outlines.
   */
  private setupWeapon(weaponName: string, isGlbWeapon: boolean, weaponDef: WeaponDef | null | undefined): boolean {
    if (!this.currentWeapon) {
      console.error("[WeaponViewManager] No weapon loaded");
      return false;
    }

    // Parent to weapon root
    this.currentWeapon.root.parent = this.weaponRoot;

    // Re-apply sticky visibility — a weapon loaded while the view is hidden
    // (e.g. the death reset to blade) must stay hidden until setVisible(true).
    this.currentWeapon.root.setEnabled(this._visible);

    // Set rendering group and layer mask for each mesh
    // - renderingGroupId 1: renders after world with depth cleared
    // - layerMask: only visible to weapon camera (separate FOV)
    for (const mesh of this.currentWeapon.meshes) {
      mesh.renderingGroupId = 1;
      mesh.layerMask = WEAPON_LAYER_MASK;
    }
    this.updateMuzzleFlashLightScope();

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

    console.log(`[WeaponViewManager] Loaded weapon: ${weaponName} (${isGlbWeapon ? "GLB" : "MD3"})`);

    return true;
  }

  /**
   * Set weapon position
   */
  public setPosition(preset: "hip" | "ads" | "lowered" | WeaponPosition): void {
    if (typeof preset === "string") {
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
   * Current ADS blend, 0 = hip-fire, 1 = fully aimed. Drives the crosshair's
   * COD-style converge-to-center (Crosshair.update).
   */
  public getAdsProgress(): number {
    return this.adsProgress;
  }

  /**
   * Toggle weapon visibility
   */
  public setVisible(visible: boolean): void {
    this._visible = visible;
    if (this.currentWeapon) {
      this.currentWeapon.root.setEnabled(visible);
    }
  }

  /**
   * Clear current weapon
   */
  public clear(): void {
    this.disposeAmmoCounter();
    if (this.currentWeapon) {
      this.currentWeapon.root.dispose();
      this.currentWeapon = null;
    }
  }

  // ==================== On-weapon Ammo Counter ====================

  /**
   * Push the live ammo count for the on-weapon counter. Cheap to call every
   * frame — the display only repaints when the number changes. No-op for weapons
   * without a counter.
   */
  public setAmmoCount(ammo: number): void {
    this.displayedAmmo = ammo;
    this.ammoCounter?.setAmmo(ammo);
  }

  private disposeAmmoCounter(): void {
    this.ammoCounter?.dispose();
    this.ammoCounter = null;
  }

  /**
   * Build the on-weapon ammo counter if this weapon is authored for it: its model
   * has a `tag_ammo` anchor and its `.cfg` carries an `ammoCounter` directive.
   * Fire-and-forget — a missing anchor/cfg just means no counter (most weapons).
   */
  private async setupAmmoCounter(weaponName: string, glbRoot: TransformNode, loadGen: number): Promise<void> {
    try {
      const cfgPath = `/data/models/weapons/${weaponName}/${weaponName}.cfg`;
      const res = await fetch(cfgPath);
      if (!res.ok) {
        console.log(`[AmmoCounter] no cfg for ${weaponName} (${res.status}) — skipping`);
        return;
      }
      const config = parseAmmoCounter(await res.text());
      if (!config) return; // weapon declares no ammoCounter — normal for most guns
      console.log(`[AmmoCounter] ${weaponName}: cfg ammoCounter =`, config);

      // A newer load may have superseded us while awaiting the cfg.
      if (loadGen !== this._loadGeneration || !this.scene) return;

      // The counter mounts to the `tag_ammo` anchor. GLB tags import as either
      // TransformNodes (nodes) or skeleton bones depending on the exporter, so
      // search both; fall back to the units-digit tag.
      const anchor = this.findWeaponTag(glbRoot, ["tag_ammo", "tag_ammo_digit_1"]);
      if (!anchor) {
        const tagNames = glbRoot
          .getDescendants(false)
          .map((n) => n.name)
          .filter((n) => n.startsWith("tag_"));
        console.warn(
          `[AmmoCounter] ${weaponName}: ammoCounter cfg present but no tag_ammo anchor found. tags seen: [${tagNames.join(", ")}]`,
        );
        return;
      }

      this.disposeAmmoCounter();
      this.ammoCounter = new AmmoCounterDisplay(this.scene, anchor, config);
      this.ammoCounter.setAmmo(this.displayedAmmo);
      // Log the anchor's world transform — a near-zero scale (invisible speck) or
      // wildly off position is the usual reason a mounted counter can't be seen.
      anchor.computeWorldMatrix(true);
      const wp = anchor.getAbsolutePosition();
      const ws = anchor.absoluteScaling;
      console.log(
        `[AmmoCounter] ${weaponName}: mounted on "${anchor.name}" worldPos=(${wp.x.toFixed(2)},${wp.y.toFixed(2)},${wp.z.toFixed(2)}) worldScale=(${ws.x.toFixed(3)},${ws.y.toFixed(3)},${ws.z.toFixed(3)}) planeLocalSize=${(config.digitWidth * 3).toFixed(2)}x${config.digitHeight.toFixed(2)}`,
      );
    } catch (e) {
      console.warn(`[AmmoCounter] ${weaponName}: setup failed`, e);
    }
  }

  /** Resolve a weapon attachment tag by name — as a TransformNode child or a
   *  skeleton bone's linked node — searching within the loaded weapon's tree. */
  private findWeaponTag(glbRoot: TransformNode, names: string[]): TransformNode | null {
    const descendants = glbRoot.getDescendants(false);
    for (const name of names) {
      const node = descendants.find((n) => n.name === name);
      if (node && node instanceof TransformNode) return node;
    }
    if (this.scene) {
      for (const name of names) {
        for (const skeleton of this.scene.skeletons) {
          const bone = skeleton.bones.find((b) => b.name === name);
          const boneNode = bone?.getTransformNode();
          if (boneNode) return boneNode;
        }
      }
    }
    return null;
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
      Math.max(0, Math.min(1, b)),
    );
    this.applyWeaponOutlines();
  }

  public setWeaponOutlineColorFromString(colorStr: string): void {
    const parts = colorStr.trim().split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((n) => !Number.isNaN(n))) {
      this.setWeaponOutlineColor(parts[0], parts[1], parts[2]);
    }
  }

  private applyPosition(pos: WeaponPosition): void {
    if (!this.currentWeapon) return;

    const root = this.currentWeapon.root;

    // Get handedness from CVar: 0=left, 1=right, 2=center
    let handOffset = HAND_OFFSETS.right; // Default
    try {
      const mv = MovementVars.getInstance();
      const hand = mv.get("cg_handedness");
      handOffset = hand === 0 ? HAND_OFFSETS.left : hand === 2 ? HAND_OFFSETS.center : HAND_OFFSETS.right;

      // Debug CVar overrides (non-zero = override weapon def)
      const hipX = mv.get("cl_wep_hip_x");
      const hipY = mv.get("cl_wep_hip_y");
      const hipZ = mv.get("cl_wep_hip_z");
      const wepScale = mv.get("cl_wep_scale");

      const effectiveY = hipY !== 0 ? hipY : pos.offset.y;
      const effectiveZ = hipZ !== 0 ? hipZ : pos.offset.z;
      const effectiveScale = wepScale !== 0 ? wepScale : pos.scale;

      // Apply position with dynamic handedness (hipX overrides handedness if set)
      root.position.set(hipX !== 0 ? hipX : handOffset, effectiveY, effectiveZ);
      root.rotation.copyFrom(pos.rotation);
      root.scaling.setAll(effectiveScale);

      // Store effective base position for bob to use
      this.effectiveBasePosition.set(hipX !== 0 ? hipX : handOffset, effectiveY, effectiveZ);
    } catch {
      // Fallback if MovementVars not available
      root.position.set(handOffset, pos.offset.y, pos.offset.z);
      root.rotation.copyFrom(pos.rotation);
      root.scaling.setAll(pos.scale);
      this.effectiveBasePosition.set(handOffset, pos.offset.y, pos.offset.z);
    }

    if (this.debugEnabled) {
      console.log(
        `[WeaponViewManager] Position: (${root.position.x.toFixed(3)}, ${root.position.y.toFixed(3)}, ${root.position.z.toFixed(3)}) scale=${root.scaling.x}`,
      );
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
      // Re-apply ammo-counter tuning cvars so edits take effect live.
      this.ammoCounter?.applyTuning();
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
    this.weaponSlash.updateTrail(this.scene, this.mainCamera);
  }

  /**
   * Update weapon bob animation synced with view bob
   */
  private updateWeaponBob(deltaTime: number): void {
    if (!this.currentWeapon || !this.weaponRoot) return;

    // Get player state from viewport manager
    const viewportManager = ViewportEffectsManager.getInstance();
    const state = viewportManager.getCurrentState();

    // Delegate walk bob, sprint tilt, jump/land to WeaponBob
    this.weaponBob.update(
      deltaTime,
      state.isGrounded,
      state.horizontalSpeed,
      state.velocity.y,
      state.landingVelocity ?? 0,
      state.bobCycle ?? 0,
      this.reloadAnim.isReloading,
      this.adsProgress,
      this.effectiveBasePosition.x,
    );
    const bob = this.weaponBob.state;

    // Apply to weapon root (on top of base position with handedness)
    const root = this.currentWeapon.root;
    const basePos = this.effectiveBasePosition;

    // === ADS (Aiming Down Sights) ===
    const mv = MovementVars.getInstance();
    const adsTime = this.currentWeaponDef?.ads?.time || mv.get("cl_ads_time");

    // Lerp ADS progress based on aim state
    // Force ADS off during reload
    const adsSpeed = 1.0 / Math.max(0.05, adsTime); // Inverse of time = speed
    const targetAds = state.isAiming && !this.reloadAnim.isReloading ? 1.0 : 0.0;
    const adsLerp = Math.min(1.0, deltaTime * adsSpeed);
    this.adsProgress += (targetAds - this.adsProgress) * adsLerp;

    // Get ADS target position from weapon def (or use CVar fallback)
    const defAdsOffset = this.currentWeaponDef?.viewModel?.adsOffset;
    // Debug CVar overrides for ADS (non-zero = override)
    const adsOverX = mv.get("cl_wep_ads_x");
    const adsOverY = mv.get("cl_wep_ads_y");
    const adsOverZ = mv.get("cl_wep_ads_z");
    const adsTargetX = adsOverX !== 0 ? adsOverX : defAdsOffset ? defAdsOffset.x : 0;
    const adsTargetY =
      adsOverY !== 0 ? adsOverY : defAdsOffset ? defAdsOffset.y : basePos.y + mv.get("cl_ads_offset_y");
    const adsTargetZ = adsOverZ !== 0 ? adsOverZ : defAdsOffset ? defAdsOffset.z : basePos.z;

    // Lerp all axes from hip position toward ADS target
    const adsX = basePos.x + (adsTargetX - basePos.x) * this.adsProgress;
    const adsY = (adsTargetY - basePos.y) * this.adsProgress; // Delta from base
    const adsZ = (adsTargetZ - basePos.z) * this.adsProgress; // Delta from base

    // === Blade charge effects (delegated) ===
    const isBladeCharging = !!(state.isAiming && this.currentWeaponDef?.meleeRadius);
    const chargeResult = this.weaponCharge.update(
      isBladeCharging,
      this.currentWeaponDef?.chargeTime || 1.0,
      this.currentWeapon.meshes,
      this.currentWeapon.root.scaling.x,
      this._weaponOutlineWidth,
      this._weaponOutlineColor,
      this._weaponOutlineEnabled,
    );
    const chargeShakeX = chargeResult.shake.x;
    const chargeShakeY = chargeResult.shake.y;

    if (chargeResult.needsOutlineRestore) {
      this._weaponOutlineWidth = chargeResult.savedWidth;
      this._weaponOutlineColor = chargeResult.savedColor;
      this._weaponOutlineEnabled = chargeResult.savedEnabled;
      this.applyWeaponOutlines();
    }

    // Get reload animation offsets
    const reloadOffsets = this.getReloadAnimationOffsets();

    // Get switch animation offsets
    const switchOffsets = this.getSwitchAnimationOffsets();

    // Get slash animation offsets (melee weapons)
    const slashOffsets = this.weaponSlash.getOffsets();

    // Apply position offset (bob + jump/land + ADS + recoil + reload + switch + charge shake + slash)
    root.position.set(
      adsX + bob.bobX + reloadOffsets.xOffset + switchOffsets.xOffset + chargeShakeX + slashOffsets.xOffset,
      basePos.y +
        bob.bobY +
        bob.jumpLandBob +
        adsY +
        reloadOffsets.yOffset +
        switchOffsets.yOffset +
        chargeShakeY +
        slashOffsets.yOffset,
      basePos.z +
        adsZ +
        reloadOffsets.zOffset -
        this.weaponRecoil.offset +
        switchOffsets.zOffset +
        slashOffsets.zOffset,
    );

    // Apply rotation (base + sprint: pitch X, yaw Y, roll Z + reload roll)
    // Reduce sprint effects when ADS (weapon should be more stable)
    // FIX: Plasmagun is rotated -90 Y.
    // - Local X aligns with World Z (Roll).
    // - Local Z aligns with World X (Pitch).
    // So recoil pitch must be applied to Z!
    const sprintFactor = 1.0 - this.adsProgress * 0.8; // 80% reduction when fully ADS
    const baseRot = this.currentPosition.rotation;
    root.rotation.set(
      baseRot.x +
        (bob.sprintTilt * sprintFactor * Math.PI) / 180 +
        reloadOffsets.pitch +
        slashOffsets.pitch -
        this.weaponRecoil.pitchOffset,
      baseRot.y + (bob.sprintYaw * sprintFactor * Math.PI) / 180 + slashOffsets.yaw,
      baseRot.z +
        (bob.sprintRoll * sprintFactor * Math.PI) / 180 +
        reloadOffsets.roll +
        switchOffsets.roll +
        this.weaponRecoil.offset * 0.06 +
        slashOffsets.roll,
    );
  }

  private updateLightingFromBsp(deltaTime: number): void {
    if (!this.currentWeapon || !this.scene) return;
    this.weaponLighting.update(deltaTime, this.scene, this.currentWeapon.meshes);
  }

  private checkCVarChanges(): void {
    try {
      const mv = MovementVars.getInstance();

      // Check handedness
      const currentHand = mv.get("cg_handedness");
      if (currentHand !== this.lastHandedness) {
        this.lastHandedness = currentHand;
        this.applyPosition(this.currentPosition);
        console.log(`[WeaponViewManager] Handedness changed to ${currentHand}`);
      }

      // Check weapon position override CVars — re-apply if any changed
      const hipX = mv.get("cl_wep_hip_x");
      const hipY = mv.get("cl_wep_hip_y");
      const hipZ = mv.get("cl_wep_hip_z");
      const wepScale = mv.get("cl_wep_scale");
      const wepKey = `${hipX},${hipY},${hipZ},${wepScale}`;
      if (wepKey !== (this as any)._lastWepKey) {
        (this as any)._lastWepKey = wepKey;
        this.applyPosition(this.currentPosition);
      }

      // Check weapon FOV
      const currentFov = mv.get("cg_weaponfov");
      if (currentFov !== this.lastWeaponFov && this.weaponCamera) {
        this.lastWeaponFov = currentFov;
        this.weaponCamera.fov = (currentFov * Math.PI) / 180;
        console.log(`[WeaponViewManager] Weapon FOV changed to ${currentFov}°`);
      }
    } catch (e) {
      // MovementVars not available
      if (this.debugEnabled) {
        console.warn("[WeaponViewManager] CVar check failed:", e);
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
        for (const m of this.muzzleFlashModel.getChildMeshes()) {
          m.visibility = WeaponViewManager.MUZZLE_FLASH_OPACITY;
        }
      }
    }

    // Trigger recoil (scaled per weapon — energy guns have very low recoil)
    // ADS reduces recoil significantly (steadier aim)
    const recoilScale = this.currentWeaponDef?.recoilScale ?? 1.0;
    this.weaponRecoil.fire(recoilScale, this.adsProgress);

    // Trigger slash animation for melee weapons (skip for charged projectile fire)
    if (this.currentWeaponDef?.meleeRadius && !opts?.isProjectileFire) {
      this.weaponSlash.trigger();
    }

    // Spawn projectile OR hitscan effect
    if (this.mainCamera && this.currentWeaponDef) {
      const origin = this.mainCamera.position.clone();
      const forward = this.mainCamera.getDirection(Vector3.Forward());
      origin.addInPlace(forward.scale(2)); // 2 units in front

      if (this.currentWeaponDef.hitscan && this.currentWeaponDef.hitscanType) {
        // Hitscan weapon → fire visual effect
        const fx = getHitscanEffects();
        const mfColor = this.currentWeaponDef.muzzleFlash?.color;
        const color = mfColor ? new Color3(mfColor.r, mfColor.g, mfColor.b) : undefined;
        const range = this.currentWeaponDef.range ?? 8192;

        switch (this.currentWeaponDef.hitscanType) {
          case "tracer":
            fx.fireTracer({ origin, direction: forward, maxRange: range, color });
            break;
          case "pellet": {
            // Check ADS state for spread angle
            const viewportManager = ViewportEffectsManager.getInstance();
            const pState = viewportManager.getCurrentState();
            const isAiming = pState.isAiming;
            const spreadAngle =
              isAiming && this.currentWeaponDef.adsSpread !== undefined
                ? this.currentWeaponDef.adsSpread
                : (this.currentWeaponDef.spread ?? 12);
            fx.firePellets({
              origin,
              direction: forward,
              maxRange: range,
              color,
              pelletCount: this.currentWeaponDef.burstCount ?? 20,
              spreadAngle,
            });
            break;
          }
          case "beam":
            // Beam rendering is handled per-frame by FPSPlayer.updateFiring()
            // Fire event only triggers muzzle flash (handled below)
            break;
          case "bolt":
            fx.fireBolt({ origin, direction: forward, maxRange: range, color });
            break;
        }
      } else if (this.currentWeaponDef.projectileId) {
        // Projectile weapons: visuals now come from server entities (Q3-style)
        // No local prediction needed — server snapshot drives projectile rendering
      }
    }

    // Update light (created eagerly in init(); fallback covers legacy init paths).
    // Intensity-only control — never setEnabled(), which would change material
    // defines and trigger shader recompilation (first-shot flicker bug).
    if (!this.muzzleFlashLight) {
      this.muzzleFlashLight = new PointLight("muzzleFlash", Vector3.Zero(), this.scene!);
      this.updateMuzzleFlashLightScope();
    }

    const color = flashDef?.color ?? { r: 1.0, g: 0.8, b: 0.3 };
    const range = flashDef?.range ?? WeaponViewManager.MUZZLE_FLASH_RANGE;
    this.muzzleFlashLight.diffuse = new Color3(color.r, color.g, color.b);
    this.muzzleFlashLight.specular = new Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5);
    this.muzzleFlashLight.range = range;
    this.muzzleFlashLight.intensity = 1.0;
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
      if (this.muzzleFlashModel?.isEnabled()) {
        const opacity = normalizedIntensity * WeaponViewManager.MUZZLE_FLASH_OPACITY;
        if (this.muzzleFlashModel instanceof TransformNode) {
          for (const m of this.muzzleFlashModel.getChildMeshes()) {
            m.visibility = opacity;
          }
        }

        if (this.muzzleFlashIntensity <= 0) {
          this.muzzleFlashModel.setEnabled(false);
        }
      }

      // Update light intensity and position. Fades to intensity 0 and STAYS
      // enabled — toggling setEnabled changes material defines → shader
      // recompile flicker (see init()).
      if (this.muzzleFlashLight) {
        this.muzzleFlashLight.intensity = normalizedIntensity;

        if (this.muzzleFlashIntensity > 0) {
          // Update position if attached to tag
          const tag = this.currentWeapon?.getTag("tag_flash");
          if (tag && this.weaponRoot) {
            const localPos = tag.origin;
            const worldPos = Vector3.TransformCoordinates(localPos, this.weaponRoot.getWorldMatrix());
            this.muzzleFlashLight.position = worldPos;
          }
        }
      }
    }

    // Update recoil ramp + recovery (delegated)
    this.weaponRecoil.update(deltaTime);

    // Spin barrel sub-models
    this.weaponBarrels.update(deltaTime);

    // Beam rendering — runs AFTER position finalization so barrel position is current-frame
    if (this.beamActive && this.mainCamera) {
      const forward = this.mainCamera.getDirection(Vector3.Forward());
      const muzzlePos = this.getMuzzleWorldPosition();
      if (muzzlePos) {
        const cfg = {
          origin: muzzlePos,
          direction: forward,
          maxRange: this.currentWeaponDef?.range ?? 850,
          color: this.beamColor,
        };
        // Chain-lightning weapons (voltaic) render a jagged bolt; others a smooth beam.
        if (this.currentWeaponDef?.chainCount) {
          getHitscanEffects().updateLightningBeam(cfg);
        } else {
          getHitscanEffects().updateBeam(cfg);
        }
      }
    }
  }

  /** Called by FPSPlayer to start/stop beam rendering */
  public setBeamActive(active: boolean, color?: Color3): void {
    this.beamActive = active;
    if (color) this.beamColor = color;
    if (!active) {
      // Stop both beam styles — cheap no-op for whichever isn't active.
      getHitscanEffects().stopBeam();
      getHitscanEffects().stopLightning();
      this.beamChargeProgress = 0;
    } else {
      this.beamChargeProgress = 1; // fully charged when beam is active
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
    this.reloadAnim.cancel();

    // Track the target immediately so reconciliation sees where the view is headed.
    this._intendedWeaponId = weaponId;
    this.switchAnim.start(weaponId, pk3Path);
  }

  /**
   * The weapon id the view is currently showing or switching toward. Used by the
   * server-reconciliation path to detect (and heal) a mispredicted/stuck viewmodel.
   * Returns null before any weapon has been loaded.
   */
  public getDisplayedWeaponId(): string | null {
    return this._intendedWeaponId;
  }

  /**
   * Process switch animation state transitions.
   * Called every frame from update().
   */
  private updateSwitchAnimation(): void {
    this.switchAnim.update(async (id, pk3) => {
      await this.loadWeapon(id, pk3);
    });
  }

  /**
   * Calculate switch animation offsets based on current phase.
   */
  private getSwitchAnimationOffsets(): { yOffset: number; roll: number; xOffset: number; zOffset: number } {
    return this.switchAnim.getOffsets();
  }

  /**
   * Check if currently in a weapon switch animation (blocks firing)
   */
  public isSwitching(): boolean {
    return this.switchAnim.isSwitching;
  }

  // ==================== RELOAD ANIMATION ====================

  /**
   * Start reload animation
   * @param _duration - Reload time from weapon def
   */
  public startReload(_duration: number): void {
    this.reloadAnim.start(_duration);
  }

  /**
   * Cancel reload animation (e.g., weapon switch)
   */
  public cancelReload(): void {
    this.reloadAnim.cancel();
  }

  /**
   * Check if currently reloading
   */
  public isReloading(): boolean {
    return this.reloadAnim.isReloading;
  }

  /**
   * Get reload progress (0-1)
   */
  public getReloadProgress(): number {
    return this.reloadAnim.progress;
  }

  /**
   * Calculate reload animation offsets based on progress
   */
  private getReloadAnimationOffsets(): {
    roll: number;
    pitch: number;
    xOffset: number;
    yOffset: number;
    zOffset: number;
  } {
    return this.reloadAnim.getOffsets();
  }
}

// Convenience function
export function getWeaponViewManager(): WeaponViewManager {
  return WeaponViewManager.getInstance();
}

/**
 * WeaponViewManager - Manages first-person weapon view models
 *
 * Handles loading, positioning, and displaying weapon models
 * attached to the camera for first-person view.
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import "@babylonjs/core/Culling/ray";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
// Side effect: registers the OutlineRenderer scene component — required for
// mesh.renderOutline (weapon outline / charge flash) to draw.
import "@babylonjs/core/Rendering/outlineRenderer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import "@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader"; // enable .tga glow maps
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { getEntityRegistry, type WeaponDef } from "../../shared/entities";
import { canonicalWeaponId } from "../../shared/entities/definitions/weapons/WeaponsTable";
import { fireIntervalTicks } from "../../shared/entities/WeaponDef";
import { DEFAULT_PHYSICS_TICK_RATE } from "../../shared/server/simulation/physics/constants";
import { logRejection } from "../core/AsyncErrors";
import { devLog } from "../core/DevLog";
import {
  applySafeMaxSimultaneousLights,
  clampMaterialLightCap,
  getSafeMaxSimultaneousLights,
} from "../lighting/DynamicLightSafety";
import { getMD3Loader, MD3Coords, type MD3LoadResult } from "../loader/model/MD3Loader";
import { readIndexedModelAsset, resolveModelAsset } from "../loader/model/ModelAsset";
import { ModelInstanceCache } from "../loader/model/ModelInstanceCache";
import type { ModelLoadResult } from "../loader/model/ModelLoader";
import { disposeModelResources } from "../loader/model/ModelSourceCache";
import { PK3Loader } from "../loader/pk3/PK3Loader";
import { PK3TextureLoader } from "../loader/pk3/PK3TextureLoader";
import { MovementVars } from "../movement/MovementVars";
import { installWeaponCameraCandidates } from "../rendering/WeaponCameraCandidates";
import { ViewportEffectsManager } from "../viewport/ViewportEffectsManager";
import { AmmoCounterDisplay, parseAmmoCounter } from "./AmmoCounterDisplay";
import { createBladeEnvironment } from "./BladeEnvironment";
import { getHitscanEffects, serverPelletDirections } from "./HitscanEffects";
import { getProjectileManager } from "./ProjectileManager";
import { WeaponBarrels } from "./WeaponBarrels";
import { WeaponBob } from "./WeaponBob";
import { WeaponCharge } from "./WeaponCharge";
import { WeaponHolsterAnim } from "./WeaponHolsterAnim";
import { WeaponLighting } from "./WeaponLighting";
import { WeaponRecoil } from "./WeaponRecoil";
import { WeaponReloadAnim } from "./WeaponReloadAnim";
import { WeaponSlash } from "./WeaponSlash";
import { WeaponSwitchAnim } from "./WeaponSwitchAnim";

/** Our own shot as the server fired it (`weapon_fire`). */
export interface LocalShot {
  origin: Vector3;
  /** The shot's direction, spread included. */
  direction: Vector3;
  /** A pellet shot's seed and cone, to rebuild the server's pellets. */
  pelletSeed?: number;
  pelletSpread?: number;
}

// Weapon position presets
export interface WeaponPosition {
  offset: Vector3; // Position offset from camera
  rotation: Vector3; // Euler rotation
  scale: number; // Uniform scale
}

/** The watched player's movement, for their weapon's sway (demo playback and live spectating). */
export interface FollowedWeaponBobInput {
  deltaTime: number;
  grounded: boolean;
  horizontalSpeed: number;
  velocityY: number;
  landingVelocity: number;
  bobCycle: number;
  /** Whether they are aiming down sights (holding alt fire). */
  aiming?: boolean;
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

/** Underwater viewmodel drift — slow enough to read as buoyancy, not as sway. */
const WEAPON_FLOAT_HZ = 0.35;
/** Peak drift in world units. Small: the gun floats, it does not swim away. */
const WEAPON_FLOAT_AMPLITUDE = 0.55;
/** Constant droop, so the weapon also hangs a little heavier in the water. */
const WEAPON_FLOAT_SAG = 0.35;

export class WeaponViewManager {
  private static instance: WeaponViewManager;
  private static readonly IDENTITY_MATRIX = Matrix.Identity();

  private scene: Scene | null = null;

  /** Check if the weapon view manager has been initialized */
  public get isReady(): boolean {
    // A map unload disposes every scene node, this view's root included,
    // while the instance itself lives on. That view is not ready; init() rebuilds it.
    return this.scene !== null && this.weaponRoot !== null && !this.weaponRoot.isDisposed();
  }

  /** Playback diagnostics: initialization alone does not prove a gun was loaded. */
  public get isWeaponModelLoaded(): boolean {
    return !!this.currentWeapon && !this.currentWeapon.root.isDisposed() && this.currentWeapon.meshes.length > 0;
  }

  /** Returns true if init() has been called. Guards all demo-side WVM calls. */
  public isInitialized(): boolean {
    return this.scene !== null;
  }

  /**
   * Weapon bob for a watched player, in demo playback or live spectating.
   * Driven from their movement instead of the local viewport state.
   */
  public updateFollowedBob(input: FollowedWeaponBobInput): void {
    this.followedBobActive = true;
    this.followedAiming = input.aiming ?? false;
    this.weaponBob.update(
      input.deltaTime,
      input.grounded,
      input.horizontalSpeed,
      input.velocityY,
      input.landingVelocity,
      input.bobCycle,
      this.reloadAnim.isReloading,
      this.adsProgress,
      this.effectiveBasePosition.x,
    );
  }

  /** Return weapon bob ownership to the live FPS viewport-effects path. */
  public clearFollowedBob(): void {
    this.followedBobActive = false;
    this.followedAiming = false;
    this.weaponBob.reset();
  }

  /**
   * Re-assert this instance's camera pair as the scene's active cameras.
   * Needed when another WeaponViewManager instance (demo playback) shared the
   * scene and rewrote `scene.activeCameras` — after it is disposed, the live
   * instance calls this to render again. Each instance only ever binds the
   * camera it was init()ed with; there is no cross-instance camera swapping.
   */
  public reassertCameras(): void {
    if (!this.scene || !this.weaponCamera || !this.mainCamera) return;
    // Weapon camera must come after world camera so depth doesn't clobber world geometry
    this.scene.activeCameras = [this.mainCamera, this.weaponCamera];
  }

  /**
   * Get the world-space position of the gun barrel/muzzle (for beam origin etc.)
   *
   * The weapon is rendered in a separate camera layer (weaponCamera).
   * weaponRoot.position is in weapon-camera-local space, which mirrors
   * mainCamera orientation. Transform through mainCamera's world matrix
   * to get main-scene world-space coordinates.
   */
  public getMuzzleWorldPosition(distance = 5): Vector3 | null {
    if (!this.mainCamera) return null;

    // Effects can sample between input/FOV changes and the camera render.
    // getTransformationMatrix() only multiplies cached matrices in Babylon.
    this.mainCamera.getViewMatrix(true);
    this.mainCamera.getProjectionMatrix(true);

    // The viewmodel is rendered by a second camera with its own FOV. Project
    // the authored model socket through that camera, then cast the matching
    // screen ray through the world camera. Any point on that ray is pixel-exact
    // with tag_flash even when cg_weaponfov differs from the gameplay FOV.
    if (this.muzzleSocket && this.weaponCamera && this.scene) {
      this.weaponCamera.getViewMatrix(true);
      this.weaponCamera.getProjectionMatrix(true);
      this.muzzleSocket.computeWorldMatrix(true);
      const socketWorld = this.muzzleSocket.getAbsolutePosition();
      const engine = this.scene.getEngine();
      const viewport = this.weaponCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
      const screen = Vector3.Project(
        socketWorld,
        WeaponViewManager.IDENTITY_MATRIX,
        this.weaponCamera.getTransformationMatrix(),
        viewport,
      );
      if (Number.isFinite(screen.x + screen.y + screen.z)) {
        const ray = this.scene.createPickingRay(
          screen.x,
          screen.y,
          WeaponViewManager.IDENTITY_MATRIX,
          this.mainCamera,
          false,
        );
        return this.mainCamera.globalPosition.add(ray.direction.scale(distance));
      }
    }

    // Defensive fallback for an incomplete/legacy model without a muzzle tag.
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

    // Underwater the weapon stops being a firing platform and starts being a
    // heavy object held in a current: a slow figure-of-eight drift, well below
    // the frequency of bob, plus a little sag. Presentation only — nothing
    // here reaches the shot, which still goes exactly where the crosshair is.
    const submersion = this.submersionAmount;
    let floatRight = 0;
    let floatUp = 0;
    if (submersion > 0) {
      const t = performance.now() / 1000;
      floatRight = Math.sin(t * WEAPON_FLOAT_HZ * Math.PI * 2) * WEAPON_FLOAT_AMPLITUDE * submersion;
      // Twice the rate on the vertical axis traces a lazy figure-of-eight
      // rather than a circle, which reads as buoyancy instead of a wobble.
      const vertical = Math.sin(t * WEAPON_FLOAT_HZ * Math.PI * 4) * WEAPON_FLOAT_AMPLITUDE;
      floatUp = (vertical - WEAPON_FLOAT_SAG) * submersion;
    }

    const origin = this.mainCamera.globalPosition.clone();
    origin.addInPlace(forward.scale(fwdOff + recoilZ));
    origin.addInPlace(right.scale(rightOff + bobX + floatRight));
    origin.addInPlace(up.scale(-downOff + bobY + floatUp));
    if (distance !== 5) {
      const eye = this.mainCamera.globalPosition;
      return eye.add(origin.subtract(eye).normalize().scale(distance));
    }
    return origin;
  }

  /**
   * Presentation-only start for a nearby shot travelling along the local view.
   * Ownership is not on the projectile wire yet, so keep the existing bounded
   * proximity/direction heuristic, but use this view's camera and authored socket.
   */
  public getProjectileMuzzlePosition(position: Vector3, velocity: Vector3): Vector3 | null {
    if (!this.mainCamera || !this.currentWeapon || !this._visible || this.holsterAnim.isFullyHolstered) return null;
    this.mainCamera.getViewMatrix(true);
    if (Vector3.Distance(position, this.mainCamera.globalPosition) > 120) return null;
    const speed = velocity.length();
    if (speed <= 1 || Vector3.Dot(velocity, this.mainCamera.getDirection(Vector3.Forward())) / speed < 0.7) return null;
    // A world projectile needs more depth than a beam endpoint to avoid drawing
    // its mesh/trail across the near plane. Projection still matches tag_flash.
    return this.getMuzzleWorldPosition(34);
  }

  /**
   * How submerged the camera is, 0-1, supplied by the game.
   *
   * A plain number rather than a reference to the liquid system: the engine
   * must not know the FPS game exists, and "how wet is the view" is the only
   * thing a viewmodel needs from it.
   */
  public submersionAmount = 0;
  private weaponCamera: FreeCamera | null = null;
  private releaseWeaponCandidates: (() => void) | null = null;
  private weaponLight: HemisphericLight | null = null;
  private bladeLight: DirectionalLight | null = null;
  private bladeEnvironment: RawCubeTexture | null = null;
  private mainCamera: FreeCamera | null = null; // The camera this instance was init()ed with
  private weaponRoot: TransformNode | null = null;
  private currentWeapon: MD3LoadResult | null = null;
  private glbSources: ModelInstanceCache | null = null;
  private currentGlbResources: ModelLoadResult | null = null;
  private muzzleSocket: TransformNode | null = null;
  /** Additive emissive glow map for the current weapon (WO-EB1), disposed on swap. */
  private currentGlowTexture: Texture | null = null;
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
  /**
   * Transient hide for a movement state that occupies both hands (climbing).
   *
   * Deliberately separate from {@link _visible}: the two have different owners
   * and different lifetimes. Death and spectating own the sticky flag, movement
   * owns this one, and folding them together would hand a player who died
   * mid-climb their gun back the moment the climb ended.
   */
  private _movementHidden = false;
  private currentPosition: WeaponPosition = DEFAULT_POSITIONS.hip;

  // CVar tracking for live updates
  private lastHandedness: number = 1;
  private lastWeaponFov: number = 60;
  /** The weapon position override CVars last applied, as `x,y,z,scale`. */
  private _lastWepKey: string | undefined;
  private cvarCheckTimer: number = 0;
  private static readonly CVAR_CHECK_INTERVAL = 0.1; // Check 10x/sec, not every frame

  // Weapon lighting (extracted)
  private weaponLighting = new WeaponLighting();

  // Weapon bob (extracted)
  private weaponBob = new WeaponBob();
  private followedBobActive = false;
  /** A watched player's aim, standing in for local input while they are followed. */
  private followedAiming = false;
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
  private holsterAnim = new WeaponHolsterAnim();

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
  /** Gameplay-owned outline override (currently Quad Damage). */
  private _powerupOutlineActive = false;
  private _powerupOutlineWidth = 0.24;
  private _powerupOutlineColor = new Color3(1, 0.18, 0.025);

  // Load generation counter — prevents concurrent loadWeapon calls from clobbering each other
  private _loadGeneration: number = 0;

  /**
   * The LIVE gameplay instance. The class is instantiable (QA-8): demo
   * playback constructs its OWN `new WeaponViewManager()` bound to the
   * spectator camera via init(), so starting/stopping a demo can never touch
   * the live viewmodel (the `demoplay stop` destruction bug).
   */
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
    // Re-init is expected when returning from a cold-start demo to live play.
    // Release the prior camera/root/observer even when Babylon keeps the same
    // Scene instance, otherwise every join adds another per-frame update.
    this.disposeViewInfrastructure();
    this.scene = scene;
    // A rebuilt view shows nothing until a weapon is loaded into it; keeping
    // the old id would make the next load look like a no-op.
    this._intendedWeaponId = null;
    this.currentWeaponDef = null;
    this._visible = true;
    this._movementHidden = false;
    this.holsterAnim.reset();
    this.clearFollowedBob();
    this.weaponRecoil.reset();
    this.weaponCharge.reset();
    this.reloadAnim.cancel();
    this.switchAnim.reset();
    this.mainCamera = camera; // Store for aim direction

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
    this.weaponCamera = new FreeCamera("weaponCamera", Vector3.Zero(), scene);
    this.weaponCamera.fov = (this.lastWeaponFov * Math.PI) / 180;
    this.weaponCamera.minZ = 0.1;
    this.weaponCamera.maxZ = 1000;
    this.weaponCamera.layerMask = WEAPON_LAYER_MASK; // Only sees weapon layer
    this.weaponCamera.parent = camera; // Follows main camera
    this.releaseWeaponCandidates = installWeaponCameraCandidates(scene, this.weaponCamera);

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

    // Add dedicated weapon light for PBR GLB models. Only the weapon layer: a
    // light reaching the world would join every world material's light list
    // the moment the view is built, and the world's fill lives with the map's
    // lights (SkyLightSystem) instead.
    this.weaponLight = new HemisphericLight("weaponLight", new Vector3(0.3, 1, 0.5), scene);
    this.weaponLight.includeOnlyWithLayerMask = WEAPON_LAYER_MASK;
    this.weaponLight.intensity = 1.2;
    this.weaponLight.diffuse = new Color3(1.0, 0.95, 0.9); // Slightly warm white
    this.weaponLight.groundColor = new Color3(0.3, 0.3, 0.35); // Cool fill from below
    // Always win the weapon's limited light slots. The PBR safe cap is low, and the
    // parked muzzle-flash point light + transient projectile lights compete for the
    // same slots — if one of those wins over this light the gun renders black
    // ("lights off"). A high render priority keeps this light selected every frame.
    this.weaponLight.renderPriority = 1000;

    // Metallic surfaces need a specular source; hemispheric fill alone has none.
    this.bladeLight = new DirectionalLight("bladeLight", new Vector3(0.3, -0.4, 1), scene);
    this.bladeLight.parent = this.weaponCamera;
    this.bladeLight.includeOnlyWithLayerMask = WEAPON_LAYER_MASK;
    this.bladeLight.setEnabled(false);
    this.bladeLight.intensity = 3;
    this.bladeLight.renderPriority = 1100;

    // Initialize hitscan effects system
    getHitscanEffects().init(scene);

    // Create the muzzle-flash light EAGERLY and keep it permanently enabled,
    // parked at intensity 0. Creating it lazily on the first shot (or toggling
    // setEnabled per shot) changes the scene's enabled-light set → material
    // defines change → synchronous shader recompiles → first-shot hitch and
    // walls flickering invisible while their new effect compiles.
    if (this.muzzleFlashLight) this.muzzleFlashLight.dispose();
    this.muzzleFlashLight = new PointLight("muzzleFlash", Vector3.Zero(), scene);
    // Weapon layer only, from the start: before a weapon loads there is no
    // mesh list to scope it to (updateMuzzleFlashLightScope).
    this.muzzleFlashLight.includeOnlyWithLayerMask = WEAPON_LAYER_MASK;
    this.muzzleFlashLight.intensity = 0;
    this.muzzleFlashLight.range = WeaponViewManager.MUZZLE_FLASH_RANGE;
    // Second-priority weapon light (below weaponLight, above transient projectile
    // lights) so the flash reliably takes the weapon's second slot when firing (#2).
    this.muzzleFlashLight.renderPriority = 500;

    // Muzzle flashes ride the live barrel: the renderer re-samples this each
    // frame so a flash tracks the muzzle instead of hanging in world space where
    // the gun was (obvious when strafing a fast-firing gun).
    getHitscanEffects().setMuzzleAnchorResolver(() => this.getMuzzleWorldPosition());

    // Register update loop. Previous-scene observer (if any) is already
    // detached above before `this.scene` was swapped.
    this.updateObserver = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000;
      this.update(deltaTime);
    });

    devLog(`[WeaponViewManager] Initialized with weapon FOV ${this.lastWeaponFov}°`);
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

    weaponName = canonicalWeaponId(weaponName);

    // Track the weapon the view is committing to (for server reconciliation).
    this._intendedWeaponId = weaponName;

    // Increment load generation — stale concurrent loads will check this and bail out
    const loadGen = ++this._loadGeneration;

    // Try to look up weapon definition from entity registry
    const registry = getEntityRegistry();
    const weaponDef = registry.get<WeaponDef>(weaponName);
    if (weaponDef) {
      this.currentWeaponDef = weaponDef;
      devLog(`[WeaponViewManager] Found weapon definition: ${weaponDef.name}`);
    } else {
      this.currentWeaponDef = null;
      devLog(`[WeaponViewManager] No definition found for '${weaponName}', using defaults`);
    }

    const pk3 = PK3Loader.getInstance();

    // Load pk3 if specified and not already loaded
    if (pk3Path) {
      try {
        await pk3.loadPK3FromUrl(pk3Path);
        devLog(`[WeaponViewManager] Loaded pk3: ${pk3Path}`);
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
    devLog(`[WeaponViewManager] GLB path — loading ${weaponName}, modelPath: ${modelPath}`);

    // Check if a newer load started while we were importing modules
    if (this._loadGeneration !== loadGen) {
      devLog(`[WeaponViewManager] GLB load for '${weaponName}' superseded (gen ${loadGen} < ${this._loadGeneration})`);
      return false;
    }

    this.clearCurrentWeapon();

    try {
      const scene = this.scene!;
      if (!this.glbSources) {
        this.glbSources = new ModelInstanceCache(scene, async (key) => {
          const [name, path] = JSON.parse(key) as [string, string];
          return this.loadGlbSource(name, path, scene);
        });
      }
      const sources = this.glbSources;
      // Name is part of the variant: blade and gun material/orientation rules differ.
      const result = await sources.createInstance(JSON.stringify([weaponName, modelPath]), 1);
      if (!result) return false;
      if (this._loadGeneration !== loadGen || this.scene !== scene || this.weaponRoot?.isDisposed()) {
        disposeModelResources([result.root], result);
        return false;
      }
      const weaponNode = result.root;
      for (const mesh of result.meshes) {
        clampMaterialLightCap(mesh.material);
        if (scene.getEngine().isWebGPU && mesh.material) mesh.material.allowShaderHotSwapping = false;
      }
      const glbRoot = result.meshes[0];
      const glbMeshes = result.meshes.filter((mesh) => mesh !== glbRoot || mesh.getTotalVertices() > 0);
      this.currentGlbResources = result;
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
            flags: 0,
            ident: 0,
            version: 0,
            ofsFrames: 0,
            ofsTags: 0,
            ofsSurfaces: 0,
            ofsEnd: 0,
          },
          frames: [],
          tags: [],
          surfaces: [],
        },
        // A GLB view model has a single static frame and no MD3 tags.
        currentFrame: 0,
        setFrame: () => {},
        getTag: () => null,
      };

      this.muzzleSocket = this.findWeaponTag(glbRoot, ["tag_flash", "tag_muzzle", "muzzle"]);
      if (!this.muzzleSocket) {
        console.warn(`[WeaponViewManager] ${weaponName}: model has no tag_flash muzzle socket; using camera fallback`);
      }

      devLog(`[WeaponViewManager] GLB meshes loaded: ${weaponName} (${glbMeshes.length} meshes)`);

      // Load barrel sub-models if defined
      if (this.currentWeaponDef?.barrels?.length) {
        this.weaponBarrels
          .load(
            this.currentWeaponDef.barrels,
            glbRoot,
            weaponName,
            this.scene!,
            loadGen,
            () => this._loadGeneration,
            weaponNode.getDescendants(false).filter((node): node is TransformNode => node instanceof TransformNode),
          )
          .catch(logRejection("WeaponViewManager"));
      }

      // Build the on-weapon ammo counter if this model is authored for one.
      this.setupAmmoCounter(weaponName, modelPath, glbRoot, loadGen).catch(() => {});

      return true;
    } catch (e) {
      console.error(`[WeaponViewManager] Failed to load GLB: ${modelPath}`, e);
      return false;
    }
  }

  /** Configure the authored source once; active views clone its rig/materials. */
  private async loadGlbSource(weaponName: string, modelPath: string, scene: Scene): Promise<ModelLoadResult> {
    // Save scene state — SceneLoader can add cameras/lights and set
    // scene.activeCamera, which breaks our dual-camera weapon rendering.
    const savedActiveCameras = scene.activeCameras ? [...scene.activeCameras] : null;
    const cameraCountBefore = scene.cameras.length;
    const viewRoot = this.weaponRoot;

    const asset = await resolveModelAsset(modelPath);
    const result = await ImportMeshAsync(asset.source, scene, asset.options);
    const weaponNode = new TransformNode(`weapon_${weaponName}`, scene);

    try {
      // Restore scene camera state — GLB importer may have corrupted it
      if (this.weaponRoot === viewRoot && this.scene === scene && savedActiveCameras) {
        scene.activeCameras = savedActiveCameras;
      }
      if (this.weaponRoot === viewRoot && this.scene === scene && scene.cameras.length > cameraCountBefore) {
        const added = scene.cameras.slice(cameraCountBefore);
        for (const cam of added) cam.dispose();
      }
      if (this.weaponRoot === viewRoot && this.scene === scene) scene.activeCamera = null;

      // Build weapon structure matching MD3 output:
      // root TransformNode + flat meshes array
      const glbRoot = result.meshes[0];
      if (!glbRoot) throw new Error(`No meshes in ${modelPath}`);
      for (const node of result.transformNodes) if (!node.parent) node.parent = weaponNode;
      for (const mesh of result.meshes) if (!mesh.parent) mesh.parent = weaponNode;
      glbRoot.parent = weaponNode;
      if (glbRoot.rotationQuaternion) glbRoot.rotationQuaternion = null;

      // Apply weapon-specific GLB model orientation
      if (weaponName === "blade") {
        // Blade: flip barrel + tilt upward for melee carry
        glbRoot.rotation.x = Math.PI;
        glbRoot.rotation.y = 0.9;
      } else {
        // IQM→GLB weapons need TWO coordinate fixes:
        // 1. z_up_to_y_up in converter: Z-up → Y-up (scope on top)
        // 2. Y rotation here: barrel from +X → -Z (pointing forward)
        glbRoot.rotation.set(0, -Math.PI / 2, 0);
      }
      // NOTE: GLB root may have scl:(1,1,-1) from Blender export — keep it,
      // the negative Z is needed for correct orientation. Use backFaceCulling=false
      // on materials to handle the flipped winding order.

      const pbrMaterialsToDispose: PBRMaterial[] = [];

      for (const mesh of result.meshes) {
        if (mesh.rotationQuaternion) mesh.rotationQuaternion = null;

        // Authored blade PBR channels remain intact; converted gun passes are tuned below.
        if (mesh.material && mesh.material.getClassName() === "PBRMaterial") {
          const pbr = mesh.material as PBRMaterial;

          if (weaponName === "blade") {
            applySafeMaxSimultaneousLights(pbr);
            pbr.maxSimultaneousLights = Math.min(2, getSafeMaxSimultaneousLights(pbr));
            if (
              scene.getEngine().getClassName() !== "NullEngine" &&
              scene.getEngine().constructor.name !== "NullEngine"
            ) {
              this.bladeEnvironment ??= createBladeEnvironment(scene);
              pbr.reflectionTexture = this.bladeEnvironment;
              pbr.environmentIntensity = 1.5;
            }
          } else {
            // Warsow weapon materials are multi-pass, but the IQM→GLB conversion
            // baked every pass as an OPAQUE, scene-lit base texture. Fix them up by
            // name (from the shipped *_glow / *_emit / *_glass tgas): the glow/emit
            // passes are solid teal energy strips (no black/alpha), so render them
            // SELF-LIT (emissive, unlit) so they read as glow instead of a dark
            // scene-shaded panel; glass reads as transparent.
            const matName = (pbr.name || "").toLowerCase();
            const isGlow = (matName.includes("_glow") || matName.includes("_emit")) && !!pbr.albedoTexture;
            if (isGlow) {
              // Self-lit emissive strip, TRANSLUCENT so the barrel reads through
              // it — a glow, not a solid teal panel. Not additive (the texture's
              // near-white highlights blew out to white when accumulated) and
              // teal-biased so those highlights stay teal rather than blooming
              // white. Bloom then turns the bright parts into a soft glow.
              const glowTex = pbr.albedoTexture;
              const glowMat = new StandardMaterial(`${pbr.name}_emis`, scene);
              glowMat.disableLighting = true;
              glowMat.diffuseColor = new Color3(0, 0, 0);
              glowMat.specularColor = new Color3(0, 0, 0);
              glowMat.emissiveTexture = glowTex;
              glowMat.emissiveColor = new Color3(0.5, 1.0, 1.0);
              glowMat.alpha = 0.5; // translucent glow overlay, not a full teal fill
              glowMat.transparencyMode = 2; // ALPHABLEND
              glowMat.backFaceCulling = false;
              mesh.material = glowMat;
              pbr.albedoTexture = null; // keep the texture alive on glowMat
              pbrMaterialsToDispose.push(pbr);
            } else if (matName.includes("_glass")) {
              // Transparent glass housing (baked OPAQUE).
              pbr.transparencyMode = 2; // ALPHABLEND
              pbr.alpha = 0.35;
              pbr.backFaceCulling = false;
              applySafeMaxSimultaneousLights(pbr);
              pbr.maxSimultaneousLights = Math.min(2, getSafeMaxSimultaneousLights(pbr));
            } else {
              // Main body / sights: keep PBR for proper metallic/roughness.
              pbr.environmentIntensity = 2.0;
              pbr.directIntensity = 1.0;
              pbr.backFaceCulling = false;
              applySafeMaxSimultaneousLights(pbr); // Prevent shader overflow from projectile PointLights
              // Dedicated ambient + muzzle flash on both capable backends.
              // Preserve the conservative cap on unsupported WebGPU devices.
              pbr.maxSimultaneousLights = Math.min(2, getSafeMaxSimultaneousLights(pbr));
              devLog(`[WeaponViewManager] Gun: keeping PBR "${pbr.name}" (env=${pbr.environmentIntensity})`);
            }
          }
        }

        // Ensure ALL meshes have weapon layer mask
        mesh.renderingGroupId = 1;
        mesh.layerMask = WEAPON_LAYER_MASK;
      }

      // Resolve the normalized model's +X tip once; cloned sockets follow its pose.
      if (weaponName === "blade") {
        glbRoot.computeWorldMatrix(true);
        const inverse = glbRoot.getWorldMatrix().clone().invert();
        let tip: Vector3 | null = null;
        for (const mesh of result.meshes) {
          const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
          if (!positions) continue;
          mesh.computeWorldMatrix(true);
          const toRoot = mesh.getWorldMatrix().multiply(inverse);
          for (let i = 0; i < positions.length; i += 3) {
            const point = Vector3.TransformCoordinates(Vector3.FromArray(positions, i), toRoot);
            if (!tip || point.x > tip.x) tip = point;
          }
        }
        if (tip) {
          const socket = new TransformNode("tag_blade_tip", scene);
          socket.parent = glbRoot;
          socket.position.copyFrom(tip);
        }
      }

      // Converted gun passes relinquish their original PBR materials.
      for (const pbr of pbrMaterialsToDispose) {
        pbr.dispose(false, false);
      }

      return {
        root: weaponNode,
        meshes: result.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh),
        skeletons: result.skeletons,
        animationGroups: result.animationGroups,
        lights: [],
      };
    } catch (error) {
      disposeModelResources([weaponNode, ...result.meshes, ...result.transformNodes], result);
      throw error;
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
      devLog(`[WeaponViewManager] MD3 load for '${weaponName}' superseded (gen ${loadGen} < ${this._loadGeneration})`);
      return false;
    }

    // Check if model exists
    if (!pk3.hasFile(modelPath)) {
      console.error(`[WeaponViewManager] Model not found: ${modelPath}`);
      devLog("[WeaponViewManager] Available files:", pk3.listDirectory(weaponDir));
      return false;
    }

    // Debug: show which PK3 this model is actually loading from
    const sourcePk3 = pk3["fileIndex"].get(modelPath.toLowerCase().replace(/\\/g, "/"));
    devLog(`[WeaponViewManager] Loading model ${modelPath} from PK3: ${sourcePk3 || "unknown"}`);

    // Load model data
    const modelBuffer = await pk3.getFile(modelPath);
    if (!modelBuffer) {
      console.error(`[WeaponViewManager] Failed to load model: ${modelPath}`);
      return false;
    }

    // Parse MD3
    const md3 = getMD3Loader();
    const model = md3.parseMD3(modelBuffer);

    this.clearCurrentWeapon();

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
      devLog(`[WeaponViewManager] Loaded texture via PK3TextureLoader: ${weaponTexPath}`);
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
          devLog(`[WeaponViewManager] Loaded texture (fallback scan): ${fullPath}`);
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
        devLog(`[WeaponViewManager] Loaded normal map for ${weaponName}`);
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
        devLog(`[WeaponViewManager] Loaded gloss map for ${weaponName}`);
      }
    }

    if (!textureLoaded) {
      console.warn(`[WeaponViewManager] No texture found for weapon: ${weaponName}`);
      devLog(`[WeaponViewManager] Searched in: ${weaponDir}`, PK3Loader.getInstance().listDirectory(weaponDir));
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
      devLog(`[WeaponViewManager] Loaded flash model: ${flashModelPath}`);
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
    this.currentWeapon.root.setEnabled(this._visible && !this.holsterAnim.isFullyHolstered);

    // Set rendering group and layer mask for each mesh
    // - renderingGroupId 1: renders after world with depth cleared
    // - layerMask: only visible to weapon camera (separate FOV)
    for (const mesh of this.currentWeapon.meshes) {
      mesh.renderingGroupId = 1;
      mesh.layerMask = WEAPON_LAYER_MASK;
    }
    this.updateMuzzleFlashLightScope();
    if (this.bladeLight) {
      this.bladeLight.includedOnlyMeshes = this.currentWeapon.meshes;
      this.bladeLight.setEnabled(weaponName === "blade");
      // Enabling a light appends it to mesh lists; rebuild in scene priority order
      // so the specular source actually fits the material's limited light slots.
      for (const mesh of this.currentWeapon.meshes) mesh._resyncLightSources();
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

    devLog(`[WeaponViewManager] Loaded weapon: ${weaponName} (${isGlbWeapon ? "GLB" : "MD3"})`);

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
    this.applyVisibility();
  }

  /**
   * Stow the viewmodel for the duration of a movement state, without touching
   * the sticky visibility death and spectating own.
   *
   * The weapon slides down and rolls away rather than blinking out; the mesh is
   * only actually disabled once it has finished travelling, so the animation
   * always gets to play.
   */
  public setMovementHidden(hidden: boolean): void {
    if (this._movementHidden === hidden) return;
    this._movementHidden = hidden;
    this.holsterAnim.setHolstered(hidden);
    this.applyVisibility();
  }

  private applyVisibility(): void {
    this.currentWeapon?.root.setEnabled(this._visible && !this.holsterAnim.isFullyHolstered);
  }

  /**
   * Clear current weapon
   */
  public clear(): void {
    ++this._loadGeneration;
    this.clearCurrentWeapon();
  }

  private clearCurrentWeapon(): void {
    this.bladeLight?.setEnabled(false);
    this.disposeAmmoCounter();
    this.muzzleSocket = null;
    this.currentGlowTexture?.dispose();
    this.currentGlowTexture = null;
    this.weaponBarrels.dispose();
    if (this.currentWeapon) disposeModelResources([this.currentWeapon.root], this.currentGlbResources ?? {});
    this.currentWeapon = null;
    this.currentGlbResources = null;
  }

  /**
   * Release this instance's view infrastructure (cameras, root, lights,
   * observers). A demo instance is disposed when playback ends — the live
   * instance is a separate object and is never touched (QA-8).
   */
  public dispose(): void {
    this.clearFollowedBob();
    this.weaponRecoil.reset();
    this.weaponCharge.reset();
    this.reloadAnim.cancel();
    this.switchAnim.reset();
    this.setBeamActive(false);
    this.currentWeaponDef = null;
    this._intendedWeaponId = null;
    this._visible = false;
    this._movementHidden = false;
    this.holsterAnim.reset();
    this.disposeViewInfrastructure();
    this.scene = null;
  }

  /** Dispose camera/root resources before init() installs a replacement set. */
  private disposeViewInfrastructure(): void {
    const oldScene = this.scene;
    this.releaseWeaponCandidates?.();
    this.releaseWeaponCandidates = null;
    if (this.updateObserver && oldScene) {
      oldScene.onBeforeRenderObservable.remove(this.updateObserver);
      this.updateObserver = null;
    }
    this._loadGeneration++;
    this.weaponSlash.dispose();
    this.clear();
    this.weaponBarrels.releaseSources();
    this.glbSources?.dispose();
    this.glbSources = null;
    if (this.muzzleFlashModel) {
      this.muzzleFlashModel.dispose();
      this.muzzleFlashModel = null;
    }
    this.weaponRoot?.dispose();
    this.weaponRoot = null;
    // Take out the pair init() put in, not just the weapon camera. A world
    // camera left in the list is what Babylon draws from, so once the controller
    // moved on, the view froze on it (a demo stopped, or cut to a flyby).
    if (oldScene?.activeCameras && this.weaponCamera) {
      const remaining = oldScene.activeCameras.filter(
        (camera) => camera !== this.weaponCamera && camera !== this.mainCamera,
      );
      oldScene.activeCameras = remaining.length > 0 ? remaining : null;
    }
    this.weaponCamera?.dispose();
    this.weaponCamera = null;
    this.muzzleFlashLight?.dispose();
    this.muzzleFlashLight = null;
    this.weaponLight?.dispose();
    this.weaponLight = null;
    this.bladeLight?.dispose();
    this.bladeLight = null;
    this.bladeEnvironment?.dispose();
    this.bladeEnvironment = null;
    this.mainCamera = null;
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
  private async setupAmmoCounter(
    weaponName: string,
    modelPath: string,
    glbRoot: TransformNode,
    loadGen: number,
  ): Promise<void> {
    try {
      // The counter mounts to the `tag_ammo` anchor. GLB tags import as either
      // TransformNodes (nodes) or skeleton bones depending on the exporter, so
      // search both; fall back to the units-digit tag. A model without one has
      // no counter, so skip the cfg request (the blade has neither: no 404).
      const anchor = this.findWeaponTag(glbRoot, ["tag_ammo", "tag_ammo_digit_1"]);
      if (!anchor) return;

      // Derive the cfg from the MODEL path, not the weapon id: Voltaic reuses the
      // lasergun model dir, so weaponName ("voltaic") != the model directory and
      // /data/models/weapons/voltaic/voltaic.cfg 404s — the counter never appears.
      const cfgPath = modelPath.replace(/\.glb$/i, ".cfg");
      const bytes = await readIndexedModelAsset(cfgPath);
      const res = bytes ? null : await fetch(cfgPath);
      if (res && !res.ok) {
        devLog(`[AmmoCounter] no cfg for ${weaponName} (${res.status}) — skipping`);
        return;
      }
      const config = parseAmmoCounter(bytes ? new TextDecoder().decode(bytes) : await res!.text());
      if (!config) return; // weapon declares no ammoCounter — normal for most guns
      devLog(`[AmmoCounter] ${weaponName}: cfg ammoCounter =`, config);

      // A newer load may have superseded us while awaiting the cfg.
      if (loadGen !== this._loadGeneration || !this.scene) return;

      this.disposeAmmoCounter();
      // Draw the counter in its own rendering group (2) on the weapon layer, with
      // depth cleared before it, so it renders ON TOP of the gun instead of being
      // occluded by gun geometry (e.g. the riotgun sight the tag sits behind).
      this.scene.setRenderingAutoClearDepthStencil(2, true, true, false);
      this.ammoCounter = new AmmoCounterDisplay(this.scene, anchor, config, {
        renderingGroupId: 2,
        layerMask: WEAPON_LAYER_MASK,
      });
      this.ammoCounter.setAmmo(this.displayedAmmo);
      // Log the anchor's world transform — a near-zero scale (invisible speck) or
      // wildly off position is the usual reason a mounted counter can't be seen.
      anchor.computeWorldMatrix(true);
      const wp = anchor.getAbsolutePosition();
      const ws = anchor.absoluteScaling;
      devLog(
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
          if (
            boneNode &&
            (boneNode.isDescendantOf(glbRoot) || (glbRoot.parent && boneNode.isDescendantOf(glbRoot.parent)))
          )
            return boneNode;
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
    const width = this._powerupOutlineActive ? this._powerupOutlineWidth : this._weaponOutlineWidth;
    const color = this._powerupOutlineActive ? this._powerupOutlineColor : this._weaponOutlineColor;
    const enabled = this._powerupOutlineActive || this._weaponOutlineEnabled;
    const adjustedWidth = width / rootScale;

    for (const mesh of this.currentWeapon.meshes) {
      mesh.renderOutline = enabled;
      mesh.outlineWidth = adjustedWidth;
      mesh.outlineColor = color;
    }
  }

  /**
   * Apply a temporary gameplay outline without mutating the player's saved
   * r_cel_weapon_* preferences. Calling with false restores those preferences.
   */
  public setPowerupOutlineOverride(active: boolean, color: Color3, width: number): void {
    this._powerupOutlineActive = active;
    if (active) {
      this._powerupOutlineColor = color;
      this._powerupOutlineWidth = Math.max(0.001, width);
    }
    this.applyWeaponOutlines();
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
      devLog(
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

    // Advance the holster slide. The mesh stops drawing only once the weapon
    // has finished travelling, and starts again the instant it begins to come
    // back, so neither direction of the animation is skipped.
    const wasStowed = this.holsterAnim.isFullyHolstered;
    this.holsterAnim.update(deltaTime);
    if (this.holsterAnim.isFullyHolstered !== wasStowed) this.applyVisibility();

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
    if (!this.followedBobActive) {
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
    }
    const bob = this.weaponBob.state;

    // Apply to weapon root (on top of base position with handedness)
    const root = this.currentWeapon.root;
    const basePos = this.effectiveBasePosition;

    // === ADS (Aiming Down Sights) ===
    const mv = MovementVars.getInstance();
    const adsTime = this.currentWeaponDef?.ads?.time || mv.get("cl_ads_time");

    // Lerp ADS progress based on aim state
    // Force ADS off during reload
    const adsDuration = this.currentWeaponDef?.adsRequireReady ? (this.currentWeaponDef.ads?.time ?? adsTime) : adsTime;
    const adsSpeed = 1.0 / Math.max(0.05, adsDuration);
    // A watched player's own aim, not the viewer's mouse
    const aiming = this.followedBobActive ? this.followedAiming : state.isAiming;
    const targetAds = aiming && !this.reloadAnim.isReloading ? 1.0 : 0.0;
    if (this.currentWeaponDef?.adsRequireReady) {
      const step = deltaTime * adsSpeed;
      this.adsProgress =
        targetAds > this.adsProgress
          ? Math.min(targetAds, this.adsProgress + step)
          : Math.max(targetAds, this.adsProgress - step);
    } else {
      const adsLerp = Math.min(1.0, deltaTime * adsSpeed);
      this.adsProgress += (targetAds - this.adsProgress) * adsLerp;
    }

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
    const isBladeCharging = !!(aiming && this.currentWeaponDef?.meleeRadius);
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

    // Quad is the highest-priority outline. In particular it replaces the
    // blade charge outline instead of flickering between two effects.
    if (this._powerupOutlineActive) this.applyWeaponOutlines();

    // Get reload animation offsets
    const reloadOffsets = this.getReloadAnimationOffsets();

    // Get switch animation offsets
    const switchOffsets = this.getSwitchAnimationOffsets();

    // Get slash animation offsets (melee weapons)
    const slashOffsets = this.weaponSlash.getOffsets();

    // Get holster offsets (weapon stowed for a both-hands movement state)
    const holsterOffsets = this.holsterAnim.getOffsets();

    // Apply position offset (bob + jump/land + ADS + recoil + reload + switch + charge shake + slash)
    root.position.set(
      adsX +
        bob.bobX +
        reloadOffsets.xOffset +
        switchOffsets.xOffset +
        chargeShakeX +
        slashOffsets.xOffset +
        holsterOffsets.xOffset,
      basePos.y +
        bob.bobY +
        bob.jumpLandBob +
        adsY +
        reloadOffsets.yOffset +
        switchOffsets.yOffset +
        chargeShakeY +
        slashOffsets.yOffset +
        holsterOffsets.yOffset,
      basePos.z +
        adsZ +
        reloadOffsets.zOffset -
        this.weaponRecoil.offset +
        switchOffsets.zOffset +
        slashOffsets.zOffset +
        holsterOffsets.zOffset,
    );

    // Apply rotation (base + sprint: pitch X, yaw Y, roll Z + reload roll)
    // Reduce sprint effects when ADS (weapon should be more stable)
    // Recoil is the backward punch (position Z, above) and the barrel's rise
    // (pitch X); it never rolls the gun, which reads as a sideways kick.
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
        slashOffsets.roll +
        holsterOffsets.roll,
    );
  }

  private updateLightingFromBsp(deltaTime: number): void {
    if (!this.currentWeapon || !this.scene) return;
    this.weaponLighting.update(deltaTime, this.scene, this.currentWeapon.meshes, this.bladeLight);
  }

  private checkCVarChanges(): void {
    try {
      const mv = MovementVars.getInstance();

      // Check handedness
      const currentHand = mv.get("cg_handedness");
      if (currentHand !== this.lastHandedness) {
        this.lastHandedness = currentHand;
        this.applyPosition(this.currentPosition);
        devLog(`[WeaponViewManager] Handedness changed to ${currentHand}`);
      }

      // Check weapon position override CVars — re-apply if any changed
      const hipX = mv.get("cl_wep_hip_x");
      const hipY = mv.get("cl_wep_hip_y");
      const hipZ = mv.get("cl_wep_hip_z");
      const wepScale = mv.get("cl_wep_scale");
      const wepKey = `${hipX},${hipY},${hipZ},${wepScale}`;
      if (wepKey !== this._lastWepKey) {
        this._lastWepKey = wepKey;
        this.applyPosition(this.currentPosition);
      }

      // Check weapon FOV
      const currentFov = mv.get("cg_weaponfov");
      if (currentFov !== this.lastWeaponFov && this.weaponCamera) {
        this.lastWeaponFov = currentFov;
        this.weaponCamera.fov = (currentFov * Math.PI) / 180;
        devLog(`[WeaponViewManager] Weapon FOV changed to ${currentFov}°`);
      }
    } catch (e) {
      // MovementVars not available
      if (this.debugEnabled) {
        console.warn("[WeaponViewManager] CVar check failed:", e);
      }
    }
  }

  /**
   * Trigger weapon fire effect and projectile, for our own shot as the server
   * reports it. `shot` is that shot's ray (spread included) and, for pellets,
   * its seed and cone; without it the shot is drawn down the view.
   */
  public fire(opts?: { isProjectileFire?: boolean; shot?: LocalShot }): void {
    this.presentFire(opts);
    this.spawnShotEffects(opts?.shot);
  }

  /**
   * What a shot looks like from behind the gun: muzzle flash and its light,
   * recoil, and the melee slash. No tracers or pellets. For anyone but the
   * local shooter those come from the server, so a watched player's shot drawn
   * here as well would appear twice.
   */
  public presentFire(opts?: { isProjectileFire?: boolean }): void {
    const flashDef = this.currentWeaponDef?.muzzleFlash;
    const maxIntensity = flashDef?.intensity ?? WeaponViewManager.MUZZLE_FLASH_MAX_INTENSITY;
    this.muzzleFlashIntensity = maxIntensity;

    // Procedural muzzle flash (shared GPU base, skinned per weapon by style).
    // Skip beam weapons — the Voltaic renderer draws its own muzzle corona.
    if (flashDef && this.currentWeaponDef?.hitscanType !== "beam") {
      const muzzle = this.getMuzzleWorldPosition();
      if (muzzle) {
        getHitscanEffects().fireMuzzleFlash({
          position: muzzle,
          color: new Color3(flashDef.color.r, flashDef.color.g, flashDef.color.b),
          style: flashDef.style,
          scale: flashDef.scale,
          intensity: flashDef.intensity,
          duration: flashDef.duration,
        });
        if (this.currentWeaponDef?.id === "blade" && !opts?.isProjectileFire) {
          const jitterX = (Math.random() - 0.5) * 8;
          const jitterY = (Math.random() - 0.5) * 8;
          const tip = this.getBladeTipWorldPosition(jitterX, jitterY);
          if (tip)
            getHitscanEffects().fireMuzzleFlash({
              position: tip,
              color: new Color3(flashDef.color.r, flashDef.color.g, flashDef.color.b),
              style: flashDef.style,
              scale: (flashDef.scale ?? 1) * 0.4,
              intensity: flashDef.intensity,
              duration: flashDef.duration,
              anchorResolver: () => this.getBladeTipWorldPosition(jitterX, jitterY),
            });
        }
      }
    }

    // Show muzzle flash model
    if (this.muzzleFlashModel) {
      this.muzzleFlashModel.setEnabled(true);
      if (this.muzzleFlashModel instanceof TransformNode) {
        for (const m of this.muzzleFlashModel.getChildMeshes()) {
          m.visibility = WeaponViewManager.MUZZLE_FLASH_OPACITY;
        }
      }
    }

    // Trigger recoil (scaled per weapon — energy guns have very low recoil),
    // timed to the weapon's fire rate so it is back at rest for the next shot.
    // Aiming scales the backward punch by the weapon's ADS factor.
    const def = this.currentWeaponDef;
    const recoilScale = def?.recoilScale ?? 1.0;
    const refireSeconds = def?.fireRate ? fireIntervalTicks(def) / DEFAULT_PHYSICS_TICK_RATE : undefined;
    this.weaponRecoil.fire(recoilScale, this.adsProgress, def?.adsRecoilScale, refireSeconds);
    this.weaponBarrels.fire();

    // Trigger slash animation for melee weapons (skip for charged projectile fire)
    if (this.currentWeaponDef?.meleeRadius && !opts?.isProjectileFire) {
      this.weaponSlash.trigger();
    }

    // Update light (created eagerly in init(); fallback covers legacy init paths).
    // Intensity-only control — never setEnabled(), which would change material
    // defines and trigger shader recompilation (first-shot flicker bug).
    if (!this.muzzleFlashLight) {
      this.muzzleFlashLight = new PointLight("muzzleFlash", Vector3.Zero(), this.scene!);
      this.muzzleFlashLight.includeOnlyWithLayerMask = WEAPON_LAYER_MASK;
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
   * Our own hitscan shot: tracers and pellets along the ray the server fired,
   * drawn from the muzzle. The ray is the shot's, not the camera's: the event
   * arrives a round trip after the shot, and by then the view may point
   * elsewhere. Without a shot (an older server) the camera stands in.
   */
  private spawnShotEffects(shot?: LocalShot): void {
    if (this.mainCamera && this.currentWeaponDef) {
      const forward = shot?.direction ?? this.mainCamera.getDirection(Vector3.Forward());
      const origin = shot?.origin ?? this.mainCamera.position.add(forward.scale(2));
      // A point on the screen ray through the muzzle socket, far enough out to
      // clear the near plane: the streak leaves the barrel on screen.
      const start = this.getMuzzleWorldPosition(24) ?? origin;

      if (this.currentWeaponDef.hitscan && this.currentWeaponDef.hitscanType) {
        // Hitscan weapon → fire visual effect
        const fx = getHitscanEffects();
        const mfColor = this.currentWeaponDef.muzzleFlash?.color;
        const color = mfColor ? new Color3(mfColor.r, mfColor.g, mfColor.b) : undefined;
        const range = this.currentWeaponDef.range ?? 8192;

        switch (this.currentWeaponDef.hitscanType) {
          case "tracer":
            fx.fireTracer({
              origin,
              start,
              direction: forward,
              maxRange: range,
              color,
              intensity: this.currentWeaponDef.muzzleFlash?.intensity,
            });
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
            const pelletCount = this.currentWeaponDef.pelletCount ?? this.currentWeaponDef.burstCount ?? 20;
            fx.firePellets({
              origin,
              start,
              direction: forward,
              maxRange: range,
              color,
              pelletCount,
              spreadAngle,
              directions:
                shot?.pelletSeed !== undefined
                  ? serverPelletDirections(forward, shot.pelletSeed, pelletCount, shot.pelletSpread ?? spreadAngle)
                  : undefined,
            });
            break;
          }
          case "beam":
            // Beam rendering is handled per-frame by FPSPlayer.updateFiring()
            // The shot itself is only the muzzle flash, from presentFire()
            break;
          case "bolt":
            // Rail rendering is driven by the authoritative electro_rail event
            // (WO-EB3) for both the local shooter and remote players, so the
            // visual endpoint always equals the damage endpoint (no through-wall
            // client-picked bolt, and no old-bolt double-draw under the rail).
            // The shot itself is only the muzzle flash, from presentFire().
            break;
        }
      } else if (this.currentWeaponDef.projectileId) {
        // Projectile weapons: visuals now come from server entities (Q3-style)
        // No local prediction needed — server snapshot drives projectile rendering
      }
    }
  }

  /**
   * Update muzzle flash effect decay and recoil recovery
   */
  private getBladeTipWorldPosition(jitterX = 0, jitterY = 0): Vector3 | null {
    if (
      this.currentWeaponDef?.id !== "blade" ||
      !this.currentWeapon ||
      !this.weaponCamera ||
      !this.mainCamera ||
      !this.scene
    )
      return null;
    const socket = this.currentWeapon.root.getDescendants(false).find((node) => node.name === "tag_blade_tip");
    if (!(socket instanceof TransformNode)) return null;
    this.weaponCamera.getViewMatrix(true);
    this.weaponCamera.getProjectionMatrix(true);
    this.mainCamera.getViewMatrix(true);
    this.mainCamera.getProjectionMatrix(true);
    socket.computeWorldMatrix(true);
    const engine = this.scene.getEngine();
    const viewport = this.weaponCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const screen = Vector3.Project(
      socket.getAbsolutePosition(),
      WeaponViewManager.IDENTITY_MATRIX,
      this.weaponCamera.getTransformationMatrix(),
      viewport,
    );
    // Small variation stays close to the projected tip, independent of weapon FOV.
    screen.x += jitterX;
    screen.y += jitterY;
    if (!Number.isFinite(screen.x + screen.y + screen.z) || screen.z < 0 || screen.z > 1) return null;
    const ray = this.scene.createPickingRay(
      screen.x,
      screen.y,
      WeaponViewManager.IDENTITY_MATRIX,
      this.mainCamera,
      false,
    );
    return this.mainCamera.globalPosition.add(ray.direction.scale(5));
  }

  private updateMuzzleFlash(deltaTime: number): void {
    if (!this.scene) return;

    // Decay flash intensity
    if (this.muzzleFlashIntensity > 0) {
      const decay = WeaponViewManager.MUZZLE_FLASH_DECAY * (this.currentWeaponDef?.id === "blade" ? 0.5 : 1);
      this.muzzleFlashIntensity -= decay * deltaTime;
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
          // GLB muzzle tags are live transform nodes; MD3 tags are static data.
          if (this.muzzleSocket) {
            this.muzzleSocket.computeWorldMatrix(true);
            this.muzzleFlashLight.position.copyFrom(this.muzzleSocket.getAbsolutePosition());
          } else {
            const tag = this.currentWeapon?.getTag("tag_flash");
            if (tag && this.weaponRoot) {
              const localPos = tag.origin;
              const worldPos = Vector3.TransformCoordinates(localPos, this.weaponRoot.getWorldMatrix());
              this.muzzleFlashLight.position = worldPos;
            }
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
          // Damage is traced from the eye; only the visible start follows the muzzle.
          traceOrigin: this.mainCamera.position,
          direction: forward,
          maxRange: this.currentWeaponDef?.range ?? 850,
          color: this.beamColor,
        };
        // Every continuous beam weapon uses the procedural Voltaic presentation.
        // Legacy `lasergun` input is canonicalized before this point; chainCount
        // is gameplay only and must never select a separate renderer.
        if (this.currentWeaponDef?.hitscanType === "beam") {
          getHitscanEffects().updateLightningBeam(cfg);
        }
      }
    }
  }

  /** Called by FPSPlayer to start/stop beam rendering */
  public setBeamActive(active: boolean, color?: Color3): void {
    const wasActive = this.beamActive;
    this.beamActive = active;
    if (color) this.beamColor = color;
    if (active && !wasActive) {
      getHitscanEffects().beginLightning();
    }
    if (!active) {
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

    weaponId = canonicalWeaponId(weaponId);

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

  /**
   * Drop a switch in progress, for a cut straight to a weapon already in hand.
   * Left running, its pending load would land afterwards and replace the cut.
   */
  public cancelSwitch(): void {
    this.switchAnim.reset();
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

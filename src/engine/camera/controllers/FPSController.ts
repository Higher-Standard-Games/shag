/**
 * FPSController - First-person camera controller with gravity and physics
 * 
 * Based on FPSController but with:
 * - Gravity (player falls when not on ground)
 * - Ground detection via BSP collision
 * - Jump with Space (when grounded)
 * - Horizontal movement only (no fly up/down)
 * 
 * Controls:
 * - Click canvas to capture mouse (pointer lock)
 * - ESC to release mouse
 * - WASD to move horizontally
 * - Space to jump (when grounded)
 * - Mouse movement: freelook
 */

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { ICameraController, CameraControllerConfig } from "./ICameraController";
import { getCollisionManager } from "../../physics";
import { Cvar } from "../../core/Cvar";
import { ContentFlags, SurfaceFlags } from "../../physics/ContentFlags";
import { MovementVars } from "../../movement/MovementVars";
import {
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  CROUCH_HEIGHT,
  PLAYER_ORIGIN_HEIGHT,
  DEFAULT_VIEWHEIGHT,
  STEPSIZE,
  CROUCH_MINS_Z,
  PLAYER_MINS_Z,
  PLAYER_MAXS_Z,
  originToFeet,
  feetToOrigin,
} from "../../physics/PlayerPhysicsConstants";

// Viewport effects system imports
import {
  ViewportEffectsManager,
  FPSApplicator,
  WalkBobEffect,
  LandingImpactEffect,
  StrafeLeanEffect,
  SpeedFOVEffect,
  IdleBreathingEffect,
  type PlayerState,
} from "../../viewport";

import { InventoryManager } from "../../game/InventoryManager";
import { EntityManager } from "../../entities/EntityManager";
import { WeaponViewManager } from "../../weapon/WeaponViewManager";
import { WeaponDef } from "../../../shared/entities";

export class FPSController implements ICameraController {
  readonly type = "fps";

  public inventory: InventoryManager = new InventoryManager();

  /**
   * Get the player's physics position at ORIGIN level (Q3 style).
   * Origin is 24 units above feet, as per Q3 coordinate system.
   * Use originToFeet() to convert to feet level if needed.
   */
  public getPlayerPosition(): Vector3 {
    return new Vector3(this.physicsX, this.physicsY, this.physicsZ);
  }

  /**
   * Get player's feet position (for external systems that need it)
   */
  public getPlayerFeetPosition(): Vector3 {
    return new Vector3(this.physicsX, originToFeet(this.physicsY), this.physicsZ);
  }

  /**
   * Force set player position, updating both physics state and camera
   * @param position Target position at ORIGIN level (24 above feet)
   */
  public setPosition(position: Vector3): void {
    // Update physics state (origin level)
    this.physicsX = position.x;
    this.physicsY = position.y;
    this.physicsZ = position.z;

    // Also update velocity to zero to stop momentum
    this.velocity.set(0, 0, 0);
    this.isGrounded = false; // Reset grounded state to allow physics to re-settle

    // Update smoothed Y to match
    this.smoothedY = this.physicsY;

    // Update camera immediately (origin + viewheight)
    if (this.camera) {
      this.camera.position.set(this.physicsX, this.physicsY + DEFAULT_VIEWHEIGHT, this.physicsZ);
    }
  }

  /**
   * Set player position from FEET level (convenience for spawn points)
   * @param feetPosition Position at feet level
   */
  public setPositionFromFeet(feetPosition: Vector3): void {
    this.setPosition(new Vector3(
      feetPosition.x,
      feetToOrigin(feetPosition.y),
      feetPosition.z
    ));
  }

  /**
   * Get current player collision height based on crouch/slide state
   * @returns CROUCH_HEIGHT (36) when crouching/sliding, PLAYER_HEIGHT (56) otherwise
   */
  public getCurrentHeight(): number {
    return (this.isCrouching || this.isSliding) ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  }

  /**
   * Get crouch state for server-side hitbox sync
   * @returns Object with crouch state, slide state, and current collision height
   */
  public getCrouchState(): { isCrouching: boolean; isSliding: boolean; height: number } {
    return {
      isCrouching: this.isCrouching,
      isSliding: this.isSliding,
      height: this.getCurrentHeight(),
    };
  }

  // Static default speed that persists between controller changes
  private static defaultSpeed: number = 200;

  // Collision always enabled for FPS (can't walk through walls)
  private static collisionEnabled: boolean = true;

  // Collision mode: 'bsp' uses BSP brush tracing (same as FreeflyController), 'native' uses Babylon's mesh collision
  private static collisionMode: 'bsp' | 'native' = 'bsp';

  // Debug logging throttle for slide system
  private static _lastSlideLog: number = 0;

  // Q3 physics constants are now imported from PlayerPhysicsConstants

  // Q3-style physics state
  private velocity: Vector3 = Vector3.Zero();  // Persistent velocity
  private isGrounded: boolean = false;
  // @ts-ignore - kept for future slope movement
  private groundNormal: Vector3 | null = null;

  // Physics position at ORIGIN level (Q3 style: 24 units above feet)
  // MUST be kept separate from camera.position which includes viewheight offset
  // Viewport effects modify camera.position for visuals, but physics uses these values
  private physicsX: number = 0;
  private physicsY: number = 0;  // This is ORIGIN height, not feet!
  private physicsZ: number = 0;
  // Last frame position for actual speed calculation
  private lastPhysicsX: number = 0;
  private lastPhysicsZ: number = 0;
  private actualHorizSpeed: number = 0;  // Real speed based on position delta
  // Smoothed Y for viewport only (never feeds back to physics)
  private smoothedY: number = 0;
  private smoothingInitialized: boolean = false;
  // Jump state for auto-bunny hop
  private jumpConsumed: boolean = false;
  private wasGroundedLastFrame: boolean = false;

  // Viewport effects system
  private viewportEffectsManager: ViewportEffectsManager | null = null;
  private viewportApplicator: FPSApplicator | null = null;
  private baseFOV: number = 1.0;
  private landingVelocityCapture: number = 0;

  // Mouse-controlled rotation (stored separately to avoid effect accumulation)
  private mouseRotationX: number = 0;  // Pitch
  private mouseRotationY: number = 0;  // Yaw

  // Ledge grab state
  private ledgeGrabState: 'none' | 'grabbing' | 'pulling' = 'none';
  private ledgeGrabTime: number = 0;           // Time spent in current state
  private ledgeGrabPosition: Vector3 = Vector3.Zero();  // Position when grabbed
  private ledgeTargetPosition: Vector3 = Vector3.Zero(); // Target position after pull-up
  private ledgeWallNormal: Vector3 = Vector3.Zero();    // Normal of wall we grabbed
  private ledgePreGrabVelocity: Vector3 = Vector3.Zero(); // Velocity before grab (for drop)

  // Wall jump state
  private lastWallJumpTime: number = 0;  // For cooldown tracking
  private wallJumpState: 'none' | 'charging' | 'pushing' = 'none';
  private wallJumpChargeTime: number = 0;
  private wallJumpPosition: Vector3 = Vector3.Zero();  // Position when started charging
  private wallJumpNormal: Vector3 = Vector3.Zero();    // Wall normal to push off from
  private wallJumpPreVelocity: Vector3 = Vector3.Zero(); // Velocity before charge

  // Crouchslide state
  private isSliding: boolean = false;
  private slideStartTime: number = 0;
  private slideVelocity: Vector3 = Vector3.Zero();  // Direction locked at slide start
  private lastSlideEndTime: number = 0;  // For cooldown
  private slideJumpHoldTime: number = 0; // For hold vs tap detection
  private slideCameraRoll: number = 0;   // Current camera roll (unused currently)
  private slideCameraPitch: number = 0;  // Current camera pitch offset during slide
  private slideEntryPitch: number = 0;   // Player's pitch when entering slide (for axis lock)
  private slideEntrySpeed: number = 0;   // Speed when entering slide (for momentum preservation)
  private static readonly SLIDE_PITCH_TILT: number = -0.22; // Tilt camera up (radians, ~12 degrees)
  private static readonly SLIDE_JUMP_GRACE_MS: number = 400; // Can't jump cancel before this (also fade-in time)
  private static readonly SLIDE_FADE_MS: number = 400; // Fade in/out time for camera effect

  // Crouch state (separate from slide)
  private isCrouching: boolean = false;
  private crouchViewOffset: number = 0;  // Current crouch offset (0 = standing, -20 = crouched)
  private static readonly CROUCH_HEIGHT_OFFSET: number = -20; // How much to lower view when crouched
  private static readonly CROUCH_TRANSITION_SPEED: number = 0.2; // Lerp speed for crouch transition

  // Debug visualization (cl_debugbbox cvar)
  private debugBboxMesh: LinesMesh | null = null;

  private camera: FreeCamera | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // State
  private enabled: boolean = true;
  private isPointerLocked: boolean = false;

  // Movement keys state
  private keys = {
    forward: false,  // W
    backward: false, // S
    left: false,     // A
    right: false,    // D
    up: false,       // Space (jump)
    sprint: false,   // Shift (run)
    crouch: false,   // Ctrl/C (crouch/slide)
    fire: false,     // Mouse1 (fire)
    aim: false,      // Mouse2 (ADS)
    reload: false,   // R (reload)
  };

  // ADS sensitivity lerp (matches ADS animation timing)
  private adsSensitivityProgress: number = 0;

  // Configuration
  private config: CameraControllerConfig = {
    speed: FPSController.defaultSpeed,
    mouseSensitivity: 0.002,
    invertY: false,
    fov: 1.0, // Wider FOV for debugging
  };

  // Reload state
  private isReloading: boolean = false;
  private reloadTimer: number = 0;

  // Fire state
  private lastFireTime: number = 0;
  private fireReleased: boolean = true;
  private burstShotsRemaining: number = 0;
  // Note: burstCooldown is unused based on lint, removing it
  //   private burstCooldown: number = 0;

  private checkReload(deltaTime: number): void {
    if (this.isReloading) {
      this.reloadTimer -= deltaTime;
      if (this.reloadTimer <= 0) {
        this.finishReload();
      }
      return;
    }

    const currentWeapon = this.inventory.getCurrentWeapon();
    const currentId = this.inventory.getCurrentWeaponId();
    if (!currentWeapon || !currentId) return;

    // Manual reload
    if (this.keys.reload) {
      if (this.inventory.needsReload(currentId)) {
        this.startReload(currentWeapon, currentId);
      }
    }
  }

  private startReload(weapon: WeaponDef, weaponId: string): void {
    if (this.isReloading) return;

    // Can we reload? (Not full, have reserve)
    // We can use inventory logic to check, but we need to know if it's possible FIRST to avoid useless animations
    // For now, let's just trust the InventoryManager to fail gracefully, 
    // BUT we need to know reloadTime.

    // Peek if reload is needed/possible
    const clipSize = weapon.clipSize || 0;
    if (clipSize <= 0) return; // No clip

    const loaded = this.inventory.getLoadedAmmo(weaponId);
    if (loaded >= clipSize) return; // Full

    if (weapon.ammoType && this.inventory.getAmmoCount(weapon.ammoType) <= 0) {
      // No reserve ammo
      // console.log("No ammo to reload!");
      return;
    }

    this.isReloading = true;
    this.reloadTimer = weapon.reloadTime || 0.6;  // Use weapon def
    console.log(`Reloading... (${this.reloadTimer}s)`);

    // Trigger animation via ViewManager
    WeaponViewManager.getInstance().startReload(weapon.reloadTime || 0.6);
  }

  private finishReload(): void {
    this.isReloading = false;
    const currentId = this.inventory.getCurrentWeaponId();
    if (currentId) {
      if (this.inventory.reloadWeapon(currentId)) {
        console.log("Reload complete.");
      } else {
        console.log("Reload failed (maybe no ammo?)");
      }
    }
  }

  // @ts-ignore
  private async switchWeapon(slotIndex: number): Promise<void> {
    const weaponId = this.inventory.getWeaponByIndex(slotIndex);
    if (!weaponId) return;

    if (this.inventory.getCurrentWeaponId() === weaponId) return;

    // Cancel reload if switching
    this.isReloading = false;
    this.reloadTimer = 0;
    WeaponViewManager.getInstance().cancelReload();

    if (this.inventory.equipWeapon(weaponId)) {
      const weaponMgr = WeaponViewManager.getInstance();
      // Load visual model
      await weaponMgr.loadWeapon(weaponId);
      console.log(`Switched to weapon: ${weaponId}`);
    }
  }

  private updateFiring(deltaTime: number): void {
    // Handle reloading
    this.checkReload(deltaTime);
    if (this.isReloading) return;

    const weaponMgr = WeaponViewManager.getInstance();
    const currentWeapon = this.inventory.getCurrentWeapon();

    if (!currentWeapon) return;

    const fireRate = currentWeapon.fireRate ?? 10;
    const fireDelay = 1.0 / fireRate;
    const now = performance.now() / 1000;

    // Update Burst Logic
    if (this.burstShotsRemaining > 0 && (now - this.lastFireTime) >= fireDelay) {
      this.executeFire(weaponMgr);
      this.burstShotsRemaining--;
      return;
    }

    // Check input
    if (!this.keys.fire) {
      this.fireReleased = true;
      return;
    }

    // Check Cooldown
    if ((now - this.lastFireTime) < fireDelay) return;

    // Handle Fire Modes
    const mode = currentWeapon.fireMode ?? 'auto';
    let readyToFire = false;

    if (mode === 'auto') {
      readyToFire = true;
    } else if (mode === 'semi') {
      if (this.fireReleased) {
        readyToFire = true;
        this.fireReleased = false;
      }
    } else if (mode === 'burst') {
      if (this.fireReleased && this.burstShotsRemaining === 0) {
        readyToFire = true;
        this.fireReleased = false;
        const burstCount = currentWeapon.burstCount ?? 3;
        this.burstShotsRemaining = burstCount - 1;
      }
    }

    if (readyToFire) {
      // Auto-reload check
      const weaponId = this.inventory.getCurrentWeaponId();
      if (weaponId && this.inventory.getLoadedAmmo(weaponId) <= 0 && currentWeapon.clipSize > 0) {
        this.startReload(currentWeapon, weaponId);
      } else {
        this.executeFire(weaponMgr);
      }
    }
  }

  private executeFire(mgr: WeaponViewManager): void {
    const weaponId = this.inventory.getCurrentWeaponId();
    if (!weaponId) return;

    // consumeLoadedAmmo handles infinite ammo logic if clipSize=0
    if (this.inventory.consumeLoadedAmmo(weaponId, 1)) {
      mgr.fire();
      this.lastFireTime = performance.now() / 1000;
    } else {
      // console.log("Click!");
    }
  }



  /**
   * Get the current default speed
   */
  static getDefaultSpeed(): number {
    return FPSController.defaultSpeed;
  }

  /**
   * Set the default speed (persists between controller changes)
   */
  static setDefaultSpeed(speed: number): void {
    FPSController.defaultSpeed = speed;
  }

  /**
   * Get collision enabled state
   */
  static isCollisionEnabled(): boolean {
    return FPSController.collisionEnabled;
  }

  /**
   * Set collision enabled state
   */
  static setCollisionEnabled(enabled: boolean): void {
    FPSController.collisionEnabled = enabled;
    console.log(`[FPSController] Collision ${enabled ? 'enabled' : 'disabled'} (mode: ${FPSController.collisionMode})`);
  }

  /**
   * Get collision mode
   */
  static getCollisionMode(): 'bsp' | 'native' {
    return FPSController.collisionMode;
  }

  /**
   * Set collision mode
   */
  static setCollisionMode(mode: 'bsp' | 'native'): void {
    FPSController.collisionMode = mode;
    console.log(`[FPSController] Collision mode set to: ${mode}`);
  }

  // Observers
  private renderObserver: Observer<Scene> | null = null;

  // Event handlers (bound for removal)
  private onCanvasClick: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private onPointerLockChange: (() => void) | null = null;
  private onMouseDown: ((e: MouseEvent) => void) | null = null;
  private onMouseUp: ((e: MouseEvent) => void) | null = null;
  private onContextMenu: ((e: Event) => void) | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    this.scene = scene;
    this.canvas = canvas;

    // Get starting position from existing camera
    let startPos = camera.position.clone();

    // If it's an ArcRotateCamera, start at its position looking at target
    if ("target" in camera && (camera as any).target instanceof Vector3) {
      startPos = camera.position.clone();
    }

    if (!(camera instanceof FreeCamera)) {
      this.camera = new FreeCamera("freeflyCamera", startPos, scene);
      this.camera.rotation.x = 0;
      this.camera.rotation.y = 0;
      scene.activeCamera = this.camera;
    } else {
      this.camera = camera;
    }

    // Initialize weapon view manager with camera
    WeaponViewManager.getInstance().init(scene, this.camera);

    // Apply FOV
    if (this.config.fov && this.camera) {
      this.camera.fov = this.config.fov;
    }

    // Disable collisions for free flight
    this.camera.checkCollisions = false;

    // Clear default inputs - we handle everything
    this.camera.inputs.clear();

    // Set up input handlers
    this.setupInputHandlers();

    // Set up render observer for movement
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000;
      this.update(deltaTime);
    });

    // === INITIALIZE VIEWPORT EFFECTS ===
    this.baseFOV = this.config.fov || 1.0;
    this.viewportEffectsManager = ViewportEffectsManager.getInstance();
    this.viewportEffectsManager.init();

    // Register all movement-based effects
    this.viewportEffectsManager.registerEffect(new WalkBobEffect());
    this.viewportEffectsManager.registerEffect(new LandingImpactEffect());
    this.viewportEffectsManager.registerEffect(new StrafeLeanEffect());
    this.viewportEffectsManager.registerEffect(new SpeedFOVEffect());
    this.viewportEffectsManager.registerEffect(new IdleBreathingEffect());

    this.viewportApplicator = new FPSApplicator();
    console.log('[FPSController] Viewport effects initialized');

    console.log("[FPSController] Attached - Click to capture mouse, WASD to move, ESC to release");
  }

  private setupInputHandlers(): void {
    if (!this.canvas) return;

    // Click to capture mouse - use document click and check target
    this.onCanvasClick = (e: MouseEvent) => {
      // Only respond to clicks on the canvas itself
      if (e.target !== this.canvas) return;

      if (!this.isPointerLocked && this.canvas) {
        console.log('[FPSController] Canvas clicked, requesting pointer lock');
        this.canvas.requestPointerLock();
      }
    };

    // Handle pointer lock change
    this.onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
      if (this.isPointerLocked) {
        console.log('[FPSController] Mouse captured - WASD to move, ESC to release');
      } else {
        console.log('[FPSController] Mouse released - Click to capture');
        // Reset movement keys when releasing
        this.keys.forward = false;
        this.keys.backward = false;
        this.keys.left = false;
        this.keys.right = false;
        this.keys.up = false;
        this.keys.sprint = false;
        this.keys.fire = false;
        this.keys.aim = false;
      }
    };

    // Mouse look (only when pointer is locked)
    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || !this.camera || !this.isPointerLocked) return;

      const baseSensitivity = this.config.mouseSensitivity || 0.002;
      const sensitivityMultiplier = Cvar.getNumber('m_sensitivity') ?? 2.0;

      // ADS sensitivity reduction (lerped with ADS progress)
      const mv = MovementVars.getInstance();
      const adsSensitivity = mv.get('cl_ads_sensitivity');
      // Lerp: 1.0 when hip, adsSensitivity when fully ADS
      const adsMultiplier = 1.0 - (1.0 - adsSensitivity) * this.adsSensitivityProgress;

      const sensitivity = baseSensitivity * sensitivityMultiplier * adsMultiplier;
      const invertYCvar = Cvar.getBool('m_invertY');
      const invertY = (this.config.invertY || invertYCvar) ? -1 : 1;

      // Update mouse-controlled rotation (stored separately from camera)
      this.mouseRotationY += e.movementX * sensitivity;
      this.mouseRotationX += e.movementY * sensitivity * invertY;

      // Clamp vertical rotation
      this.mouseRotationX = Math.max(
        -Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, this.mouseRotationX)
      );

      // Apply to camera (will be reset before effects each frame)
      this.camera.rotation.y = this.mouseRotationY;
      this.camera.rotation.x = this.mouseRotationX;
    };

    // Keyboard input
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.isPointerLocked) return;

      // Block ALL Ctrl+key browser shortcuts when pointer locked (like Ctrl+W, Ctrl+T)
      if (e.ctrlKey) {
        e.preventDefault();
      }

      switch (e.code) {
        case 'KeyW': this.keys.forward = true; break;
        case 'KeyS': this.keys.backward = true; break;
        case 'KeyA': this.keys.left = true; break;
        case 'KeyD': this.keys.right = true; break;
        case 'Space': this.keys.up = true; e.preventDefault(); break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = true; break;
        case 'ControlLeft': case 'ControlRight': case 'KeyC':
          this.keys.crouch = true;
          break;
        case 'KeyR': this.keys.reload = true; break;
      }

      // Weapon switching (1-9)
      if (e.code.startsWith('Digit')) {
        const digit = parseInt(e.code.replace('Digit', ''));
        if (digit > 0 && digit <= 9) {
          this.switchWeapon(digit - 1);
        }
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': this.keys.forward = false; break;
        case 'KeyS': this.keys.backward = false; break;
        case 'KeyA': this.keys.left = false; break;
        case 'KeyD': this.keys.right = false; break;
        case 'Space': this.keys.up = false; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = false; break;
        case 'ControlLeft': case 'ControlRight': case 'KeyC': this.keys.crouch = false; break;
        case 'KeyR': this.keys.reload = false; break;
      }
    };

    // Mouse button handlers for fire and ADS
    this.onMouseDown = (e: MouseEvent) => {
      if (!this.isPointerLocked) {
        // console.log("MouseDown ignored - not locked");
        return;
      }

      console.log(`[FPS] MouseDown: btn=${e.button}, locked=${this.isPointerLocked}`);
      if (e.button === 0) this.keys.fire = true;   // Left click = fire
      if (e.button === 2) this.keys.aim = true;    // Right click = ADS
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.keys.fire = false;
      if (e.button === 2) this.keys.aim = false;
    };

    // Prevent context menu on right click
    this.onContextMenu = (e: Event) => {
      if (this.isPointerLocked) e.preventDefault();
    };

    // Add event listeners - use document for click to ensure we catch it
    if (this.onCanvasClick) document.addEventListener('click', this.onCanvasClick);
    if (this.onPointerLockChange) document.addEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.onMouseMove) document.addEventListener('mousemove', this.onMouseMove);
    if (this.onKeyDown) document.addEventListener('keydown', this.onKeyDown);
    if (this.onKeyUp) document.addEventListener('keyup', this.onKeyUp);
    if (this.onMouseDown) document.addEventListener('mousedown', this.onMouseDown);
    if (this.onMouseUp) document.addEventListener('mouseup', this.onMouseUp);
    if (this.onContextMenu) document.addEventListener('contextmenu', this.onContextMenu);
  }

  private removeInputHandlers(): void {
    // Exit pointer lock if active
    if (this.isPointerLocked) {
      document.exitPointerLock();
    }

    if (this.onCanvasClick) document.removeEventListener('click', this.onCanvasClick);
    if (this.onPointerLockChange) document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.onMouseMove) document.removeEventListener('mousemove', this.onMouseMove);
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    if (this.onKeyUp) document.removeEventListener('keyup', this.onKeyUp);
    if (this.onMouseDown) document.removeEventListener('mousedown', this.onMouseDown);
    if (this.onMouseUp) document.removeEventListener('mouseup', this.onMouseUp);
    if (this.onContextMenu) document.removeEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    this.removeInputHandlers();

    this.camera = null;
    this.scene = null;
    this.canvas = null;
    this.isPointerLocked = false;

    console.log("[FPSController] Detached");
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera || !this.isPointerLocked) return;

    const mv = MovementVars.getInstance();
    const gravity = mv.get('sv_gravity');
    const jumpHeight = mv.get('sv_jumpheight');
    const stepHeight = mv.get('sv_stepheight');
    const smoothFactor = mv.get('cl_smoothfactor');
    const friction = mv.get('sv_friction');
    const accelerate = mv.get('sv_accelerate');
    const stopspeed = mv.get('sv_stopspeed');
    const airaccelerate = mv.get('sv_airaccelerate');
    const maxairspeed = mv.get('sv_maxairspeed');
    const autorun = mv.get('cl_autorun') > 0;

    // ADS sensitivity lerp (matches ADS animation timing)
    const adsTime = mv.get('cl_ads_time');
    const adsSpeed = 1.0 / Math.max(0.05, adsTime);
    const targetAdsSens = this.keys.aim ? 1.0 : 0.0;
    const adsSensLerp = Math.min(1.0, deltaTime * adsSpeed);
    this.adsSensitivityProgress += (targetAdsSens - this.adsSensitivityProgress) * adsSensLerp;

    // cl_autorun inverts run/walk: run by default, walk when holding shift
    // ADS and CROUCH both force walk mode (cannot sprint while aiming or crouching)
    const canRun = !this.keys.aim && !this.keys.crouch;  // No sprinting while ADS or crouching
    const isRunning = canRun && (autorun ? !this.keys.sprint : this.keys.sprint);
    let wishspeed = isRunning ? mv.get('sv_runSpeed') : mv.get('sv_movementSpeed');

    // Apply crouch walk speed (reduced when crouching but not sliding)
    // BUT: Don't reduce speed if player is fast enough to slide - preserve momentum for slide entry
    if (this.keys.crouch && !this.isSliding) {
      const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      const slideMinSpeed = mv.get('sv_slideMinSpeed');
      const cooldownPassed = (Date.now() - this.lastSlideEndTime) >= mv.get('sv_slideCooldown');

      // Only reduce speed if NOT about to slide
      if (horizSpeed < slideMinSpeed || !cooldownPassed) {
        wishspeed *= mv.get('cl_crouchmult'); // 0.5x by default
      }
    }

    const cm = getCollisionManager();

    // SOLID DEPENETRATION: Disabled due to roof instability (looping)
    /*
    if (cm.isInitialized() && FPSController.collisionEnabled) {
      if (this.resolveDepenetration(cm)) {
        // If we teleported, update physics vars immediately
        this.physicsX = this.camera.position.x;
        this.physicsY = this.camera.position.y;
        this.physicsZ = this.camera.position.z;
        this.smoothedY = this.physicsY; // Snap view to prevent jitter
      }
    }
    */

    // Initialize physics position on first frame
    // NOTE: Spawn system should call setPositionFromFeet() or setPosition() before first frame
    // If not, we assume camera.position is at spawn location (may need adjustment)
    if (!this.smoothingInitialized) {
      // Assume camera was placed at eye level by spawn system
      // Convert to origin level by subtracting viewheight
      this.physicsX = this.camera.position.x;
      this.physicsY = this.camera.position.y - DEFAULT_VIEWHEIGHT; // Convert from eyes to origin
      this.physicsZ = this.camera.position.z;
      this.smoothedY = this.physicsY;
      this.smoothingInitialized = true;
      console.log(`[FPS] Initialized at origin: (${this.physicsX.toFixed(1)}, ${this.physicsY.toFixed(1)}, ${this.physicsZ.toFixed(1)}), feet at Y=${originToFeet(this.physicsY).toFixed(1)}`);
    }

    // Restore physics position (ORIGIN level) at start of frame
    // This removes any viewport effect offsets that were applied for visuals
    this.camera.position.x = this.physicsX;
    this.camera.position.y = this.physicsY;
    this.camera.position.z = this.physicsZ;

    // === CALCULATE WISHDIR (desired movement direction) ===
    const forward = this.camera.getDirection(Vector3.Forward());
    const right = this.camera.getDirection(Vector3.Right());
    const flatForward = new Vector3(forward.x, 0, forward.z);
    const flatRight = new Vector3(right.x, 0, right.z);
    if (flatForward.length() > 0.001) flatForward.normalize();
    if (flatRight.length() > 0.001) flatRight.normalize();

    // Build wishdir from input
    let wishdir = Vector3.Zero();
    if (this.keys.forward) wishdir.addInPlace(flatForward);
    if (this.keys.backward) wishdir.subtractInPlace(flatForward);
    if (this.keys.left) wishdir.subtractInPlace(flatRight);
    if (this.keys.right) wishdir.addInPlace(flatRight);

    const hasInput = wishdir.length() > 0.001;
    if (hasInput) wishdir.normalize();

    // === Q3-STYLE PHYSICS ===

    // Detect autohop frame: just landed + holding jump + autohop enabled
    const autohop = mv.get('sv_autohop') > 0;
    const justLanded = !this.wasGroundedLastFrame && this.isGrounded;
    const willAutohop = autohop && justLanded && this.keys.up;

    if (this.isGrounded) {
      // === GROUND MOVEMENT ===

      // WARSOW: Skip friction on autohop frame to preserve bunny hop speed!
      if (!willAutohop) {
        // Apply friction (PM_Friction) - only when NOT auto-hopping
        const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
        if (speed > 1) {
          const control = speed < stopspeed ? stopspeed : speed;
          const drop = control * friction * deltaTime;
          let newSpeed = speed - drop;
          if (newSpeed < 0) newSpeed = 0;
          const scale = newSpeed / speed;
          this.velocity.x *= scale;
          this.velocity.z *= scale;
        } else {
          this.velocity.x = 0;
          this.velocity.z = 0;
        }

        // Apply acceleration toward wishdir (PM_Accelerate)
        if (hasInput) {
          // Strafe-only (A/D without W/S) always uses walking speed
          const holdingStrafe = this.keys.left || this.keys.right;
          const holdingForward = this.keys.forward || this.keys.backward;
          const groundWishspeed = (holdingStrafe && !holdingForward) ? mv.get('sv_movementSpeed') : wishspeed;

          const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
          const addspeed = groundWishspeed - currentspeed;
          if (addspeed > 0) {
            let accelspeed = accelerate * deltaTime * groundWishspeed;
            if (accelspeed > addspeed) accelspeed = addspeed;
            this.velocity.x += accelspeed * wishdir.x;
            this.velocity.z += accelspeed * wishdir.z;
          }
        }
      }
    } else {
      // === AIR MOVEMENT (Warsow-style from gs_pmove.c) ===
      // Reference: PM_AirMove, PM_AirAccelerate, PM_Aircontrol

      const holdingStrafe = this.keys.left || this.keys.right;
      const holdingForward = this.keys.forward || this.keys.backward;

      // Check if we're accelerating (moving roughly in wishdir direction)
      const velocityDotWish = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
      const isAccelerating = velocityDotWish > 0;

      if (hasInput) {
        if (holdingForward && !holdingStrafe && isAccelerating) {
          // MODE 1: PM_AirAccelerate - Forward only, moving forward
          // This is the MAIN speed gain mechanic in Warsow!
          // Note: turnaccel (4.0) inside airAccelerate handles turning, no separate airControl needed
          this.airAccelerate(wishdir, wishspeed, deltaTime);

        } else if (holdingStrafe && !holdingForward) {
          // MODE 2: STRAFE BUNNY - Strafe only (A/D, no W/S)
          // High acceleration (70) but capped wishspeed (30)
          const baseStrafeBunnyAccel = 50;  // pm_strafebunnyaccel (reduced from 70)
          const strafeWishspeed = Math.min(wishspeed, maxairspeed); // maxairspeed = 30

          // Two-stage falloff:
          // Stage 1 (400-600): Normal bunny hop zone with gradual falloff
          // Stage 2 (600+): Radical slowdown, nearly impossible to accelerate
          const curSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
          const runSpeed = mv.get('sv_runSpeed');   // 400 - falloff starts
          const radicalSpeed = 600;                  // Radical slowdown threshold
          const topspeed = mv.get('sv_topspeed');   // 1000 - hard cap

          let accelFalloff = 1.0;
          if (curSpeed > runSpeed) {
            if (curSpeed < radicalSpeed) {
              // Stage 1: Gradual falloff from 100% to ~50%
              const ratio = (curSpeed - runSpeed) / (radicalSpeed - runSpeed);
              accelFalloff = 1 - ratio * 0.5;  // Goes from 1.0 to 0.5
            } else {
              // Stage 2: Radical falloff from ~50% to 0%
              const ratio = (curSpeed - radicalSpeed) / (topspeed - radicalSpeed);
              accelFalloff = Math.max(0, 0.5 * (1 - ratio * ratio * ratio));  // Cubic, very aggressive
            }
          }

          const strafeBunnyAccel = baseStrafeBunnyAccel * accelFalloff;

          const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
          const addspeed = strafeWishspeed - currentspeed;

          if (addspeed > 0 && accelFalloff > 0.01) {
            let accelspeed = strafeBunnyAccel * deltaTime * strafeWishspeed;
            if (accelspeed > addspeed) accelspeed = addspeed;
            this.velocity.x += accelspeed * wishdir.x;
            this.velocity.z += accelspeed * wishdir.z;
          }

          // Debug log
          if (!FPSController._lastStrafeLog || Date.now() - FPSController._lastStrafeLog > 300) {
            FPSController._lastStrafeLog = Date.now();
            const newSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
            console.log(`[Air:StrafeBunny] falloff=${(accelFalloff * 100).toFixed(0)}% speed=${newSpeed.toFixed(0)}`);
          }

        } else {
          // MODE 3: Standard air movement (W+A/D, or W while decelerating)
          // Uses full wishspeed (NOT capped to 30) with low accel (1)
          // This provides meaningful acceleration toward camera direction

          // Two-stage falloff (same as strafe bunny)
          const curSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
          const runSpeed = mv.get('sv_runSpeed');   // 400 - falloff starts
          const radicalSpeed = 600;                  // Radical slowdown threshold
          const topspeed = mv.get('sv_topspeed');   // 1000 - hard cap

          let accelFalloff = 1.0;
          if (curSpeed > runSpeed) {
            if (curSpeed < radicalSpeed) {
              const ratio = (curSpeed - runSpeed) / (radicalSpeed - runSpeed);
              accelFalloff = 1 - ratio * 0.5;
            } else {
              const ratio = (curSpeed - radicalSpeed) / (topspeed - radicalSpeed);
              accelFalloff = Math.max(0, 0.5 * (1 - ratio * ratio * ratio));
            }
          }

          const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
          const addspeed = wishspeed - currentspeed;  // Full wishspeed, not capped!

          if (addspeed > 0 && accelFalloff > 0.01) {
            let accelspeed = airaccelerate * deltaTime * wishspeed * accelFalloff;
            if (accelspeed > addspeed) accelspeed = addspeed;
            this.velocity.x += accelspeed * wishdir.x;
            this.velocity.z += accelspeed * wishdir.z;
          }

          // Debug log
          if (!FPSController._lastStrafeLog || Date.now() - FPSController._lastStrafeLog > 300) {
            FPSController._lastStrafeLog = Date.now();
            const newSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
            console.log(`[Air:Normal] falloff=${(accelFalloff * 100).toFixed(0)}% speed=${newSpeed.toFixed(0)}`);
          }
        }
      }
    }

    // === GRAVITY ===
    if (!this.isGrounded) {
      this.velocity.y -= gravity * deltaTime;
    }

    // === JUMP ===
    // Reset jumpConsumed when key is released
    if (!this.keys.up) {
      this.jumpConsumed = false;
    }

    if (this.keys.up && this.isGrounded) {
      // Two modes:
      // 1. Normal jump: Require key release between jumps (jumpConsumed check)
      // 2. Auto-bunny hop: Jump automatically on landing frame when holding space
      // (autohop and justLanded already calculated above for friction skip)
      const canJump = !this.jumpConsumed || (autohop && justLanded);

      if (canJump) {
        this.velocity.y = jumpHeight;
        this.isGrounded = false;
        this.jumpConsumed = true;
      }
    }

    // === WALL JUMP ===
    const wallJumpEnabled = mv.get('sv_walljump') > 0;
    const wallJumpChargeTime = mv.get('sv_walljump_chargetime');

    // Handle wall jump state machine
    if (wallJumpEnabled) {
      if (this.wallJumpState === 'charging') {
        // Currently charging - stay locked, update timer
        this.wallJumpChargeTime += deltaTime;
        this.camera.position.copyFrom(this.wallJumpPosition);
        this.velocity.set(0, 0, 0);

        if (this.wallJumpChargeTime >= wallJumpChargeTime) {
          // Charge complete - execute push!
          this.executeWallJumpPush(mv);
        }
      } else if (this.wallJumpState === 'none') {
        // Check for new wall jump
        if (this.keys.up && !this.isGrounded && !this.jumpConsumed) {
          if (this.tryWallJump(mv, cm)) {
            this.jumpConsumed = true;  // Prevent repeat until key release
          }
        }
      }
    }

    // === BUILD MOVEMENT VECTOR FROM VELOCITY ===
    const movement = this.velocity.scale(deltaTime);

    // Store Y before movement for ground detection
    const prevY = this.camera.position.y;

    // === APPLY MOVEMENT WITH COLLISION ===
    if (movement.length() > 0) {
      if (FPSController.collisionEnabled) {
        if (FPSController.collisionMode === 'native') {
          this.nativeCollisionMove(movement);
        } else if (cm.isInitialized()) {
          // Use BSP collision with stepSlideMove for stair stepping
          const backend = (cm as any).backends?.get('q3');
          if (backend && typeof backend.stepSlideMove === 'function') {
            // Q3 style: camera.position is at ORIGIN level
            // stepSlideMove expects origin position, box extends -24 to +32 from there
            const traceOpts = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT };
            const result = backend.stepSlideMove(this.camera.position.clone(), movement, traceOpts);

            // Result is already at origin level - use directly
            this.camera.position.copyFrom(result.endPos);
          } else {
            // Fallback to local slideMove
            this.slideMove(movement, cm as ReturnType<typeof getCollisionManager>);
          }
        } else {
          this.camera.position.addInPlace(movement);
        }
      } else {
        this.camera.position.addInPlace(movement);
      }
    }

    // === CEILING DETECTION ===
    // If we were moving UP but didn't move as much as expected, we hit a ceiling
    // Zero vertical velocity immediately to prevent "floating" at ceiling
    const actualYMove = this.camera.position.y - prevY;
    const expectedYMove = movement.y;
    if (this.velocity.y > 0 && expectedYMove > 0.1) {
      // We wanted to move up significantly
      if (actualYMove < expectedYMove * 0.5) {
        // But we barely moved - hit ceiling!
        this.velocity.y = 0;
      }
    }

    // === GROUND DETECTION ===
    // Q3-style: Actively check for ground beneath player each frame
    // With asymmetric box, origin is 24 above feet, box extends 24 down from origin
    // Tracing down 2-4 units from origin checks if feet are near ground
    this.wasGroundedLastFrame = this.isGrounded;

    if (cm.isInitialized()) {
      const backend = (cm as any).backends?.get('q3');
      if (backend && typeof backend.trace === 'function') {
        // Q3 style: trace from origin down by a small amount
        // Box bottom (feet) is at origin - 24, so tracing origin down by 2
        // checks if feet are within 2 units of ground
        const groundCheckStart = this.camera.position.clone();
        const groundCheckEnd = groundCheckStart.add(new Vector3(0, -2, 0));

        // NOTE: Ground check uses PLAYER_HEIGHT always, not dynamic crouch height
        // Because Q3 crouch keeps origin at same waist level, feet move UP to -4 from -24
        // The ground trace needs to check from consistent origin height
        const traceOpts = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT };
        const groundTrace = backend.trace(groundCheckStart, groundCheckEnd, traceOpts);

        if (groundTrace.fraction < 1.0) {
          // Hit ground - but ONLY land if we're moving down or stationary
          // This prevents "landing" immediately after jumping (jetpack fix)
          if (this.velocity.y <= 0) {
            if (!this.isGrounded) {
              // Just landed this frame - capture velocity BEFORE zeroing!
              this.landingVelocityCapture = this.velocity.y;
              this.isGrounded = true;
            }
            // Zero vertical velocity when on ground
            if (this.velocity.y < 0) {
              this.velocity.y = 0;
            }
          }
          // If velocity.y > 0, we're going UP - don't land yet
        } else {
          // No ground beneath - start falling
          if (this.isGrounded) {
            this.isGrounded = false;
            // Small initial downward velocity to start falling
            if (this.velocity.y <= 0) {
              this.velocity.y = -1;
            }
          }
        }
      }
    } else {
      // Fallback: movement-based detection
      const actualYMove = this.camera.position.y - prevY;
      const expectedYMove = movement.y;
      // Only land if moving downward
      if (expectedYMove < -0.1 && actualYMove > expectedYMove * 0.5 && this.velocity.y <= 0) {
        this.isGrounded = true;
        if (this.velocity.y < 0) {
          this.velocity.y = 0;
        }
      }
    }

    // Debug log
    if (!FPSController._lastGroundLog || Date.now() - FPSController._lastGroundLog > 1000) {
      FPSController._lastGroundLog = Date.now();
      console.log(`[FPS] pos.y=${this.camera.position.y.toFixed(1)}, vel.y=${this.velocity.y.toFixed(1)}, grounded=${this.isGrounded}, ledge=${this.ledgeGrabState}`);
    }

    // === LEDGE GRAB SYSTEM ===
    const ledgeEnabled = mv.get('sv_ledgegrab') > 0;
    if (ledgeEnabled) {
      this.updateLedgeGrab(deltaTime, mv, cm);
    }

    // === CROUCHSLIDE SYSTEM ===
    this.updateCrouchslide(deltaTime, mv);

    // === SAVE PHYSICS POSITION AFTER COLLISION AND CALCULATE ACTUAL SPEED ===
    // Physics position is at ORIGIN level (24 above feet)
    const newPhysicsX = this.camera.position.x;
    const newPhysicsZ = this.camera.position.z;

    // Calculate actual horizontal speed from position delta (real movement, not input velocity)
    if (deltaTime > 0) {
      const dx = newPhysicsX - this.lastPhysicsX;
      const dz = newPhysicsZ - this.lastPhysicsZ;
      this.actualHorizSpeed = Math.sqrt(dx * dx + dz * dz) / deltaTime;
    }

    // Update last position for next frame
    this.lastPhysicsX = newPhysicsX;
    this.lastPhysicsZ = newPhysicsZ;
    this.physicsX = newPhysicsX;
    this.physicsY = this.camera.position.y;
    this.physicsZ = newPhysicsZ;

    // === SPEED DISPLAY (cl_showspeed) - Use actual speed, not velocity ===
    const showSpeed = mv.get('cl_showspeed') > 0;
    this.updateSpeedDisplay(showSpeed, this.actualHorizSpeed);

    // === VIEWPORT SMOOTHING (same pattern as FreeflyController) ===
    const heightDiff = Math.abs(this.physicsY - this.smoothedY);
    if (heightDiff > stepHeight * 2) {
      // Large change (teleport, big fall) - snap immediately
      this.smoothedY = this.physicsY;
    } else {
      // Smooth interpolation for stairs
      this.smoothedY = this.smoothedY + (this.physicsY - this.smoothedY) * smoothFactor;
    }

    // === APPLY VIEWHEIGHT ===
    // Physics runs at ORIGIN level, camera view is at origin + viewheight
    // Q3 viewheight = 26 (eyes are 26 units above origin, which is 50 above feet)
    const viewheight = DEFAULT_VIEWHEIGHT;

    // === CROUCH STATE ===
    // Camera lowers IMMEDIATELY when crouch key pressed OR when sliding
    // No grounded check - crouch should be instant and override other movement

    // Ceiling check: prevent standing up if blocked above
    let wantsToCrouch = this.keys.crouch || this.isSliding;
    const wasCrouching = this.isCrouching;

    // If trying to stand up from crouch, check for ceiling clearance
    if (wasCrouching && !wantsToCrouch && this.isGrounded) {
      const cm = getCollisionManager();
      if (cm.isInitialized()) {
        const backend = (cm as any).backends?.get('q3');
        if (backend && typeof backend.trace === 'function') {
          // Check for 20 units of headroom (PLAYER_HEIGHT 56 - CROUCH_HEIGHT 36 = 20)
          const headroom = PLAYER_HEIGHT - CROUCH_HEIGHT;
          const ceilingCheckStart = this.camera.position.clone();
          const ceilingCheckEnd = ceilingCheckStart.add(new Vector3(0, headroom, 0));

          // Use small height for the trace (point trace essentially)
          const ceilingTrace = backend.trace(ceilingCheckStart, ceilingCheckEnd, { radius: PLAYER_RADIUS, height: 4 });

          if (ceilingTrace.fraction < 1.0) {
            // Blocked! Force player to stay crouched
            wantsToCrouch = true;
            // Optional: debug log
            // console.log('[Crouch] Blocked by ceiling, cannot stand');
          }
        }
      }
    }

    this.isCrouching = wantsToCrouch;

    // Smoothly interpolate crouch offset
    const targetCrouchOffset = this.isCrouching ? FPSController.CROUCH_HEIGHT_OFFSET : 0;
    this.crouchViewOffset += (targetCrouchOffset - this.crouchViewOffset) * FPSController.CROUCH_TRANSITION_SPEED;

    // Apply smoothed origin Y + viewheight + crouch offset for rendering
    this.camera.position.y = this.smoothedY + viewheight + this.crouchViewOffset;

    // === PICKUP CHECK ===
    EntityManager.getInstance().checkPickups(this.camera.position, this.inventory);

    // === WEAPON FIRING ===
    this.updateFiring(deltaTime);

    // === VIEWPORT EFFECTS ===
    if (this.viewportEffectsManager && this.viewportApplicator) {
      // Reset camera rotation to mouse-controlled values before applying effects
      this.camera.rotation.x = this.mouseRotationX;
      this.camera.rotation.y = this.mouseRotationY;
      this.camera.rotation.z = 0;  // Roll is never user-controlled in FPS

      // Note: landingVelocityCapture is set in ground detection (before velocity is zeroed)

      const playerState: PlayerState = {
        position: this.camera.position.clone(),
        velocity: this.velocity.clone(),
        horizontalSpeed: this.actualHorizSpeed,
        isGrounded: this.isGrounded,
        wasGroundedLastFrame: this.wasGroundedLastFrame,
        isJumping: this.keys.up && this.isGrounded,
        strafeInput: (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0),
        forwardInput: (this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0),
        landingVelocity: this.landingVelocityCapture,
        wallJumpState: this.wallJumpState,
        isSprinting: this.keys.sprint,
        isAiming: this.keys.aim,
        isFiring: this.keys.fire,
        isSliding: this.isSliding,
      };

      const viewportDelta = this.viewportEffectsManager.update(deltaTime, playerState);
      this.viewportApplicator.apply(viewportDelta, this.camera, this.baseFOV);
    }

    // === DEBUG BBOX VISUALIZATION ===
    this.updateDebugBbox();
  }

  // Speed display element
  private static speedDisplayEl: HTMLDivElement | null = null;

  /**
   * Update on-screen speed display
   */
  private updateSpeedDisplay(show: boolean, speed: number): void {
    if (show) {
      if (!FPSController.speedDisplayEl) {
        // Create speed display element
        const el = document.createElement('div');
        el.id = 'fps-speed-display';
        el.style.cssText = `
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          font-family: monospace;
          font-size: 24px;
          font-weight: bold;
          color: #0f0;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
          z-index: 9999;
          pointer-events: none;
        `;
        document.body.appendChild(el);
        FPSController.speedDisplayEl = el;
      }
      FPSController.speedDisplayEl.textContent = `${Math.round(speed)} u/s`;
      FPSController.speedDisplayEl.style.display = 'block';
    } else if (FPSController.speedDisplayEl) {
      FPSController.speedDisplayEl.style.display = 'none';
    }
  }

  /**
   * Q3-style clip velocity - project velocity onto plane
   */
  // @ts-ignore - kept for future slope movement
  private clipVelocity(vel: Vector3, normal: Vector3, overbounce: number): Vector3 {
    let backoff = Vector3.Dot(vel, normal);

    if (backoff < 0) {
      backoff *= overbounce;
    } else {
      backoff /= overbounce;
    }

    return vel.subtract(normal.scale(backoff));
  }

  /**
   * Update debug bbox visualization
   * Shows a red wireframe box 100 units ahead of player that mirrors current player bbox
   * Enabled via cl_debugbbox cvar (0 = off, 1 = on)
   */
  private updateDebugBbox(): void {
    if (!this.camera || !this.scene) return;

    const debugCvar = Cvar.get('cl_debugbbox');
    const debugEnabled = debugCvar !== undefined && Number(debugCvar) > 0;

    if (!debugEnabled) {
      // Hide mesh if exists
      if (this.debugBboxMesh) {
        this.debugBboxMesh.isVisible = false;
      }
      return;
    }

    // Get current bbox dimensions using Q3 constants
    // Standing: minsZ = -24, maxsZ = +32 (origin at waist)
    // Crouched: minsZ = -4, maxsZ = +32 (feet move UP, head stays same)
    const isCrouched = this.isCrouching || this.isSliding;
    const minsZ = isCrouched ? CROUCH_MINS_Z : PLAYER_MINS_Z;  // -4 or -24
    const maxsZ = PLAYER_MAXS_Z;  // Always +32
    const radius = PLAYER_RADIUS;
    const height = maxsZ - minsZ;  // 36 or 56

    // Check if we need to recreate the mesh (height changed)
    const needsRecreate = !this.debugBboxMesh || (this.debugBboxMesh as any).lastHeight !== height;

    if (needsRecreate) {
      // Dispose old mesh
      if (this.debugBboxMesh) {
        this.debugBboxMesh.dispose();
      }

      // Create wireframe box points (8 corners of rectangular prism)
      // Create at origin, we'll position it via mesh.position
      const minX = -radius, maxX = radius;
      const minY = minsZ, maxY = maxsZ;
      const minZ = -radius, maxZ = radius;

      const corners = [
        new Vector3(minX, minY, minZ), // 0 bottom-back-left
        new Vector3(maxX, minY, minZ), // 1 bottom-back-right
        new Vector3(maxX, minY, maxZ), // 2 bottom-front-right
        new Vector3(minX, minY, maxZ), // 3 bottom-front-left
        new Vector3(minX, maxY, minZ), // 4 top-back-left
        new Vector3(maxX, maxY, minZ), // 5 top-back-right
        new Vector3(maxX, maxY, maxZ), // 6 top-front-right
        new Vector3(minX, maxY, maxZ), // 7 top-front-left
      ];

      // Create line strip for wireframe box (12 edges)
      const lines: Vector3[][] = [
        // Bottom face
        [corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[3]], [corners[3], corners[0]],
        // Top face
        [corners[4], corners[5]], [corners[5], corners[6]], [corners[6], corners[7]], [corners[7], corners[4]],
        // Vertical edges
        [corners[0], corners[4]], [corners[1], corners[5]], [corners[2], corners[6]], [corners[3], corners[7]],
      ];

      this.debugBboxMesh = MeshBuilder.CreateLineSystem('debug_bbox', { lines }, this.scene);
      (this.debugBboxMesh as any).lastHeight = height; // Store for comparison
      (this.debugBboxMesh as any).isCrouchedMesh = isCrouched; // Also track crouch state
    }

    // Position mesh ahead of player based on cl_debugbbox_offset cvar
    const offsetCvar = Cvar.get('cl_debugbbox_offset');
    const offset = offsetCvar !== undefined ? Number(offsetCvar) : 100;

    const forward = this.camera.getForwardRay().direction;
    forward.y = 0;
    forward.normalize();
    const aheadPos = this.camera.position.add(forward.scale(offset));

    // Correct crouch behavior: feet stay on ground, head lowers
    // When crouched, origin drops by (PLAYER_MINS_Z - CROUCH_MINS_Z) = 20 units
    // to keep feet at the same level as standing
    const crouchOriginDrop = isCrouched ? (PLAYER_MINS_Z - CROUCH_MINS_Z) : 0;  // -24 - (-4) = -20
    aheadPos.y = this.physicsY + crouchOriginDrop;

    this.debugBboxMesh!.position.copyFrom(aheadPos);
    this.debugBboxMesh!.isVisible = true;
  }


  /**
   * Warsow PM_AirAccelerate - Main bunny hop speed gain mechanic
   * Called when holding forward only (no strafe) and moving forward
   *
   * This allows gaining speed beyond normal limits up to bunnytopspeed (925)
   */
  private airAccelerate(wishdir: Vector3, wishspeed: number, deltaTime: number): void {
    const mv = MovementVars.getInstance();
    const maxPlayerSpeed = mv.get('sv_movementSpeed'); // ~320
    const topspeed = mv.get('sv_topspeed');  // Hard cap (default 1000)
    const runSpeed = mv.get('sv_runSpeed');  // 400 - falloff starts
    const radicalSpeed = 600;                 // Radical slowdown threshold

    // Warsow-style constants
    const airforwardaccel = 1.00001;
    const bunnyaccel = 0.1593;
    const turnaccel = 4.0;
    const backtosideratio = 0.8;

    // Get current horizontal velocity and speed
    const curvelX = this.velocity.x;
    const curvelZ = this.velocity.z;
    const curspeed = Math.sqrt(curvelX * curvelX + curvelZ * curvelZ);

    // Two-stage falloff (same as strafe modes)
    let accelFalloff = 1.0;
    if (curspeed > runSpeed) {
      if (curspeed < radicalSpeed) {
        const ratio = (curspeed - runSpeed) / (radicalSpeed - runSpeed);
        accelFalloff = 1 - ratio * 0.5;  // 100% -> 50%
      } else {
        const ratio = (curspeed - radicalSpeed) / (topspeed - radicalSpeed);
        accelFalloff = Math.max(0, 0.5 * (1 - ratio * ratio * ratio));  // 50% -> 0% cubic
      }
    }

    // Calculate target wishspeed based on current speed
    let targetWishspeed: number;
    if (wishspeed > curspeed * 1.01) {
      // Below max speed: accelerate toward wishspeed
      const accelspeed = curspeed + airforwardaccel * maxPlayerSpeed * deltaTime * accelFalloff;
      targetWishspeed = Math.min(wishspeed, accelspeed);
    } else {
      // At or above max speed: bunny acceleration
      // Use topspeed as internal target so bunny mechanics work, but apply our falloff
      const f = Math.max(0, (topspeed - curspeed) / (topspeed - maxPlayerSpeed));
      targetWishspeed = Math.max(curspeed, maxPlayerSpeed) + bunnyaccel * f * accelFalloff * maxPlayerSpeed * deltaTime;
    }

    // Calculate wish velocity and acceleration direction
    const wishvelX = wishdir.x * targetWishspeed;
    const wishvelZ = wishdir.z * targetWishspeed;
    let accelDirX = wishvelX - curvelX;
    let accelDirZ = wishvelZ - curvelZ;

    // Normalize acceldir and get addspeed
    const accelDirLen = Math.sqrt(accelDirX * accelDirX + accelDirZ * accelDirZ);
    if (accelDirLen < 0.001) return;

    accelDirX /= accelDirLen;
    accelDirZ /= accelDirLen;
    const addspeed = accelDirLen;

    // Calculate acceleration with turn rate limit
    let accelspeed = turnaccel * maxPlayerSpeed * deltaTime;
    if (accelspeed > addspeed) accelspeed = addspeed;

    // Back-to-side ratio: reduce backwards acceleration
    if (backtosideratio < 1.0 && curspeed > 0.001) {
      const curDirX = curvelX / curspeed;
      const curDirZ = curvelZ / curspeed;
      const dot = accelDirX * curDirX + accelDirZ * curDirZ;
      if (dot < 0) {
        // Reduce acceleration in the backwards direction
        accelDirX -= (1.0 - backtosideratio) * dot * curDirX;
        accelDirZ -= (1.0 - backtosideratio) * dot * curDirZ;
      }
    }

    // Apply acceleration
    this.velocity.x += accelspeed * accelDirX;
    this.velocity.z += accelspeed * accelDirZ;

    // Debug log
    if (!FPSController._lastStrafeLog || Date.now() - FPSController._lastStrafeLog > 300) {
      FPSController._lastStrafeLog = Date.now();
      const newSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      console.log(`[Air:Accelerate] curspeed=${curspeed.toFixed(0)} -> ${newSpeed.toFixed(0)} (target=${targetWishspeed.toFixed(0)})`);
    }
  }

  /**
   * Warsow PM_Aircontrol - Curves velocity toward wishdir
   * EXACT formula from gs_pmove.c: k = 32 * aircontrol * dot * dot * frametime
   *
   * This pushes velocity toward where you're looking while preserving speed.
   * Currently unused in newmovement (FWDBUNNY) mode - kept for oldmovement support.
   */
  // @ts-ignore - kept for oldmovement style support
  private airControl(wishdir: Vector3, deltaTime: number): void {
    const mv = MovementVars.getInstance();
    const aircontrol = mv.get('sv_aircontrol'); // Default 150

    if (aircontrol === 0) return;

    // Get horizontal speed
    const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    if (speed < 1) return;

    // Normalize horizontal velocity
    let velDirX = this.velocity.x / speed;
    let velDirZ = this.velocity.z / speed;

    // Dot product: how aligned is velocity with wishdir?
    const dot = velDirX * wishdir.x + velDirZ * wishdir.z;

    // Warsow formula: k = 32 * aircontrol * dot^2 * frametime
    const k = 32.0 * aircontrol * dot * dot * deltaTime;

    if (dot > 0) {
      // Push velocity toward wishdir: velocity = velocity * speed + wishdir * k
      velDirX = velDirX * speed + wishdir.x * k;
      velDirZ = velDirZ * speed + wishdir.z * k;

      // Renormalize
      const newLen = Math.sqrt(velDirX * velDirX + velDirZ * velDirZ);
      if (newLen > 0.001) {
        velDirX /= newLen;
        velDirZ /= newLen;
      }
    }

    // Restore original speed (air control doesn't change speed)
    this.velocity.x = velDirX * speed;
    this.velocity.z = velDirZ * speed;
  }

  /**
   * Ledge grab state machine
   * Handles detection, grabbing, pull-up animation, and release
   */
  private updateLedgeGrab(
    deltaTime: number,
    mv: MovementVars,
    cm: ReturnType<typeof getCollisionManager>
  ): void {
    if (!this.camera) return;

    const ledgeReach = mv.get('sv_ledge_reach');
    const ledgeHeight = mv.get('sv_ledge_height');
    const ledgeMinFall = mv.get('sv_ledge_minfall');
    const ledgeTimeout = mv.get('sv_ledge_timeout');
    const ledgePullTime = mv.get('sv_ledge_pulltime');
    const eyeOffset = mv.get('sv_eyeoffset');

    // State machine
    switch (this.ledgeGrabState) {
      case 'none':
        // Check for ledge grab conditions
        if (this.shouldGrabLedge(cm, ledgeReach, ledgeHeight, ledgeMinFall)) {
          this.enterGrabbingState(eyeOffset, ledgeReach);
        }
        break;

      case 'grabbing':
        this.ledgeGrabTime += deltaTime;

        // Check for release conditions
        if (this.shouldReleaseLedge(ledgeTimeout)) {
          this.exitGrabbingState(false); // Drop
        } else if (this.keys.forward || this.keys.up) {
          // Start pull-up
          this.enterPullingState(ledgeHeight, ledgeReach);
        } else {
          // Stay hanging - lock position
          this.camera.position.copyFrom(this.ledgeGrabPosition);
          this.velocity.set(0, 0, 0);
        }
        break;

      case 'pulling':
        this.ledgeGrabTime += deltaTime;
        const pullProgress = Math.min(1, this.ledgeGrabTime / ledgePullTime);

        // Eased pull-up animation
        const t = this.easeInOutQuad(pullProgress);
        const newPos = Vector3.Lerp(this.ledgeGrabPosition, this.ledgeTargetPosition, t);
        this.camera.position.copyFrom(newPos);

        // Update physics position too (physicsY is at origin level)
        this.physicsX = newPos.x;
        this.physicsY = newPos.y;  // Already at origin level
        this.physicsZ = newPos.z;

        if (pullProgress >= 1) {
          // Finished pull-up
          this.exitGrabbingState(true); // Land on ledge
        }
        break;
    }
  }

  /**
   * Crouchslide state machine
   * Handles entry, physics, exit, and camera effects
   */
  private updateCrouchslide(deltaTime: number, mv: MovementVars): void {
    const slideEnabled = mv.get('sv_slide') > 0;
    if (!slideEnabled) {
      if (this.isSliding) this.exitSlide();
      return;
    }

    const now = Date.now();
    const slideDuration = mv.get('sv_slideDuration');
    const slideMinSpeed = mv.get('sv_slideMinSpeed');
    const slideCooldown = mv.get('sv_slideCooldown');
    const slideSpeedMult = mv.get('sv_slideSpeedMultiplier');
    const slideDecay = mv.get('sv_slideDecay');
    const slideFriction = mv.get('sv_slideFriction');
    const slideJumpBoost = mv.get('sv_slideJumpBoost');
    const slideCameraTilt = mv.get('sv_slideCameraTilt');

    // Calculate current horizontal speed
    const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

    // === SLIDE ENTRY ===
    if (!this.isSliding && this.keys.crouch && this.isGrounded) {
      const cooldownPassed = (now - this.lastSlideEndTime) >= slideCooldown;

      if (horizSpeed >= slideMinSpeed && cooldownPassed) {
        // Enter slide!
        this.isSliding = true;
        this.slideStartTime = now;

        // Lock velocity direction at entry
        this.slideVelocity = this.velocity.clone();
        this.slideVelocity.y = 0;
        this.slideVelocity.normalize();

        // Store entry speed for momentum preservation
        this.slideEntrySpeed = horizSpeed * slideSpeedMult;

        // Store entry pitch for axis lock
        this.slideEntryPitch = this.mouseRotationX;

        // Apply speed multiplier immediately
        this.velocity.x = this.slideVelocity.x * this.slideEntrySpeed;
        this.velocity.z = this.slideVelocity.z * this.slideEntrySpeed;

        console.log(`[Slide] Entered at speed ${this.slideEntrySpeed.toFixed(0)}`);
      }
    }

    // === SLIDING PHYSICS ===
    if (this.isSliding) {
      const slideElapsed = now - this.slideStartTime;

      // Force ADS off while sliding
      this.keys.aim = false;

      // === CAMERA PITCH TILT (look up effect) with smooth 400ms in/out ===
      // Calculate tilt intensity based on slide time (400ms fade in, 400ms fade out)
      let tiltIntensity: number;
      const fadeIn = FPSController.SLIDE_FADE_MS;
      const fadeOut = FPSController.SLIDE_FADE_MS;
      const timeRemaining = slideDuration - slideElapsed;

      if (slideElapsed < fadeIn) {
        // Fade in: 0 → 1 over first 400ms (smoothstep for smooth ease)
        const t = slideElapsed / fadeIn;
        tiltIntensity = t * t * (3 - 2 * t); // smoothstep
      } else if (timeRemaining < fadeOut) {
        // Fade out: 1 → 0 over last 400ms (smoothstep)
        const t = timeRemaining / fadeOut;
        tiltIntensity = t * t * (3 - 2 * t); // smoothstep
      } else {
        // Full tilt in the middle
        tiltIntensity = 1;
      }

      const targetPitch = this.slideEntryPitch + (FPSController.SLIDE_PITCH_TILT * tiltIntensity);
      this.slideCameraPitch = targetPitch; // Direct set, smoothing handled by intensity

      // Lock vertical look axis during slide - override mouse rotation X
      this.mouseRotationX = this.slideCameraPitch;

      // === SPEED DECAY ===
      // Preserve full speed for first 500ms, then start decaying
      let currentSlideSpeed: number;
      if (slideElapsed < FPSController.SLIDE_JUMP_GRACE_MS) {
        // Grace period - maintain entry speed
        currentSlideSpeed = this.slideEntrySpeed;
      } else {
        // After grace, apply friction and decay
        const decayElapsed = slideElapsed - FPSController.SLIDE_JUMP_GRACE_MS;
        const decayDuration = slideDuration - FPSController.SLIDE_JUMP_GRACE_MS;
        const decayProgress = Math.min(1, decayElapsed / decayDuration);

        // Decay from entry speed down to crouch walk speed
        const crouchSpeed = mv.get('sv_movementSpeed') * mv.get('cl_crouchmult');
        currentSlideSpeed = this.slideEntrySpeed + (crouchSpeed - this.slideEntrySpeed) * decayProgress;
      }

      // Update velocity in slide direction
      this.velocity.x = this.slideVelocity.x * currentSlideSpeed;
      this.velocity.z = this.slideVelocity.z * currentSlideSpeed;

      // Camera roll tilt (optional - currently disabled, using pitch instead)
      // this.slideCameraRoll += (slideCameraTilt - this.slideCameraRoll) * 0.2;
      // if (this.camera) this.camera.rotation.z = this.slideCameraRoll * Math.PI / 180;

      // === SLIDE EXIT CONDITIONS ===

      // Timeout - slide ends and player crouches at crouch speed
      if (slideElapsed >= slideDuration) {
        console.log('[Slide] Exit: Timeout');
        this.exitSlide();
        return;
      }

      // Release crouch
      if (!this.keys.crouch) {
        console.log('[Slide] Exit: Released crouch');
        this.exitSlide();
        return;
      }

      // Jump cancel - only available AFTER grace period (500ms)
      if (this.keys.up && slideElapsed >= FPSController.SLIDE_JUMP_GRACE_MS) {
        // Track hold time for boost detection
        this.slideJumpHoldTime += deltaTime;

        // Hold threshold for boost (200ms)
        if (this.slideJumpHoldTime >= 0.2) {
          // BOOST JUMP!
          console.log(`[Slide] Boost Jump! Speed ${(currentSlideSpeed * slideJumpBoost).toFixed(0)}`);
          this.velocity.x = this.slideVelocity.x * currentSlideSpeed * slideJumpBoost;
          this.velocity.z = this.slideVelocity.z * currentSlideSpeed * slideJumpBoost;
          this.velocity.y = mv.get('sv_jumpheight');
          this.isGrounded = false;
          this.exitSlide();
          return;
        }
      } else if (!this.keys.up) {
        // Reset hold time if not holding jump
        if (this.slideJumpHoldTime > 0 && this.slideJumpHoldTime < 0.2 && slideElapsed >= FPSController.SLIDE_JUMP_GRACE_MS) {
          // TAP JUMP - quick stand without boost
          console.log('[Slide] Exit: Tap jump (stand)');
          this.exitSlide();
          return;
        }
        this.slideJumpHoldTime = 0;
      }

      // Left ground (fell off edge)
      // NOTE: Disabled strict ground check - ground detection flickers during slide physics.
      // Instead, let the slide naturally end via timeout, speed, or user input.
      // If player slides off a ledge, they'll just become airborne with slide velocity.
      // if (!this.isGrounded) {
      //   console.log('[Slide] Exit: Left ground');
      //   this.exitSlide();
      //   return;
      // }
    } else {
      // Not sliding - reset camera tilt
      if (Math.abs(this.slideCameraRoll) > 0.01) {
        this.slideCameraRoll *= 0.8; // Smooth return to 0
        if (this.camera) {
          this.camera.rotation.z = this.slideCameraRoll * Math.PI / 180;
        }
      }
    }
  }

  /**
   * Exit slide state and record cooldown
   */
  private exitSlide(): void {
    this.isSliding = false;
    this.lastSlideEndTime = Date.now();
    this.slideJumpHoldTime = 0;

    // Reset camera pitch to entry value (unlock Y-axis look)
    // The smooth return will happen as slideCameraPitch lerps back
    this.slideCameraPitch = this.slideEntryPitch;
    this.slideEntrySpeed = 0;
  }

  /**
   * Check if conditions are met for ledge grab
   */
  private shouldGrabLedge(
    cm: ReturnType<typeof getCollisionManager>,
    ledgeReach: number,
    ledgeHeight: number,
    ledgeMinFall: number
  ): boolean {
    if (!this.camera || !cm.isInitialized()) return false;

    // Must be falling and moving forward
    if (this.velocity.y >= ledgeMinFall) return false;
    if (this.isGrounded) return false;
    if (!this.keys.forward) return false;

    const backend = (cm as any).backends?.get('q3');
    if (!backend?.trace) return false;

    // STAIR CHECK: Don't grab if ground is close below (we can just walk)
    // Minimum height above ground required for ledge grab (measured from feet)
    // Camera is at origin (24 above feet), so we check origin - (40 + 24) = origin - 64
    const minHeightAboveGround = 40 + PLAYER_ORIGIN_HEIGHT;  // Must be falling a decent amount
    const groundCheckStart = this.camera.position.clone();
    const groundCheckEnd = groundCheckStart.add(new Vector3(0, -minHeightAboveGround, 0));
    const groundCheck = backend.trace(groundCheckStart, groundCheckEnd, { radius: 8, height: 16 });

    if (groundCheck.fraction < 1.0) {
      // Ground is too close - this is probably stairs
      return false;
    }

    // Get forward direction (flattened)
    const forward = this.camera.getDirection(Vector3.Forward());
    const flatForward = new Vector3(forward.x, 0, forward.z).normalize();

    // Heights relative to ORIGIN (camera.position is at origin level)
    // In Q3 system: origin is 24 above feet
    // Chest at feet+32 = origin+8, Head at feet+48 = origin+24
    const chestHeightFromOrigin = 32 - PLAYER_ORIGIN_HEIGHT; // 8
    const headHeightFromOrigin = 48 - PLAYER_ORIGIN_HEIGHT;  // 24
    const armReach = 16;
    const traceOpts = { radius: 8, height: 16 };

    // Trace 1: Chest height - should HIT wall
    // Chest at origin + 8
    const chestStart = this.camera.position.add(new Vector3(0, chestHeightFromOrigin, 0));
    const chestEnd = chestStart.add(flatForward.scale(ledgeReach));
    const chestTrace = backend.trace(chestStart, chestEnd, traceOpts);

    if (chestTrace.fraction >= 1.0) return false; // No wall at chest

    // SLOPE CHECK: Reject if wall is too sloped (e.g. 45-degree ramp)
    // A vertical wall has normal.y ~ 0
    // A 45-degree slope has normal.y ~ 0.707
    if (chestTrace.normal && Math.abs(chestTrace.normal.y) > 0.5) {
      return false;
    }

    // Trace 2: Head + arm reach - should be CLEAR (ledge exists)
    // Head + arm at origin + 24 + 16 = origin + 40
    const headStart = this.camera.position.add(new Vector3(0, headHeightFromOrigin + armReach, 0));
    const headEnd = headStart.add(flatForward.scale(ledgeReach));
    const headTrace = backend.trace(headStart, headEnd, traceOpts);

    if (headTrace.fraction < 1.0) return false; // Blocked above - no ledge

    // Trace 3: Check there's room ABOVE us to pull up (not in a corner)
    const upStart = this.camera.position.clone();
    const upEnd = upStart.add(new Vector3(0, ledgeHeight * 0.8, 0));
    const upTrace = backend.trace(upStart, upEnd, { radius: 12, height: 48 });

    if (upTrace.fraction < 0.9) {
      console.log('[LedgeGrab] Rejected: no room above');
      return false; // Would hit ceiling
    }

    // Trace 4: Check target position is valid (not in solid)
    const targetPos = this.camera.position.add(new Vector3(0, ledgeHeight * 0.8, 0))
      .add(flatForward.scale(ledgeReach * 0.5));
    const targetTrace = backend.trace(this.camera.position, targetPos, { radius: 12, height: 48 });

    if (targetTrace.fraction < 0.8) {
      console.log('[LedgeGrab] Rejected: target in solid');
      return false; // Target position is blocked
    }

    // Store wall normal for later
    if (chestTrace.normal) {
      this.ledgeWallNormal.copyFrom(chestTrace.normal);
    } else {
      this.ledgeWallNormal = flatForward.scale(-1); // Fallback: opposite of forward
    }

    console.log('[LedgeGrab] Detected valid ledge!');
    return true;
  }

  /**
   * Enter the grabbing state
   */
  private enterGrabbingState(_eyeOffset: number, _ledgeReach: number): void {
    if (!this.camera) return;

    this.ledgeGrabState = 'grabbing';
    this.ledgeGrabTime = 0;
    this.ledgePreGrabVelocity.copyFrom(this.velocity);
    this.ledgeGrabPosition.copyFrom(this.camera.position);

    // Lower camera slightly (hanging from hands)
    this.ledgeGrabPosition.y -= 12;

    // Zero velocity
    this.velocity.set(0, 0, 0);
    this.isGrounded = false;

    console.log('[LedgeGrab] Grabbing ledge!');
  }

  /**
   * Check if player should release the ledge
   */
  private shouldReleaseLedge(ledgeTimeout: number): boolean {
    // Timeout
    if (this.ledgeGrabTime >= ledgeTimeout) return true;

    // Moving backward
    if (this.keys.backward) return true;

    // Looking away from wall (dot product with wall normal > 0.5 means facing away)
    if (this.camera) {
      const forward = this.camera.getDirection(Vector3.Forward());
      const flatForward = new Vector3(forward.x, 0, forward.z).normalize();
      const dot = flatForward.x * this.ledgeWallNormal.x + flatForward.z * this.ledgeWallNormal.z;
      if (dot > 0.5) return true; // Facing away from wall
    }

    return false;
  }

  /**
   * Enter the pulling state (climbing up)
   */
  private enterPullingState(ledgeHeight: number, ledgeReach: number): void {
    if (!this.camera) return;

    this.ledgeGrabState = 'pulling';
    this.ledgeGrabTime = 0;

    // Calculate target position: above ledge and forward onto it
    const forward = this.camera.getDirection(Vector3.Forward());
    const flatForward = new Vector3(forward.x, 0, forward.z).normalize();

    this.ledgeTargetPosition.copyFrom(this.ledgeGrabPosition);
    this.ledgeTargetPosition.y += ledgeHeight * 0.8; // Pull up
    this.ledgeTargetPosition.addInPlace(flatForward.scale(ledgeReach * 0.5)); // Forward onto ledge

    console.log('[LedgeGrab] Pulling up!');
  }

  /**
   * Exit grabbing state
   */
  private exitGrabbingState(landed: boolean): void {
    if (landed) {
      // Landed on ledge
      this.isGrounded = true;
      this.velocity.set(0, 0, 0);
      // Give small forward velocity
      const forward = this.camera?.getDirection(Vector3.Forward()) ?? Vector3.Forward();
      const flatForward = new Vector3(forward.x, 0, forward.z).normalize();
      this.velocity.x = flatForward.x * 100;
      this.velocity.z = flatForward.z * 100;
      console.log('[LedgeGrab] Landed on ledge!');
    } else {
      // Dropped
      this.velocity.x = this.ledgePreGrabVelocity.x * 0.5;
      this.velocity.z = this.ledgePreGrabVelocity.z * 0.5;
      this.velocity.y = -50; // Small downward kick
      console.log('[LedgeGrab] Dropped from ledge!');
    }

    this.ledgeGrabState = 'none';
    this.ledgeGrabTime = 0;
  }

  /**
   * Easing function for smooth animation
   */
  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /**
   * Try to perform a wall jump
   * Returns true if successful
   */
  private tryWallJump(
    mv: MovementVars,
    cm: ReturnType<typeof getCollisionManager>
  ): boolean {
    if (!this.camera || !cm.isInitialized()) return false;

    const wallJumpHeight = mv.get('sv_walljump_height');
    const wallJumpBounce = mv.get('sv_walljump_bounce');
    const wallJumpReach = mv.get('sv_walljump_reach');
    const wallJumpCooldown = mv.get('sv_walljump_cooldown');
    const wallJumpMinHeight = mv.get('sv_walljump_minheight');

    const currentTime = performance.now() / 1000;

    // Check cooldown
    if (currentTime - this.lastWallJumpTime < wallJumpCooldown) {
      return false;
    }

    const backend = (cm as any).backends?.get('q3');
    if (!backend?.trace) return false;

    // Check height above ground (prevent stair triggers)
    const groundCheckStart = this.camera.position.clone();
    const groundCheckEnd = groundCheckStart.add(new Vector3(0, -wallJumpMinHeight, 0));
    const groundCheck = backend.trace(groundCheckStart, groundCheckEnd, { radius: 8, height: 16 });

    if (groundCheck.fraction < 1.0) {
      return false;  // Too close to ground
    }

    // Get forward direction (flattened)
    const forward = this.camera.getDirection(Vector3.Forward());
    const flatForward = new Vector3(forward.x, 0, forward.z).normalize();

    // Try multiple directions to find a wall
    const directions = [
      flatForward,  // Forward
      new Vector3(flatForward.x * 0.707 - flatForward.z * 0.707, 0, flatForward.x * 0.707 + flatForward.z * 0.707),  // Forward-right 45°
      new Vector3(flatForward.x * 0.707 + flatForward.z * 0.707, 0, -flatForward.x * 0.707 + flatForward.z * 0.707), // Forward-left 45°
      new Vector3(-flatForward.z, 0, flatForward.x),   // Right 90°
      new Vector3(flatForward.z, 0, -flatForward.x),   // Left 90°
    ];

    let wallNormal: Vector3 | null = null;
    let wallHit = false;

    for (const dir of directions) {
      const traceStart = this.camera.position.clone();
      const traceEnd = traceStart.add(dir.scale(wallJumpReach));
      const trace = backend.trace(traceStart, traceEnd, { radius: 12, height: 40 });

      if (trace.fraction < 1.0 && trace.normal) {
        // Check if this is a VERTICAL wall, not a ledge/floor
        // A proper wall has normal.y close to 0 (pointing sideways)
        // A floor/ledge has normal.y close to 1 (pointing up)
        const normalY = Math.abs(trace.normal.y);
        if (normalY > 0.5) {
          // This is more like a floor/ledge than a wall - skip
          continue;
        }

        // Found a valid vertical wall
        wallNormal = new Vector3(trace.normal.x, 0, trace.normal.z).normalize();
        wallHit = true;
        break;
      } else if (trace.fraction < 1.0) {
        // Fallback: opposite of trace direction (assume vertical wall)
        wallNormal = dir.scale(-1);
        wallHit = true;
        break;
      }
    }

    if (!wallHit || !wallNormal) {
      return false;  // No wall found
    }

    // Check we're moving toward the wall (dot product < 0)
    const velDot = this.velocity.x * wallNormal.x + this.velocity.z * wallNormal.z;
    if (velDot > -10) {
      return false;  // Not moving toward wall
    }

    // Check if we should use instant bounce or charged push
    const chargeTime = mv.get('sv_walljump_chargetime');

    if (chargeTime <= 0) {
      // Instant bounce (old behavior) with speed-based scaling
      // At low speed: push mostly UP for ledge climbing
      // At high speed: push normally with horizontal momentum
      // Use ACTUAL speed (position-based), not velocity (input intention)
      const runSpeed = mv.get('sv_runSpeed');
      const curSpeed = this.actualHorizSpeed;  // Real movement speed
      const speedFactor = Math.max(0.8, Math.min(1.0, curSpeed / runSpeed));  // Min 0.8 = always 80% horizontal push
      const horizontalScale = speedFactor;
      const verticalScale = 1.0 + (1.0 - speedFactor) * 1.0; // 1.20 at min speed (20% vertical boost)

      const dot = this.velocity.x * wallNormal.x + this.velocity.z * wallNormal.z;
      const reflectedX = this.velocity.x - 2 * dot * wallNormal.x;
      const reflectedZ = this.velocity.z - 2 * dot * wallNormal.z;

      this.velocity.x = reflectedX * wallJumpBounce * horizontalScale;
      this.velocity.z = reflectedZ * wallJumpBounce * horizontalScale;
      this.velocity.y = wallJumpHeight * verticalScale;

      this.lastWallJumpTime = currentTime;
      console.log(`[WallJump] Instant bounce! speed=${curSpeed.toFixed(0)} factor=${speedFactor.toFixed(2)} vel=(${this.velocity.x.toFixed(0)}, ${this.velocity.z.toFixed(0)})`);
    } else {
      // Start charging for push
      this.wallJumpState = 'charging';
      this.wallJumpChargeTime = 0;
      this.wallJumpPosition.copyFrom(this.camera.position);
      this.wallJumpNormal.copyFrom(wallNormal);
      this.wallJumpPreVelocity.copyFrom(this.velocity);

      // Zero velocity during charge
      this.velocity.set(0, 0, 0);

      console.log('[WallJump] Charging...');
    }

    return true;
  }

  /**
   * Check if player is stuck in solid geometry and attempt to free them
   * Based on Q3 PM_CorrectAllSolid
   * NOTE: Currently disabled due to roof instability. Kept for future use.
   */
  // @ts-ignore - Kept for future use
  private resolveDepenetration(cm: ReturnType<typeof getCollisionManager>): boolean {
    const backend = (cm as any).backends?.get('q3');
    if (!backend?.trace) return false;

    const start = this.camera!.position;
    const traceOpts = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT };

    // Check if we are currently in solid
    // Trace from same point to same point checks point content
    const trace = backend.trace(start, start, traceOpts);

    if (!trace.allSolid && !trace.startSolid) {
      return false; // All good, not stuck
    }

    // Search pattern: Up first (most common escape), then sides
    const offsets = [
      new Vector3(0, STEPSIZE, 0),     // Try popping up a step
      new Vector3(0, STEPSIZE * 2, 0), // Try higher
      new Vector3(0, -4, 0),           // Try down slightly
      new Vector3(PLAYER_RADIUS, 0, 0),        // Cardinal directions
      new Vector3(-PLAYER_RADIUS, 0, 0),
      new Vector3(0, 0, PLAYER_RADIUS),
      new Vector3(0, 0, -PLAYER_RADIUS),
      new Vector3(12, STEPSIZE, 0),    // Diagonals + up
      new Vector3(-12, STEPSIZE, 0),
      new Vector3(0, STEPSIZE, 12),
      new Vector3(0, STEPSIZE, -12),
    ];

    for (const offset of offsets) {
      const testPos = start.add(offset);
      const output = backend.trace(testPos, testPos, traceOpts);

      if (!output.allSolid && !output.startSolid) {
        // Found a free spot!
        console.log(`[Depenetration] Escaped solid! Moved from ${start} to ${testPos}`);
        this.camera!.position.copyFrom(testPos);
        this.velocity.set(0, 0, 0); // Kill velocity to prevent re-entry
        return true;
      }
    }

    return false; // Still stuck
  }

  /**
   * Execute the wall jump push after charging
   */
  private executeWallJumpPush(mv: MovementVars): void {
    if (!this.camera) return;

    const wallJumpHeight = mv.get('sv_walljump_height');
    const wallJumpBounce = mv.get('sv_walljump_bounce');
    const wallJumpBoost = mv.get('sv_walljump_boost');
    const runSpeed = mv.get('sv_runSpeed'); // ~400

    // Calculate speed-based scaling factor
    // At low speed (standstill): push mostly UP for ledge climbing
    // At high speed (sprinting): push normally with horizontal momentum
    // NOTE: We use actualHorizSpeed (real movement speed at charge start), not velocity
    // This prevents false "high speed" when pushing against wall
    const preSpeed = this.actualHorizSpeed;  // Real movement speed
    const speedFactor = Math.max(0.8, Math.min(1.0, preSpeed / runSpeed));  // Min 0.8 = always 80% horizontal push

    // Scale horizontal push by speed factor (0.8 at standstill, 1.0 at sprint)
    // Scale vertical push inversely (1.15 at standstill, 1.0 at sprint)
    const horizontalScale = speedFactor;
    const verticalScale = 1.0 + (1.0 - speedFactor) * 1.0; // 20% vertical boost at min speed

    // Calculate reflected velocity from pre-charge velocity
    const dot = this.wallJumpPreVelocity.x * this.wallJumpNormal.x +
      this.wallJumpPreVelocity.z * this.wallJumpNormal.z;
    const reflectedX = this.wallJumpPreVelocity.x - 2 * dot * this.wallJumpNormal.x;
    const reflectedZ = this.wallJumpPreVelocity.z - 2 * dot * this.wallJumpNormal.z;

    // Apply bounce multiplier, boost, speed scaling, and upward velocity
    this.velocity.x = reflectedX * wallJumpBounce * wallJumpBoost * horizontalScale;
    this.velocity.z = reflectedZ * wallJumpBounce * wallJumpBoost * horizontalScale;
    this.velocity.y = wallJumpHeight * wallJumpBoost * verticalScale;

    // Update cooldown and reset state
    this.lastWallJumpTime = performance.now() / 1000;
    this.wallJumpState = 'none';

    console.log(`[WallJump] PUSH! speed=${preSpeed.toFixed(0)} factor=${speedFactor.toFixed(2)} vel=(${this.velocity.x.toFixed(0)}, ${this.velocity.z.toFixed(0)}, ${this.velocity.y.toFixed(0)})`);
  }

  /**
   * Q3-style slide move with BSP collision (same as FreeflyController)
   */
  private slideMove(originalMovement: Vector3, cm: ReturnType<typeof getCollisionManager>): void {
    if (!this.camera || !this.scene) return;

    const start = this.camera.position.clone();
    const end = start.add(originalMovement);
    const traceOpts = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT };

    // Trace through BSP
    const trace = cm.trace(start as never, end as never, traceOpts);

    // If we started in solid, don't move (stuck detection)
    if (trace.startSolid) {
      // Try to nudge out of solid
      const nudgeSteps = [1.0, 2.0, 4.0];
      const testDirs = [
        new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
        new Vector3(0, 1, 0), new Vector3(0, -1, 0),
        new Vector3(0, 0, 1), new Vector3(0, 0, -1),
      ];
      for (const nudge of nudgeSteps) {
        for (const dir of testDirs) {
          const testPos = start.add(dir.scale(nudge));
          const testTrace = cm.trace(testPos as never, testPos.add(new Vector3(0, -0.1, 0)) as never, traceOpts);
          if (!testTrace.startSolid) {
            this.camera.position = testPos;
            return;
          }
        }
      }
      return;
    }

    if (trace.fraction >= 1.0) {
      // No collision - apply full movement
      this.camera.position = end;
    } else if (trace.fraction > 0) {
      // Partial collision - move to contact point with small offset
      const contactPoint = Vector3.Lerp(start, end, trace.fraction);

      // Push back slightly from the wall
      if (trace.normal) {
        const n = trace.normal;
        contactPoint.x += n.x * 0.5;
        contactPoint.y += n.y * 0.5;
        contactPoint.z += n.z * 0.5;
      }

      this.camera.position = contactPoint;

      // Slide along the wall (Q3-style)
      if (trace.normal) {
        let velocity = originalMovement.clone();
        let timeLeft = 1.0 - trace.fraction;
        const maxTries = 4;
        for (let i = 0; i < maxTries && timeLeft > 0.01 && velocity.length() > 0.01; i++) {
          const n = trace.normal;
          const remaining = velocity.scale(timeLeft);
          const dot = remaining.x * n.x + remaining.y * n.y + remaining.z * n.z;
          const slideMove = new Vector3(
            remaining.x - n.x * dot,
            remaining.y - n.y * dot,
            remaining.z - n.z * dot
          );

          if (slideMove.length() < 0.01) break;

          const slideStart = this.camera.position.clone();
          const slideEnd = slideStart.add(slideMove);
          const slideTrace = cm.trace(slideStart as never, slideEnd as never, traceOpts);

          if (slideTrace.fraction > 0) {
            const slidePos = Vector3.Lerp(slideStart, slideEnd, Math.min(slideTrace.fraction * 0.9, 1.0));
            if (slideTrace.fraction < 1.0 && slideTrace.normal) {
              const sn = slideTrace.normal;
              slidePos.x += sn.x * 0.5;
              slidePos.y += sn.y * 0.5;
              slidePos.z += sn.z * 0.5;
            }
            this.camera.position = slidePos;
            timeLeft *= (1.0 - slideTrace.fraction);
            velocity = slideMove.normalize().scale(velocity.length());
          } else {
            break;
          }
        }
      }
    }
  }

  // @ts-ignore - kept for future debug use
  private static _loggedState = false;
  // @ts-ignore - kept for future debug use
  private static _warnedNotInit = false;
  // @ts-ignore - kept for future debug use
  private static _lastDebugTime = 0;
  // @ts-ignore - kept for future debug use
  private static _nativeCollisionSetup = false;
  private static _lastGroundLog = 0;
  private static _lastStrafeLog = 0;

  /**
   * Apply movement using Babylon's native mesh collision system
   * 
   * ARCHITECTURE: Native Collision Mode with BSP Data Augmentation
   * ============================================================
   * 
   * Primary Collision: Babylon.js camera._collideWithWorld
   * - Checks against rendered BSP geometry (walls, floors, ceilings)
   * - Checks against generated clip brush meshes (fullclip, playerclip, caulk)
   * - Excludes detail brushes (filtered in shouldSkipCollision)
   * 
   * Secondary Collision: BSP Clamp Pass (optional safety net)
   * - Runs after Babylon collision
   * - Trace A: checks fullclip/playerclip via BSP brush data
   * - Trace B: checks caulk/structural via BSP brush data
   * - Adjusts position if BSP collision detected
   * 
   * BSP Data Augmentation:
   * - ADD collision: Clip brush meshes generated in MapLoader.buildClipBrushMeshes
   * - REMOVE collision: Detail brushes excluded via shouldSkipCollision
   * 
   * Result: Solid, reliable collision that respects BSP semantics
   */
  private nativeCollisionMove(movement: Vector3): void {
    if (!this.camera || !this.scene) return;

    // Set up native collision on first use
    if (!FPSController._nativeCollisionSetup) {
      FPSController._nativeCollisionSetup = true;

      // Enable scene collision
      this.scene.collisionsEnabled = true;

      // Set up camera ellipsoid for player-sized collision
      // Babylon ellipsoid is half-extents: (width/2, height/2, depth/2)
      // For Q3-style player: radius=16, height=56 → ellipsoid (16, 28, 16)
      this.camera.ellipsoid = new Vector3(16, 28, 16);
      this.camera.ellipsoidOffset = new Vector3(0, 28, 0); // Offset so camera is at eye level
      this.camera.checkCollisions = true;

      // Enable collision on world geometry meshes, excluding non-solid elements
      const meshes = this.scene.meshes;
      let collisionMeshCount = 0;
      let skippedCount = 0;
      for (const mesh of meshes) {
        // Enable collision on BSP world mesh and children
        if (mesh.name.includes('bsp_') || mesh.name.includes('world') ||
          mesh.parent?.name.includes('bsp_') || mesh.parent?.name.includes('world')) {

          // Skip non-solid meshes (light halos, flares, billboards, effects)
          const shouldSkip = this.shouldSkipCollision(mesh);
          if (shouldSkip) {
            mesh.checkCollisions = false;
            skippedCount++;
            continue;
          }

          mesh.checkCollisions = true;
          collisionMeshCount++;
        }
      }
      console.log(`[FPSController] Skipped ${skippedCount} non-solid meshes (halos, flares, etc.)`)

      console.log(`[FPSController] Native collision setup: ${collisionMeshCount} meshes with collision enabled`);
      console.log(`[FPSController] Camera ellipsoid: (${this.camera.ellipsoid.x}, ${this.camera.ellipsoid.y}, ${this.camera.ellipsoid.z})`);
    }

    // IMPORTANT: camera.position.addInPlace() bypasses collision!
    // We must use Babylon's internal collision system

    // Debug: check what methods are available
    const cam = this.camera as any;
    if (!FPSController._debuggedMethods) {
      FPSController._debuggedMethods = true;
      console.log(`[FPSController] Camera type: ${this.camera.getClassName()}`);
      console.log(`[FPSController] Has _collideWithWorld: ${typeof cam._collideWithWorld}`);
      console.log(`[FPSController] Has _checkInputs: ${typeof cam._checkInputs}`);
      console.log(`[FPSController] checkCollisions: ${this.camera.checkCollisions}`);
      console.log(`[FPSController] scene.collisionsEnabled: ${this.scene.collisionsEnabled}`);

      // List meshes with collision enabled
      const collisionMeshes = this.scene.meshes.filter(m => m.checkCollisions);
      console.log(`[FPSController] Meshes with checkCollisions=true: ${collisionMeshes.length}`);
      if (collisionMeshes.length > 0) {
        console.log(`[FPSController] Sample collision mesh: "${collisionMeshes[0].name}"`);
      }
    }

    // Try using _collideWithWorld if available
    if (cam._collideWithWorld && this.camera.checkCollisions) {
      const posBefore = this.camera.position.clone();

      // Debug: Check for collision meshes near camera
      const now = Date.now();
      if (now - FPSController._lastDebugTime > 1000 && this.camera.position) {
        FPSController._lastDebugTime = now;
        const camPos = this.camera.position;
        const nearbyMeshes = this.scene.meshes.filter(m => {
          if (!m.checkCollisions) return false;
          const dist = Vector3.Distance(m.position, camPos);
          return dist < 100;
        });
        console.log(`[FPSController] Camera at (${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)})`);
        console.log(`[FPSController] Nearby collision meshes (< 100 units): ${nearbyMeshes.length}`);
        if (nearbyMeshes.length > 0 && nearbyMeshes.length < 10) {
          nearbyMeshes.forEach(m => {
            const dist = Vector3.Distance(m.position, camPos);
            console.log(`  - "${m.name}" at dist=${dist.toFixed(1)} metadata=${JSON.stringify(m.metadata)}`);
          });
        }
      }

      cam._collideWithWorld(movement);
      const posAfterBabylon = this.camera.position.clone();
      const ellipsoidOffset = (this.camera as any).ellipsoidOffset ? (this.camera as any).ellipsoidOffset : Vector3.Zero();

      // Use the new Q3 collision backend for BSP collision
      const cm = getCollisionManager();
      const wasBackend = cm.getBackendType();
      if (wasBackend !== 'q3') {
        cm.setBackend('q3');
      }

      // Debug logging
      const debugBsp = now - FPSController._lastDebugTime < 100;
      if (debugBsp) {
        console.log(`[Q3 Collision] pos: (${posBefore.x.toFixed(1)}, ${posBefore.y.toFixed(1)}, ${posBefore.z.toFixed(1)})`);
        console.log(`[Q3 Collision] movement: (${movement.x.toFixed(3)}, ${movement.y.toFixed(3)}, ${movement.z.toFixed(3)})`);
      }

      // Use Q3-style slideMove for smooth wall sliding
      const backend = (cm as any).backends?.get('q3');
      const traceOpts = {
        radius: PLAYER_RADIUS,
        height: PLAYER_HEIGHT,
        contentMask: 0x1 | 0x10000, // SOLID | PLAYERCLIP
      };

      if (backend && typeof backend.stepSlideMove === 'function') {
        // Use stepSlideMove for smooth collision + stair stepping
        const slideResult = backend.stepSlideMove(posBefore, movement, traceOpts);
        this.camera.position.copyFrom(slideResult.endPos);

        if (slideResult.hitCount > 0 && debugBsp) {
          console.log(`[Freefly][StepSlideMove] ${slideResult.hitCount} collision(s), stepped=${slideResult.stepped}`);
        }
      } else if (backend && typeof backend.slideMove === 'function') {
        // Fallback to slideMove without stepping
        const slideResult = backend.slideMove(posBefore, movement, traceOpts);
        this.camera.position.copyFrom(slideResult.endPos);
      } else {
        // Fallback to simple trace
        const clipTrace = cm.trace(posBefore as never, posAfterBabylon as never, traceOpts);
        if (clipTrace.fraction < 1.0) {
          this.camera.position.copyFrom(clipTrace.endPos);
        }
      }

      if (wasBackend && wasBackend !== 'q3') {
        cm.setBackend(wasBackend);
      }

      // Check if we're stuck in solid (startSolid case)
      const stuckCheck = cm.trace(this.camera.position as never, this.camera.position as never, traceOpts);
      if (stuckCheck.startSolid) {
        const nowStuck = Date.now();
        if (nowStuck - FPSController._lastClipHitLogTime > 250) {
          FPSController._lastClipHitLogTime = nowStuck;
          const hitBrushIndex = (stuckCheck as any).hitBrushIndex;
          const hitTextureName = (stuckCheck as any).hitTextureName;
          FPSController._lastClipHitBrushIndex = typeof hitBrushIndex === 'number' ? hitBrushIndex : null;
          FPSController._lastClipHitTextureName = typeof hitTextureName === 'string' ? hitTextureName : null;
          console.log(`[Freefly][Stuck] startSolid=true brush=${hitBrushIndex} tex=${hitTextureName}`);
        }

        const base = posAfterBabylon.clone();
        const nudgeSteps = [0.5, 1.0, 2.0, 4.0, 8.0];
        const testDirs = [
          new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
          new Vector3(0, 1, 0), new Vector3(0, -1, 0),
          new Vector3(0, 0, 1), new Vector3(0, 0, -1),
          new Vector3(1, 1, 0), new Vector3(-1, -1, 0),
          new Vector3(1, 0, 1), new Vector3(-1, 0, -1),
          new Vector3(0, 1, 1), new Vector3(0, -1, -1)
        ];

        for (const nudge of nudgeSteps) {
          for (const dir of testDirs) {
            const testPos = base.add(dir.scale(nudge));
            const testStart = testPos.add(ellipsoidOffset);
            const testTraceA = cm.trace(testStart as never, testStart as never, {
              radius: PLAYER_RADIUS,
              height: PLAYER_HEIGHT,
              clipTexturesOnly: true,
              contentMask: 0x1 | 0x10000,
            });
            const testTraceB = cm.trace(testStart as never, testStart as never, {
              radius: PLAYER_RADIUS,
              height: PLAYER_HEIGHT,
              nodrawSolidsOnly: true,
              contentMask: 0x1,
            });
            if (!testTraceA.startSolid && !testTraceB.startSolid) {
              this.camera.position.copyFrom(testPos);
              return;
            }
          }
        }

        this.camera.position.copyFrom(posBefore);
      }

      // Debug: log if collision occurred (position changed differently than expected)
      const actualMove = this.camera.position.subtract(posBefore);
      const moveDiff = actualMove.subtract(movement).length();
      if (moveDiff > 0.01) {
        console.log(`[FPSController] Collision detected! Expected move: ${movement.length().toFixed(2)}, Actual: ${actualMove.length().toFixed(2)}`);
      }
    } else {
      // Fallback: no collision available, just move
      console.log(`[FPSController] WARNING: _collideWithWorld not available, falling back to direct move`);
      this.camera.position.addInPlace(movement);
    }
  }

  private static _debuggedMethods = false;
  private static _lastClipHitLogTime = 0;
  private static _lastClipHitBrushIndex: number | null = null;
  private static _lastClipHitTextureName: string | null = null;

  static getLastClipHitBrushIndex(): number | null {
    return FPSController._lastClipHitBrushIndex;
  }

  static getLastClipHitTextureName(): string | null {
    return FPSController._lastClipHitTextureName;
  }

  /**
   * Check if a mesh should be excluded from collision detection
   * Excludes: billboards, light halos, flares, transparent/additive effects
   */
  private shouldSkipCollision(mesh: any): boolean {
    const name = mesh.name?.toLowerCase() || '';
    const textureName = mesh.metadata?.textureName?.toLowerCase() || '';

    const contentFlags = typeof mesh.metadata?.contentFlags === 'number' ? mesh.metadata.contentFlags : 0;
    const surfaceFlags = typeof mesh.metadata?.surfaceFlags === 'number' ? mesh.metadata.surfaceFlags : 0;

    if ((contentFlags & ContentFlags.DETAIL) !== 0) {
      return true;
    }
    if ((surfaceFlags & SurfaceFlags.NONSOLID) !== 0) {
      return true;
    }
    if ((surfaceFlags & SurfaceFlags.HINT) !== 0) {
      return true;
    }

    // Skip by mesh name patterns
    if (name.includes('flare') || name.includes('halo') || name.includes('glow') ||
      name.includes('billboard') || name.includes('sprite') || name.includes('particle') ||
      name.includes('effect') || name.includes('light_')) {
      return true;
    }

    // Skip by texture name patterns (common Q3/Warsow light textures)
    if (textureName.includes('flare') || textureName.includes('halo') ||
      textureName.includes('glow') || textureName.includes('flareshader') ||
      textureName.includes('lights/') || textureName.includes('sfx/')) {
      return true;
    }

    // Skip meshes with additive blending (light effects)
    const material = mesh.material;
    if (material) {
      // Check for additive alpha mode (used for light effects)
      if (material.alphaMode === 1 || material.alphaMode === 2) { // ADD or MULTIPLY
        return true;
      }
      // Check for high transparency
      if (material.alpha !== undefined && material.alpha < 0.5) {
        return true;
      }
    }

    // Skip billboard faces (faceType 4 in BSP)
    if (mesh.metadata?.faceType === 4) {
      return true;
    }

    return false;
  }

  configure(config: Partial<CameraControllerConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.fov && this.camera) {
      this.camera.fov = config.fov;
    }
  }

  getConfig(): CameraControllerConfig {
    return { ...this.config };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.forward = false;
      this.keys.backward = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.up = false;
      this.keys.sprint = false;
      if (this.isPointerLocked) {
        document.exitPointerLock();
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.detach();
  }
}

// Register freefly camera cvars at module load (after class definition)
Cvar.register('cam_freefly_speed', FPSController.getDefaultSpeed(), {
  type: 'float',
  min: 10,
  max: 10000,
  description: 'Freefly camera movement speed',
  onChange: (value) => {
    FPSController.setDefaultSpeed(value as number);
  },
});

// Debug bbox visualization cvar
Cvar.register('cl_debugbbox', 0, {
  type: 'int',
  min: 0,
  max: 1,
  description: 'Show player bounding box ahead (developer)',
});

Cvar.register('cl_debugbbox_offset', 100, {
  type: 'float',
  min: 0,
  max: 500,
  description: 'Distance to show debug bbox ahead of player (units)',
});

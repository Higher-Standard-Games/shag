/**
 * FPSController - First-person camera controller with gravity and physics
  * 
 * Based on FPSController but with:
 * - Gravity(player falls when not on ground)
  * - Ground detection via BSP collision
    * - Jump with Space(when grounded)
    * - Horizontal movement only(no fly up / down)
      * 
 * Controls:
 * - Click canvas to capture mouse(pointer lock)
  * - ESC to release mouse
    * - WASD to move horizontally
      * - Space to jump(when grounded)
        * - Mouse movement: freelook
          */

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
// import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
// import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
// import { Mesh } from "@babylonjs/core/Meshes/mesh";
// import { Skeleton } from "@babylonjs/core/Bones/skeleton";
// import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
// import { Animation } from "@babylonjs/core/Animations/animation";
// import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/loaders";
import { ICameraController, CameraControllerConfig } from "./ICameraController";
import { Cvar } from "../../core/Cvar";
import { InputSystem } from "../../input/InputSystem";
import { MovementVars } from "../../movement/MovementVars";
import { DeveloperBar } from "../../debug/DeveloperBar";
import {
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  CROUCH_HEIGHT,
  DEFAULT_VIEWHEIGHT,

  feetToOrigin,
  originToFeet,
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
// import { EntityManager } from "../../entities/EntityManager";
// import { WeaponViewManager } from "../../weapon/WeaponViewManager";
// import { WeaponDef } from "../../../shared/entities";

import { PlayerVisuals } from "./components/PlayerVisuals";
import { FPSGameManager } from "../../../games/fps/FPSGameManager";
import { FPS, getWeaponSlotPressed, registerFPSActions } from "../../../games/fps/client/FPSActions";
import { createBSPCollisionWorld } from "../../../games/fps/simulation/collision/BSPCollisionWorld";
import { getCollisionManager } from "../../physics/CollisionManager";
import { extractSpawnPoints } from "../../spawn/SpawnPointManager";

export class FPSController implements ICameraController {
  public readonly type = "fps";

  private gameManager: FPSGameManager | null = null;
  private useNetworkMovement: boolean = false;
  private networkReady: boolean = false;  // True only after async init completes
  private stateUnsubscribe: (() => void) | null = null;  // For cleanup

  // Inventory reference (delegated from FPSPlayer)
  private _inventory: InventoryManager | null = null;

  public setInventory(inventory: InventoryManager) {
    this._inventory = inventory;
  }

  public get inventory(): InventoryManager | null {
    return this._inventory;
  }

  // Configuration
  public readonly radius: number = PLAYER_RADIUS;
  public readonly height: number = PLAYER_HEIGHT;
  public readonly crouchHeight: number = CROUCH_HEIGHT;
  public readonly eyeOffset: number = 48; // Default eye offset
  public readonly groundFriction: number = 6.0; // Default Q3 friction

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

  /**
   * Enable network movement mode after connection is established.
   * Call this from FPSGameManager when connecting to a server.
   * This allows switching from local mode to network mode dynamically.
   */
  public enableNetworkMode(): void {
    if (this.useNetworkMovement) {
      console.log(`[FPS] Network mode already enabled`);
      return;
    }

    this.gameManager = FPSGameManager.getInstance();

    if (!this.gameManager.isConnectedToServer()) {
      console.warn(`[FPS] Cannot enable network mode - not connected to server`);
      return;
    }

    console.log(`[FPS] Switching to network movement mode (server: ${this.gameManager.getServerUrl()})`);
    this.useNetworkMovement = true;


    // Subscribe to state updates from server
    this.stateUnsubscribe = this.gameManager.onPlayerStateUpdate((state) => {
      // Track previous grounded state for landing detection
      this.wasGroundedLastFrame = this.isGrounded;

      // NOTE: Do NOT set physicsX/Y/Z here when V2Client is active!
      // getLocalPlayerPosition() already reads V2Client's latest predicted state.
      // Setting position here causes one-frame backward snaps (jitter) because
      // the camera restores from stale physicsX/Y/Z at the start of the next frame.
      this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);

      // Update movement state for visual effects
      this.isGrounded = state.grounded;
      this.isSliding = state.isSliding;
      this.isCrouching = state.isCrouching;
      this.crouchViewOffset = state.crouchViewOffset;
      this.wallJumpState = state.wallJumpState;
      this.ledgeGrabState = state.ledgeGrabState;
      this.actualHorizSpeed = state.actualHorizSpeed;
      this.slidePhase = state.slidePhase;
      this.ledgeGrabPhase = state.ledgeGrabPhase;

      // Capture landing velocity for impact effect
      if (!this.wasGroundedLastFrame && this.isGrounded && state.velocity.y < -50) {
        this.landingVelocityCapture = Math.abs(state.velocity.y);
      }
    });

    this.networkReady = true;
    console.log(`[FPS] Network mode enabled - inputs will be sent to server`);
  }

  // Static default speed that persists between controller changes
  private static defaultSpeed: number = 200;




  // Q3 physics constants are now imported from PlayerPhysicsConstants

  // Q3-style physics state
  private velocity: Vector3 = Vector3.Zero();  // Persistent velocity
  private isGrounded: boolean = false;

  // Wall jump state
  private wallJumpState: 'none' | 'available' | 'charging' = 'none';

  // Ledge grab state
  private ledgeGrabState: 'none' | 'grabbing' | 'pulling' = 'none';


  // Physics position at ORIGIN level (Q3 style: 24 units above feet)
  // MUST be kept separate from camera.position which includes viewheight offset
  // Viewport effects modify camera.position for visuals, but physics uses these values
  private physicsX: number = 0;
  private physicsY: number = 0;  // This is ORIGIN height, not feet!
  private physicsZ: number = 0;
  // Last frame position for actual speed calculation

  private actualHorizSpeed: number = 0;  // Real speed based on position delta
  // Smoothed Y for viewport only (never feeds back to physics)
  private smoothedY: number = 0;
  private ledgeGrabSnapFrames: number = 0;  // Post-grab grace period for smoothedY snap
  private smoothingInitialized: boolean = false;
  // Jump state for auto-bunny hop
  private wasGroundedLastFrame: boolean = false;


  // Viewport effects system
  private viewportEffectsManager: ViewportEffectsManager | null = null;
  private viewportApplicator: FPSApplicator | null = null;
  private baseFOV: number = 1.0;
  private landingVelocityCapture: number = 0;

  // Input throttling for network prediction
  private commandAccumulator: number = 0;

  // Mouse-controlled rotation (stored separately to avoid effect accumulation)
  private mouseRotationX: number = 0;  // Pitch
  private mouseRotationY: number = 0;  // Yaw

  // Crouchslide state
  public isSliding: boolean = false;

  // Crouch state (separate from slide)
  private isCrouching: boolean = false;
  private crouchViewOffset: number = 0;  // Current crouch offset (0 = standing, -20 = crouched)
  private slidePhase: number = 0;  // 0-1 intensity for slide camera tilt (from FPSMovementProfile)
  private ledgeGrabPhase: number = 0;  // 0-1 intensity for ledge grab camera tilt (from FPSMovementProfile)
  private slidePitchOffset: number = 0;  // Computed absolute pitch offset during slide
  private ledgePitchOffset: number = 0;  // Computed absolute pitch offset during ledge grab

  // Camera shake (from explosions, etc.)
  private shakeIntensity: number = 0;
  private shakePitchOffset: number = 0;
  private shakeYawOffset: number = 0;
  private shakeDecayRate: number = 6;  // How fast shake decays (higher = faster)

  // Death camera (Warsow-style: tilt sideways + drop to ground)
  private deathCamPhase: number = 0;    // 0 = alive, 1 = fully dead effect
  private deathCamRoll: number = 0;     // Current roll angle (radians)
  private deathCamHeightDrop: number = 0; // Y offset to lower view toward feet

  // Player Visuals Component (Debug model, animations)
  private playerVisuals: PlayerVisuals | null = null;

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
    use: false,      // F (interact/pickup)
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



  // ==================== Animation State Methods ====================

  /**
   * Get the player's current velocity vector
   */
  getVelocity(): Vector3 {
    return this.velocity.clone();
  }

  /**
   * Check if player is currently on ground
   */
  isPlayerGrounded(): boolean {
    return this.isGrounded;
  }

  /**
   * Get slide state for animation
   */
  /**
   * Get slide state for animation
   */
  getSlideSpeed(): number {
    return this.isSliding ? this.actualHorizSpeed : 0;
  }

  /**
   * Get slide direction for animation
   */
  getSlideDirection(): Vector3 {
    return this.isSliding ? this.getVelocity().normalize() : Vector3.Forward();
  }

  /**
   * Get wall jump state for animation
   */
  getWallJumpState(): { state: string; normal: Vector3; phase: number } {
    return {
      state: this.wallJumpState,
      normal: Vector3.Zero(), // Normal not available in current sync
      phase: 0
    };
  }

  /**
   * Get ledge grab state for animation
   */
  /**
   * Get ledge grab state for animation
   */
  getLedgeGrabState(): string {
    return this.ledgeGrabState !== 'none' ? "active" : "none";
  }

  /**
   * Get camera rotation for aim IK
   */
  getRotation(): { x: number; y: number } {
    return {
      x: this.mouseRotationX,
      y: this.mouseRotationY
    };
  }

  /**
   * Trigger camera shake (e.g. from nearby explosions)
   * @param intensity - Shake strength (0-1 range, where 1 = very close explosion)
   */
  shakeCamera(intensity: number): void {
    // Stack with existing shake but cap at 1.0
    this.shakeIntensity = Math.min(1.0, this.shakeIntensity + intensity);
  }

  /**
   * Check if currently firing
   */
  isFiring(): boolean {
    return this.keys.fire;
  }

  // Observers
  private renderObserver: Observer<Scene> | null = null;

  // Callbacks for high-level game logic
  public onWeaponSelect: ((index: number) => void) | null = null;
  public onReload: (() => void) | null = null;
  public onUse: (() => void) | null = null; // F key interact/pickup

  // Weapon slot tracking for network sync
  public currentWeaponSlot: number = 0; // 0-based index into inventory slots
  private _pendingWeaponSlot: number = 0; // 1-based slot to send to server (0 = no change)
  private _isWeaponSwitchBlocked: (() => boolean) | null = null; // Dynamic check for animation state

  /** Set a callback that returns true when weapon switching should be blocked (e.g., during animation) */
  public setWeaponSwitchBlockedCheck(check: (() => boolean) | null): void { this._isWeaponSwitchBlocked = check; }

  // Input state accessors
  public isAiming(): boolean { return this.keys.aim; }
  private onCanvasClick: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private onPointerLockChange: (() => void) | null = null;
  private onMouseDown: ((e: MouseEvent) => void) | null = null;
  private onMouseUp: ((e: MouseEvent) => void) | null = null;
  private onContextMenu: ((e: Event) => void) | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    // Register FPS actions with InputSystem (idempotent, safe to call multiple times)
    registerFPSActions();

    // Ensure InputSystem event listeners are registered (idempotent)
    InputSystem.getInstance().init(scene, canvas);

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
    } else {
      this.camera = camera;
    }

    // Always set as active camera (fixes blue screen when switching controllers)
    scene.activeCamera = this.camera;

    // Weapon initialization is now handled by FPSPlayer
    // WeaponViewManager.getInstance().init(scene, this.camera);

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

    // Initialize player visuals
    this.playerVisuals = new PlayerVisuals(this, scene);

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

      // Apply to camera (slide/ledge offsets are applied here too so async events don't overwrite them)
      this.camera.rotation.y = this.mouseRotationY;
      this.camera.rotation.x = this.mouseRotationX + this.slidePitchOffset + this.ledgePitchOffset;
    };

    // Keyboard input — only handles preventDefault; key state comes from InputSystem
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.isPointerLocked) return;

      // Block ALL Ctrl+key browser shortcuts when pointer locked
      if (e.ctrlKey) e.preventDefault();

      // Prevent default for keys that would interfere with the browser
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (e.code === 'F4') e.preventDefault();
    };

    this.onKeyUp = (_e: KeyboardEvent) => {
      // No-op: key state is driven by InputSystem in syncKeysFromInput()
    };

    // Mouse button handlers for fire and ADS
    this.onMouseDown = (e: MouseEvent) => {
      if (!this.isPointerLocked) {
        // console.log("MouseDown ignored - not locked");
        return;
      }

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


    // Mouse events scoped to canvas; keyboard + pointerlockchange stay on document.
    // mousemove stays on document because Pointer Lock dispatches there.
    const canvas = this.canvas;
    if (this.onCanvasClick && canvas) canvas.addEventListener('click', this.onCanvasClick);
    if (this.onPointerLockChange) document.addEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.onMouseMove) document.addEventListener('mousemove', this.onMouseMove);
    if (this.onKeyDown) document.addEventListener('keydown', this.onKeyDown);
    if (this.onKeyUp) document.addEventListener('keyup', this.onKeyUp);
    if (this.onMouseDown && canvas) canvas.addEventListener('mousedown', this.onMouseDown);
    if (this.onMouseUp && canvas) canvas.addEventListener('mouseup', this.onMouseUp);
    if (this.onContextMenu && canvas) canvas.addEventListener('contextmenu', this.onContextMenu);

  }

  private removeInputHandlers(): void {
    // Exit pointer lock if active
    if (this.isPointerLocked) {
      document.exitPointerLock();
    }

    const canvas = this.canvas;
    if (this.onCanvasClick && canvas) canvas.removeEventListener('click', this.onCanvasClick);
    if (this.onPointerLockChange) document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.onMouseMove) document.removeEventListener('mousemove', this.onMouseMove);
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    if (this.onKeyUp) document.removeEventListener('keyup', this.onKeyUp);
    if (this.onMouseDown && canvas) canvas.removeEventListener('mousedown', this.onMouseDown);
    if (this.onMouseUp && canvas) canvas.removeEventListener('mouseup', this.onMouseUp);
    if (this.onContextMenu && canvas) canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    this.removeInputHandlers();

    // Clean up network state subscription
    if (this.stateUnsubscribe) {
      this.stateUnsubscribe();
      this.stateUnsubscribe = null;
    }

    // Reset physics/network state so reattach reinitializes properly
    this.smoothingInitialized = false;
    this.useNetworkMovement = false;
    this.networkReady = false;

    this.gameManager = null;

    this.camera = null;
    this.scene = null;
    this.canvas = null;
    this.isPointerLocked = false;

    console.log("[FPSController] Detached (state reset)");
  }

  /**
   * Sync this.keys state from InputSystem per frame.
   * Replaces the old onKeyDown/onKeyUp switch/case blocks.
   */
  private syncKeysFromInput(): void {
    const input = InputSystem.getInstance();

    // Continuous hold state
    this.keys.forward = input.isActive(FPS.MOVE_FORWARD);
    this.keys.backward = input.isActive(FPS.MOVE_BACKWARD);
    this.keys.left = input.isActive(FPS.MOVE_LEFT);
    this.keys.right = input.isActive(FPS.MOVE_RIGHT);
    this.keys.up = input.isActive(FPS.JUMP);
    this.keys.sprint = input.isActive(FPS.SPRINT);
    this.keys.crouch = input.isActive(FPS.CROUCH);
    this.keys.reload = input.isActive(FPS.RELOAD);
    this.keys.use = input.isActive(FPS.USE);

    // Fire/Aim: only when pointer locked (InputSystem tracks globally)
    this.keys.fire = this.isPointerLocked && input.isActive(FPS.FIRE);
    this.keys.aim = this.isPointerLocked && input.isActive(FPS.AIM);

    // One-shot callbacks via wasPressed()
    if (input.wasPressed(FPS.RELOAD) && this.onReload) this.onReload();
    if (input.wasPressed(FPS.USE) && this.onUse) this.onUse();
    if (input.wasPressed(FPS.READY) && this.gameManager) this.gameManager.sendReady();

    // Weapon select (1-9 keys) — blocked during switch animation
    if (!(this._isWeaponSwitchBlocked?.() ?? false)) {
      const slot = getWeaponSlotPressed();
      if (slot > 0 && this.onWeaponSelect) {
        this.currentWeaponSlot = slot - 1;
        this._pendingWeaponSlot = slot; // 1-based for server
        this.onWeaponSelect(slot - 1);
      }

      // Scroll weapon cycling via InputSystem actions (skip gunblade at slot 0)
      if (this.onWeaponSelect) {
        const weaponCount = this._inventory ? this._inventory.getSlotCount() : 3;
        if (weaponCount > 1) {
          let next = -1;

          if (input.wasPressed(FPS.WEAPON_NEXT)) {
            next = this.currentWeaponSlot + 1;
            if (next >= weaponCount) next = 1;   // wrap to first non-gunblade
            if (next === 0) next = 1;             // skip gunblade
          } else if (input.wasPressed(FPS.WEAPON_PREV)) {
            next = this.currentWeaponSlot - 1;
            if (next <= 0) next = weaponCount - 1; // wrap to last slot, skip gunblade
          }

          if (next > 0) {
            this.currentWeaponSlot = next;
            this._pendingWeaponSlot = next + 1; // 1-based for server
            this.onWeaponSelect(next);
          }
        }
      }
    }

    // NOTE: HUD actions (scoreboard, chat) moved to FPSGameManager
    // to avoid circular dependency and browser `require` crashes
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;

    // When pointer lock is lost (e.g. pause menu), zero out inputs to prevent moving
    // but DO NOT return early so we still process networking and render remote players.
    if (!this.isPointerLocked) {
      this.keys.forward = false;
      this.keys.backward = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.up = false;
      this.keys.sprint = false;
      this.keys.crouch = false;
      this.keys.reload = false;
      this.keys.use = false;
      this.keys.fire = false;
      this.keys.aim = false;
    } else {
      // Sync key state from InputSystem (replaces hardcoded switch/case handlers)
      this.syncKeysFromInput();
    }

    const mv = MovementVars.getInstance();

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
    if (this.keys.crouch && !this.isSliding) {
      const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      const slideMinSpeed = mv.get('sv_slideMinSpeed');

      // Simple logic: if moving slow, reduce speed
      if (horizSpeed < slideMinSpeed) {
        wishspeed *= mv.get('cl_crouchmult'); // 0.5x by default
      }
    }



    // Initialize physics position on first frame
    // NOTE: Spawn system should call setPositionFromFeet() or setPosition() before first frame
    if (!this.smoothingInitialized) {
      // Get the game manager instance first to check if we're connected
      this.gameManager = FPSGameManager.getInstance();
      const isConnected = this.gameManager.isConnectedToServer();

      // If connected to a server, use server-provided position (NOT stale camera position)
      if (isConnected) {
        // CRITICAL: Must process buffered snapshots BEFORE getLocalPlayerPosition()!
        // Otherwise hasValidPosition() is always false (deadlock: smoothing waits for
        // position, but snapshot processing only happens after smoothing init).
        this.gameManager.processSnapshots();

        const serverPos = this.gameManager.getLocalPlayerPosition();
        if (!serverPos) {
          // Server hasn't sent position yet - wait for next frame
          return; // Don't initialize until we have server position
        }
        // Use position from server
        this.physicsX = serverPos.x;
        this.physicsY = serverPos.y;
        this.physicsZ = serverPos.z;
        this.smoothedY = this.physicsY;
        console.log(`[FPS] Using server position for init: (${this.physicsX.toFixed(1)}, ${this.physicsY.toFixed(1)}, ${this.physicsZ.toFixed(1)})`);
      } else {
        // Local mode: assume camera was placed at eye level by spawn system
        // Convert to origin level by subtracting viewheight
        this.physicsX = this.camera.position.x;
        this.physicsY = this.camera.position.y - DEFAULT_VIEWHEIGHT;
        this.physicsZ = this.camera.position.z;
        this.smoothedY = this.physicsY;
      }

      this.smoothingInitialized = true;

      // Check if already connected to a server (via 'connect' command)
      // Skip if network mode was already enabled by enableNetworkMode() to avoid duplicate subscriptions
      if (isConnected && !this.networkReady) {
        // === SERVER CONNECTION MODE ===
        // FPSGameManager was already initialized by 'connect' command
        // Just subscribe to state updates - don't spawn or init locally
        console.log(`[FPS] Connected to server ${this.gameManager.getServerUrl()} - using server-authoritative movement`);
        this.useNetworkMovement = true;

        // Track whether we've logged the first server position
        let loggedFirstServerPosition = false;

        // Subscribe to state updates from server
        this.stateUnsubscribe = this.gameManager.onPlayerStateUpdate((state) => {
          // Log first server position (this is where we actually spawn)
          if (!loggedFirstServerPosition) {
            console.log(`[FPS] Server spawn position: (${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)})`);
            loggedFirstServerPosition = true;
          }

          // Track previous grounded state for landing detection
          this.wasGroundedLastFrame = this.isGrounded;

          // NOTE: Do NOT set physicsX/Y/Z here — getLocalPlayerPosition()
          // reads V2Client's predicted state directly. Setting position here
          // causes jitter (one-frame snaps between reconciled and predicted state).
          this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);

          // Update movement state for visual effects
          this.isGrounded = state.grounded;
          this.isSliding = state.isSliding;
          this.isCrouching = state.isCrouching;
          this.crouchViewOffset = state.crouchViewOffset;
          this.wallJumpState = state.wallJumpState;
          this.ledgeGrabState = state.ledgeGrabState;
          this.actualHorizSpeed = state.actualHorizSpeed;

          // Capture landing velocity for impact effect
          if (!this.wasGroundedLastFrame && this.isGrounded && state.velocity.y < -50) {
            this.landingVelocityCapture = Math.abs(state.velocity.y);
          }
        });

        this.networkReady = true;
        console.log(`[FPS] Server movement ready - inputs will be sent to server`);

      } else if (isConnected && this.networkReady) {
        // Network mode already enabled by enableNetworkMode() - skip initialization
        console.log(`[FPS] Network mode already enabled, skipping initialization`);

      } else {
        // === LOCAL SIMULATION MODE ===
        // Using local FPSMovementProfile simulation (same physics as server)
        console.log(`[FPS] Initializing local simulation via FPSGameManager`);
        this.useNetworkMovement = true;

        this.gameManager.initializeLocal({ tickRate: 60 }).then(async () => {
          // Set up BSP collision if available
          const cm = getCollisionManager();
          if (cm.isInitialized()) {
            const collisionWorld = createBSPCollisionWorld();
            this.gameManager!.setCollisionWorld(collisionWorld);
            console.log(`[FPS] BSP collision injected into simulation`);
          }

          // Extract spawn points from loaded BSP
          try {
            const { MapLoader } = await import("../../loader/map/MapLoader");
            const bsp = MapLoader.getInstance().getCurrentBsp();
            if (bsp && bsp.entities) {
              const spawns = extractSpawnPoints(bsp.entities);
              if (spawns.length > 0) {
                this.gameManager!.setSpawnPoints(spawns.map(s => s.position));
                console.log(`[FPS] Extracted ${spawns.length} spawn points from BSP`);
              }
            }
          } catch (e) {
            console.warn(`[FPS] Could not extract spawn points:`, e);
          }

          // Spawn player at current position
          this.gameManager!.spawnLocalPlayer({
            x: this.physicsX,
            y: this.physicsY,
            z: this.physicsZ
          });

          // Subscribe to state updates for visual effects
          this.stateUnsubscribe = this.gameManager!.onPlayerStateUpdate((state) => {
            // Track previous grounded state for landing detection
            this.wasGroundedLastFrame = this.isGrounded;

            // NOTE: Do NOT set physicsX/Y/Z here — getLocalPlayerPosition()
            // reads V2Client's predicted state directly. Setting position here
            // causes jitter (one-frame snaps between reconciled and predicted state).
            this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);

            // Update movement state for visual effects
            this.isGrounded = state.grounded;
            this.isSliding = state.isSliding;
            this.isCrouching = state.isCrouching;
            this.crouchViewOffset = state.crouchViewOffset;
            this.wallJumpState = state.wallJumpState;
            this.ledgeGrabState = state.ledgeGrabState;
            this.actualHorizSpeed = state.actualHorizSpeed;
            this.slidePhase = state.slidePhase;
            this.ledgeGrabPhase = state.ledgeGrabPhase;

            // Capture landing velocity for impact effect
            if (!this.wasGroundedLastFrame && this.isGrounded && state.velocity.y < -50) {
              this.landingVelocityCapture = Math.abs(state.velocity.y);
            }
          });

          this.networkReady = true;
          console.log(`[FPS] Local network simulation initialized - player spawned`);
        }).catch((err: Error) => {
          console.error(`[FPS] Failed to initialize network movement:`, err);
          this.useNetworkMovement = false;
          this.networkReady = false;
        });
      }

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

    // === ADVANCED PHYSICS ===
    if (this.useNetworkMovement && this.networkReady && this.gameManager) {
      // === FRAME-SYNC: Process buffered server snapshots BEFORE input ===
      // This ensures reconciliation happens at a deterministic point in the frame,
      // preventing mid-frame camera position discontinuities (primary jitter source).
      this.gameManager.processSnapshots();
      // Render remote players with per-frame interpolated positions from snapshot buffer
      this.gameManager.renderRemotePlayers();

      // === NETWORK MOVEMENT MODE ===
      // Throttle command sending to 125Hz (server tick rate)
      // This prevents "superfast" movement on high refresh rate monitors (e.g. 144Hz, 240Hz)
      const TICK_RATE = 125;
      const TICK_DURATION = 1.0 / TICK_RATE;

      this.commandAccumulator += deltaTime;

      // Limit catch-up to avoid spiral of death if frame rate dips low
      if (this.commandAccumulator > 0.1) this.commandAccumulator = 0.1;

      while (this.commandAccumulator >= TICK_DURATION) {
        // Send input to FPSGameManager -> FPSSimulation
        // Consume pending weapon slot (fire-and-forget: sent once, then cleared)
        const weaponSlot = this._pendingWeaponSlot;
        this._pendingWeaponSlot = 0;

        this.gameManager.sendInput({
          forward: this.keys.forward,
          backward: this.keys.backward,
          left: this.keys.left,
          right: this.keys.right,
          jump: this.keys.up,
          crouch: this.keys.crouch,
          sprint: this.keys.sprint,
          fire: this.keys.fire,
          altFire: this.keys.aim,
          use: this.keys.use,
          pitch: this.mouseRotationX,
          yaw: this.mouseRotationY,
          weaponSlot,
        });

        this.commandAccumulator -= TICK_DURATION;

        // === DIAGNOSTIC: Measure actual tick rate ===
        if (!(this as any)._diagTickCount) { (this as any)._diagTickCount = 0; (this as any)._diagTickStart = performance.now(); }
        (this as any)._diagTickCount++;
        const elapsed = (performance.now() - (this as any)._diagTickStart) / 1000;
        if (elapsed >= 2.0) {
          const actualRate = (this as any)._diagTickCount / elapsed;
          console.log(`[FPS] Client tick rate: ${actualRate.toFixed(1)} Hz (expected ${TICK_RATE}), ticks=${(this as any)._diagTickCount} in ${elapsed.toFixed(2)}s`);
          (this as any)._diagTickCount = 0;
          (this as any)._diagTickStart = performance.now();
        }
      }

      // Get interpolated position for smooth rendering
      // This uses NetworkGameHost.getInterpolatedEntity() which interpolates between
      // server snapshots for buttery-smooth movement even at 20Hz network rate
      const pos = this.gameManager.getLocalPlayerPosition();
      if (pos) {
        this.physicsX = pos.x;
        this.physicsY = pos.y;
        this.physicsZ = pos.z;

        // Apply stair smoothing (snap during/after ledge grab — frozen position is deterministic)
        const stepHeight = mv.get('sv_stepheight');
        const smoothFactor = mv.get('cl_smoothfactor');
        const heightDiff = Math.abs(pos.y - this.smoothedY);

        // Track post-grab grace period: keep snapping smoothedY for a few frames
        // after grab ends so the post-grab boost (vel.y=50) doesn't cause a lerp warp
        const inGrab = this.ledgeGrabState && this.ledgeGrabState !== 'none';
        if (inGrab) {
          this.ledgeGrabSnapFrames = 15; // ~250ms at 60fps
        } else if (this.ledgeGrabSnapFrames > 0) {
          this.ledgeGrabSnapFrames--;
        }

        if (heightDiff > stepHeight * 2 || inGrab || this.ledgeGrabSnapFrames > 0) {
          // Large height change, teleport, or ledge grab (+grace) - snap immediately
          this.smoothedY = pos.y;
        } else {
          // Smooth stair climbing
          this.smoothedY = this.smoothedY + (pos.y - this.smoothedY) * smoothFactor;
        }

        // Apply to camera with smoothed Y
        this.camera.position.x = pos.x;
        this.camera.position.y = this.smoothedY + DEFAULT_VIEWHEIGHT + this.crouchViewOffset;
        this.camera.position.z = pos.z;
      } else {
        // No interpolated position yet, use last known server position
        this.camera.position.x = this.physicsX;
        this.camera.position.y = this.smoothedY + DEFAULT_VIEWHEIGHT + this.crouchViewOffset;
        this.camera.position.z = this.physicsZ;
      }

      // === SYNC MOVEMENT STATE WITH POSITION (post-tick-loop) ===
      // The onPlayerStateUpdate callback fires BEFORE the tick loop (on snapshot frames only).
      // But position is read AFTER the tick loop from V2Client's latest prediction.
      // Re-reading state here ensures velocity, grounded, isSliding etc. match the
      // current predicted position — preventing 1-frame desync that causes jitter/bob glitches.
      const currentState = this.gameManager.getCurrentMovementState();
      if (currentState) {
        this.wasGroundedLastFrame = this.isGrounded;
        this.velocity.set(currentState.velocity.x, currentState.velocity.y, currentState.velocity.z);
        this.isGrounded = currentState.grounded;
        this.isSliding = currentState.isSliding;
        this.isCrouching = currentState.isCrouching;
        this.crouchViewOffset = currentState.crouchViewOffset;
        this.wallJumpState = currentState.wallJumpState;
        this.ledgeGrabState = currentState.ledgeGrabState;
        this.actualHorizSpeed = currentState.actualHorizSpeed;
        this.slidePhase = currentState.slidePhase ?? 0;
        this.ledgeGrabPhase = currentState.ledgeGrabPhase ?? 0;

        // Capture landing velocity for impact effect
        if (!this.wasGroundedLastFrame && this.isGrounded && currentState.velocity.y < -50) {
          this.landingVelocityCapture = Math.abs(currentState.velocity.y);
        }
      }

      // Update UI
      const showSpeed = mv.get('cl_showspeed') > 0;
      this.updateSpeedDisplay(showSpeed, this.actualHorizSpeed);

      // Update developer bar (if visible)
      const devBar = DeveloperBar.getInstance();
      if (devBar.isVisible()) {
        const engine = this.camera.getScene().getEngine();
        const ping = this.gameManager?.getPing() ?? -1;
        devBar.setStats(
          engine.getFps(),
          ping,
          this.actualHorizSpeed,
          { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }
        );
      }

      // === NETWORK CAMERA EFFECTS ===
      // Compute absolute pitch offsets (NOT additive to mouseRotationX — that would accumulate per-frame)
      this.slidePitchOffset = this.slidePhase > 0.01 ? this.slidePhase * -0.22 : 0; // ~12° down
      // Smooth the ledge grab pitch offset — phase drops from 1→0 instantly on completion,
      // so lerp toward the target to avoid an 8.6° camera snap that looks like a warp
      const targetLedgePitch = this.ledgeGrabPhase > 0.01 ? this.ledgeGrabPhase * 0.15 : 0;
      const lerpSpeed = 8; // decay speed (higher = faster return to normal)
      this.ledgePitchOffset += (targetLedgePitch - this.ledgePitchOffset) * Math.min(1, deltaTime * lerpSpeed);
      // (debug log removed — was firing every frame during crouchslide, causing 60fps drop)

    }

    // === PICKUP CHECK ===
    // Moved to FPSPlayer
    // EntityManager.getInstance().checkPickups(this.camera.position, this.inventory);

    // === WEAPON FIRING ===
    // Moved to FPSPlayer
    // this.updateFiring(deltaTime);

    // === VIEWPORT EFFECTS ===
    if (this.viewportEffectsManager && this.viewportApplicator) {
      // Reset camera rotation to mouse-controlled values + slide/ledge offsets
      this.camera.rotation.x = this.mouseRotationX + this.slidePitchOffset + this.ledgePitchOffset + this.shakePitchOffset;
      this.camera.rotation.y = this.mouseRotationY + this.shakeYawOffset;
      this.camera.rotation.z = 0;  // Roll is never user-controlled in FPS

      // === DEATH CAMERA ===
      // Warsow-style: smoothly tilt camera sideways and drop view to ground when dead
      const isDead = this.gameManager?.isPlayerDead() ?? false;
      if (isDead) {
        // Ramp up death effect over ~0.8s
        this.deathCamPhase = Math.min(1.0, this.deathCamPhase + deltaTime * 1.25);
      } else if (this.deathCamPhase > 0) {
        // Snap reset on respawn
        this.deathCamPhase = 0;
        this.deathCamRoll = 0;
        this.deathCamHeightDrop = 0;
      }

      if (this.deathCamPhase > 0) {
        // Smoothstep for natural ease-in
        const t = this.deathCamPhase;
        const smooth = t * t * (3 - 2 * t);

        // Roll: tilt ~40° (0.7 rad) sideways
        this.deathCamRoll = smooth * 0.7;
        this.camera.rotation.z = this.deathCamRoll;

        // Height drop: lower camera by ~20 units (from eye to near feet)
        this.deathCamHeightDrop = smooth * 20;
        this.camera.position.y -= this.deathCamHeightDrop;
      }

      // Update camera shake (decaying random offsets)
      if (this.shakeIntensity > 0.001) {
        // Generate new random offsets each frame, scaled by intensity
        const maxAngle = 0.10;  // ~5.7 degrees max shake at full intensity
        this.shakePitchOffset = (Math.random() * 2 - 1) * maxAngle * this.shakeIntensity;
        this.shakeYawOffset = (Math.random() * 2 - 1) * maxAngle * this.shakeIntensity;

        // Decay intensity
        this.shakeIntensity *= Math.max(0, 1 - this.shakeDecayRate * deltaTime);
        if (this.shakeIntensity < 0.001) {
          this.shakeIntensity = 0;
          this.shakePitchOffset = 0;
          this.shakeYawOffset = 0;
        }
      }

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

    // === CROSSHAIR ===
    if (this.gameManager) {
      // Lazy init crosshair on first frame (avoids import at module load)
      if (!(this as any)._crosshairReady) {
        import('../../../games/fps/client/Crosshair').then(m => {
          const ch = m.Crosshair.getInstance();
          ch.init();
          (this as any)._crosshairReady = true;
          (this as any)._crosshair = ch;
        });
        (this as any)._crosshairReady = 'pending';
      }

      const ch = (this as any)._crosshair;
      if (ch) {
        // Look up weapon crosshair config
        const weaponId = this.gameManager.getCurrentWeaponId();
        if (!(this as any)._weaponsMap) {
          // Lazy load WEAPONS map (fire-and-forget)
          import('../../../games/fps/server/weapons/WeaponDef').then(m => {
            (this as any)._weaponsMap = m.WEAPONS;
          });
        }
        const weapons = (this as any)._weaponsMap;
        const weaponDef = weapons?.[weaponId];
        const crosshairConfig = weaponDef?.crosshair ?? null;

        ch.update(
          this.adsSensitivityProgress,
          this.actualHorizSpeed,
          crosshairConfig,
          this.gameManager.isPlayerDead(),
          this.gameManager.isConnectedToServer() || this.networkReady,
        );
      }
    }

    // === PLAYER VISUALS ===
    if (this.playerVisuals) {
      this.playerVisuals.update(deltaTime);
    }

    // === GIBS ===
    // Update gib physics/rendering (lazy — only if GibSystem was initialized by a death event)
    if ((this as any)._gibSystem) {
      (this as any)._gibSystem.update(deltaTime);
    } else if (this.gameManager) {
      // Try to get singleton if a death event has already initialized it
      import('../../../games/fps/client/GibSystem').then(m => {
        const gs = m.GibSystem.getInstance();
        if (gs['scene']) { // Only cache reference if already initialized
          (this as any)._gibSystem = gs;
        }
      });
    }

    // === DAMAGE NUMBERS ===
    // Update floating damage number positions (lazy — only if DamageNumbers was initialized)
    if ((this as any)._damageNumbers) {
      (this as any)._damageNumbers.update(deltaTime);
    } else if (this.gameManager) {
      import('../../../games/fps/client/DamageNumbers').then(m => {
        const dn = m.DamageNumbers.getInstance();
        if (dn['scene']) {
          (this as any)._damageNumbers = dn;
        }
      });
    }
  }

  // Speed display element
  private static speedDisplayEl: HTMLDivElement | null = null;
  private static speedNumberEl: HTMLSpanElement | null = null;

  /**
   * Reset speed display static refs (called when switching to spectator mode).
   * The DOM element is removed externally; this just nulls the cached refs
   * so a fresh widget is created when rejoining.
   */
  static resetSpeedDisplay(): void {
    FPSController.speedDisplayEl = null;
    FPSController.speedNumberEl = null;
  }

  /**
   * Update on-screen speed display
   */
  private updateSpeedDisplay(show: boolean, speed: number): void {
    if (show) {
      if (!FPSController.speedDisplayEl) {
        // Create speed display widget
        const el = document.createElement('div');
        el.id = 'fps-speed-display';
        el.className = 'fps-speedometer manga-panel';

        // Corner brackets
        const corners = document.createElement('div');
        corners.className = 'manga-panel-corners';
        el.appendChild(corners);

        // Number
        const num = document.createElement('span');
        num.className = 'fps-speedometer-number';
        num.textContent = '0';
        el.appendChild(num);

        // Label
        const label = document.createElement('span');
        label.className = 'fps-speedometer-label';
        label.textContent = 'u/s';
        el.appendChild(label);

        // Attach to HUD bottom-center zone (unified bottom bar), fallback to body
        const bottomCenter = document.querySelector('.fps-hud-bottom-center');
        (bottomCenter || document.body).appendChild(el);
        FPSController.speedDisplayEl = el;
        FPSController.speedNumberEl = num;
      }
      FPSController.speedNumberEl!.textContent = String(Math.round(speed));
      FPSController.speedDisplayEl.style.display = '';
    } else if (FPSController.speedDisplayEl) {
      FPSController.speedDisplayEl.style.display = 'none';
    }
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
    // Clean up state subscription
    if (this.stateUnsubscribe) {
      this.stateUnsubscribe();
      this.stateUnsubscribe = null;
    }

    if (this.playerVisuals) {
      this.playerVisuals.dispose();
      this.playerVisuals = null;
    }
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

// Debug player model visualization cvars
Cvar.register('cl_debugplayer', 0, {
  type: 'int',
  min: 0,
  max: 1,
  description: 'Show player model ahead with animations (developer)',
});

Cvar.register('cl_debugplayer_offset', 100, {
  type: 'float',
  min: 0,
  max: 500,
  description: 'Distance to show debug player model ahead (units)',
});

Cvar.register('cl_debugplayer_scale', 36, {
  type: 'float',
  min: 1,
  max: 200,
  description: 'Scale of debug player model (Mixamo to BSP units)',
});

Cvar.register('cl_debugplayer_walk_speed', 50, {
  type: 'float',
  min: 10,
  max: 1000,
  description: 'Natural speed for walk animation (units/sec). Increase if feet slide, decrease if they skip.',
});

Cvar.register('cl_debugplayer_run_speed', 400, {
  type: 'float',
  min: 10,
  max: 1000,
  description: 'Natural speed for run animation (units/sec). Increase if feet slide, decrease if they skip.',
});

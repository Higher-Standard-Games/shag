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
import { MovementVars } from "../../movement/MovementVars";
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
import { AdvancedCharacterController, PlayerInput } from "../../movement/AdvancedCharacterController";

export class FPSController implements ICameraController {
  public readonly type = "fps";

  private physics: AdvancedCharacterController | null = null;

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
  private smoothingInitialized: boolean = false;
  // Jump state for auto-bunny hop
  private wasGroundedLastFrame: boolean = false;


  // Viewport effects system
  private viewportEffectsManager: ViewportEffectsManager | null = null;
  private viewportApplicator: FPSApplicator | null = null;
  private baseFOV: number = 1.0;
  private landingVelocityCapture: number = 0;

  // Mouse-controlled rotation (stored separately to avoid effect accumulation)
  private mouseRotationX: number = 0;  // Pitch
  private mouseRotationY: number = 0;  // Yaw

  // Crouchslide state (delegated to AdvancedCharacterController, keeping only flags for sync if needed)
  public isSliding: boolean = false;

  // Crouch state (separate from slide)
  private isCrouching: boolean = false;
  private crouchViewOffset: number = 0;  // Current crouch offset (0 = standing, -20 = crouched)

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
        case 'KeyR':
          this.keys.reload = true;
          if (this.onReload) this.onReload();
          break;
      }

      // Weapon switching (1-9)
      if (e.code.startsWith('Digit')) {
        const digit = parseInt(e.code.replace('Digit', ''));
        if (digit > 0 && digit <= 9 && this.onWeaponSelect) {
          this.onWeaponSelect(digit - 1);
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
    // If not, we assume camera.position is at spawn location (may need adjustment)
    if (!this.smoothingInitialized) {
      // Assume camera was placed at eye level by spawn system
      // Convert to origin level by subtracting viewheight
      this.physicsX = this.camera.position.x;
      this.physicsY = this.camera.position.y - DEFAULT_VIEWHEIGHT; // Convert from eyes to origin
      this.physicsZ = this.camera.position.z;
      this.smoothedY = this.physicsY;
      this.smoothingInitialized = true;

      // Check network movement toggle
      const useNetworkMovement = mv.get('sv_network_movement') > 0;
      if (useNetworkMovement) {
        console.log(`[FPS] Network movement enabled - future: FPSGameManager will handle physics`);
        // TODO: Initialize FPSGameManager here when ready for full integration
        // For now, fall back to local physics
      }

      // Initialize Physics Engine
      if (!this.physics) {
        this.physics = new AdvancedCharacterController(new Vector3(this.physicsX, this.physicsY, this.physicsZ));
        console.log(`[FPS] Physics Engine Initialized (local mode)`);
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
    if (this.physics) {
      // 1. Construct Input
      const input: PlayerInput = {
        wishdir: wishdir,
        up: this.keys.up,
        crouch: this.keys.crouch,
        sprint: this.keys.sprint,
        aim: this.keys.aim,
        forward: this.keys.forward || this.keys.backward,
        strafe: this.keys.left || this.keys.right,
        viewForward: forward.clone()
      };

      // 2. Run Physics
      const result = this.physics.update(deltaTime, input, this.mouseRotationX);

      // 3. Apply Results
      this.camera.position.copyFrom(result.position);
      this.velocity.copyFrom(result.velocity);

      this.isGrounded = result.isGrounded;
      this.isSliding = result.isSliding;
      this.isCrouching = result.isCrouching;
      this.wallJumpState = result.wallJumpState;
      this.ledgeGrabState = result.ledgeGrabState;
      this.crouchViewOffset = result.crouchViewOffset;
      this.smoothedY = result.smoothedY;
      this.actualHorizSpeed = result.actualHorizSpeed;

      // Apply sliding camera lock - OVERRIDE mouseRotationX during slide
      if (result.isSlideActive) {
        // Lock vertical look to the calculated slide pitch
        this.mouseRotationX = result.slideCameraPitch;
        this.camera.rotation.x = result.slideCameraPitch;
      }

      // Apply ledge grab camera pitch - OVERRIDE mouseRotationX during ledge grab
      if (result.isLedgeGrabActive) {
        // Smooth camera tilt during ledge grab animation
        this.mouseRotationX = result.ledgeCameraPitch;
        this.camera.rotation.x = result.ledgeCameraPitch;
      }

      // Update Sync Vars (legacy/compatibility)
      this.physicsX = result.position.x;
      this.physicsY = result.position.y;
      this.physicsZ = result.position.z;

      // 4. Update UI
      const showSpeed = mv.get('cl_showspeed') > 0;
      this.updateSpeedDisplay(showSpeed, this.actualHorizSpeed);

      // 5. Apply View (Physics origin + Viewheight + Crouch offset)
      const viewheight = DEFAULT_VIEWHEIGHT;
      this.camera.position.y = this.smoothedY + viewheight + this.crouchViewOffset;
    }

    // === PICKUP CHECK ===
    // Moved to FPSPlayer
    // EntityManager.getInstance().checkPickups(this.camera.position, this.inventory);

    // === WEAPON FIRING ===
    // Moved to FPSPlayer
    // this.updateFiring(deltaTime);

    // === VIEWPORT EFFECTS ===
    if (this.viewportEffectsManager && this.viewportApplicator) {
      // Reset camera rotation to mouse-controlled values before applying effects
      // NOTE: If sliding, mouseRotationX is already locked to slide pitch
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

    // === PLAYER VISUALS ===
    if (this.playerVisuals) {
      this.playerVisuals.update(deltaTime);
    }
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

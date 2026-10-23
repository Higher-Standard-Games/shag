/**
 * FreeflyController - Debug camera controller for free flight
 *
 * Controls:
 * - Click canvas to capture mouse (pointer lock)
 * - ESC to release mouse
 * - WASD to move (W forward, S backward, A left, D right)
 * - Mouse movement: freelook (when captured)
 * - Jump to rise, Crouch to sink, Sprint to go faster: the player's own
 *   bindings, so Space, C/Ctrl/middle mouse and Shift by default
 * - No gravity. Collision is off by default and is turned on per session with
 *   the freefly_collision command, in native or BSP mode.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { Cvar } from "../../core/Cvar";
import { devLog } from "../../core/DevLog";
import { InputSystem } from "../../input/InputSystem";
import { getCollisionManager } from "../../physics";
import { ContentFlags, SurfaceFlags } from "../../physics/ContentFlags";
import { CameraInputHandler } from "../CameraInputHandler";
import { getFreeflyInput } from "../FreeflyInput";
import { getGameFrameHook } from "../GameFrameHook";
import type { CameraControllerConfig, ICameraController } from "./ICameraController";
import { reusableFreeCamera } from "./ReusableFreeCamera";

export class FreeflyController implements ICameraController {
  readonly type = "freefly";

  // Static default speed that persists between controller changes
  private static defaultSpeed: number = 200;

  // Static collision enable flag (toggled via console command)
  private static collisionEnabled: boolean = false;

  // Collision mode: 'bsp' uses BSP brush tracing, 'native' uses Babylon's mesh collision
  private static collisionMode: "bsp" | "native" = "native";

  private camera: FreeCamera | null = null;
  /** The camera made here when attached to a non-FreeCamera, kept for the next attach. */
  private ownCamera: FreeCamera | null = null;
  private scene: Scene | null = null;

  // State
  private enabled: boolean = true;

  // Viewport smoothing for stairs
  private physicsY: number = 0;
  private smoothedY: number = 0;
  private smoothingInitialized: boolean = false;

  // Movement keys state
  private keys = {
    forward: false, // W
    backward: false, // S
    left: false, // A
    right: false, // D
    up: false, // Space (jump)
    down: false, // Crouch
    sprint: false, // Shift
  };

  // Configuration
  private config: CameraControllerConfig = {
    speed: FreeflyController.defaultSpeed,
    mouseSensitivity: 0.002,
    invertY: false,
    fov: 1.0, // Wider FOV for debugging
  };

  /**
   * Get the current default speed
   */
  static getDefaultSpeed(): number {
    return FreeflyController.defaultSpeed;
  }

  /** The camera this controller drives while attached, or null. */
  public getCamera(): FreeCamera | null {
    return this.camera;
  }

  /**
   * Force set camera position, updating internal physics state
   * @param position Target position
   */
  public setPosition(position: Vector3): void {
    if (this.camera) {
      this.camera.position.copyFrom(position);
      this.physicsY = position.y;
      this.smoothedY = position.y;

      // Also update smoothedY in case we teleport mid-smoothing
      this.smoothingInitialized = true;
    }
  }

  /**
   * Set the default speed (persists between controller changes)
   */
  static setDefaultSpeed(speed: number): void {
    FreeflyController.defaultSpeed = speed;
  }

  /**
   * Get collision enabled state
   */
  static isCollisionEnabled(): boolean {
    return FreeflyController.collisionEnabled;
  }

  /**
   * Set collision enabled state
   */
  static setCollisionEnabled(enabled: boolean): void {
    FreeflyController.collisionEnabled = enabled;
    devLog(
      `[FreeflyController] Collision ${enabled ? "enabled" : "disabled"} (mode: ${FreeflyController.collisionMode})`,
    );
  }

  /**
   * Get collision mode
   */
  static getCollisionMode(): "bsp" | "native" {
    return FreeflyController.collisionMode;
  }

  /**
   * Set collision mode
   */
  static setCollisionMode(mode: "bsp" | "native"): void {
    FreeflyController.collisionMode = mode;
    devLog(`[FreeflyController] Collision mode set to: ${mode}`);
  }

  // Observers
  private renderObserver: Observer<Scene> | null = null;

  // Shared input handler (pointer lock, mouse look, key prevention)
  private inputHandler = new CameraInputHandler();
  private inputActions = getFreeflyInput().actions;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    const input = getFreeflyInput();
    input.prepare();
    this.inputActions = input.actions;

    // Ensure InputSystem event listeners are registered (idempotent)
    InputSystem.getInstance().init(scene, canvas);

    this.scene = scene;

    // Get starting position from existing camera
    let startPos = camera.position.clone();

    // If it's an ArcRotateCamera, start at its position looking at target
    if ("target" in camera && camera.target instanceof Vector3) {
      startPos = camera.position.clone();
    }

    if (!(camera instanceof FreeCamera)) {
      // Once per controller, not once per attach (see reusableFreeCamera).
      this.ownCamera = reusableFreeCamera(this.ownCamera, "freeflyCamera", startPos, scene);
      this.camera = this.ownCamera;
    } else {
      this.camera = camera;
    }

    // Always reset rotation when entering freefly mode — prevents carrying
    // corrupted pitch/yaw/roll from e.g. being stuck at a weird angle in FPS mode.
    // IMPORTANT: rotationQuaternion takes precedence in Babylon.js. If it's set
    // (e.g. by FPS controller or physics), Euler rotation is ignored. Clear it.
    this.camera.rotationQuaternion = null;
    this.camera.rotation.x = 0;
    this.camera.rotation.y = 0;
    this.camera.rotation.z = 0;

    // Always set as active camera (fixes blue screen when switching controllers)
    scene.activeCamera = this.camera;

    // Apply FOV
    if (this.config.fov && this.camera) {
      this.camera.fov = this.config.fov;
    }

    // Note: We handle collision ourselves via slideMove/nativeCollisionMove
    // Don't set checkCollisions here - it's managed by nativeCollisionMove when needed

    // Clear default inputs - we handle everything
    this.camera.inputs.clear();

    // Set up shared input handlers (pointer lock, mouse look, key prevention)
    this.inputHandler.setup(canvas, this.camera, this.config, "FreeflyController", {
      onUnlocked: () => {
        this.keys.forward = false;
        this.keys.backward = false;
        this.keys.left = false;
        this.keys.right = false;
        this.keys.up = false;
        this.keys.down = false;
      },
    });

    // Set up render observer for movement
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000;
      this.update(deltaTime);
    });

    devLog("[FreeflyController] Attached - Click to capture mouse, WASD to move, ESC to release");
  }

  detach(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    this.inputHandler.teardown();

    this.camera = null;
    this.scene = null;

    devLog("[FreeflyController] Detached");
  }

  /**
   * Sync this.keys state from InputSystem per frame.
   * Uses the active game's action mapping or engine-local freefly actions.
   */
  private syncKeysFromInput(): void {
    const input = InputSystem.getInstance();
    this.keys.forward = input.isActive(this.inputActions.forward);
    this.keys.backward = input.isActive(this.inputActions.backward);
    this.keys.left = input.isActive(this.inputActions.left);
    this.keys.right = input.isActive(this.inputActions.right);
    this.keys.up = input.isActive(this.inputActions.up);
    this.keys.down = input.isActive(this.inputActions.down);
    this.keys.sprint = input.isActive(this.inputActions.sprint);
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;

    // Tick the network and render remote players even when paused or spectating.
    // Via the injected game frame hook — no direct game import (QA-WO7).
    try {
      const game = getGameFrameHook();
      if (game?.isGameRunning()) {
        game.processSnapshots();
        game.renderRemotePlayers();
      }
    } catch (_e) {
      // Ignore if not initialized yet
    }

    if (!this.inputHandler.isPointerLocked) {
      this.keys.forward = false;
      this.keys.backward = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.up = false;
      this.keys.down = false;
      this.keys.sprint = false;
    } else {
      // Sync key state from InputSystem
      this.syncKeysFromInput();
    }

    const sprintMultiplier = this.keys.sprint ? 3 : 1;
    const speed = (this.config.speed || 200) * sprintMultiplier * deltaTime;
    const stepHeight = 18; // Max stair step height
    const smoothFactor = 0.15;

    // Initialize smoothing on first frame
    if (!this.smoothingInitialized) {
      this.physicsY = this.camera.position.y;
      this.smoothedY = this.camera.position.y;
      this.smoothingInitialized = true;
    }

    // Restore physics Y before collision (not smoothed)
    this.camera.position.y = this.physicsY;

    // Get camera directions
    const forward = this.camera.getDirection(Vector3.Forward());
    const right = this.camera.getDirection(Vector3.Right());
    const up = Vector3.Up();

    // Calculate movement
    const movement = Vector3.Zero();

    if (this.keys.forward) movement.addInPlace(forward.scale(speed));
    if (this.keys.backward) movement.addInPlace(forward.scale(-speed));
    if (this.keys.left) movement.addInPlace(right.scale(-speed));
    if (this.keys.right) movement.addInPlace(right.scale(speed));
    if (this.keys.up) movement.addInPlace(up.scale(speed));
    if (this.keys.down) movement.addInPlace(up.scale(-speed));

    // Apply movement with collision
    if (movement.length() > 0) {
      if (FreeflyController.collisionEnabled) {
        if (FreeflyController.collisionMode === "native") {
          this.nativeCollisionMove(movement);
        } else {
          const cm = getCollisionManager();
          const isInit = cm.isInitialized();

          if (!FreeflyController._loggedState) {
            FreeflyController._loggedState = true;
            devLog(
              `[Freefly] Collision check: enabled=${FreeflyController.collisionEnabled}, mode=${FreeflyController.collisionMode}, initialized=${isInit}, instance=${cm.getInstanceId()}, backend=${cm.getBackendType()}`,
            );
          }

          if (isInit) {
            this.slideMove(movement, cm);
          } else {
            if (!FreeflyController._warnedNotInit) {
              console.warn("[Freefly] Collision enabled but not initialized!");
              FreeflyController._warnedNotInit = true;
            }
            this.camera.position.addInPlace(movement);
          }
        }
      } else {
        this.camera.position.addInPlace(movement);
      }
    }

    // Save physics Y after collision
    this.physicsY = this.camera.position.y;

    // Viewport smoothing for stairs
    const heightDiff = Math.abs(this.physicsY - this.smoothedY);
    if (heightDiff > stepHeight * 2) {
      // Large change - snap immediately
      this.smoothedY = this.physicsY;
    } else {
      // Smooth interpolation for stairs
      this.smoothedY = this.smoothedY + (this.physicsY - this.smoothedY) * smoothFactor;
    }

    // Apply smoothed Y for rendering
    this.camera.position.y = this.smoothedY;
  }

  /** Set once the collision state has been logged; freefly_collision clears it to log again. */
  static _loggedState = false;

  private static _warnedNotInit = false;

  // Debug: log once per second
  private static _lastDebugTime = 0;

  // Track if we've set up native collision
  private static _nativeCollisionSetup = false;

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
    if (!FreeflyController._nativeCollisionSetup) {
      FreeflyController._nativeCollisionSetup = true;

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
        if (
          mesh.name.includes("bsp_") ||
          mesh.name.includes("world") ||
          mesh.parent?.name.includes("bsp_") ||
          mesh.parent?.name.includes("world")
        ) {
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
      devLog(`[FreeflyController] Skipped ${skippedCount} non-solid meshes (halos, flares, etc.)`);

      devLog(`[FreeflyController] Native collision setup: ${collisionMeshCount} meshes with collision enabled`);
      devLog(
        `[FreeflyController] Camera ellipsoid: (${this.camera.ellipsoid.x}, ${this.camera.ellipsoid.y}, ${this.camera.ellipsoid.z})`,
      );
    }

    // IMPORTANT: camera.position.addInPlace() bypasses collision!
    // We must use Babylon's internal collision system

    // Debug: check what methods are available
    const cam = this.camera;
    if (!FreeflyController._debuggedMethods) {
      FreeflyController._debuggedMethods = true;
      devLog(`[FreeflyController] Camera type: ${this.camera.getClassName()}`);
      devLog(`[FreeflyController] Has _collideWithWorld: ${typeof cam._collideWithWorld}`);
      devLog(`[FreeflyController] Has _checkInputs: ${typeof cam._checkInputs}`);
      devLog(`[FreeflyController] checkCollisions: ${this.camera.checkCollisions}`);
      devLog(`[FreeflyController] scene.collisionsEnabled: ${this.scene.collisionsEnabled}`);

      // List meshes with collision enabled
      const collisionMeshes = this.scene.meshes.filter((m) => m.checkCollisions);
      devLog(`[FreeflyController] Meshes with checkCollisions=true: ${collisionMeshes.length}`);
      if (collisionMeshes.length > 0) {
        devLog(`[FreeflyController] Sample collision mesh: "${collisionMeshes[0].name}"`);
      }
    }

    // Try using _collideWithWorld if available
    if (cam._collideWithWorld && this.camera.checkCollisions) {
      const posBefore = this.camera.position.clone();

      // Debug: Check for collision meshes near camera
      const now = Date.now();
      if (now - FreeflyController._lastDebugTime > 1000 && this.camera.position) {
        FreeflyController._lastDebugTime = now;
        const camPos = this.camera.position;
        const nearbyMeshes = this.scene.meshes.filter((m) => {
          if (!m.checkCollisions) return false;
          const dist = Vector3.Distance(m.position, camPos);
          return dist < 100;
        });
        devLog(
          `[FreeflyController] Camera at (${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)})`,
        );
        devLog(`[FreeflyController] Nearby collision meshes (< 100 units): ${nearbyMeshes.length}`);
        if (nearbyMeshes.length > 0 && nearbyMeshes.length < 10) {
          nearbyMeshes.forEach((m) => {
            const dist = Vector3.Distance(m.position, camPos);
            devLog(`  - "${m.name}" at dist=${dist.toFixed(1)} metadata=${JSON.stringify(m.metadata)}`);
          });
        }
      }

      cam._collideWithWorld(movement);
      const posAfterBabylon = this.camera.position.clone();
      const ellipsoidOffset = this.camera.ellipsoidOffset ? this.camera.ellipsoidOffset : Vector3.Zero();

      // Use the new Q3 collision backend for BSP collision
      const cm = getCollisionManager();
      const wasBackend = cm.getBackendType();
      if (wasBackend !== "q3") {
        cm.setBackend("q3");
      }

      // Debug logging
      const debugBsp = now - FreeflyController._lastDebugTime < 100;
      if (debugBsp) {
        devLog(`[Q3 Collision] pos: (${posBefore.x.toFixed(1)}, ${posBefore.y.toFixed(1)}, ${posBefore.z.toFixed(1)})`);
        devLog(
          `[Q3 Collision] movement: (${movement.x.toFixed(3)}, ${movement.y.toFixed(3)}, ${movement.z.toFixed(3)})`,
        );
      }

      // Use Q3-style slideMove for smooth wall sliding
      const backend = cm.getSweepBackend();
      const traceOpts = {
        radius: 16,
        height: 56,
        contentMask: 0x1 | 0x10000, // SOLID | PLAYERCLIP
      };

      if (backend && typeof backend.stepSlideMove === "function") {
        // Use stepSlideMove for smooth collision + stair stepping
        const slideResult = backend.stepSlideMove(posBefore, movement, traceOpts);
        this.camera.position.copyFrom(slideResult.endPos);

        if (slideResult.hitCount > 0 && debugBsp) {
          devLog(`[Freefly][StepSlideMove] ${slideResult.hitCount} collision(s), stepped=${slideResult.stepped}`);
        }
      } else if (backend && typeof backend.slideMove === "function") {
        // Fallback to slideMove without stepping
        const slideResult = backend.slideMove(posBefore, movement, traceOpts);
        this.camera.position.copyFrom(slideResult.endPos);
      } else {
        // Fallback to simple trace
        const clipTrace = cm.trace(posBefore, posAfterBabylon, traceOpts);
        if (clipTrace.fraction < 1.0) {
          this.camera.position.copyFrom(clipTrace.endPos);
        }
      }

      if (wasBackend && wasBackend !== "q3") {
        cm.setBackend(wasBackend);
      }

      // Check if we're stuck in solid (startSolid case)
      const stuckCheck = cm.trace(this.camera.position, this.camera.position, traceOpts);
      if (stuckCheck.startSolid) {
        const nowStuck = Date.now();
        if (nowStuck - FreeflyController._lastClipHitLogTime > 250) {
          FreeflyController._lastClipHitLogTime = nowStuck;
          const hitBrushIndex = stuckCheck.hitBrushIndex;
          const hitTextureName = stuckCheck.hitTextureName;
          FreeflyController._lastClipHitBrushIndex = typeof hitBrushIndex === "number" ? hitBrushIndex : null;
          FreeflyController._lastClipHitTextureName = typeof hitTextureName === "string" ? hitTextureName : null;
          devLog(`[Freefly][Stuck] startSolid=true brush=${hitBrushIndex} tex=${hitTextureName}`);
        }

        const base = posAfterBabylon.clone();
        const nudgeSteps = [0.5, 1.0, 2.0, 4.0, 8.0];
        const testDirs = [
          new Vector3(1, 0, 0),
          new Vector3(-1, 0, 0),
          new Vector3(0, 1, 0),
          new Vector3(0, -1, 0),
          new Vector3(0, 0, 1),
          new Vector3(0, 0, -1),
          new Vector3(1, 1, 0),
          new Vector3(-1, -1, 0),
          new Vector3(1, 0, 1),
          new Vector3(-1, 0, -1),
          new Vector3(0, 1, 1),
          new Vector3(0, -1, -1),
        ];

        for (const nudge of nudgeSteps) {
          for (const dir of testDirs) {
            const testPos = base.add(dir.scale(nudge));
            const testStart = testPos.add(ellipsoidOffset);
            const testTraceA = cm.trace(testStart, testStart, {
              radius: 16,
              height: 56,
              clipTexturesOnly: true,
              contentMask: 0x1 | 0x10000,
            });
            const testTraceB = cm.trace(testStart, testStart, {
              radius: 16,
              height: 56,
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
        devLog(
          `[FreeflyController] Collision detected! Expected move: ${movement.length().toFixed(2)}, Actual: ${actualMove.length().toFixed(2)}`,
        );
      }
    } else {
      // Fallback: no collision available, just move
      devLog(`[FreeflyController] WARNING: _collideWithWorld not available, falling back to direct move`);
      this.camera.position.addInPlace(movement);
    }
  }

  private static _debuggedMethods = false;
  private static _lastClipHitLogTime = 0;
  private static _lastClipHitBrushIndex: number | null = null;
  private static _lastClipHitTextureName: string | null = null;

  static getLastClipHitBrushIndex(): number | null {
    return FreeflyController._lastClipHitBrushIndex;
  }

  static getLastClipHitTextureName(): string | null {
    return FreeflyController._lastClipHitTextureName;
  }

  /**
   * Check if a mesh should be excluded from collision detection
   * Excludes: billboards, light halos, flares, transparent/additive effects
   */
  private shouldSkipCollision(mesh: AbstractMesh): boolean {
    const name = mesh.name?.toLowerCase() || "";
    const textureName = mesh.metadata?.textureName?.toLowerCase() || "";

    const contentFlags = typeof mesh.metadata?.contentFlags === "number" ? mesh.metadata.contentFlags : 0;
    const surfaceFlags = typeof mesh.metadata?.surfaceFlags === "number" ? mesh.metadata.surfaceFlags : 0;

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
    if (
      name.includes("flare") ||
      name.includes("halo") ||
      name.includes("glow") ||
      name.includes("billboard") ||
      name.includes("sprite") ||
      name.includes("particle") ||
      name.includes("effect") ||
      name.includes("light_")
    ) {
      return true;
    }

    // Skip by texture name patterns (common Q3/Warsow light textures)
    if (
      textureName.includes("flare") ||
      textureName.includes("halo") ||
      textureName.includes("glow") ||
      textureName.includes("flareshader") ||
      textureName.includes("lights/") ||
      textureName.includes("sfx/")
    ) {
      return true;
    }

    // Skip meshes with additive blending (light effects)
    const material = mesh.material;
    if (material) {
      // Check for additive alpha mode (used for light effects)
      if (material.alphaMode === 1 || material.alphaMode === 2) {
        // ADD or MULTIPLY
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

  /**
   * Apply collision using BSP trace with Q3-style sliding
   */
  private slideMove(originalMovement: Vector3, cm: ReturnType<typeof getCollisionManager>): void {
    if (!this.camera || !this.scene) return;

    const start = this.camera.position.clone();
    const end = start.add(originalMovement);
    const traceOpts = { radius: 16, height: 56 };

    // Trace through BSP
    const trace = cm.trace(start, end, traceOpts);

    // Debug logging once per second
    const now = Date.now();
    if (now - FreeflyController._lastDebugTime > 1000) {
      FreeflyController._lastDebugTime = now;
      const camPos = this.camera.position;
      devLog(
        `[Freefly] pos=(${camPos.x.toFixed(0)}, ${camPos.y.toFixed(0)}, ${camPos.z.toFixed(0)}) → trace: frac=${trace.fraction.toFixed(3)}, startSolid=${trace.startSolid}, hit=${trace.fraction < 1.0}`,
      );
    }

    // Log every hit for debugging
    if (trace.fraction < 1.0) {
      devLog(
        `[Freefly] HIT at fraction=${trace.fraction.toFixed(3)}, normal=(${trace.normal?.x.toFixed(2)}, ${trace.normal?.y.toFixed(2)}, ${trace.normal?.z.toFixed(2)})`,
      );
    }

    // If we started in solid, don't move (stuck detection)
    if (trace.startSolid) {
      devLog(`[Freefly] BLOCKED: startSolid=true, attempting nudge out`);
      // Try to nudge out of solid with more aggressive steps
      const nudgeSteps = [1.0, 2.0, 4.0];
      const testDirs = [
        new Vector3(1, 0, 0),
        new Vector3(-1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, -1, 0),
        new Vector3(0, 0, 1),
        new Vector3(0, 0, -1),
        new Vector3(1, 1, 0),
        new Vector3(-1, -1, 0),
        new Vector3(1, 0, 1),
        new Vector3(-1, 0, -1),
        new Vector3(0, 1, 1),
        new Vector3(0, -1, -1),
      ];
      for (const nudge of nudgeSteps) {
        for (const dir of testDirs) {
          const testPos = start.add(dir.scale(nudge));
          const testTrace = cm.trace(testPos, testPos.add(new Vector3(0, -0.1, 0)), traceOpts);
          if (!testTrace.startSolid) {
            devLog(
              `[Freefly] Nudge successful at (${testPos.x.toFixed(1)}, ${testPos.y.toFixed(1)}, ${testPos.z.toFixed(1)})`,
            );
            this.camera.position = testPos;
            return;
          }
        }
      }
      devLog(`[Freefly] Nudge failed, stuck in solid`);
      // Couldn't nudge out - don't move
      return;
    }

    if (trace.fraction >= 1.0) {
      // No collision - apply full movement
      this.camera.position = end;
    } else if (trace.fraction > 0) {
      // Partial collision - move to contact point with small offset
      const contactPoint = Vector3.Lerp(start, end, trace.fraction);

      // Push back slightly from the wall (use plain numbers to avoid type issues)
      if (trace.normal) {
        const n = trace.normal;
        contactPoint.x += n.x * 0.5;
        contactPoint.y += n.y * 0.5;
        contactPoint.z += n.z * 0.5;
      }

      this.camera.position = contactPoint;

      // Slide along the wall (Q3-style, multiple iterations)
      if (trace.normal) {
        let velocity = originalMovement.clone();
        let timeLeft = 1.0 - trace.fraction;
        const maxTries = 4; // Quake 3 uses up to 4-5 slide attempts
        for (let i = 0; i < maxTries && timeLeft > 0.01 && velocity.length() > 0.01; i++) {
          const n = trace.normal;
          const remaining = velocity.scale(timeLeft);
          // Calculate dot product manually
          const dot = remaining.x * n.x + remaining.y * n.y + remaining.z * n.z;
          // Slide = remaining - normal * dot
          const slideMove = new Vector3(remaining.x - n.x * dot, remaining.y - n.y * dot, remaining.z - n.z * dot);

          if (slideMove.length() < 0.01) {
            devLog(`[Freefly] Slide ${i + 1}/${maxTries}: negligible movement, stopping`);
            break;
          }

          devLog(
            `[Freefly] Slide ${i + 1}/${maxTries}: attempting (${slideMove.x.toFixed(1)}, ${slideMove.y.toFixed(1)}, ${slideMove.z.toFixed(1)})`,
          );
          const slideStart = this.camera.position.clone();
          const slideEnd = slideStart.add(slideMove);
          const slideTrace = cm.trace(slideStart, slideEnd, traceOpts);

          if (slideTrace.fraction > 0) {
            const slidePos = Vector3.Lerp(slideStart, slideEnd, Math.min(slideTrace.fraction * 0.9, 1.0));
            if (slideTrace.fraction < 1.0 && slideTrace.normal) {
              const sn = slideTrace.normal;
              slidePos.x += sn.x * 0.5;
              slidePos.y += sn.y * 0.5;
              slidePos.z += sn.z * 0.5;
              devLog(`[Freefly] Slide ${i + 1}/${maxTries}: hit again at frac=${slideTrace.fraction.toFixed(3)}`);
            } else {
              devLog(`[Freefly] Slide ${i + 1}/${maxTries}: moved successfully`);
            }
            this.camera.position = slidePos;
            timeLeft *= 1.0 - slideTrace.fraction;
            velocity = slideMove.normalize().scale(velocity.length());
          } else {
            devLog(`[Freefly] Slide ${i + 1}/${maxTries}: blocked completely`);
            break;
          }
        }
      }
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
      this.keys.down = false;
      if (this.inputHandler.isPointerLocked) {
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
Cvar.register("cam_freefly_speed", FreeflyController.getDefaultSpeed(), {
  type: "float",
  min: 10,
  max: 10000,
  description: "Freefly camera movement speed",
  onChange: (value) => {
    FreeflyController.setDefaultSpeed(value as number);
  },
});

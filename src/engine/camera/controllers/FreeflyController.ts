/**
 * FreeflyController - Debug camera controller for free flight
 * 
 * Controls:
 * - Click canvas to capture mouse (pointer lock)
 * - ESC to release mouse
 * - WASD to move (W forward, S backward, A left, D right)
 * - Mouse movement: freelook (when captured)
 * - Space to go up, Shift to go down
 * - No gravity, no collision, flies through everything
 */

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ICameraController, CameraControllerConfig } from "./ICameraController";
import { getCollisionManager } from "../../physics";
import { Cvar } from "../../core/Cvar";
import { ContentFlags, SurfaceFlags } from "../../physics/ContentFlags";

export class FreeflyController implements ICameraController {
  readonly type = "freefly";

  // Static default speed that persists between controller changes
  private static defaultSpeed: number = 200;
  
  // Static collision enable flag (toggled via console command)
  private static collisionEnabled: boolean = true;
  
  // Collision mode: 'bsp' uses BSP brush tracing, 'native' uses Babylon's mesh collision
  private static collisionMode: 'bsp' | 'native' = 'native';

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
    up: false,       // Space
    down: false,     // Shift
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
    console.log(`[FreeflyController] Collision ${enabled ? 'enabled' : 'disabled'} (mode: ${FreeflyController.collisionMode})`);
  }
  
  /**
   * Get collision mode
   */
  static getCollisionMode(): 'bsp' | 'native' {
    return FreeflyController.collisionMode;
  }
  
  /**
   * Set collision mode
   */
  static setCollisionMode(mode: 'bsp' | 'native'): void {
    FreeflyController.collisionMode = mode;
    console.log(`[FreeflyController] Collision mode set to: ${mode}`);
  }
  
  // Observers
  private renderObserver: Observer<Scene> | null = null;
  
  // Event handlers (bound for removal)
  private onCanvasClick: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private onPointerLockChange: (() => void) | null = null;

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
    
    console.log("[FreeflyController] Attached - Click to capture mouse, WASD to move, ESC to release");
  }

  private setupInputHandlers(): void {
    if (!this.canvas) return;
    
    // Click to capture mouse - use document click and check target
    this.onCanvasClick = (e: MouseEvent) => {
      // Only respond to clicks on the canvas itself
      if (e.target !== this.canvas) return;
      
      console.log('[FreeflyController] Canvas clicked, requesting pointer lock');
      if (!this.isPointerLocked && this.canvas) {
        this.canvas.requestPointerLock();
      }
    };
    
    // Handle pointer lock change
    this.onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
      if (this.isPointerLocked) {
        console.log('[FreeflyController] Mouse captured - WASD to move, ESC to release');
      } else {
        console.log('[FreeflyController] Mouse released - Click to capture');
        // Reset movement keys when releasing
        this.keys.forward = false;
        this.keys.backward = false;
        this.keys.left = false;
        this.keys.right = false;
        this.keys.up = false;
        this.keys.down = false;
      }
    };
    
    // Mouse look (only when pointer is locked)
    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || !this.camera || !this.isPointerLocked) return;
      
      const baseSensitivity = this.config.mouseSensitivity || 0.002;
      const sensitivityMultiplier = Cvar.getNumber('m_sensitivity') || 1.0;
      const sensitivity = baseSensitivity * sensitivityMultiplier;
      const invertYCvar = Cvar.getBool('m_invertY');
      const invertY = (this.config.invertY || invertYCvar) ? -1 : 1;
      
      // Apply freelook
      this.camera.rotation.y += e.movementX * sensitivity;
      this.camera.rotation.x += e.movementY * sensitivity * invertY;
      
      // Clamp vertical rotation
      this.camera.rotation.x = Math.max(
        -Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, this.camera.rotation.x)
      );
    };
    
    // Keyboard input
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.isPointerLocked) return;
      
      switch (e.code) {
        case 'KeyW': this.keys.forward = true; break;
        case 'KeyS': this.keys.backward = true; break;
        case 'KeyA': this.keys.left = true; break;
        case 'KeyD': this.keys.right = true; break;
        case 'Space': this.keys.up = true; e.preventDefault(); break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.down = true; break;
      }
    };
    
    this.onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': this.keys.forward = false; break;
        case 'KeyS': this.keys.backward = false; break;
        case 'KeyA': this.keys.left = false; break;
        case 'KeyD': this.keys.right = false; break;
        case 'Space': this.keys.up = false; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.down = false; break;
      }
    };
    
    // Add event listeners - use document for click to ensure we catch it
    document.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  private removeInputHandlers(): void {
    // Exit pointer lock if active
    if (this.isPointerLocked) {
      document.exitPointerLock();
    }
    
    if (this.onCanvasClick) {
      document.removeEventListener('click', this.onCanvasClick);
    }
    if (this.onPointerLockChange) {
      document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }
    if (this.onMouseMove) {
      document.removeEventListener('mousemove', this.onMouseMove);
    }
    if (this.onKeyDown) {
      document.removeEventListener('keydown', this.onKeyDown);
    }
    if (this.onKeyUp) {
      document.removeEventListener('keyup', this.onKeyUp);
    }
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
    
    console.log("[FreeflyController] Detached");
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera || !this.isPointerLocked) return;
    
    const speed = (this.config.speed || 200) * deltaTime;
    
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
    
    // Apply movement with optional collision
    if (movement.length() > 0) {
      if (FreeflyController.collisionEnabled) {
        if (FreeflyController.collisionMode === 'native') {
          // Use Babylon's native mesh collision
          this.nativeCollisionMove(movement);
        } else {
          // Use BSP brush tracing
          const cm = getCollisionManager();
          const isInit = cm.isInitialized();
          
          // Debug: log state once
          if (!FreeflyController._loggedState) {
            FreeflyController._loggedState = true;
            console.log(`[Freefly] Collision check: enabled=${FreeflyController.collisionEnabled}, mode=${FreeflyController.collisionMode}, initialized=${isInit}, instance=${cm.getInstanceId()}, backend=${cm.getBackendType()}`);
          }
          
          if (isInit) {
            this.slideMove(movement, cm);
          } else {
            if (!FreeflyController._warnedNotInit) {
              console.warn('[Freefly] Collision enabled but not initialized!');
              FreeflyController._warnedNotInit = true;
            }
            this.camera.position.addInPlace(movement);
          }
        }
      } else {
        this.camera.position.addInPlace(movement);
      }
    }
  }
  
  private static _loggedState = false;
  
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
      console.log(`[FreeflyController] Skipped ${skippedCount} non-solid meshes (halos, flares, etc.)`)
      
      console.log(`[FreeflyController] Native collision setup: ${collisionMeshCount} meshes with collision enabled`);
      console.log(`[FreeflyController] Camera ellipsoid: (${this.camera.ellipsoid.x}, ${this.camera.ellipsoid.y}, ${this.camera.ellipsoid.z})`);
    }
    
    // IMPORTANT: camera.position.addInPlace() bypasses collision!
    // We must use Babylon's internal collision system
    
    // Debug: check what methods are available
    const cam = this.camera as any;
    if (!FreeflyController._debuggedMethods) {
      FreeflyController._debuggedMethods = true;
      console.log(`[FreeflyController] Camera type: ${this.camera.getClassName()}`);
      console.log(`[FreeflyController] Has _collideWithWorld: ${typeof cam._collideWithWorld}`);
      console.log(`[FreeflyController] Has _checkInputs: ${typeof cam._checkInputs}`);
      console.log(`[FreeflyController] checkCollisions: ${this.camera.checkCollisions}`);
      console.log(`[FreeflyController] scene.collisionsEnabled: ${this.scene.collisionsEnabled}`);
      
      // List meshes with collision enabled
      const collisionMeshes = this.scene.meshes.filter(m => m.checkCollisions);
      console.log(`[FreeflyController] Meshes with checkCollisions=true: ${collisionMeshes.length}`);
      if (collisionMeshes.length > 0) {
        console.log(`[FreeflyController] Sample collision mesh: "${collisionMeshes[0].name}"`);
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
        const nearbyMeshes = this.scene.meshes.filter(m => {
          if (!m.checkCollisions) return false;
          const dist = Vector3.Distance(m.position, camPos);
          return dist < 100;
        });
        console.log(`[FreeflyController] Camera at (${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)})`);
        console.log(`[FreeflyController] Nearby collision meshes (< 100 units): ${nearbyMeshes.length}`);
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
      const debugBsp = now - FreeflyController._lastDebugTime < 100;
      if (debugBsp) {
        console.log(`[Q3 Collision] pos: (${posBefore.x.toFixed(1)}, ${posBefore.y.toFixed(1)}, ${posBefore.z.toFixed(1)})`);
        console.log(`[Q3 Collision] movement: (${movement.x.toFixed(3)}, ${movement.y.toFixed(3)}, ${movement.z.toFixed(3)})`);
      }

      // Use Q3-style slideMove for smooth wall sliding
      const backend = (cm as any).backends?.get('q3');
      const traceOpts = {
        radius: 16,
        height: 56,
        contentMask: 0x1 | 0x10000, // SOLID | PLAYERCLIP
      };
      
      if (backend && typeof backend.slideMove === 'function') {
        // Use slideMove for smooth collision response
        const slideResult = backend.slideMove(posBefore, movement, traceOpts);
        this.camera.position.copyFrom(slideResult.endPos);
        
        if (slideResult.hitCount > 0 && debugBsp) {
          console.log(`[Freefly][SlideMove] ${slideResult.hitCount} collision(s)`);
        }
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
        if (nowStuck - FreeflyController._lastClipHitLogTime > 250) {
          FreeflyController._lastClipHitLogTime = nowStuck;
          const hitBrushIndex = (stuckCheck as any).hitBrushIndex;
          const hitTextureName = (stuckCheck as any).hitTextureName;
          FreeflyController._lastClipHitBrushIndex = typeof hitBrushIndex === 'number' ? hitBrushIndex : null;
          FreeflyController._lastClipHitTextureName = typeof hitTextureName === 'string' ? hitTextureName : null;
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
              radius: 16,
              height: 56,
              clipTexturesOnly: true,
              contentMask: 0x1 | 0x10000,
            });
            const testTraceB = cm.trace(testStart as never, testStart as never, {
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
        console.log(`[FreeflyController] Collision detected! Expected move: ${movement.length().toFixed(2)}, Actual: ${actualMove.length().toFixed(2)}`);
      }
    } else {
      // Fallback: no collision available, just move
      console.log(`[FreeflyController] WARNING: _collideWithWorld not available, falling back to direct move`);
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
  
  /**
   * Apply collision using BSP trace with Q3-style sliding
   */
  private slideMove(originalMovement: Vector3, cm: ReturnType<typeof getCollisionManager>): void {
    if (!this.camera || !this.scene) return;

    const start = this.camera.position.clone();
    const end = start.add(originalMovement);
    const traceOpts = { radius: 16, height: 56 };

    // Trace through BSP (cast to handle babylonjs vs @babylonjs/core type mismatch)
    const trace = cm.trace(start as never, end as never, traceOpts);

    // Debug logging once per second
    const now = Date.now();
    if (now - FreeflyController._lastDebugTime > 1000) {
      FreeflyController._lastDebugTime = now;
      const camPos = this.camera.position;
      console.log(`[Freefly] pos=(${camPos.x.toFixed(0)}, ${camPos.y.toFixed(0)}, ${camPos.z.toFixed(0)}) → trace: frac=${trace.fraction.toFixed(3)}, startSolid=${trace.startSolid}, hit=${trace.fraction < 1.0}`);
    }

    // Log every hit for debugging
    if (trace.fraction < 1.0) {
      console.log(`[Freefly] HIT at fraction=${trace.fraction.toFixed(3)}, normal=(${trace.normal?.x.toFixed(2)}, ${trace.normal?.y.toFixed(2)}, ${trace.normal?.z.toFixed(2)})`);
    }

    // If we started in solid, don't move (stuck detection)
    if (trace.startSolid) {
      console.log(`[Freefly] BLOCKED: startSolid=true, attempting nudge out`);
      // Try to nudge out of solid with more aggressive steps
      const nudgeSteps = [1.0, 2.0, 4.0];
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
          const testPos = start.add(dir.scale(nudge));
          const testTrace = cm.trace(testPos as never, testPos.add(new Vector3(0, -0.1, 0)) as never, traceOpts);
          if (!testTrace.startSolid) {
            console.log(`[Freefly] Nudge successful at (${testPos.x.toFixed(1)}, ${testPos.y.toFixed(1)}, ${testPos.z.toFixed(1)})`);
            this.camera.position = testPos;
            return;
          }
        }
      }
      console.log(`[Freefly] Nudge failed, stuck in solid`);
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
          const slideMove = new Vector3(
            remaining.x - n.x * dot,
            remaining.y - n.y * dot,
            remaining.z - n.z * dot
          );

          if (slideMove.length() < 0.01) {
            console.log(`[Freefly] Slide ${i+1}/${maxTries}: negligible movement, stopping`);
            break;
          }

          console.log(`[Freefly] Slide ${i+1}/${maxTries}: attempting (${slideMove.x.toFixed(1)}, ${slideMove.y.toFixed(1)}, ${slideMove.z.toFixed(1)})`);
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
              console.log(`[Freefly] Slide ${i+1}/${maxTries}: hit again at frac=${slideTrace.fraction.toFixed(3)}`);
            } else {
              console.log(`[Freefly] Slide ${i+1}/${maxTries}: moved successfully`);
            }
            this.camera.position = slidePos;
            timeLeft *= (1.0 - slideTrace.fraction);
            velocity = slideMove.normalize().scale(velocity.length());
          } else {
            console.log(`[Freefly] Slide ${i+1}/${maxTries}: blocked completely`);
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

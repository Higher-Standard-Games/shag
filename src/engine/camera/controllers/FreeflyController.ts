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

import {
  Camera,
  FreeCamera,
  Observer,
  Scene,
  Vector3,
} from "babylonjs";
import { ICameraController, CameraControllerConfig } from "./ICameraController";
import { getCollisionManager } from "../../physics";

export class FreeflyController implements ICameraController {
  readonly type = "freefly";

  // Static default speed that persists between controller changes
  private static defaultSpeed: number = 200;
  
  // Static collision enable flag (toggled via console command)
  private static collisionEnabled: boolean = false;

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
    console.log(`[FreeflyController] Collision ${enabled ? 'enabled' : 'disabled'}`);
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
      
      const sensitivity = this.config.mouseSensitivity || 0.002;
      const invertY = this.config.invertY ? -1 : 1;
      
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
        const cm = getCollisionManager();
        const isInit = cm.isInitialized();
        
        // Debug: log state once
        if (!FreeflyController._loggedState) {
          FreeflyController._loggedState = true;
          console.log(`[Freefly] Collision check: enabled=${FreeflyController.collisionEnabled}, initialized=${isInit}, instance=${cm.getInstanceId()}, backend=${cm.getBackendType()}`);
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
      } else {
        this.camera.position.addInPlace(movement);
      }
    }
  }
  
  private static _loggedState = false;
  
  private static _warnedNotInit = false;
  
  // Debug: log once per second
  private static _lastDebugTime = 0;
  
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

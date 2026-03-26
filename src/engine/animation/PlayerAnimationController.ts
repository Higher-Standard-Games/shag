/**
 * Player Animation Controller
 *
 * Main controller for player character animation. Combines:
 * - Pre-baked Mixamo animations (locomotion, jump, crouch)
 * - Procedural animation layers (aim IK, lean, slide, wall jump)
 * - Animation blending and state machine
 */

import type { AnimationGroup, Mesh, Scene, Skeleton } from "@babylonjs/core";
import { AnimationBlender, type BlendConfig } from "./AnimationBlender";
import { AnimationLoader } from "./AnimationLoader";
import { HumanoidRig } from "./HumanoidRig";
import {
  AnimationStateName,
  createDefaultAnimationState,
  type PlayerAnimationState,
  selectAnimationState,
} from "./PlayerAnimationState";
import { type ProceduralLayerConfig, ProceduralLayers } from "./ProceduralLayers";

/**
 * Configuration for player animation controller
 */
export interface PlayerAnimationConfig {
  /** Animation blend configuration */
  blend: Partial<BlendConfig>;

  /** Procedural layer configuration */
  procedural: Partial<ProceduralLayerConfig>;

  /** Enable debug logging */
  debug: boolean;
}

const DEFAULT_CONFIG: PlayerAnimationConfig = {
  blend: {
    blendTime: 0.15,
    defaultSpeed: 1.0,
  },
  procedural: {
    aimIK: true,
    strafeLean: true,
    proceduralSlide: true,
    proceduralWallJump: true,
  },
  debug: false,
};

/**
 * PlayerAnimationController - Orchestrates character animation
 */
export class PlayerAnimationController {
  private _mesh: Mesh;
  private skeleton: Skeleton;
  private _scene: Scene;

  private rig: HumanoidRig;
  private blender: AnimationBlender;
  private proceduralLayers: ProceduralLayers;
  private animationLoader: AnimationLoader;

  private config: PlayerAnimationConfig;
  private _currentState: PlayerAnimationState = createDefaultAnimationState();
  private currentAnimationName: AnimationStateName = AnimationStateName.Idle;
  private initialized: boolean = false;

  // Animation groups applied to this character
  private appliedAnimations: Map<string, AnimationGroup> = new Map();

  constructor(mesh: Mesh, skeleton: Skeleton, scene: Scene, config?: Partial<PlayerAnimationConfig>) {
    this._mesh = mesh;
    this.skeleton = skeleton;
    this._scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create humanoid rig wrapper
    this.rig = new HumanoidRig(skeleton);

    // Validate rig
    const validation = this.rig.validate();
    if (!validation.valid) {
      console.warn(`[PlayerAnimationController] Rig validation failed. Missing bones:`, validation.missing);
    }

    // Create animation blender
    this.blender = new AnimationBlender(this.config.blend);

    // Create procedural layers
    this.proceduralLayers = new ProceduralLayers(this.rig, this.config.procedural);

    // Get animation loader instance
    this.animationLoader = AnimationLoader.getInstance();

    if (this.config.debug) {
      this.rig.debugPrint();
    }
  }

  /**
   * Initialize animations - load and apply standard animation set
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log("[PlayerAnimationController] Initializing animations...");

    // Check if animation loader is initialized
    if (!this.animationLoader.hasAnimation("idle")) {
      console.log("[PlayerAnimationController] Loading standard animations...");
      await this.animationLoader.loadStandardAnimations();
    }

    // Apply animations to this character's skeleton
    for (const animName of Object.values(AnimationStateName)) {
      const animGroup = this.animationLoader.applyToSkeleton(animName, this.skeleton);

      if (animGroup) {
        this.appliedAnimations.set(animName, animGroup);
        this.blender.registerAnimation(animName, animGroup, animName === "idle" ? 1.0 : 0);

        if (this.config.debug) {
          console.log(`[PlayerAnimationController] Applied animation: ${animName}`);
        }
      }
    }

    this.initialized = true;
    console.log(`[PlayerAnimationController] Initialized with ${this.appliedAnimations.size} animations`);
  }

  /**
   * Update animation state - call every frame
   */
  update(state: PlayerAnimationState, deltaTime: number): void {
    if (!this.initialized) {
      return;
    }

    this._currentState = state;

    // 1. Determine target animation from state
    const targetAnimation = this.selectTargetAnimation(state);

    // 2. Trigger animation transition if changed
    if (targetAnimation !== this.currentAnimationName) {
      this.transitionTo(targetAnimation);
    }

    // 3. Update animation speed based on movement
    this.updateAnimationSpeed(state);

    // 4. Update blend weights
    this.blender.update(deltaTime);

    // 5. Apply procedural layers on top
    this.proceduralLayers.update(state, deltaTime);
  }

  /**
   * Select target animation based on player state
   */
  private selectTargetAnimation(state: PlayerAnimationState): AnimationStateName {
    return selectAnimationState(state);
  }

  /**
   * Transition to a new animation
   */
  private transitionTo(animName: AnimationStateName): void {
    if (this.config.debug) {
      console.log(`[PlayerAnimationController] Transition: ${this.currentAnimationName} -> ${animName}`);
    }

    this.currentAnimationName = animName;
    this.blender.play(animName);
  }

  /**
   * Update animation playback speed based on movement
   */
  private updateAnimationSpeed(state: PlayerAnimationState): void {
    // Scale locomotion animation speed with movement speed
    if (
      this.currentAnimationName === AnimationStateName.RunForward ||
      this.currentAnimationName === AnimationStateName.RunBackward ||
      this.currentAnimationName === AnimationStateName.StrafeLeft ||
      this.currentAnimationName === AnimationStateName.StrafeRight
    ) {
      // Assume base animation speed matches ~6 units/sec run speed
      const baseSpeed = 6;
      const speedRatio = Math.max(0.5, state.speed / baseSpeed);
      this.blender.setSpeed(this.currentAnimationName, speedRatio);
    }

    if (this.currentAnimationName === AnimationStateName.CrouchWalk) {
      // Crouch walk is slower
      const baseSpeed = 3;
      const speedRatio = Math.max(0.3, state.speed / baseSpeed);
      this.blender.setSpeed(this.currentAnimationName, speedRatio);
    }
  }

  /**
   * Get current animation name
   */
  getCurrentAnimation(): AnimationStateName {
    return this.currentAnimationName;
  }

  /**
   * Get the humanoid rig
   */
  getRig(): HumanoidRig {
    return this.rig;
  }

  /**
   * Get the animation blender
   */
  getBlender(): AnimationBlender {
    return this.blender;
  }

  /**
   * Get the procedural layers
   */
  getProceduralLayers(): ProceduralLayers {
    return this.proceduralLayers;
  }

  /**
   * Force play a specific animation (for debugging or cutscenes)
   */
  forcePlay(animName: AnimationStateName): void {
    this.transitionTo(animName);
  }

  /**
   * Update procedural layer configuration
   */
  setProceduralConfig(config: Partial<ProceduralLayerConfig>): void {
    this.proceduralLayers.setConfig(config);
  }

  /**
   * Get the mesh this controller is attached to
   */
  getMesh(): Mesh {
    return this._mesh;
  }

  /**
   * Get the scene
   */
  getScene(): Scene {
    return this._scene;
  }

  /**
   * Get the current animation state
   */
  getCurrentState(): PlayerAnimationState {
    return this._currentState;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.blender.dispose();

    for (const animGroup of this.appliedAnimations.values()) {
      animGroup.dispose();
    }
    this.appliedAnimations.clear();

    this.initialized = false;
  }
}

/**
 * Factory function to create animation controller from a loaded mesh
 */
export async function createPlayerAnimationController(
  mesh: Mesh,
  scene: Scene,
  config?: Partial<PlayerAnimationConfig>,
): Promise<PlayerAnimationController | null> {
  // Find skeleton attached to mesh
  const skeleton = mesh.skeleton;

  if (!skeleton) {
    console.error("[createPlayerAnimationController] Mesh has no skeleton");
    return null;
  }

  // Create controller
  const controller = new PlayerAnimationController(mesh, skeleton, scene, config);

  // Initialize
  await controller.initialize();

  return controller;
}

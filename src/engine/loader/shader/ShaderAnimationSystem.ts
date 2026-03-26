/**
 * ShaderAnimationSystem - Manages animated Q3/Warsow shader effects
 *
 * Handles tcMod (texture coordinate animation), rgbGen wave, and alphaGen wave
 * for BSP materials. Runs as a centralized system with one render observer.
 */

import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { AlphaGen, RgbGen, TcMod, WaveFunc } from "./Q3ShaderTypes";

// ============================================================================
// Types
// ============================================================================

/** State for texture coordinate animation */
export interface TcState {
  uOffset: number;
  vOffset: number;
  rotation: number; // radians
  uScale: number;
  vScale: number;
}

/** Animated stage within a material */
export interface AnimatedStage {
  texture: Texture;
  tcMods: TcMod[];
  tcState: TcState;
  rgbGen?: RgbGen;
  alphaGen?: AlphaGen;
  baseColor?: Color3; // Original color for wave modulation
}

/** Entry for a material with animation */
export interface AnimatedMaterialEntry {
  id: string;
  material: StandardMaterial;
  stages: AnimatedStage[];
}

// ============================================================================
// Wave Function Evaluator
// ============================================================================

/**
 * Evaluate a Q3 wave function at a given time
 * @param wave Wave function parameters
 * @param time Current time in seconds
 * @returns Evaluated value
 */
export function evaluateWaveFunc(wave: WaveFunc, time: number): number {
  const phase = wave.phase + time * wave.frequency;
  let value: number;

  switch (wave.func) {
    case "sin":
      value = Math.sin(phase * 2 * Math.PI);
      break;
    case "triangle":
      // Triangle wave: -1 to 1 linearly
      value = Math.abs((((phase % 1) + 1) % 1) * 4 - 2) - 1;
      break;
    case "square":
      value = phase % 1 < 0.5 ? 1 : -1;
      break;
    case "sawtooth":
      value = (((phase % 1) + 1) % 1) * 2 - 1;
      break;
    case "inversesawtooth":
      value = 1 - (((phase % 1) + 1) % 1) * 2;
      break;
    case "noise":
      // Simplified noise - just random per evaluation
      // For proper noise, would need seeded random based on time
      value = Math.random() * 2 - 1;
      break;
    default:
      value = 0;
  }

  return wave.base + value * wave.amplitude;
}

// ============================================================================
// ShaderAnimationSystem
// ============================================================================

export class ShaderAnimationSystem {
  private static instance: ShaderAnimationSystem;

  private scene: Scene | null = null;
  private entries: Map<string, AnimatedMaterialEntry> = new Map();
  private renderObserver: Observer<Scene> | null = null;

  private enabled: boolean = true;
  private timeScale: number = 1.0;
  private totalTime: number = 0;
  private lastTime: number = 0;

  private constructor() {}

  static getInstance(): ShaderAnimationSystem {
    if (!ShaderAnimationSystem.instance) {
      ShaderAnimationSystem.instance = new ShaderAnimationSystem();
    }
    return ShaderAnimationSystem.instance;
  }

  /** Check if instance exists without creating */
  static hasInstance(): boolean {
    return !!ShaderAnimationSystem.instance;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Initialize the animation system with a scene
   */
  init(scene: Scene): void {
    if (this.scene === scene) return;

    // Clean up previous scene if any
    this.dispose();

    this.scene = scene;
    this.totalTime = 0;
    this.lastTime = performance.now() / 1000;

    // Register render observer
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      this.update();
    });

    console.log("[ShaderAnimationSystem] Initialized");
  }

  /**
   * Dispose the animation system
   */
  dispose(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.entries.clear();
    this.scene = null;
    this.totalTime = 0;
  }

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * Register a material for animation
   * @param id Unique identifier (usually texture name)
   * @param material The Babylon material
   * @param texture The texture to animate
   * @param tcMods tcMod directives
   * @param rgbGen Optional rgbGen for color animation
   * @param alphaGen Optional alphaGen for alpha animation
   */
  registerMaterial(
    id: string,
    material: StandardMaterial,
    texture: Texture,
    tcMods: TcMod[],
    rgbGen?: RgbGen,
    alphaGen?: AlphaGen,
  ): void {
    // Check if we actually have anything to animate
    const hasAnimation = tcMods.length > 0 || rgbGen?.type === "wave" || alphaGen?.type === "wave";

    if (!hasAnimation) {
      return;
    }

    // Create initial state
    const tcState: TcState = {
      uOffset: 0,
      vOffset: 0,
      rotation: 0,
      uScale: 1,
      vScale: 1,
    };

    // Apply any static scale from tcMod
    for (const tcMod of tcMods) {
      if (tcMod.type === "scale") {
        tcState.uScale = tcMod.sScale;
        tcState.vScale = tcMod.tScale;
      }
    }

    const stage: AnimatedStage = {
      texture,
      tcMods,
      tcState,
      rgbGen,
      alphaGen,
      baseColor: material.diffuseColor.clone(),
    };

    // Check if entry exists
    const existing = this.entries.get(id);
    if (existing) {
      existing.stages.push(stage);
    } else {
      this.entries.set(id, {
        id,
        material,
        stages: [stage],
      });
    }

    console.log(
      `[ShaderAnimationSystem] Registered: ${id} (${tcMods.length} tcMods, rgbGen: ${rgbGen?.type || "none"}, alphaGen: ${alphaGen?.type || "none"})`,
    );
  }

  /**
   * Unregister a material
   */
  unregisterMaterial(id: string): void {
    if (this.entries.delete(id)) {
      console.log(`[ShaderAnimationSystem] Unregistered: ${id}`);
    }
  }

  /**
   * Clear all registered materials
   */
  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.totalTime = 0;
    console.log(`[ShaderAnimationSystem] Cleared ${count} entries`);
  }

  // ============================================================================
  // Control
  // ============================================================================

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[ShaderAnimationSystem] ${enabled ? "Enabled" : "Disabled"}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale);
    console.log(`[ShaderAnimationSystem] Time scale: ${this.timeScale}`);
  }

  getTimeScale(): number {
    return this.timeScale;
  }

  /** Get count of animated materials */
  getCount(): number {
    return this.entries.size;
  }

  /** Get total animation time */
  getTotalTime(): number {
    return this.totalTime;
  }

  /** Get info about registered animations */
  getInfo(): { id: string; tcModCount: number; hasRgbGen: boolean; hasAlphaGen: boolean }[] {
    const info: { id: string; tcModCount: number; hasRgbGen: boolean; hasAlphaGen: boolean }[] = [];
    for (const [id, entry] of this.entries) {
      for (const stage of entry.stages) {
        info.push({
          id,
          tcModCount: stage.tcMods.length,
          hasRgbGen: stage.rgbGen?.type === "wave",
          hasAlphaGen: stage.alphaGen?.type === "wave",
        });
      }
    }
    return info;
  }

  // ============================================================================
  // Update Loop
  // ============================================================================

  private update(): void {
    if (!this.enabled || this.entries.size === 0) return;

    // Calculate delta time
    const now = performance.now() / 1000;
    const deltaTime = (now - this.lastTime) * this.timeScale;
    this.lastTime = now;
    this.totalTime += deltaTime;

    // Update each entry
    for (const entry of this.entries.values()) {
      this.updateEntry(entry, deltaTime);
    }
  }

  private updateEntry(entry: AnimatedMaterialEntry, deltaTime: number): void {
    for (const stage of entry.stages) {
      // Apply tcMods
      this.applyTcMods(stage, deltaTime);

      // Apply rgbGen wave
      if (stage.rgbGen?.type === "wave" && stage.rgbGen.wave) {
        const waveValue = evaluateWaveFunc(stage.rgbGen.wave, this.totalTime);
        const clampedValue = Math.max(0, Math.min(1, waveValue));

        if (stage.baseColor) {
          entry.material.diffuseColor = new Color3(
            stage.baseColor.r * clampedValue,
            stage.baseColor.g * clampedValue,
            stage.baseColor.b * clampedValue,
          );
        } else {
          entry.material.diffuseColor = new Color3(clampedValue, clampedValue, clampedValue);
        }
      }

      // Apply alphaGen wave
      if (stage.alphaGen?.type === "wave" && stage.alphaGen.wave) {
        const waveValue = evaluateWaveFunc(stage.alphaGen.wave, this.totalTime);
        entry.material.alpha = Math.max(0, Math.min(1, waveValue));
      }
    }
  }

  private applyTcMods(stage: AnimatedStage, deltaTime: number): void {
    const state = stage.tcState;

    for (const tcMod of stage.tcMods) {
      switch (tcMod.type) {
        case "scroll":
          state.uOffset += tcMod.sSpeed * deltaTime;
          state.vOffset += tcMod.tSpeed * deltaTime;
          // Wrap to prevent float overflow on long sessions
          state.uOffset = state.uOffset % 1000;
          state.vOffset = state.vOffset % 1000;
          break;

        case "scale":
          // Static - already applied at registration
          break;

        case "rotate": {
          const radPerSec = tcMod.degreesPerSecond * (Math.PI / 180);
          state.rotation += radPerSec * deltaTime;
          // Wrap rotation
          state.rotation = state.rotation % (2 * Math.PI);
          break;
        }

        case "stretch":
          if (tcMod.func) {
            const waveValue = evaluateWaveFunc(tcMod.func, this.totalTime);
            state.uScale = waveValue;
            state.vScale = waveValue;
          }
          break;

        case "turb": {
          // Simplified turbulence - oscillate UV offset
          const turbPhase = this.totalTime * tcMod.frequency + tcMod.phase;
          const turbU = Math.sin(turbPhase * 2 * Math.PI) * tcMod.amplitude;
          const turbV = Math.cos(turbPhase * 2 * Math.PI + 0.7) * tcMod.amplitude;
          // Add to existing offset (turb is additive)
          state.uOffset += turbU * deltaTime * 10; // Scale for visibility
          state.vOffset += turbV * deltaTime * 10;
          break;
        }

        case "transform": {
          // 2D affine matrix transform: [u', v'] = [m00 m01; m10 m11] * [u, v] + [t0, t1]
          // Decompose into scale, rotation, and translation that Babylon supports
          // Note: This doesn't handle shear correctly, but covers most Q3 shader use cases

          // Extract scale from matrix (length of each row vector)
          const scaleU = Math.sqrt(tcMod.m00 * tcMod.m00 + tcMod.m01 * tcMod.m01);
          const scaleV = Math.sqrt(tcMod.m10 * tcMod.m10 + tcMod.m11 * tcMod.m11);

          // Extract rotation from first row (assumes no shear)
          const rotation = Math.atan2(tcMod.m01, tcMod.m00);

          // Apply: set state (transform is typically static, applied once)
          state.uScale = scaleU;
          state.vScale = scaleV;
          state.rotation = rotation;
          state.uOffset = tcMod.t0;
          state.vOffset = tcMod.t1;
          break;
        }
      }
    }

    // Apply state to texture
    stage.texture.uOffset = state.uOffset;
    stage.texture.vOffset = state.vOffset;
    stage.texture.uScale = state.uScale;
    stage.texture.vScale = state.vScale;
    stage.texture.wAng = state.rotation;
  }
}

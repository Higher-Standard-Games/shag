/**
 * ShaderAnimationSystem - Manages animated Q3/Warsow shader effects
 *
 * Handles tcMod (texture coordinate animation), rgbGen wave, and alphaGen wave
 * for BSP materials. Runs as a centralized system with one render observer.
 */

import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../../core/DevLog";
import type { AlphaGen, RgbGen, TcMod } from "./Q3ShaderTypes";

import { createTcState, evaluateWaveFunc, stepTcModsInto, type TcState } from "./Q3StageEvaluation";

export { evaluateWaveFunc, type TcState } from "./Q3StageEvaluation";

// ============================================================================
// Types
// ============================================================================

/** Animated stage within a material */
export interface AnimatedStage {
  frames?: { frequency: number; textures: Texture[] };
  texture: Texture;
  tcMods: TcMod[];
  tcState: TcState;
  rgbGen?: RgbGen;
  alphaGen?: AlphaGen;
  baseColor?: Color3; // Original color for wave modulation
  colorTarget?: "diffuse" | "emissive";
}

/** Entry for a material with animation */
export interface AnimatedMaterialEntry {
  id: string;
  material: StandardMaterial | PBRMaterial;
  stages: AnimatedStage[];
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

    devLog("[ShaderAnimationSystem] Initialized");
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
    material: StandardMaterial | PBRMaterial,
    texture: Texture,
    tcMods: TcMod[],
    rgbGen?: RgbGen,
    alphaGen?: AlphaGen,
    colorTarget: "diffuse" | "emissive" = "diffuse",
    frames?: { frequency: number; textures: Texture[] },
  ): void {
    // Check if we actually have anything to animate
    const hasAnimation =
      tcMods.length > 0 || rgbGen?.type === "wave" || alphaGen?.type === "wave" || !!frames?.textures.length;

    if (!hasAnimation) {
      return;
    }

    const tcState = createTcState(tcMods);

    const stage: AnimatedStage = {
      texture,
      tcMods,
      tcState,
      rgbGen,
      alphaGen,
      baseColor: (colorTarget === "emissive"
        ? material.emissiveColor
        : "diffuseColor" in material
          ? material.diffuseColor
          : material.albedoColor
      ).clone(),
      colorTarget,
      frames,
    };
    if (colorTarget === "emissive" && "diffuseColor" in material) {
      // StandardMaterial adds emissiveColor to the sampled image; PBR multiplies it.
      material.emissiveColor.set(0, 0, 0);
      material.useEmissiveAsIllumination = true;
    }

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

    devLog(
      `[ShaderAnimationSystem] Registered: ${id} (${tcMods.length} tcMods, rgbGen: ${rgbGen?.type || "none"}, alphaGen: ${alphaGen?.type || "none"})`,
    );
  }

  /**
   * Unregister a material
   */
  unregisterMaterial(id: string): void {
    if (this.entries.delete(id)) {
      devLog(`[ShaderAnimationSystem] Unregistered: ${id}`);
    }
  }

  /**
   * Clear all registered materials
   */
  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.totalTime = 0;
    devLog(`[ShaderAnimationSystem] Cleared ${count} entries`);
  }

  // ============================================================================
  // Control
  // ============================================================================

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    devLog(`[ShaderAnimationSystem] ${enabled ? "Enabled" : "Disabled"}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale);
    devLog(`[ShaderAnimationSystem] Time scale: ${this.timeScale}`);
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
    if (entry.material.isFrozen) entry.material.unfreeze();
    for (const stage of entry.stages) {
      if (stage.frames?.textures.length) {
        const index = Math.floor(this.totalTime * stage.frames.frequency) % stage.frames.textures.length;
        const texture = stage.frames.textures[index];
        const material = entry.material;
        if (stage.colorTarget === "emissive") {
          if (
            "diffuseTexture" in material &&
            material.diffuseTexture === stage.texture &&
            material.diffuseTexture !== texture
          )
            material.diffuseTexture = texture;
          if (material.emissiveTexture !== texture) material.emissiveTexture = texture;
        } else if ("diffuseTexture" in material) {
          if (material.diffuseTexture !== texture) material.diffuseTexture = texture;
        } else if (material.albedoTexture !== texture) material.albedoTexture = texture;
        stage.texture = texture;
      }
      // Apply tcMods
      this.applyTcMods(stage, deltaTime);

      // Apply rgbGen wave
      if (stage.rgbGen?.type === "wave" && stage.rgbGen.wave) {
        const waveValue = evaluateWaveFunc(stage.rgbGen.wave, this.totalTime);
        const clampedValue = Math.max(0, Math.min(1, waveValue));

        if (stage.colorTarget === "emissive" && "diffuseColor" in entry.material) {
          stage.texture.level = clampedValue;
        } else {
          const color =
            stage.colorTarget === "emissive"
              ? entry.material.emissiveColor
              : "diffuseColor" in entry.material
                ? entry.material.diffuseColor
                : entry.material.albedoColor;
          color.set(
            (stage.baseColor?.r ?? 1) * clampedValue,
            (stage.baseColor?.g ?? 1) * clampedValue,
            (stage.baseColor?.b ?? 1) * clampedValue,
          );
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
    // Brightness/alpha waves do not own UVs. In particular, keep the loader's
    // compressed-texture orientation instead of resetting it every frame.
    if (stage.tcMods.length === 0) return;
    const state = stage.tcState;

    stepTcModsInto(state, stage.tcMods, deltaTime, this.totalTime);

    // Apply state to texture
    stage.texture.uOffset = state.uOffset;
    stage.texture.vOffset = state.vOffset;
    stage.texture.uScale = state.uScale;
    stage.texture.vScale = state.vScale;
    stage.texture.wAng = state.rotation;
  }
}

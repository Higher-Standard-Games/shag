/**
 * ViewportEffectsManager - Core orchestrator for viewport effects
 *
 * Responsibilities:
 * - Registers and manages effect processors
 * - Receives player state each frame
 * - Aggregates ViewportDelta from all active effects
 * - Integrates with EventBus for triggered effects
 *
 * Usage:
 *   const manager = ViewportEffectsManager.getInstance();
 *   manager.init();
 *   // Each frame:
 *   const delta = manager.update(deltaTime, playerState);
 *   applicator.apply(delta, camera, baseFOV);
 */

import { Cvar } from "../core/Cvar";
import { EventBus } from "../core/EventBus";
import { MovementVars } from "../movement/MovementVars";
import type { PlayerState } from "./PlayerState";
import { createNeutralPlayerState } from "./PlayerState";
import { combineDelta, createNeutralDelta, type ViewportDelta } from "./ViewportDelta";
import type { ViewportEffect } from "./ViewportEffect";

export class ViewportEffectsManager {
  private static instance: ViewportEffectsManager;

  private effects: Map<string, ViewportEffect> = new Map();
  private initialized: boolean = false;
  private unsubscribes: Array<() => void> = [];
  private _currentState: PlayerState = createNeutralPlayerState();

  // ADS FOV state
  private adsProgress: number = 0; // 0 = hip, 1 = fully ADS

  /** Cached MovementVars singleton — avoids a getInstance() lookup every frame in update(). */
  private _movementVars: MovementVars | null = null;

  private constructor() {}

  static getInstance(): ViewportEffectsManager {
    if (!ViewportEffectsManager.instance) {
      ViewportEffectsManager.instance = new ViewportEffectsManager();
    }
    return ViewportEffectsManager.instance;
  }

  /**
   * Initialize the manager and register master cvar
   */
  init(): void {
    if (this.initialized) return;

    // Register master toggle cvar
    if (!Cvar.exists("cl_vieweffects")) {
      Cvar.register("cl_vieweffects", 1, {
        type: "int",
        min: 0,
        max: 1,
        description: "Master toggle for all viewport effects",
        persist: true,
      });
    }

    // Subscribe to EventBus viewport events
    this.unsubscribes.push(
      EventBus.on("viewport:shake", (data) => this.trigger("shake", data)),
      EventBus.on("viewport:punch", (data) => this.trigger("punch", data)),
      EventBus.on("viewport:zoom", (data) => this.trigger("zoom", data)),
      EventBus.on("viewport:roll", (data) => this.trigger("roll", data)),
      EventBus.on("viewport:landing", (data) => this.trigger("landing", data)),
    );

    this.initialized = true;
    console.log("[ViewportEffects] Manager initialized");
  }

  /**
   * Register an effect processor
   */
  registerEffect(effect: ViewportEffect): void {
    if (this.effects.has(effect.name)) {
      console.warn(`[ViewportEffects] Effect '${effect.name}' already registered, replacing`);
      this.effects.get(effect.name)?.dispose?.();
    }
    this.effects.set(effect.name, effect);
    console.log(`[ViewportEffects] Registered effect: ${effect.name}`);
  }

  /**
   * Unregister an effect processor
   */
  unregisterEffect(name: string): void {
    const effect = this.effects.get(name);
    if (effect) {
      effect.dispose?.();
      this.effects.delete(name);
      console.log(`[ViewportEffects] Unregistered effect: ${name}`);
    }
  }

  /**
   * Get an effect by name
   */
  getEffect<T extends ViewportEffect>(name: string): T | undefined {
    return this.effects.get(name) as T | undefined;
  }

  /**
   * Enable/disable an effect by name
   */
  setEffectEnabled(name: string, enabled: boolean): boolean {
    const effect = this.effects.get(name);
    if (effect) {
      effect.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Update all effects and return combined delta
   * @param deltaTime Time since last frame in seconds
   * @param state Current player movement state
   * @returns Combined ViewportDelta from all active effects
   */
  update(deltaTime: number, state: PlayerState): ViewportDelta {
    // Store current state for external access (e.g., weapon bob)
    this._currentState = state;

    const combined = createNeutralDelta();

    // Check master toggle
    const masterEnabled = Cvar.getNumber("cl_vieweffects") !== 0;
    if (!masterEnabled) {
      return combined;
    }

    // Update each active effect and combine deltas
    for (const effect of this.effects.values()) {
      if (!effect.enabled) continue;

      try {
        const delta = effect.update(deltaTime, state);
        combineDelta(combined, delta);
      } catch (err) {
        console.error(`[ViewportEffects] Error in effect '${effect.name}':`, err);
      }
    }

    // === ADS FOV ZOOM ===
    this._movementVars ??= MovementVars.getInstance();
    const mv = this._movementVars;
    const adsTime = mv.get("cl_ads_time");
    // FOV reduction as a percentage (15 = 15% reduction, so 0.85x multiplier)
    const adsFovReductionPercent = mv.get("cl_ads_fov_reduction") / 100;

    // Lerp ADS progress
    const adsSpeed = 1.0 / Math.max(0.05, adsTime);
    const targetAds = state.isAiming ? 1.0 : 0.0;
    const adsLerp = Math.min(1.0, deltaTime * adsSpeed);
    this.adsProgress += (targetAds - this.adsProgress) * adsLerp;

    // Apply FOV reduction as multiplier (1.0 = no change, 0.85 = 15% zoom)
    // Clamp to prevent extreme zoom (min 0.4 = 40% of base FOV)
    if (this.adsProgress > 0.001) {
      const fovMultiplier = 1.0 - adsFovReductionPercent * this.adsProgress;
      combined.fovMultiplier *= Math.max(0.4, fovMultiplier);
    }

    return combined;
  }

  /**
   * Get current player state (updated each frame)
   * Used by weapon bob to sync with view bob
   */
  getCurrentState(): PlayerState {
    return this._currentState;
  }

  /**
   * Trigger an event on all effects
   */
  trigger(event: string, data: unknown): void {
    for (const effect of this.effects.values()) {
      if (!effect.enabled) continue;
      effect.trigger?.(event, data);
    }
  }

  /**
   * Reset all effects (e.g., on respawn or map change)
   */
  resetAll(): void {
    for (const effect of this.effects.values()) {
      effect.reset();
    }
  }

  /**
   * Get list of registered effect names
   */
  getEffectNames(): string[] {
    return Array.from(this.effects.keys());
  }

  /**
   * Get effect info for debugging
   */
  getInfo(): string {
    const lines = ["=== Viewport Effects ==="];
    const masterEnabled = Cvar.getNumber("cl_vieweffects") !== 0;
    lines.push(`Master: ${masterEnabled ? "ON" : "OFF"}`);
    lines.push("");

    for (const [name, effect] of this.effects) {
      const status = effect.enabled ? "✓" : "✗";
      lines.push(`[${status}] ${name}`);
    }

    return lines.join("\n");
  }

  /**
   * Clean up manager
   */
  dispose(): void {
    // Dispose all effects
    for (const effect of this.effects.values()) {
      effect.dispose?.();
    }
    this.effects.clear();

    // Unsubscribe from EventBus
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];

    this.initialized = false;
    console.log("[ViewportEffects] Manager disposed");
  }
}

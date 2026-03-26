/**
 * Viewport Effects System
 *
 * A modular, event-driven system for camera/viewport effects that enhance player immersion.
 *
 * Usage:
 *   import { ViewportEffectsManager, WalkBobEffect, FPSApplicator } from '../viewport';
 *
 *   // Setup
 *   const manager = ViewportEffectsManager.getInstance();
 *   manager.init();
 *   manager.registerEffect(new WalkBobEffect());
 *   manager.registerEffect(new LandingImpactEffect());
 *   // ... more effects
 *
 *   const applicator = new FPSApplicator();
 *
 *   // Each frame (in FPSController.update):
 *   const playerState = { position, velocity, isGrounded, ... };
 *   const delta = manager.update(deltaTime, playerState);
 *   applicator.apply(delta, camera, baseFOV);
 */

// Applicators
export * from "./applicators";
export type { EasingFunction } from "./Easing";
// Easing utilities
export { Easing, ease, getEasing } from "./Easing";
// Effects
export * from "./effects";
export type { PlayerState } from "./PlayerState";
export { createNeutralPlayerState } from "./PlayerState";
// Speed constants (shared across effects)
export { BASE_SPEED, getSpeedRatio, MAX_SPEED } from "./SpeedConstants";
// Core types
export type { ViewportDelta } from "./ViewportDelta";
export { combineDelta, createNeutralDelta, isDeltaNeutral } from "./ViewportDelta";
export type { ViewportEffect } from "./ViewportEffect";
export { BaseViewportEffect } from "./ViewportEffect";
// Manager
export { ViewportEffectsManager } from "./ViewportEffectsManager";

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

// Core types
export type { ViewportDelta } from './ViewportDelta';
export { createNeutralDelta, combineDelta, isDeltaNeutral } from './ViewportDelta';

export type { PlayerState } from './PlayerState';
export { createNeutralPlayerState } from './PlayerState';

export type { ViewportEffect } from './ViewportEffect';
export { BaseViewportEffect } from './ViewportEffect';

// Manager
export { ViewportEffectsManager } from './ViewportEffectsManager';

// Easing utilities
export { Easing, getEasing, ease } from './Easing';
export type { EasingFunction } from './Easing';

// Speed constants (shared across effects)
export { BASE_SPEED, MAX_SPEED, getSpeedRatio } from './SpeedConstants';

// Applicators
export * from './applicators';

// Effects
export * from './effects';

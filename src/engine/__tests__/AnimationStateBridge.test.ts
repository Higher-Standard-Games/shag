/**
 * AnimationStateBridge Tests
 *
 * Tests the extractAnimationState() function that bridges
 * physics/movement systems to the animation system. Pure function
 * with mock provider — no Babylon scene needed.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { type AnimationStateProvider, extractAnimationState } from "../animation/AnimationStateBridge";

/** Create a minimal mock provider */
function createProvider(overrides: Partial<AnimationStateProvider> = {}): AnimationStateProvider {
  return {
    getPlayerPosition: () => Vector3.Zero(),
    ...overrides,
  };
}

describe("AnimationStateBridge", () => {
  // ── Minimal Provider ──────────────────────────────────────

  describe("minimal provider", () => {
    it("returns default state with position-only provider", () => {
      const state = extractAnimationState(createProvider());
      expect(state.speed).toBe(0);
      expect(state.grounded).toBe(true);
      expect(state.isCrouching).toBe(false);
      expect(state.isSliding).toBe(false);
      expect(state.isFiring).toBe(false);
    });
  });

  // ── Velocity Extraction ───────────────────────────────────

  describe("velocity", () => {
    it("extracts velocity and speed", () => {
      const state = extractAnimationState(
        createProvider({
          getVelocity: () => new Vector3(300, 0, 400), // speed = 500
        }),
      );
      expect(state.velocity.x).toBe(300);
      expect(state.velocity.z).toBe(400);
      expect(state.speed).toBeCloseTo(500);
    });

    it("calculates local velocity without camera rotation", () => {
      const state = extractAnimationState(
        createProvider({
          getVelocity: () => new Vector3(100, 0, 200),
        }),
      );
      // Without camera rotation, local = world
      expect(state.localVelocity.x).toBe(100);
      expect(state.localVelocity.z).toBe(200);
    });

    it("rotates local velocity by camera yaw", () => {
      // Moving along +X in world, camera facing +X (yaw = PI/2)
      const state = extractAnimationState(
        createProvider({
          getVelocity: () => new Vector3(100, 0, 0),
        }),
        { x: 0, y: Math.PI / 2 }, // 90 degrees yaw
      );
      // After rotation, +X world should become forward (+Z) in local space
      // cos(PI/2) ≈ 0, sin(PI/2) ≈ 1
      // localX = worldX * cos + worldZ * sin = 100 * 0 + 0 * 1 = 0
      // localZ = -worldX * sin + worldZ * cos = -100 * 1 + 0 * 0 = -100
      expect(state.localVelocity.x).toBeCloseTo(0, 0);
      expect(state.localVelocity.z).toBeCloseTo(-100, 0);
    });
  });

  // ── Ground State ──────────────────────────────────────────

  describe("ground state", () => {
    it("reads grounded from provider", () => {
      const state = extractAnimationState(
        createProvider({
          isPlayerGrounded: () => false,
        }),
      );
      expect(state.grounded).toBe(false);
    });
  });

  // ── Crouch & Slide ────────────────────────────────────────

  describe("crouch and slide", () => {
    it("extracts crouch state", () => {
      const state = extractAnimationState(
        createProvider({
          getCrouchState: () => ({ isCrouching: true, isSliding: false, height: 32 }),
        }),
      );
      expect(state.isCrouching).toBe(true);
      expect(state.isSliding).toBe(false);
    });

    it("extracts slide state with speed and direction", () => {
      const state = extractAnimationState(
        createProvider({
          getCrouchState: () => ({ isCrouching: true, isSliding: true, height: 32 }),
          getSlideSpeed: () => 500,
          getSlideDirection: () => new Vector3(1, 0, 0),
        }),
      );
      expect(state.isSliding).toBe(true);
      expect(state.slideSpeed).toBe(500);
      expect(state.slideDirection.x).toBe(1);
    });
  });

  // ── Wall Jump ─────────────────────────────────────────────

  describe("wall jump", () => {
    it("extracts wall jump state", () => {
      const state = extractAnimationState(
        createProvider({
          getWallJumpState: () => ({ state: "jumping", normal: new Vector3(0, 0, 1), phase: 0.5 }),
        }),
      );
      expect(state.isWallJumping).toBe(true);
      expect(state.wallNormal.z).toBe(1);
      expect(state.wallJumpPhase).toBe(0.5);
    });

    it("sets isWallJumping false for 'none' state", () => {
      const state = extractAnimationState(
        createProvider({
          getWallJumpState: () => ({ state: "none", normal: Vector3.Zero(), phase: 0 }),
        }),
      );
      expect(state.isWallJumping).toBe(false);
    });
  });

  // ── Ledge Grab ────────────────────────────────────────────

  describe("ledge grab", () => {
    it("detects active ledge grab", () => {
      const state = extractAnimationState(
        createProvider({
          getLedgeGrabState: () => "grabbing",
        }),
      );
      expect(state.isLedgeGrabbing).toBe(true);
    });

    it("detects inactive ledge grab", () => {
      const state = extractAnimationState(
        createProvider({
          getLedgeGrabState: () => "none",
        }),
      );
      expect(state.isLedgeGrabbing).toBe(false);
    });
  });

  // ── Aim Direction ─────────────────────────────────────────

  describe("aim direction", () => {
    it("converts camera rotation (radians) to degrees", () => {
      const state = extractAnimationState(createProvider(), { x: Math.PI / 4, y: Math.PI / 2 });
      expect(state.aimPitch).toBeCloseTo(45);
      expect(state.aimYaw).toBeCloseTo(90);
    });

    it("falls back to provider rotation", () => {
      const state = extractAnimationState(
        createProvider({
          getRotation: () => ({ x: Math.PI / 6, y: Math.PI / 3 }),
        }),
      );
      expect(state.aimPitch).toBeCloseTo(30);
      expect(state.aimYaw).toBeCloseTo(60);
    });
  });

  // ── Combat ────────────────────────────────────────────────

  describe("combat state", () => {
    it("extracts firing state", () => {
      const state = extractAnimationState(
        createProvider({
          isFiring: () => true,
        }),
      );
      expect(state.isFiring).toBe(true);
    });

    it("extracts reload state", () => {
      const state = extractAnimationState(
        createProvider({
          getIsReloading: () => true,
          getReloadProgress: () => 0.75,
        }),
      );
      expect(state.isReloading).toBe(true);
      expect(state.reloadProgress).toBe(0.75);
    });
  });
});

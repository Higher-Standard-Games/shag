/**
 * PlayerAnimationState Tests
 *
 * Tests the animation state machine that selects which animation
 * to play based on player movement state. Pure logic — no Babylon scene.
 */

import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  AnimationStateName,
  createDefaultAnimationState,
  selectAnimationState,
  type PlayerAnimationState,
} from "../animation/PlayerAnimationState";

/** Create a state with overrides */
function makeState(overrides: Partial<PlayerAnimationState>): PlayerAnimationState {
  return { ...createDefaultAnimationState(), ...overrides };
}

describe("PlayerAnimationState", () => {
  // ── Defaults ──────────────────────────────────────────────

  describe("createDefaultAnimationState", () => {
    it("returns correct defaults", () => {
      const state = createDefaultAnimationState();
      expect(state.velocity).toBeInstanceOf(Vector3);
      expect(state.speed).toBe(0);
      expect(state.grounded).toBe(true);
      expect(state.isCrouching).toBe(false);
      expect(state.isSliding).toBe(false);
      expect(state.isWallJumping).toBe(false);
      expect(state.isLedgeGrabbing).toBe(false);
      expect(state.aimPitch).toBe(0);
      expect(state.aimYaw).toBe(0);
      expect(state.isFiring).toBe(false);
      expect(state.isReloading).toBe(false);
      expect(state.reloadProgress).toBe(0);
    });

    it("returns independent instances", () => {
      const a = createDefaultAnimationState();
      const b = createDefaultAnimationState();
      a.speed = 100;
      expect(b.speed).toBe(0);
    });
  });

  // ── State Selection Priority ──────────────────────────────

  describe("selectAnimationState", () => {
    // Priority 1: Special movement states
    it("selects Slide when sliding", () => {
      expect(selectAnimationState(makeState({ isSliding: true, speed: 200 }))).toBe(AnimationStateName.Slide);
    });

    it("selects WallJump when wall jumping", () => {
      expect(selectAnimationState(makeState({ isWallJumping: true, grounded: false }))).toBe(AnimationStateName.WallJump);
    });

    it("selects LedgeGrab when grabbing ledge", () => {
      expect(selectAnimationState(makeState({ isLedgeGrabbing: true, grounded: false }))).toBe(AnimationStateName.LedgeGrab);
    });

    it("slide takes priority over wall jump", () => {
      expect(selectAnimationState(makeState({ isSliding: true, isWallJumping: true }))).toBe(AnimationStateName.Slide);
    });

    // Priority 2: Airborne
    it("selects JumpAir when not grounded", () => {
      expect(selectAnimationState(makeState({ grounded: false }))).toBe(AnimationStateName.JumpAir);
    });

    // Priority 3: Crouching
    it("selects CrouchIdle when crouching and still", () => {
      expect(selectAnimationState(makeState({ isCrouching: true, speed: 0 }))).toBe(AnimationStateName.CrouchIdle);
    });

    it("selects CrouchWalk when crouching and moving", () => {
      expect(selectAnimationState(makeState({ isCrouching: true, speed: 50 }))).toBe(AnimationStateName.CrouchWalk);
    });

    // Priority 4: Locomotion (8-directional)
    it("selects RunForward when moving forward", () => {
      const state = makeState({
        speed: 200,
        localVelocity: new Vector3(0, 0, 200), // forward = +Z
      });
      expect(selectAnimationState(state)).toBe(AnimationStateName.RunForward);
    });

    it("selects RunBackward when moving backward", () => {
      const state = makeState({
        speed: 200,
        localVelocity: new Vector3(0, 0, -200), // backward = -Z
      });
      expect(selectAnimationState(state)).toBe(AnimationStateName.RunBackward);
    });

    it("selects StrafeRight when moving right", () => {
      const state = makeState({
        speed: 200,
        localVelocity: new Vector3(200, 0, 0), // right = +X
      });
      expect(selectAnimationState(state)).toBe(AnimationStateName.StrafeRight);
    });

    it("selects StrafeLeft when moving left", () => {
      const state = makeState({
        speed: 200,
        localVelocity: new Vector3(-200, 0, 0), // left = -X
      });
      expect(selectAnimationState(state)).toBe(AnimationStateName.StrafeLeft);
    });

    // Priority 5: Idle
    it("selects Idle when still", () => {
      expect(selectAnimationState(makeState({ speed: 0 }))).toBe(AnimationStateName.Idle);
    });

    it("selects Idle for very low speed", () => {
      expect(selectAnimationState(makeState({ speed: 0.3 }))).toBe(AnimationStateName.Idle);
    });
  });

  // ── AnimationStateName Enum ───────────────────────────────

  describe("AnimationStateName enum", () => {
    it("has all expected values", () => {
      expect(AnimationStateName.Idle).toBe("idle");
      expect(AnimationStateName.RunForward).toBe("run_forward");
      expect(AnimationStateName.RunBackward).toBe("run_backward");
      expect(AnimationStateName.StrafeLeft).toBe("strafe_left");
      expect(AnimationStateName.StrafeRight).toBe("strafe_right");
      expect(AnimationStateName.JumpAir).toBe("jump_air");
      expect(AnimationStateName.CrouchIdle).toBe("crouch_idle");
      expect(AnimationStateName.CrouchWalk).toBe("crouch_walk");
      expect(AnimationStateName.Slide).toBe("slide");
      expect(AnimationStateName.WallJump).toBe("walljump");
      expect(AnimationStateName.LedgeGrab).toBe("ledge_grab");
    });
  });
});

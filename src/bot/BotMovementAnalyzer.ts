/**
 * Deterministic, bounded movement rollout analysis for bot navigation.
 *
 * Every rollout uses a fresh MovementProfile and the same 125 Hz fixed tick as
 * authoritative gameplay. The analyzer never mutates a live player or bot.
 */

import { InputButtons } from "../engine/network/components/InputComponent";
import type { MovementInput } from "../engine/network/systems/movement/MovementProfile";
import { MovementProfile } from "../games/fps/simulation/MovementProfile";
import type { Vec3 } from "../shared/bsp/BspDataLoader";
import type { CollisionWorld } from "../shared/collision/CollisionWorld";

export type TraversalKind = "jump" | "strafe_jump" | "slide_jump" | "wall_jump" | "wall_jump_ledge_grab";

export interface MovementInputPlan {
  direction: Vec3;
  initialSpeed: number;
  buttons: number;
  jumpTicks: number;
  maxTicks: number;
}

export interface MovementOpportunity {
  id: string;
  kind: TraversalKind;
  fromNodeId: number;
  toNodeId: number;
  takeoff: {
    position: Vec3;
    radius: number;
    minSpeed: number;
    maxSpeed: number;
    yawRange: [number, number];
  };
  landing: {
    position: Vec3;
    radius: number;
    surfaceNormal: Vec3;
  };
  inputPlan: MovementInputPlan;
  expectedTicks: number;
  successMargin: number;
  risk: {
    fallDamage: boolean;
    requiresLedgeGrab: boolean;
  };
}

export type MovementRejectionReason =
  | "rollout_budget_exhausted"
  | "invalid_takeoff"
  | "invalid_landing"
  | "outside_ballistic_envelope"
  | "rollout_missed_landing";

export interface MovementRejection {
  id: string;
  kind: TraversalKind;
  fromNodeId: number;
  toNodeId: number;
  takeoff: Vec3;
  landing: Vec3;
  reason: MovementRejectionReason;
}

export interface MovementAnalysisSummary {
  candidateCount: number;
  rolloutCount: number;
  acceptedCount: number;
  rejectedCount: number;
  budgetExhausted: boolean;
  rejectionCounts: Partial<Record<MovementRejectionReason, number>>;
}

export interface MovementCandidateResult {
  opportunity: MovementOpportunity | null;
  rejection: MovementRejection | null;
}

export interface BotMovementAnalyzerConfig {
  tickRate: number;
  maxTicks: number;
  maxRollouts: number;
  landingRadius: number;
  stableGroundTicks: number;
  candidateSpeeds: number[];
}

const PLAYER_FEET_OFFSET = 24;
const STANDING_CLEARANCE = 1;
const SURFACE_PROBE_UP = 8;
const SURFACE_PROBE_DOWN = 128;
const MIN_WALK_NORMAL = 0.7;
const MAX_ANALYZED_HEIGHT = 96;
const MAX_ANALYZED_HORIZONTAL_DISTANCE = 480;
const MAX_STORED_REJECTIONS = 256;

export const BOT_MOVEMENT_ANALYZER_VERSION = 2;

const DEFAULT_CONFIG: BotMovementAnalyzerConfig = {
  tickRate: 125,
  maxTicks: 150,
  maxRollouts: 512,
  landingRadius: 48,
  stableGroundTicks: 2,
  candidateSpeeds: [0, 160, 280, 400],
};

const ROLLOUT_PROFILE_OVERRIDES = {
  ledgeGrabEnabled: false,
  wallJumpEnabled: false,
  slideEnabled: false,
} as const;

const rolloutProfileFingerprint = new MovementProfile(ROLLOUT_PROFILE_OVERRIDES).getDeterminismFingerprint();
export const BOT_MOVEMENT_ANALYZER_FINGERPRINT = [
  `rollout:${BOT_MOVEMENT_ANALYZER_VERSION}`,
  `budget:${DEFAULT_CONFIG.tickRate}:${DEFAULT_CONFIG.maxTicks}:${DEFAULT_CONFIG.maxRollouts}`,
  `speeds:${DEFAULT_CONFIG.candidateSpeeds.join(",")}`,
  `landing:${DEFAULT_CONFIG.landingRadius}:${DEFAULT_CONFIG.stableGroundTicks}`,
  `standing:${PLAYER_FEET_OFFSET}:${STANDING_CLEARANCE}:${SURFACE_PROBE_UP}:${SURFACE_PROBE_DOWN}:${MIN_WALK_NORMAL}`,
  `envelope:${MAX_ANALYZED_HEIGHT}:${MAX_ANALYZED_HORIZONTAL_DISTANCE}`,
  `movement:${rolloutProfileFingerprint}`,
].join("|");

interface RolloutSuccess {
  ticks: number;
  minDistance: number;
  landingPosition: Vec3;
}

/** Runs reproducible offline movement trials against one map collision world. */
export class BotMovementAnalyzer {
  private readonly config: BotMovementAnalyzerConfig;
  private readonly opportunities: MovementOpportunity[] = [];
  private readonly rejections: MovementRejection[] = [];
  private readonly summary: MovementAnalysisSummary = {
    candidateCount: 0,
    rolloutCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    budgetExhausted: false,
    rejectionCounts: {},
  };

  constructor(
    private readonly collision: CollisionWorld,
    config: Partial<BotMovementAnalyzerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.config.candidateSpeeds = [...(config.candidateSpeeds ?? DEFAULT_CONFIG.candidateSpeeds)].sort((a, b) => a - b);
  }

  get accepted(): ReadonlyArray<MovementOpportunity> {
    return this.opportunities;
  }

  get rejected(): ReadonlyArray<MovementRejection> {
    return this.rejections;
  }

  get analysisSummary(): MovementAnalysisSummary {
    return {
      ...this.summary,
      rejectionCounts: { ...this.summary.rejectionCounts },
    };
  }

  analyzeJump(fromNodeId: number, fromHint: Vec3, toNodeId: number, toHint: Vec3): MovementCandidateResult {
    const id = `jump:${fromNodeId}->${toNodeId}`;
    this.summary.candidateCount++;

    const takeoff = this.resolveStandingOrigin(fromHint);
    if (!takeoff) return this.reject(id, fromNodeId, fromHint, toNodeId, toHint, "invalid_takeoff");

    const landing = this.resolveStandingOrigin(toHint);
    if (!landing) return this.reject(id, fromNodeId, takeoff, toNodeId, toHint, "invalid_landing");

    const dx = landing.x - takeoff.x;
    const dz = landing.z - takeoff.z;
    const horizontalDistance = Math.hypot(dx, dz);
    const heightDelta = landing.y - takeoff.y;
    if (
      horizontalDistance < 1 ||
      horizontalDistance > MAX_ANALYZED_HORIZONTAL_DISTANCE ||
      Math.abs(heightDelta) > MAX_ANALYZED_HEIGHT
    ) {
      return this.reject(id, fromNodeId, takeoff, toNodeId, landing, "outside_ballistic_envelope");
    }

    const direction = { x: dx / horizontalDistance, y: 0, z: dz / horizontalDistance };
    for (const initialSpeed of this.config.candidateSpeeds) {
      if (this.summary.rolloutCount >= this.config.maxRollouts) {
        this.summary.budgetExhausted = true;
        return this.reject(id, fromNodeId, takeoff, toNodeId, landing, "rollout_budget_exhausted");
      }

      this.summary.rolloutCount++;
      const success = this.rolloutJump(takeoff, landing, direction, initialSpeed);
      if (!success) continue;

      const yaw = Math.atan2(direction.x, direction.z);
      const opportunity: MovementOpportunity = {
        id,
        kind: "jump",
        fromNodeId,
        toNodeId,
        takeoff: {
          position: { ...takeoff },
          radius: 32,
          minSpeed: initialSpeed,
          maxSpeed: initialSpeed,
          yawRange: [yaw - 0.12, yaw + 0.12],
        },
        landing: {
          position: { ...success.landingPosition },
          radius: this.config.landingRadius,
          surfaceNormal: { x: 0, y: 1, z: 0 },
        },
        inputPlan: {
          direction,
          initialSpeed,
          buttons: InputButtons.FORWARD | InputButtons.SPRINT | InputButtons.JUMP,
          jumpTicks: 1,
          maxTicks: this.config.maxTicks,
        },
        expectedTicks: success.ticks,
        successMargin: Math.max(0, this.config.landingRadius - success.minDistance),
        risk: {
          fallDamage: heightDelta < -128,
          requiresLedgeGrab: false,
        },
      };
      this.opportunities.push(opportunity);
      this.summary.acceptedCount++;
      return { opportunity, rejection: null };
    }

    return this.reject(id, fromNodeId, takeoff, toNodeId, landing, "rollout_missed_landing");
  }

  private resolveStandingOrigin(hint: Vec3): Vec3 | null {
    const start = { x: hint.x, y: hint.y + SURFACE_PROBE_UP, z: hint.z };
    const end = { x: hint.x, y: hint.y - SURFACE_PROBE_DOWN, z: hint.z };
    const floor = this.collision.trace(start, end);
    if (!floor.hit) return null;
    if (!floor.hitPoint || !floor.normal || floor.normal.y < MIN_WALK_NORMAL) return null;
    return {
      x: floor.hitPoint.x,
      y: floor.hitPoint.y + PLAYER_FEET_OFFSET + STANDING_CLEARANCE,
      z: floor.hitPoint.z,
    };
  }

  private rolloutJump(takeoff: Vec3, landing: Vec3, direction: Vec3, initialSpeed: number): RolloutSuccess | null {
    const profile = new MovementProfile(ROLLOUT_PROFILE_OVERRIDES);
    profile.resetPhysicsState(true);

    let position = { ...takeoff };
    let velocity = { x: direction.x * initialSpeed, y: 0, z: direction.z * initialSpeed };
    let wasAirborne = false;
    let stableTicks = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    const deltaTime = 1 / this.config.tickRate;

    for (let tick = 1; tick <= this.config.maxTicks; tick++) {
      const buttons = InputButtons.FORWARD | InputButtons.SPRINT | (tick <= 1 ? InputButtons.JUMP : 0);
      const input: MovementInput = {
        direction,
        viewAngles: { pitch: 0, yaw: Math.atan2(direction.x, direction.z) },
        buttons,
        sequence: tick,
        isPressed(button: number): boolean {
          return (this.buttons & button) !== 0;
        },
      };
      const result = profile.simulate(position, velocity, input, deltaTime, this.collision);
      position = result.position;
      velocity = result.velocity;

      if (!result.grounded) wasAirborne = true;
      const horizontalDistance = Math.hypot(position.x - landing.x, position.z - landing.z);
      const verticalDistance = Math.abs(position.y - landing.y);
      if (verticalDistance <= 32) minDistance = Math.min(minDistance, horizontalDistance);

      if (wasAirborne && result.grounded && horizontalDistance <= this.config.landingRadius && verticalDistance <= 32) {
        stableTicks++;
        if (stableTicks >= this.config.stableGroundTicks) {
          return { ticks: tick, minDistance, landingPosition: { ...position } };
        }
      } else {
        stableTicks = 0;
      }
    }
    return null;
  }

  private reject(
    id: string,
    fromNodeId: number,
    takeoff: Vec3,
    toNodeId: number,
    landing: Vec3,
    reason: MovementRejectionReason,
  ): MovementCandidateResult {
    const rejection: MovementRejection = {
      id,
      kind: "jump",
      fromNodeId,
      toNodeId,
      takeoff: { ...takeoff },
      landing: { ...landing },
      reason,
    };
    if (this.rejections.length < MAX_STORED_REJECTIONS) {
      this.rejections.push(rejection);
    }
    this.summary.rejectedCount++;
    this.summary.rejectionCounts[reason] = (this.summary.rejectionCounts[reason] ?? 0) + 1;
    return { opportunity: null, rejection };
  }
}

/**
 * Lag Compensation System
 *
 * Implements server-side lag compensation for hit registration.
 * Based on:
 * - Quake 3 unlagged mod
 * - Valve's Source Engine
 * - Modern implementations like Overwatch/Valorant
 */

import type { CollisionWorld } from "../../../engine/network/systems/collision/CollisionWorld";
import type { WorldState } from "../core/WorldState";
import type { Entity } from "../ecs/Entity";
import type { EntityId, PlayerId, TickNumber } from "../ecs/types";
import { EntityType, tickNumber } from "../ecs/types";
import type { LagCompensationConfig } from "./config";
import { LAG_COMPENSATION } from "./config";
import { HistoryBuffer } from "./HistoryBuffer";

// ═══════════════════════════════════════════════════════════════════
// TRACE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface Ray {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  maxDistance: number;
}

export interface Capsule {
  base: { x: number; y: number; z: number };
  tip: { x: number; y: number; z: number };
  radius: number;
}

/**
 * Where the world was when a client took its shot: the bodies it was aiming at,
 * and the movers that were or were not in the way.
 */
export interface RewindView {
  tick: TickNumber;
  compensationMs: number;
  /** Live player positions as of `tick`. */
  positions: ReadonlyMap<EntityId, { x: number; y: number; z: number }>;
  /** Mover travel offsets as of `tick`, in LiftSystem definition order. */
  liftOffsets?: readonly number[];
}

export interface HitResult {
  hit: boolean;
  entityId?: EntityId;
  hitPoint?: { x: number; y: number; z: number };
  hitNormal?: { x: number; y: number; z: number };
  distance?: number;
  hitPart?: "head" | "body" | "legs";
  tick: TickNumber;
  compensationMs: number;
  blockedByWorld?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// LAG COMPENSATION SYSTEM
// ═══════════════════════════════════════════════════════════════════

export class LagCompensation {
  private historyBuffer: HistoryBuffer;
  private config: LagCompensationConfig;
  private clientLatencies: Map<PlayerId, number> = new Map();
  /** Mover travel offsets per recorded tick. */
  private liftHistory: Map<number, number[]> = new Map();
  /** Live player positions per recorded tick — all a rewound trace needs. */
  private positionHistory: Map<number, Map<EntityId, { x: number; y: number; z: number }>> = new Map();
  /** How far back history is kept, in ticks, with a little slack at the boundary. */
  private readonly capacityTicks: number;
  private newestRecordedTick: number | null = null;

  private collisionWorld: CollisionWorld | null = null;

  constructor(config: LagCompensationConfig = LAG_COMPENSATION) {
    this.config = config;
    this.historyBuffer = new HistoryBuffer(config.maxCompensationMs, config.tickRate);
    this.capacityTicks = Math.ceil((config.maxCompensationMs / 1000) * config.tickRate) + 2;
  }

  /**
   * Set collision world for BSP traces (blocks shots through walls)
   */
  setCollisionWorld(world: CollisionWorld | null): void {
    this.collisionWorld = world;
  }

  /** Drop all rewind history — on a restart, the old world is not coming back. */
  clearHistory(): void {
    this.positionHistory.clear();
    this.liftHistory.clear();
    this.newestRecordedTick = null;
  }

  /**
   * Record current state for lag compensation, every tick after the simulation
   * runs. Full fidelity, including a deep state clone for capsule tracing —
   * costly, so prefer `recordPositions` on a live server loop.
   */
  recordSnapshot(state: Readonly<WorldState>): void {
    this.historyBuffer.push(state as WorldState);
    this.recordPositions(state);
  }

  /**
   * Record only what a rewound shot needs: where the live bodies were, and where
   * the movers were. Cheap enough to run every tick, unlike a full state clone.
   */
  recordPositions(state: Readonly<WorldState>): void {
    const tick = state.tick as number;
    if (!Number.isFinite(tick)) return;
    // A restart rewinds the clock. Window pruning only trims what is older than
    // the newest tick, so without this the pre-restart ticks would never expire.
    if (this.newestRecordedTick !== null && tick < this.newestRecordedTick) this.clearHistory();
    this.newestRecordedTick = tick;

    const positions = new Map<EntityId, { x: number; y: number; z: number }>();
    for (const entity of state.entitiesByType(EntityType.Player)) {
      if (!entity.transform || !entity.health || entity.health.dead) continue;
      const p = entity.transform.position;
      positions.set(entity.id, { x: p.x, y: p.y, z: p.z });
    }
    this.positionHistory.set(tick, positions);

    // Movers are world geometry that moves, so they need the same history the
    // players get, or a rewound shot is traced against a lift that has moved on.
    const lifts = this.collisionWorld?.lifts;
    if (lifts?.definitions.length) this.liftHistory.set(tick, lifts.offsets());

    const oldest = tick - this.capacityTicks;
    for (const t of this.positionHistory.keys()) if (t < oldest) this.positionHistory.delete(t);
    for (const t of this.liftHistory.keys()) if (t < oldest) this.liftHistory.delete(t);
  }

  /**
   * Where the bodies and movers were when this client took its shot.
   *
   * Falls back to the closest recorded tick at or before the target, so a gap in
   * history degrades to a slightly stale rewind rather than silently snapping the
   * trace to the present. Returns null when nothing usable has been recorded.
   */
  rewind(currentTick: TickNumber, clientPingMs: number): RewindView | null {
    return this.rewindToTick(currentTick, this.getRewindTick(currentTick, clientPingMs) as number);
  }

  /**
   * Rewind to an explicit server tick — the view the client reported having,
   * rather than one estimated from a ping it told us about.
   *
   * The target is clamped into the compensation window, so a client asking to be
   * judged against the distant past gets the oldest rewind the budget allows and
   * nothing more.
   */
  rewindToTick(currentTick: TickNumber, targetTick: number): RewindView | null {
    if (!Number.isFinite(targetTick)) return null;
    const now = currentTick as number;
    const oldest = now - Math.round((this.config.maxCompensationMs / 1000) * this.config.tickRate);
    const target = Math.max(oldest, Math.min(now, targetTick));
    let tick = this.positionHistory.has(target) ? target : -1;
    if (tick < 0) for (const t of this.positionHistory.keys()) if (t <= target && t > tick) tick = t;
    const positions = tick < 0 ? undefined : this.positionHistory.get(tick);
    if (!positions) return null;
    return {
      tick: tickNumber(tick),
      compensationMs: ((currentTick as number) - tick) * (1000 / this.config.tickRate),
      positions,
      liftOffsets: this.liftHistory.get(tick),
    };
  }

  /**
   * Update client latency
   * Called when receiving ping data from client
   */
  updateClientLatency(playerId: PlayerId, rttMs: number): void {
    // Use half RTT as one-way latency
    this.clientLatencies.set(playerId, rttMs / 2);
  }

  /**
   * Get client latency
   */
  getClientLatency(playerId: PlayerId): number {
    return this.clientLatencies.get(playerId) ?? 0;
  }

  /**
   * Calculate the rewind tick for a client
   */
  getRewindTick(currentTick: TickNumber, clientPing: number, clientInputDelay: number = 0): TickNumber {
    // Total compensation = client ping + client input delay + half tick
    const totalLatencyMs = clientPing + clientInputDelay + 1000 / this.config.tickRate / 2;

    // Clamp to max compensation
    const compensationMs = Math.min(totalLatencyMs, this.config.maxCompensationMs);

    // Convert to ticks
    const compensationTicks = Math.round((compensationMs / 1000) * this.config.tickRate);

    return tickNumber(Math.max(0, (currentTick as number) - compensationTicks));
  }

  /**
   * Perform a lag-compensated hitscan trace
   */
  traceHitscan(
    ray: Ray,
    shooterEntityId: EntityId,
    clientPingMs: number,
    currentState: Readonly<WorldState>,
  ): HitResult {
    const rewindTick = this.getRewindTick(currentState.tick, clientPingMs);

    // Get historical state
    const historicalState = this.historyBuffer.getClosestState(rewindTick);

    if (!historicalState) {
      // No history available, use current state
      return this.performTrace(ray, shooterEntityId, currentState, currentState.tick, 0);
    }

    const compensationMs =
      ((currentState.tick as number) - (historicalState.tick as number)) * (1000 / this.config.tickRate);

    return this.performTrace(ray, shooterEntityId, historicalState, historicalState.tick, compensationMs);
  }

  /**
   * Perform actual ray-vs-capsule trace
   * Also checks BSP world collision to block shots through walls
   */
  private performTrace(
    ray: Ray,
    shooterEntityId: EntityId,
    state: Readonly<WorldState>,
    tick: TickNumber,
    compensationMs: number,
  ): HitResult {
    let closestHit: HitResult = {
      hit: false,
      tick,
      compensationMs,
    };
    let closestDistance = ray.maxDistance;

    // First: Check BSP world collision (walls, floors, etc.)
    let worldBlockDistance = Infinity;
    if (this.collisionWorld) {
      const endPoint = {
        x: ray.origin.x + ray.direction.x * ray.maxDistance,
        y: ray.origin.y + ray.direction.y * ray.maxDistance,
        z: ray.origin.z + ray.direction.z * ray.maxDistance,
      };

      const trace = () => this.collisionWorld!.trace(ray.origin, endPoint);
      const lifts = this.collisionWorld.lifts;
      const offsets = this.liftHistory.get(tick as number);
      const worldTrace = lifts && offsets ? lifts.rewind(offsets, trace) : trace();
      if (worldTrace.hit) {
        worldBlockDistance = worldTrace.fraction * ray.maxDistance;
      }
    }

    // Check all player entities
    for (const entity of state.entitiesByType(EntityType.Player)) {
      // Skip shooter
      if (entity.id === shooterEntityId) continue;

      // Skip dead players
      if (!entity.transform || !entity.health || entity.health.dead) continue;

      // Create capsule for player
      const capsule = this.getPlayerCapsule(entity);

      // Ray-capsule intersection
      const result = this.rayCapsuleIntersect(ray, capsule);

      if (result.hit && result.distance! < closestDistance) {
        // Check if world blocks this hit (wall in the way)
        if (result.distance! < worldBlockDistance) {
          closestDistance = result.distance!;

          // Determine hit part based on height
          const hitY = result.hitPoint!.y - entity.transform.position.y;
          let hitPart: "head" | "body" | "legs" = "body";
          if (hitY > 48) hitPart = "head";
          else if (hitY < 16) hitPart = "legs";

          closestHit = {
            hit: true,
            entityId: entity.id,
            hitPoint: result.hitPoint,
            hitNormal: result.hitNormal,
            distance: result.distance,
            hitPart,
            tick,
            compensationMs,
            blockedByWorld: false,
          };
        }
      }
    }

    // If no player was hit but world was hit, return world hit info
    if (!closestHit.hit && worldBlockDistance < ray.maxDistance) {
      return {
        hit: false,
        tick,
        compensationMs,
        blockedByWorld: true,
        distance: worldBlockDistance,
      };
    }

    return closestHit;
  }

  /**
   * Get player capsule from entity
   */
  private getPlayerCapsule(entity: Readonly<Entity>): Capsule {
    const pos = entity.transform!.position;

    return {
      base: { x: pos.x, y: pos.y, z: pos.z },
      tip: { x: pos.x, y: pos.y + 56, z: pos.z }, // Standing height
      radius: 16, // Player radius
    };
  }

  /**
   * Ray-capsule intersection test
   * Returns closest hit point on capsule surface
   */
  private rayCapsuleIntersect(
    ray: Ray,
    capsule: Capsule,
  ): {
    hit: boolean;
    distance?: number;
    hitPoint?: { x: number; y: number; z: number };
    hitNormal?: { x: number; y: number; z: number };
  } {
    // Capsule axis
    const axis = {
      x: capsule.tip.x - capsule.base.x,
      y: capsule.tip.y - capsule.base.y,
      z: capsule.tip.z - capsule.base.z,
    };

    const axisLenSq = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
    const axisLen = Math.sqrt(axisLenSq);

    // Normalize axis
    const axisNorm = {
      x: axis.x / axisLen,
      y: axis.y / axisLen,
      z: axis.z / axisLen,
    };

    // Vector from capsule base to ray origin
    const toRay = {
      x: ray.origin.x - capsule.base.x,
      y: ray.origin.y - capsule.base.y,
      z: ray.origin.z - capsule.base.z,
    };

    // Project onto capsule axis
    let t = toRay.x * axisNorm.x + toRay.y * axisNorm.y + toRay.z * axisNorm.z;
    t = Math.max(0, Math.min(axisLen, t));

    // Closest point on capsule axis
    const closestOnAxis = {
      x: capsule.base.x + axisNorm.x * t,
      y: capsule.base.y + axisNorm.y * t,
      z: capsule.base.z + axisNorm.z * t,
    };

    // Now we have a sphere at closestOnAxis with radius capsule.radius
    // Do ray-sphere intersection

    const toSphere = {
      x: ray.origin.x - closestOnAxis.x,
      y: ray.origin.y - closestOnAxis.y,
      z: ray.origin.z - closestOnAxis.z,
    };

    const a = ray.direction.x * ray.direction.x + ray.direction.y * ray.direction.y + ray.direction.z * ray.direction.z;
    const b = 2 * (toSphere.x * ray.direction.x + toSphere.y * ray.direction.y + toSphere.z * ray.direction.z);
    const c =
      toSphere.x * toSphere.x + toSphere.y * toSphere.y + toSphere.z * toSphere.z - capsule.radius * capsule.radius;

    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
      return { hit: false };
    }

    const sqrtD = Math.sqrt(discriminant);
    let distance = (-b - sqrtD) / (2 * a);

    // If behind ray origin, try far intersection
    if (distance < 0) {
      distance = (-b + sqrtD) / (2 * a);
      if (distance < 0) return { hit: false };
    }

    // Check max distance
    if (distance > ray.maxDistance) {
      return { hit: false };
    }

    // Calculate hit point
    const hitPoint = {
      x: ray.origin.x + ray.direction.x * distance,
      y: ray.origin.y + ray.direction.y * distance,
      z: ray.origin.z + ray.direction.z * distance,
    };

    // Calculate normal (from sphere center to hit point)
    const normal = {
      x: hitPoint.x - closestOnAxis.x,
      y: hitPoint.y - closestOnAxis.y,
      z: hitPoint.z - closestOnAxis.z,
    };
    const normalLen = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);

    return {
      hit: true,
      distance,
      hitPoint,
      hitNormal:
        normalLen > 0
          ? {
              x: normal.x / normalLen,
              y: normal.y / normalLen,
              z: normal.z / normalLen,
            }
          : { x: 0, y: 1, z: 0 },
    };
  }

  /**
   * Get current buffer stats for debugging
   */
  getStats(): {
    bufferSize: number;
    bufferCapacity: number;
    oldestTick: TickNumber | null;
    newestTick: TickNumber | null;
    connectedClients: number;
    avgLatency: number;
  } {
    const latencies = [...this.clientLatencies.values()];
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    return {
      bufferSize: this.historyBuffer.size,
      bufferCapacity: this.historyBuffer.maxSize,
      oldestTick: this.historyBuffer.oldestTick,
      newestTick: this.historyBuffer.newestTick,
      connectedClients: this.clientLatencies.size,
      avgLatency,
    };
  }
}

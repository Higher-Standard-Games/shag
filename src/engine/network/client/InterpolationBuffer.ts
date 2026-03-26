/**
 * InterpolationBuffer — Server snapshot interpolation for smooth remote entity rendering.
 *
 * Stores recent server snapshots and interpolates between them at render time.
 * Used for OTHER players' positions (not the local player, who uses prediction).
 *
 * Architecture:
 * - Each snapshot is timestamped with performance.now() on arrival
 * - Rendering happens at `now - interpDelay` (delayed to ensure buffer has data)
 * - Between two snapshots, positions/rotations/velocities are linearly interpolated
 * - If renderTime is past all snapshots, use the latest one
 */

import { GameState } from "../core/GameState";

// Component shapes for typed access (same as BinaryProtocol)
interface Vec3 { x: number; y: number; z: number }
interface PositionShape extends Vec3 {}
interface TransformShape { position: Vec3; rotation?: { x: number; y: number; z: number; w: number } }
interface VelocityShape { linear: Vec3; x: number; y: number; z: number; grounded?: boolean }

export class InterpolationBuffer {
  private snapshots: { state: GameState; timestamp: number }[] = [];
  private interpolationDelay: number = 50; // 50ms delay - reduced for responsiveness
  private readonly maxSnapshots: number = 10;

  /** Get interpolation delay in ms */
  getInterpolationDelay(): number {
    return this.interpolationDelay;
  }

  /**
   * Add a new snapshot to the buffer with timestamp
   */
  addSnapshot(snapshot: GameState, timestamp?: number): void {
    const now = timestamp ?? performance.now();
    this.snapshots.push({ state: snapshot, timestamp: now });

    // Keep only the last N snapshots
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * Get interpolated state for rendering.
   * Uses actual time to calculate smooth interpolation between snapshots.
   */
  getInterpolatedState(renderTime: number): GameState {
    // We render in the past to ensure we always have two snapshots to interpolate between
    const targetTime = renderTime - this.interpolationDelay;

    // Need at least 2 snapshots to interpolate
    if (this.snapshots.length < 2) {
      // Return latest snapshot if we have one
      if (this.snapshots.length === 1) {
        return this.snapshots[0].state;
      }
      return new GameState();
    }

    // Find the two snapshots to interpolate between
    // We want snapshot1.timestamp <= targetTime <= snapshot2.timestamp
    let snapshot1 = this.snapshots[0];
    let snapshot2 = this.snapshots[1];

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].timestamp <= targetTime && this.snapshots[i + 1].timestamp >= targetTime) {
        snapshot1 = this.snapshots[i];
        snapshot2 = this.snapshots[i + 1];
        break;
      }
      // If we've passed the target time, use these two
      if (this.snapshots[i].timestamp > targetTime) {
        if (i > 0) {
          snapshot1 = this.snapshots[i - 1];
          snapshot2 = this.snapshots[i];
        }
        break;
      }
      // If we're beyond all snapshots, use the two most recent
      if (i === this.snapshots.length - 2) {
        snapshot1 = this.snapshots[i];
        snapshot2 = this.snapshots[i + 1];
      }
    }

    // Calculate interpolation factor t (0 to 1)
    const timeDiff = snapshot2.timestamp - snapshot1.timestamp;
    let t: number;
    if (timeDiff <= 0) {
      t = 1; // Same timestamp, use snapshot2
    } else {
      t = Math.max(0, Math.min(1, (targetTime - snapshot1.timestamp) / timeDiff));
    }

    // Interpolate between the two snapshots
    return this.interpolateStates(snapshot1.state, snapshot2.state, t);
  }

  /** Get number of buffered snapshots */
  getBufferSize(): number {
    return this.snapshots.length;
  }

  private interpolateStates(state1: GameState, state2: GameState, t: number): GameState {
    const result = new GameState();
    result.tick = state1.tick;
    result.events = []; // Events aren't interpolated

    // Copy players from state2 (needed for Game to find local player)
    for (const [id, player] of state2.players) {
      result.players.set(id, player);
    }

    // Interpolate entities
    for (const [id, entity2] of state2.entities) {
      const entity1 = state1.entities.get(id);
      if (!entity1) {
        // New entity, just clone it
        result.entities.set(id, entity2.clone());
        continue;
      }

      const interpolatedEntity = entity2.clone();

      // Interpolate position component
      const pos1 = entity1.getComponent("position") as unknown as PositionShape | undefined;
      const pos2 = entity2.getComponent("position") as unknown as PositionShape | undefined;

      if (pos1 && pos2) {
        const interpolatedPos = interpolatedEntity.getComponent("position") as unknown as PositionShape | undefined;
        if (interpolatedPos) {
          interpolatedPos.x = pos1.x + (pos2.x - pos1.x) * t;
          interpolatedPos.y = pos1.y + (pos2.y - pos1.y) * t;
          interpolatedPos.z = pos1.z + (pos2.z - pos1.z) * t;
        }
      }

      // Interpolate transform.position (for Game compatibility)
      const transform1 = entity1.getComponent("transform") as unknown as TransformShape | undefined;
      const transform2 = entity2.getComponent("transform") as unknown as TransformShape | undefined;

      if (transform1?.position && transform2?.position) {
        const interpolatedTransform = interpolatedEntity.getComponent("transform") as unknown as TransformShape | undefined;
        if (interpolatedTransform?.position) {
          interpolatedTransform.position.x =
            transform1.position.x + (transform2.position.x - transform1.position.x) * t;
          interpolatedTransform.position.y =
            transform1.position.y + (transform2.position.y - transform1.position.y) * t;
          interpolatedTransform.position.z =
            transform1.position.z + (transform2.position.z - transform1.position.z) * t;
        }
      }

      // Interpolate velocity.linear (for smooth movement display)
      const vel1 = entity1.getComponent("velocity") as unknown as VelocityShape | undefined;
      const vel2 = entity2.getComponent("velocity") as unknown as VelocityShape | undefined;

      if (vel1?.linear && vel2?.linear) {
        const interpolatedVel = interpolatedEntity.getComponent("velocity") as unknown as VelocityShape | undefined;
        if (interpolatedVel?.linear) {
          interpolatedVel.linear.x = vel1.linear.x + (vel2.linear.x - vel1.linear.x) * t;
          interpolatedVel.linear.y = vel1.linear.y + (vel2.linear.y - vel1.linear.y) * t;
          interpolatedVel.linear.z = vel1.linear.z + (vel2.linear.z - vel1.linear.z) * t;
        }
      }

      result.entities.set(id, interpolatedEntity);
    }

    return result;
  }
}

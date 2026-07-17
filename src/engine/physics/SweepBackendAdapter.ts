/**
 * SweepBackendAdapter — adapts the Babylon-based SweepCollisionBackend to the
 * structural SweepBackend contract that shared/collision speaks (QA-3/QA-WO8).
 *
 * All Babylon Vector3 conversion for shared collision lives HERE, on the
 * engine side of the boundary; SharedCollisionWorld is pure structural math.
 * Conversion doubles as the defensive copy the Babylon backend needs (it may
 * mutate the vectors it is handed).
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SweepBackend, SweepBackendTraceOptions } from "../../shared/collision/CollisionWorld";
import type { Vec3 } from "../../shared/server/simulation/types";
import type { SweepCollisionBackend } from "./SweepCollisionBackend";

function toBabylon(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

function fromBabylon(v: Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export class SweepBackendAdapter implements SweepBackend {
  constructor(private readonly backend: SweepCollisionBackend) {}

  trace(
    start: Vec3,
    end: Vec3,
    options: SweepBackendTraceOptions,
  ): { fraction: number; endPos?: Vec3; normal?: Vec3; contents?: number } {
    const result = this.backend.trace(toBabylon(start), toBabylon(end), options);
    return {
      fraction: result.fraction,
      endPos: result.endPos ? fromBabylon(result.endPos) : undefined,
      normal: result.normal ? fromBabylon(result.normal) : undefined,
      contents: result.contents,
    };
  }

  stepSlideMove(
    start: Vec3,
    movement: Vec3,
    options: SweepBackendTraceOptions,
  ): { endPos: Vec3; velocity: Vec3; hitCount: number } {
    const result = this.backend.stepSlideMove(toBabylon(start), toBabylon(movement), options);
    return {
      endPos: fromBabylon(result.endPos),
      velocity: fromBabylon(result.velocity),
      hitCount: result.hitCount,
    };
  }

  pointContents(point: Vec3): number {
    return this.backend.pointContents(toBabylon(point));
  }
}

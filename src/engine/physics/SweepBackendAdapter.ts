/**
 * SweepBackendAdapter — adapts the Babylon-based SweepCollisionBackend to the
 * structural SweepBackend contract that shared/collision speaks (QA-3/QA-WO8).
 *
 * All Babylon Vector3 conversion for shared collision lives HERE, on the
 * engine side of the boundary; SharedCollisionWorld is pure structural math.
 * The backend only reads the vectors it is handed, so inputs are converted
 * into reused scratch vectors.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Contents, type SweepBackend, type SweepBackendTraceOptions } from "../../shared/collision/CollisionWorld";
import type { Vec3 } from "../../shared/server/simulation/types";
import { ContentFlags } from "./ContentFlags";
import type { SweepCollisionBackend } from "./SweepCollisionBackend";

// Inputs go through two reused vectors: every backend entry point reads or
// copies its arguments up front and never keeps or writes them. Outputs stay
// fresh objects, since callers keep them (a projectile takes a hit point as
// its new position).
const _a = new Vector3();
const _b = new Vector3();
function inA(v: Vec3): Vector3 {
  return _a.set(v.x, v.y, v.z);
}
function inB(v: Vec3): Vector3 {
  return _b.set(v.x, v.y, v.z);
}

function fromBabylon(v: Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Raw BSP content bit -> the shared `Contents` vocabulary.
 *
 * The two enums are numerically different and agree on exactly one value,
 * `SOLID = 0x1`. That coincidence is why nothing had noticed: every consumer so
 * far only ever asked about solidity. The rest do not line up at all, and one
 * pair actively lies — raw `LAVA` is `0x8`, which is the same number as shared
 * `Contents.SLIME`, so an untranslated lava reading would report slime.
 *
 * Translating here means shared and simulation code never sees a BSP value.
 */
const CONTENTS_TRANSLATION: ReadonlyArray<readonly [number, number]> = [
  [ContentFlags.SOLID, Contents.SOLID],
  [ContentFlags.WATER, Contents.WATER],
  [ContentFlags.LAVA, Contents.LAVA],
  [ContentFlags.SLIME, Contents.SLIME],
  [ContentFlags.PLAYERCLIP, Contents.PLAYERCLIP],
  [ContentFlags.MONSTERCLIP, Contents.MONSTERCLIP],
  [ContentFlags.TRIGGER, Contents.TRIGGER],
];

/**
 * Convert raw BSP content flags into the shared vocabulary.
 *
 * Bits with no shared equivalent (fog, detail, structural, translucent...) are
 * dropped rather than passed through, so a shared-side mask can never match a
 * BSP bit by accident.
 */
export function toSharedContents(raw: number): number {
  let out = 0;
  for (const [bspBit, sharedBit] of CONTENTS_TRANSLATION) {
    if (raw & bspBit) out |= sharedBit;
  }
  return out;
}

export class SweepBackendAdapter implements SweepBackend {
  constructor(private readonly backend: SweepCollisionBackend) {}

  get lifts() {
    return this.backend.lifts;
  }

  get brushModels() {
    return this.backend.brushModels;
  }

  trace(
    start: Vec3,
    end: Vec3,
    options: SweepBackendTraceOptions,
  ): { fraction: number; endPos?: Vec3; normal?: Vec3; contents?: number } {
    const result = this.backend.trace(inA(start), inB(end), options);
    return {
      fraction: result.fraction,
      endPos: result.endPos ? fromBabylon(result.endPos) : undefined,
      normal: result.normal ? fromBabylon(result.normal) : undefined,
      contents: result.contents === undefined ? undefined : toSharedContents(result.contents),
    };
  }

  stepSlideMove(
    start: Vec3,
    movement: Vec3,
    options: SweepBackendTraceOptions,
  ): { endPos: Vec3; velocity: Vec3; hitCount: number } {
    const result = this.backend.stepSlideMove(inA(start), inB(movement), options);
    return {
      endPos: fromBabylon(result.endPos),
      velocity: fromBabylon(result.velocity),
      hitCount: result.hitCount,
    };
  }

  pointContents(point: Vec3): number {
    return toSharedContents(this.backend.pointContents(inA(point)));
  }

  isInLadder(min: Vec3, max: Vec3): boolean {
    return this.backend.isInLadder(inA(min), inB(max));
  }
}

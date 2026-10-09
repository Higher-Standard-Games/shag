/** Axis-aligned box subtraction: exact, and every result is again an axis-aligned box. */
import type { Vec3q } from "../EditorDocument";

export interface Box {
  min: Vec3q;
  max: Vec3q;
}

const AXES = ["x", "y", "z"] as const;

/** Whether two boxes share volume (touching faces do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return AXES.every((axis) => a.min[axis] < b.max[axis] && b.min[axis] < a.max[axis]);
}

/**
 * `a` minus `b`, as up to six boxes that exactly fill the rest of `a`. Slabs are
 * taken off along x, then y, then z, so the result is deterministic.
 */
export function subtractBox(a: Box, b: Box): Box[] {
  if (!boxesOverlap(a, b)) return [{ min: { ...a.min }, max: { ...a.max } }];
  const pieces: Box[] = [];
  const rest: Box = { min: { ...a.min }, max: { ...a.max } };
  for (const axis of AXES) {
    if (rest.min[axis] < b.min[axis]) {
      pieces.push({ min: { ...rest.min }, max: { ...rest.max, [axis]: b.min[axis] } });
      rest.min[axis] = b.min[axis];
    }
    if (rest.max[axis] > b.max[axis]) {
      pieces.push({ min: { ...rest.min, [axis]: b.max[axis] }, max: { ...rest.max } });
      rest.max[axis] = b.max[axis];
    }
  }
  return pieces;
}

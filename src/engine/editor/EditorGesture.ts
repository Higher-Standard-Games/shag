import type { BoxBrush, Vec3q } from "./EditorDocument";
import { lockBrushBounds } from "./TextureLock";

export interface OrthoAxes {
  u: keyof Vec3q;
  v: keyof Vec3q;
  hidden: keyof Vec3q;
}

/** A drag proposes Quake-space bounds; it does not mutate the document. */
export function drawBounds(
  axes: OrthoAxes,
  start: readonly [number, number],
  current: readonly [number, number],
  workPlane: number,
  thickness: number,
): { min: Vec3q; max: Vec3q } | null {
  if (start[0] === current[0] || start[1] === current[1]) return null;
  const min: Vec3q = { x: 0, y: 0, z: 0 };
  const max: Vec3q = { x: 0, y: 0, z: 0 };
  min[axes.u] = Math.min(start[0], current[0]);
  max[axes.u] = Math.max(start[0], current[0]);
  min[axes.v] = Math.min(start[1], current[1]);
  max[axes.v] = Math.max(start[1], current[1]);
  min[axes.hidden] = workPlane;
  max[axes.hidden] = workPlane + thickness;
  return { min, max };
}

export function moveBox(brush: BoxBrush, axes: OrthoAxes, du: number, dv: number): BoxBrush {
  const result = structuredClone(brush);
  result.min[axes.u] += du;
  result.max[axes.u] += du;
  result.min[axes.v] += dv;
  result.max[axes.v] += dv;
  return lockBrushBounds(brush, result);
}

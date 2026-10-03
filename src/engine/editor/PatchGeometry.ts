import type { PatchSurface, Vec3q } from "./EditorDocument";
import type { OrthoAxes } from "./EditorGesture";

/** A flat 3×3 patch on the active orthographic work plane. Inputs are already grid-snapped. */
export function flatPatch(
  id: string,
  axes: OrthoAxes,
  start: readonly [number, number],
  end: readonly [number, number],
  workPlane: number,
  shader: string,
): PatchSurface | null {
  if (start[0] === end[0] || start[1] === end[1]) return null;
  const u0 = Math.min(start[0], end[0]);
  const u1 = Math.max(start[0], end[0]);
  const v0 = Math.min(start[1], end[1]);
  const v1 = Math.max(start[1], end[1]);
  const controlPoints: PatchSurface["controlPoints"] = [];
  for (let row = 0; row < 3; row++) {
    const controls: PatchSurface["controlPoints"][number] = [];
    for (let col = 0; col < 3; col++) {
      const position: Vec3q = { x: 0, y: 0, z: 0 };
      position[axes.u] = u0 + ((u1 - u0) * col) / 2;
      position[axes.v] = v0 + ((v1 - v0) * row) / 2;
      position[axes.hidden] = workPlane;
      controls.push({ ...position, u: col / 2, v: row / 2 });
    }
    controlPoints.push(controls);
  }
  return { id, shader, width: 3, height: 3, controlPoints };
}

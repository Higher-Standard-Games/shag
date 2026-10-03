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

/** Pick the nearest projected control, preferring the inspector's current point only when projections tie. */
export function patchControlHit(
  patch: PatchSurface,
  axes: OrthoAxes,
  u: number,
  v: number,
  tolerance: number,
  preferredIndex = -1,
): number | null {
  let nearest: number | null = null;
  let distance = tolerance;
  for (let row = 0; row < patch.height; row++) {
    for (let col = 0; col < patch.width; col++) {
      const point = patch.controlPoints[row][col];
      const next = Math.hypot(point[axes.u] - u, point[axes.v] - v);
      if (next <= tolerance && (nearest === null || next < distance)) {
        nearest = row * patch.width + col;
        distance = next;
      }
    }
  }
  if (preferredIndex >= 0 && preferredIndex < patch.width * patch.height && nearest !== null) {
    const point = patch.controlPoints[Math.floor(preferredIndex / patch.width)][preferredIndex % patch.width];
    if (Math.abs(Math.hypot(point[axes.u] - u, point[axes.v] - v) - distance) < 1e-6) return preferredIndex;
  }
  return nearest;
}

/** A transient copy for drag preview. The hidden axis and UV of this control remain intact. */
export function movedPatchControl(
  patch: PatchSurface,
  index: number,
  axes: OrthoAxes,
  u: number,
  v: number,
): PatchSurface {
  const result = structuredClone(patch);
  const point = result.controlPoints[Math.floor(index / patch.width)][index % patch.width];
  point[axes.u] = u;
  point[axes.v] = v;
  return result;
}

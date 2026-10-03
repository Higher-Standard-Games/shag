import type { PatchSurface, Vec3q } from "./EditorDocument";
import type { OrthoAxes } from "./EditorGesture";

export interface PatchSweep {
  /** The two corners of the visible rectangle; reverse drags are accepted. */
  start: readonly [number, number];
  end: readonly [number, number];
  /** The two ends of the extrusion along the orthographic pane's hidden axis. */
  depth: readonly [number, number];
  axes: OrthoAxes;
  /** Reverses surface winding without moving its control-point positions. */
  reverse?: boolean;
}

type ProfilePoint = readonly [number, number];

const valid = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= 1_000_000;

/** Extrudes an odd-length quadratic profile into a 3-row patchDef2 grid. */
function sweepPatch(
  id: string,
  shader: string,
  sweep: PatchSweep,
  profile: readonly ProfilePoint[],
): PatchSurface | null {
  const { axes } = sweep;
  if (new Set([axes.u, axes.v, axes.hidden]).size !== 3) return null;
  if (![...sweep.start, ...sweep.end, ...sweep.depth].every(valid)) return null;
  if (sweep.start[0] === sweep.end[0] || sweep.start[1] === sweep.end[1] || sweep.depth[0] === sweep.depth[1]) {
    return null;
  }
  const depth0 = Math.min(...sweep.depth);
  const depth1 = Math.max(...sweep.depth);
  const controlPoints: PatchSurface["controlPoints"] = [];
  for (let row = 0; row < 3; row++) {
    const depth = depth0 + ((depth1 - depth0) * row) / 2;
    const controls = profile.map(([u, v], col) => {
      const position: Vec3q = { x: 0, y: 0, z: 0 };
      position[axes.u] = u;
      position[axes.v] = v;
      position[axes.hidden] = depth;
      return { ...position, u: col / (profile.length - 1), v: row / 2 };
    });
    controlPoints.push(controls);
  }
  if (sweep.reverse) controlPoints.reverse();
  return { id, shader, width: profile.length, height: 3, controlPoints };
}

/** A quarter-turn surface between opposite corners. `inner` bends toward the other side of the diagonal. */
export function bevelPatch(
  id: string,
  shader: string,
  sweep: PatchSweep,
  bend: "outer" | "inner" = "outer",
): PatchSurface | null {
  const u0 = Math.min(sweep.start[0], sweep.end[0]);
  const u1 = Math.max(sweep.start[0], sweep.end[0]);
  const v0 = Math.min(sweep.start[1], sweep.end[1]);
  const v1 = Math.max(sweep.start[1], sweep.end[1]);
  return sweepPatch(id, shader, sweep, [[u0, v0], bend === "outer" ? [u1, v0] : [u0, v1], [u1, v1]]);
}

/** Two joined quadratic spans: spring at v0, crest at v1, extruded through the hidden axis. */
export function archPatch(id: string, shader: string, sweep: PatchSweep): PatchSurface | null {
  const u0 = Math.min(sweep.start[0], sweep.end[0]);
  const u1 = Math.max(sweep.start[0], sweep.end[0]);
  const v0 = Math.min(sweep.start[1], sweep.end[1]);
  const v1 = Math.max(sweep.start[1], sweep.end[1]);
  const middle = u0 + (u1 - u0) / 2;
  return sweepPatch(id, shader, sweep, [
    [u0, v0],
    [u0, v1],
    [middle, v1],
    [u1, v1],
    [u1, v0],
  ]);
}

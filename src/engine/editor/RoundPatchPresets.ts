import type { PatchSurface, Vec3q } from "./EditorDocument";
import type { PatchSweep } from "./PatchPresets";

export type RoundPatchShape = "cylinder" | "tube" | "cone" | "cap";
export interface RoundPatchOptions {
  /** Tube wall thickness, in world units, subtracted from both ellipse radii. */
  thickness?: number;
  capped?: boolean;
}

// Four joined quadratic spans. The duplicate endpoint closes the texture seam.
const RING = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
] as const;

/** Quadratic approximations, not rational exact circles. Each surface is an editable patchDef2. */
export function roundPatches(
  id: string,
  shader: string,
  sweep: PatchSweep,
  shape: RoundPatchShape,
  options: RoundPatchOptions = {},
): PatchSurface[] | null {
  const { axes } = sweep;
  if (!["cylinder", "tube", "cone", "cap"].includes(shape)) return null;
  if (
    new Set([axes.u, axes.v, axes.hidden]).size !== 3 ||
    ![axes.u, axes.v, axes.hidden].every((axis) => ["x", "y", "z"].includes(axis))
  )
    return null;
  if (
    ![...sweep.start, ...sweep.end, ...sweep.depth].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= 1_000_000,
    )
  )
    return null;
  if (options.capped !== undefined && typeof options.capped !== "boolean") return null;
  if (sweep.reverse !== undefined && typeof sweep.reverse !== "boolean") return null;
  const ru = Math.abs(sweep.end[0] - sweep.start[0]) / 2,
    rv = Math.abs(sweep.end[1] - sweep.start[1]) / 2;
  if (ru <= 0 || rv <= 0 || (shape !== "cap" && sweep.depth[0] === sweep.depth[1])) return null;
  const cu = (sweep.start[0] + sweep.end[0]) / 2,
    cv = (sweep.start[1] + sweep.end[1]) / 2;
  const low = Math.min(...sweep.depth),
    high = Math.max(...sweep.depth),
    thickness = options.thickness ?? 8;
  if (shape === "tube" && (!Number.isFinite(thickness) || thickness <= 0 || thickness >= Math.min(ru, rv))) return null;
  const innerU = ru - thickness,
    innerV = rv - thickness;
  // These orthographic frames are cyclic except X/Z/Y, which reverses handedness.
  const odd =
    `${axes.u}${axes.v}${axes.hidden}` === "xzy" ||
    `${axes.u}${axes.v}${axes.hidden}` === "yxz" ||
    `${axes.u}${axes.v}${axes.hidden}` === "zyx";
  const surface = (
    suffix: string,
    r0: readonly [number, number],
    r1: readonly [number, number],
    d0: number,
    d1: number,
    flip = false,
  ): PatchSurface => {
    const controlPoints = Array.from({ length: 3 }, (_, row) =>
      RING.map(([u, v], col) => {
        const t = row / 2,
          point: Vec3q = { x: 0, y: 0, z: 0 };
        point[axes.u] = cu + u * (r0[0] + (r1[0] - r0[0]) * t);
        point[axes.v] = cv + v * (r0[1] + (r1[1] - r0[1]) * t);
        point[axes.hidden] = d0 + (d1 - d0) * t;
        return {
          ...point,
          u: d0 === d1 ? 0.5 + (point[axes.u] - cu) / (2 * ru) : col / 8,
          v: d0 === d1 ? 0.5 + (point[axes.v] - cv) / (2 * rv) : t,
        };
      }),
    );
    if ((Number(odd) + Number(flip) + Number(sweep.reverse ?? false)) % 2) controlPoints.reverse();
    return { id: suffix ? `${id}-${suffix}` : id, shader, width: 9, height: 3, controlPoints };
  };
  if (shape === "cap") return [surface("", [0, 0], [ru, rv], sweep.depth[0], sweep.depth[0], true)];
  const result = [surface("", [ru, rv], shape === "cone" ? [0, 0] : [ru, rv], low, high)];
  if (shape === "tube") result.push(surface("inner", [innerU, innerV], [innerU, innerV], low, high, true));
  if (options.capped ?? true) {
    const inner: readonly [number, number] = shape === "tube" ? [innerU, innerV] : [0, 0];
    result.push(surface("bottom", inner, [ru, rv], low, low));
    if (shape !== "cone") result.push(surface("top", inner, [ru, rv], high, high, true));
  }
  return result;
}

import type { Vec3q } from "./EditorDocument";

export type EditorPlane = "xy" | "xz" | "yz";
export const PLANE_AXES: Record<EditorPlane, { u: keyof Vec3q; v: keyof Vec3q; hidden: keyof Vec3q }> = {
  xy: { u: "x", v: "y", hidden: "z" },
  xz: { u: "x", v: "z", hidden: "y" },
  yz: { u: "y", v: "z", hidden: "x" },
};

/** CSS pixels relative to the pane center, with screen Y pointing down. */
export function paneToWorld(plane: EditorPlane, center: Vec3q, zoom: number, x: number, y: number): [number, number] {
  const axes = PLANE_AXES[plane];
  return [center[axes.u] + x / zoom, center[axes.v] - y / zoom];
}

export function panCenter(plane: EditorPlane, center: Vec3q, zoom: number, dx: number, dy: number): Vec3q {
  const axes = PLANE_AXES[plane];
  return { ...center, [axes.u]: center[axes.u] - dx / zoom, [axes.v]: center[axes.v] + dy / zoom };
}

export function zoomCenter(
  plane: EditorPlane,
  center: Vec3q,
  before: number,
  after: number,
  x: number,
  y: number,
): Vec3q {
  const axes = PLANE_AXES[plane];
  const anchor = paneToWorld(plane, center, before, x, y);
  return { ...center, [axes.u]: anchor[0] - x / after, [axes.v]: anchor[1] + y / after };
}

/** Combined bounds of brushes, entity boxes, or anything else with a min and max. */
export function brushBounds<T extends { min: Vec3q; max: Vec3q }>(
  brushes: readonly T[],
): { center: Vec3q; size: Vec3q } | null {
  if (!brushes.length) return null;
  const min = { ...brushes[0].min };
  const max = { ...brushes[0].max };
  for (const brush of brushes) {
    for (const axis of ["x", "y", "z"] as const) {
      min[axis] = Math.min(min[axis], brush.min[axis]);
      max[axis] = Math.max(max[axis], brush.max[axis]);
    }
  }
  return {
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

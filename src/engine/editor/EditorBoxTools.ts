import type { BoxBrush, Vec3q } from "./EditorDocument";

export interface ResizeEdge {
  axis: keyof Vec3q;
  side: "min" | "max";
}

/** Pick the nearest visible edge, in Quake units, only when inside the box. */
export function pickResizeEdge(
  brush: BoxBrush,
  uAxis: keyof Vec3q,
  vAxis: keyof Vec3q,
  u: number,
  v: number,
  tolerance: number,
): ResizeEdge | null {
  if (u < brush.min[uAxis] || u > brush.max[uAxis] || v < brush.min[vAxis] || v > brush.max[vAxis]) return null;
  const edges: Array<{ distance: number; edge: ResizeEdge }> = [
    { distance: u - brush.min[uAxis], edge: { axis: uAxis, side: "min" } },
    { distance: brush.max[uAxis] - u, edge: { axis: uAxis, side: "max" } },
    { distance: v - brush.min[vAxis], edge: { axis: vAxis, side: "min" } },
    { distance: brush.max[vAxis] - v, edge: { axis: vAxis, side: "max" } },
  ];
  edges.sort((a, b) => a.distance - b.distance);
  return edges[0].distance <= tolerance ? edges[0].edge : null;
}

/** Returns a valid preview/commit candidate, clamping before brush inversion. */
export function resizeBox(brush: BoxBrush, edge: ResizeEdge, value: number, grid: number): BoxBrush {
  const result = structuredClone(brush);
  const axis = edge.axis;
  if (edge.side === "min") result.min[axis] = Math.min(value, result.max[axis] - grid);
  else result.max[axis] = Math.max(value, result.min[axis] + grid);
  return result;
}

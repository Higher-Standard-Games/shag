import type { BoxBrush, Vec3q } from "./EditorDocument";

/** One box axis being dragged, toward its min or max face. */
export interface ResizeFace {
  axis: keyof Vec3q;
  side: "min" | "max";
}

/** An edge (one face) or a corner (two faces, resized together). */
export interface ResizeEdge {
  faces: [ResizeFace] | [ResizeFace, ResizeFace];
}

/**
 * The nearest draggable edge or corner, in Quake units, only when inside the
 * box. A corner is returned when the point is within tolerance of both
 * visible axes at once, so a diagonal drag resizes both in one gesture.
 */
export function pickResizeEdge(
  brush: BoxBrush,
  uAxis: keyof Vec3q,
  vAxis: keyof Vec3q,
  u: number,
  v: number,
  tolerance: number,
): ResizeEdge | null {
  if (u < brush.min[uAxis] || u > brush.max[uAxis] || v < brush.min[vAxis] || v > brush.max[vAxis]) return null;
  const toMinU = u - brush.min[uAxis];
  const toMaxU = brush.max[uAxis] - u;
  const toMinV = v - brush.min[vAxis];
  const toMaxV = brush.max[vAxis] - v;
  const uFace: ResizeFace = { axis: uAxis, side: toMinU <= toMaxU ? "min" : "max" };
  const vFace: ResizeFace = { axis: vAxis, side: toMinV <= toMaxV ? "min" : "max" };
  const uDist = Math.min(toMinU, toMaxU);
  const vDist = Math.min(toMinV, toMaxV);
  const nearU = uDist <= tolerance;
  const nearV = vDist <= tolerance;
  if (nearU && nearV) return { faces: [uFace, vFace] };
  if (nearU && (!nearV || uDist <= vDist)) return { faces: [uFace] };
  if (nearV) return { faces: [vFace] };
  return null;
}

/**
 * A valid preview/commit candidate, clamping each dragged face before brush
 * inversion. `values` gives the pointer's current coordinate on every axis
 * that might be in `edge.faces`; an axis not being dragged is ignored.
 */
export function resizeBox(
  brush: BoxBrush,
  edge: ResizeEdge,
  values: Partial<Record<keyof Vec3q, number>>,
  grid: number,
): BoxBrush {
  const result = structuredClone(brush);
  for (const { axis, side } of edge.faces) {
    const value = values[axis];
    if (value === undefined) continue;
    if (side === "min") result.min[axis] = Math.min(value, result.max[axis] - grid);
    else result.max[axis] = Math.max(value, result.min[axis] + grid);
  }
  return result;
}

/** The CSS resize cursor for an edge (↔/↕) or a corner (↗↙/↖↘), in this pane's screen orientation. */
export function resizeCursor(edge: ResizeEdge, uAxis: keyof Vec3q): string {
  if (edge.faces.length === 1) return edge.faces[0].axis === uAxis ? "ew-resize" : "ns-resize";
  const [a, b] = edge.faces;
  // The v axis is flipped on screen (larger v draws higher), so matching sides is the "/" diagonal.
  return a.side === b.side ? "nesw-resize" : "nwse-resize";
}

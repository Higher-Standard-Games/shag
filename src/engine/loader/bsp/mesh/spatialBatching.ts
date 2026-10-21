import type { BspFace, BspFile } from "../BspLoader";

/** Avoid adding draws to already small texture/lightmap/patch batches. */
export const MIN_SPATIAL_BATCH_TRIANGLES = 1024;

/** 0 disables the experiment; positive values use 128-4096 map-unit cells. */
export function normalizeSpatialCellSize(size = 0): number {
  return Number.isFinite(size) && size > 0 ? Math.max(128, Math.min(4096, Math.round(size))) : 0;
}

/**
 * Assign a whole face to its source-bounds centre cell. Never clips/duplicates
 * triangles, so winding, tessellation and UV/lightmap seams stay unchanged.
 * A large face can extend outside its cell; this is a grouping key, not a bound.
 */
export function faceSpatialCell(bsp: BspFile, face: BspFace, cellSize: number): string | null {
  if (!cellSize || face.numVertices <= 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = face.firstVertex; i < face.firstVertex + face.numVertices; i++) {
    const position = bsp.vertices[i]?.position;
    if (!position?.every(Number.isFinite)) return null;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  }
  return min.map((value, axis) => Math.floor((value + max[axis]) / 2 / cellSize)).join(",");
}

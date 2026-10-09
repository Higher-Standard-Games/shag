import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Stream positions without changing a render-only effect's vertex layout.
 * Geometry.updateVerticesData also dirties shader attributes and discards VAOs;
 * a write into the same dynamic buffer needs neither. These effects have no
 * picking/collision consumers of Geometry's cached point array. Keep their mesh
 * and submesh bounds current for frustum culling.
 */
export function updateEffectPositions(mesh: Mesh, positions: Float32Array | number[]): void {
  const buffer = mesh.getVertexBuffer(VertexBuffer.PositionKind);
  if (!buffer?.isUpdatable() || positions.length !== mesh.getTotalVertices() * 3)
    throw new Error("Effect position updates require a fixed, updatable vertex layout");
  buffer.update(positions);
  mesh.refreshBoundingInfo();
}

/** Two equal, open ribbon paths with doubled sides; normals are unused by the unlit trail. */
export function updateUnlitTrailRibbon(mesh: Mesh, pathA: readonly Vector3[], pathB: readonly Vector3[]): void {
  const current = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!current || pathA.length !== pathB.length || current.length !== pathA.length * 12)
    throw new Error("Trail ribbon topology changed");
  const positions = current instanceof Float32Array ? current : new Float32Array(current);
  let offset = 0;
  for (let side = 0; side < 2; side++) {
    for (const path of [pathA, pathB]) {
      for (const point of path) {
        positions[offset++] = point.x;
        positions[offset++] = point.y;
        positions[offset++] = point.z;
      }
    }
  }
  updateEffectPositions(mesh, positions);
}

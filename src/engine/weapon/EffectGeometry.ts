import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Stream positions without changing a render-only effect's vertex layout.
 * Geometry.updateVerticesData also dirties shader attributes and discards VAOs;
 * a write into the same dynamic buffer needs neither. These effects have no
 * picking/collision consumers of Geometry's cached point array. Keep their mesh
 * and submesh bounds current for frustum culling.
 */
export function updateEffectPositions(
  mesh: Mesh,
  positions: Float32Array | number[],
  bounds?: { min: Vector3; max: Vector3 },
): void {
  const buffer = mesh.getVertexBuffer(VertexBuffer.PositionKind);
  if (!buffer?.isUpdatable() || positions.length !== mesh.getTotalVertices() * 3)
    throw new Error("Effect position updates require a fixed, updatable vertex layout");
  buffer.update(positions);
  // Known bounds spare reading the positions back: one submesh spanning the
  // whole mesh takes the mesh's bounds, as Babylon's own refresh does.
  const subMeshes = mesh.subMeshes;
  if (bounds && subMeshes?.length === 1 && subMeshes[0].IsGlobal)
    mesh.getBoundingInfo().reConstruct(bounds.min, bounds.max);
  else mesh.refreshBoundingInfo();
}

/** Each trail mesh's position array, rewritten in place every frame. */
const trailPositions = new WeakMap<Mesh, Float32Array>();
const trailBounds = { min: new Vector3(), max: new Vector3() };

/** Two equal, open ribbon paths with doubled sides; normals are unused by the unlit trail. */
export function updateUnlitTrailRibbon(mesh: Mesh, pathA: readonly Vector3[], pathB: readonly Vector3[]): void {
  const length = pathA.length * 12;
  if (pathA.length !== pathB.length || mesh.getTotalVertices() * 3 !== length)
    throw new Error("Trail ribbon topology changed");
  let positions = trailPositions.get(mesh);
  if (positions?.length !== length) {
    positions = new Float32Array(length);
    trailPositions.set(mesh, positions);
  }
  let offset = 0;
  for (let side = 0; side < 2; side++) {
    for (let p = 0; p < 2; p++) {
      const path = p === 0 ? pathA : pathB;
      for (let i = 0; i < path.length; i++) {
        const point = path[i];
        positions[offset++] = point.x;
        positions[offset++] = point.y;
        positions[offset++] = point.z;
      }
    }
  }
  // From the stored float32 values, as Babylon would read them back.
  const { min, max } = trailBounds;
  min.set(positions[0], positions[1], positions[2]);
  max.copyFrom(min);
  for (let i = 3; i < length / 2; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < min.x) min.x = x;
    else if (x > max.x) max.x = x;
    if (y < min.y) min.y = y;
    else if (y > max.y) max.y = y;
    if (z < min.z) min.z = z;
    else if (z > max.z) max.z = z;
  }
  updateEffectPositions(mesh, positions, trailBounds);
}

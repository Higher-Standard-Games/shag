import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { createAutosprite2Geometry } from "./autosprite2";
import type { BspMeshBuildResult } from "./types";

export type AutospriteRecord = NonNullable<BspMeshBuildResult["autospriteMeshes"]>[number];

interface AutospriteSource {
  positions: number[];
  center: [number, number, number];
  shaderProps: { autosprite2?: boolean };
}

/**
 * Billboard data for one autosprite face drawn by `mesh` from `vertexStart`.
 * `batchPositions` and `indices` are the mesh's own: an autosprite2 quad keeps
 * the vertex numbers it has in the shared buffer.
 */
export function autospriteRecord(
  sprite: AutospriteSource,
  mesh: Mesh,
  vertexStart: number,
  batchPositions: number[],
  indices: number[],
): AutospriteRecord {
  // Sprite dimensions from the authored quad's bounding box
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;
  const numVerts = sprite.positions.length / 3;
  for (let v = 0; v < numVerts; v++) {
    const x = sprite.positions[v * 3];
    const y = sprite.positions[v * 3 + 1];
    const z = sprite.positions[v * 3 + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  // A quad has two large extents and one near zero:
  // halfWidth is the horizontal extent, halfHeight the vertical one
  const extentX = (maxX - minX) / 2;
  const extentY = (maxY - minY) / 2;
  const extentZ = (maxZ - minZ) / 2;
  const halfWidth = Math.max(extentX, extentZ);
  const halfHeight = extentY > 0.01 ? extentY : Math.max(extentX, extentZ);

  // Vertex offsets from the centre, so triangulated sprites (not just four
  // corners) interpolate across the billboard
  const [cx, cy, cz] = sprite.center;
  const offsets: [number, number, number][] = [];
  for (let v = 0; v < numVerts; v++) {
    offsets.push([sprite.positions[v * 3] - cx, sprite.positions[v * 3 + 1] - cy, sprite.positions[v * 3 + 2] - cz]);
  }

  // The smallest extent is the sprite's normal axis
  let maxExtentX = 0,
    maxExtentY = 0,
    maxExtentZ = 0;
  for (const [ox, oy, oz] of offsets) {
    maxExtentX = Math.max(maxExtentX, Math.abs(ox));
    maxExtentY = Math.max(maxExtentY, Math.abs(oy));
    maxExtentZ = Math.max(maxExtentZ, Math.abs(oz));
  }

  // Each vertex as a fraction of the quad, -1 to 1 along right and up
  const vertexOffsets: [number, number][] = [];
  for (const [ox, oy, oz] of offsets) {
    let rightFrac: number, upFrac: number;
    if (maxExtentY < maxExtentX && maxExtentY < maxExtentZ) {
      // Horizontal sprite (XZ plane) - Y is normal
      rightFrac = maxExtentX > 0.001 ? ox / maxExtentX : 0;
      upFrac = maxExtentZ > 0.001 ? oz / maxExtentZ : 0;
    } else if (maxExtentX < maxExtentY && maxExtentX < maxExtentZ) {
      // YZ plane - X is normal
      rightFrac = maxExtentZ > 0.001 ? oz / maxExtentZ : 0;
      upFrac = maxExtentY > 0.001 ? oy / maxExtentY : 0;
    } else {
      // XY plane or default - Z is normal (most common for vertical sprites)
      rightFrac = maxExtentX > 0.001 ? ox / maxExtentX : 0;
      upFrac = maxExtentY > 0.001 ? oy / maxExtentY : 0;
    }
    vertexOffsets.push([rightFrac, upFrac]);
  }

  const isAutosprite2 = sprite.shaderProps.autosprite2 ?? false;
  return {
    mesh,
    center: sprite.center,
    halfWidth,
    halfHeight,
    isAutosprite2,
    axisGeometry: isAutosprite2 ? createAutosprite2Geometry(batchPositions, indices) : undefined,
    vertexOffsets,
    vertexStart,
  };
}

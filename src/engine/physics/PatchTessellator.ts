/**
 * PatchTessellator - Pure math bezier patch tessellation for collision
 *
 * Decoupled from BspMeshBuilder to avoid Babylon.js mesh dependencies.
 * Generates raw vertex positions and indices for physics.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BspFace, BspFile } from "../loader/bsp/BspLoader";

/**
 * Result of a patch tessellation
 */
export interface PatchCollisionMesh {
  vertices: Vector3[];
  indices: number[];
  mins: Vector3;
  maxs: Vector3;
}

/**
 * Tessellates bezier patches into collision meshes
 */
export class PatchTessellator {
  /**
   * Build collision mesh for a patch face
   * @param bsp The BSP file containing vertex data
   * @param face The patch face to tessellate
   * @param level Tessellation level (default 3 for collision - lower than visual)
   */
  public static buildPatch(bsp: BspFile, face: BspFace, level: number = 5): PatchCollisionMesh | null {
    const width = face.patchSize[0];
    const height = face.patchSize[1];

    if (width < 3 || height < 3) {
      return null;
    }

    // Get control points
    const controlPoints: [number, number, number][][] = [];
    for (let row = 0; row < height; row++) {
      const rowPoints: [number, number, number][] = [];
      for (let col = 0; col < width; col++) {
        const idx = face.firstVertex + row * width + col;
        const v = bsp.vertices[idx];
        // Convert Q3 (X, Y, Z) to Babylon (X, Z, Y)
        // Check BspLoader for vertex format, essentially: x=v.pos[0], y=v.pos[2], z=v.pos[1]
        // But we'll access raw array for speed
        if ("position" in v) {
          rowPoints.push([v.position[0], v.position[2], v.position[1]]);
        }
      }
      controlPoints.push(rowPoints);
    }

    const vertices: Vector3[] = [];
    const indices: number[] = [];
    const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    // Patches are 3x3 grids sharing edges
    const numPatchesX = Math.floor((width - 1) / 2);
    const numPatchesY = Math.floor((height - 1) / 2);

    let vertexIndex = 0;

    for (let py = 0; py < numPatchesY; py++) {
      for (let px = 0; px < numPatchesX; px++) {
        // Extract 3x3 control grid
        const ctrl: [number, number, number][][] = [];
        for (let j = 0; j < 3; j++) {
          const row: [number, number, number][] = [];
          for (let i = 0; i < 3; i++) {
            row.push(controlPoints[py * 2 + j][px * 2 + i]);
          }
          ctrl.push(row);
        }

        // Tessellate
        const startIdx = vertexIndex;
        for (let v = 0; v <= level; v++) {
          for (let u = 0; u <= level; u++) {
            const s = u / level;
            const t = v / level;

            const pos = PatchTessellator.evaluateBezier(ctrl, s, t);
            const vec = new Vector3(pos[0], pos[1], pos[2]);
            vertices.push(vec);

            // Update bounds
            min.x = Math.min(min.x, pos[0]);
            min.y = Math.min(min.y, pos[1]);
            min.z = Math.min(min.z, pos[2]);
            max.x = Math.max(max.x, pos[0]);
            max.y = Math.max(max.y, pos[1]);
            max.z = Math.max(max.z, pos[2]);

            vertexIndex++;
          }
        }

        // Generate triangles
        for (let v = 0; v < level; v++) {
          for (let u = 0; u < level; u++) {
            const i00 = startIdx + v * (level + 1) + u;
            const i10 = i00 + 1;
            const i01 = i00 + (level + 1);
            const i11 = i01 + 1;

            // Reverse winding (CCW -> CW) for Babylon
            indices.push(i00, i10, i01);
            indices.push(i10, i11, i01);
          }
        }
      }
    }

    return {
      vertices,
      indices,
      mins: min,
      maxs: max,
    };
  }

  private static evaluateBezier(ctrl: [number, number, number][][], s: number, t: number): [number, number, number] {
    // de Casteljau interpolation preserves constant coordinates and shared
    // endpoints exactly, avoiding tilted planes on otherwise flat caps.
    const quadratic = (a: number, b: number, c: number, u: number): number => {
      if (u === 0) return a;
      if (u === 1) return c;
      const ab = a + (b - a) * u;
      const bc = b + (c - b) * u;
      return ab + (bc - ab) * u;
    };
    const position: [number, number, number] = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      position[axis] = quadratic(
        quadratic(ctrl[0][0][axis], ctrl[0][1][axis], ctrl[0][2][axis], s),
        quadratic(ctrl[1][0][axis], ctrl[1][1][axis], ctrl[1][2][axis], s),
        quadratic(ctrl[2][0][axis], ctrl[2][1][axis], ctrl[2][2][axis], s),
        t,
      );
    }
    return position;
  }
}

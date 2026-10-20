import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../../core/DevLog";

export interface PatchControlPoint {
  position: Vector3;
  u: number;
  v: number;
}

export interface PatchDefinition {
  texture: string;
  width: number; // Number of control points in U direction
  height: number; // Number of control points in V direction
  controlPoints: PatchControlPoint[][];
}

/**
 * PatchGenerator handles Quake 3 / Warsow bezier patch surfaces.
 *
 * Patches are defined as a grid of control points that form bezier curves.
 * The grid dimensions are always (2n+1) x (2m+1) where n,m >= 1.
 *
 * Each 3x3 sub-grid forms a biquadratic bezier patch.
 */
export class PatchGenerator {
  // Tessellation level - higher = smoother curves, more triangles
  private static tessellation = 4;

  /**
   * Set the tessellation level for patch generation
   */
  static setTessellation(level: number): void {
    PatchGenerator.tessellation = Math.max(1, Math.min(16, level));
  }

  /**
   * Build a mesh from a patch definition
   */
  static buildMesh(patch: PatchDefinition, scene: Scene): Mesh | null {
    devLog("Building patch mesh:", patch.width, "x", patch.height, "control points:", patch.controlPoints.length);

    if (patch.width < 3 || patch.height < 3) {
      console.warn("Patch too small:", patch.width, "x", patch.height);
      return null;
    }

    // Validate dimensions (must be 2n+1)
    if ((patch.width - 1) % 2 !== 0 || (patch.height - 1) % 2 !== 0) {
      console.warn("Invalid patch dimensions:", patch.width, "x", patch.height);
      return null;
    }

    // Validate control points array
    if (patch.controlPoints.length !== patch.height) {
      console.warn("Control points height mismatch:", patch.controlPoints.length, "vs", patch.height);
      return null;
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Control points are stored as rows (height) x columns (width)
    const numRows = patch.controlPoints.length;
    const numCols = patch.controlPoints[0]?.length || 0;

    // Number of 3x3 bezier sub-patches in each direction
    const subPatchesX = (numCols - 1) / 2;
    const subPatchesY = (numRows - 1) / 2;

    // Total tessellated vertices across entire surface
    const totalStepsX = subPatchesX * PatchGenerator.tessellation;
    const totalStepsY = subPatchesY * PatchGenerator.tessellation;

    // Generate all vertices in one unified grid
    for (let gy = 0; gy <= totalStepsY; gy++) {
      for (let gx = 0; gx <= totalStepsX; gx++) {
        // Map global grid position to sub-patch and local parameter
        const globalU = gx / totalStepsX;
        const globalV = gy / totalStepsY;

        // Which sub-patch are we in?
        const subPatchX = Math.min(Math.floor(globalU * subPatchesX), subPatchesX - 1);
        const subPatchY = Math.min(Math.floor(globalV * subPatchesY), subPatchesY - 1);

        // Local parameter within the sub-patch (0 to 1)
        const localU = globalU * subPatchesX - subPatchX;
        const localV = globalV * subPatchesY - subPatchY;

        // Extract 3x3 control points for this sub-patch
        const controls: PatchControlPoint[][] = [];
        for (let j = 0; j < 3; j++) {
          controls[j] = [];
          for (let i = 0; i < 3; i++) {
            const row = subPatchY * 2 + j;
            const col = subPatchX * 2 + i;
            controls[j][i] = patch.controlPoints[row][col];
          }
        }

        // Evaluate bezier surface at local (u, v)
        const position = PatchGenerator.evaluateBezierSurface(controls, localU, localV);
        const normal = PatchGenerator.calculateBezierNormal(controls, localU, localV);
        const uv = PatchGenerator.interpolateUV(controls, localU, localV);

        positions.push(position.x, position.y, position.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(uv.u, uv.v);
      }
    }

    // Generate triangle indices
    const gridWidth = totalStepsX + 1;
    for (let gy = 0; gy < totalStepsY; gy++) {
      for (let gx = 0; gx < totalStepsX; gx++) {
        const topLeft = gy * gridWidth + gx;
        const topRight = topLeft + 1;
        const bottomLeft = (gy + 1) * gridWidth + gx;
        const bottomRight = bottomLeft + 1;

        // Two triangles per quad
        indices.push(topLeft, topRight, bottomLeft);
        indices.push(bottomLeft, topRight, bottomRight);
      }
    }

    if (positions.length === 0) {
      return null;
    }

    devLog(`Patch vertices: ${positions.length / 3}, triangles: ${indices.length / 3}`);

    const mesh = new Mesh("patch", scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    vertexData.indices = indices;

    vertexData.applyToMesh(mesh);

    // Ensure double-sided rendering
    mesh.sideOrientation = Mesh.DOUBLESIDE;

    return mesh;
  }

  /**
   * Evaluate a biquadratic bezier surface at parameter (u, v)
   */
  private static evaluateBezierSurface(controls: PatchControlPoint[][], u: number, v: number): Vector3 {
    // Bezier basis functions for quadratic (degree 2)
    const bu = PatchGenerator.bezierBasis(u);
    const bv = PatchGenerator.bezierBasis(v);

    const result = Vector3.Zero();

    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const weight = bu[i] * bv[j];
        result.addInPlace(controls[j][i].position.scale(weight));
      }
    }

    return result;
  }

  /**
   * Calculate surface normal at parameter (u, v) using partial derivatives
   */
  private static calculateBezierNormal(controls: PatchControlPoint[][], u: number, v: number): Vector3 {
    const epsilon = 0.001;

    // Clamp to avoid going out of bounds
    const u0 = Math.max(0, u - epsilon);
    const u1 = Math.min(1, u + epsilon);
    const v0 = Math.max(0, v - epsilon);
    const v1 = Math.min(1, v + epsilon);

    // Partial derivative in U direction
    const pu0 = PatchGenerator.evaluateBezierSurface(controls, u0, v);
    const pu1 = PatchGenerator.evaluateBezierSurface(controls, u1, v);
    const dPdu = pu1.subtract(pu0);

    // Partial derivative in V direction
    const pv0 = PatchGenerator.evaluateBezierSurface(controls, u, v0);
    const pv1 = PatchGenerator.evaluateBezierSurface(controls, u, v1);
    const dPdv = pv1.subtract(pv0);

    // Normal is cross product of partial derivatives (order determines direction)
    const normal = Vector3.Cross(dPdv, dPdu);

    if (normal.lengthSquared() < 0.0001) {
      return Vector3.Up(); // Fallback for degenerate cases
    }

    return normal.normalize();
  }

  /**
   * Interpolate UV coordinates from control points
   */
  private static interpolateUV(controls: PatchControlPoint[][], u: number, v: number): { u: number; v: number } {
    const bu = PatchGenerator.bezierBasis(u);
    const bv = PatchGenerator.bezierBasis(v);

    let resultU = 0;
    let resultV = 0;

    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const weight = bu[i] * bv[j];
        resultU += controls[j][i].u * weight;
        resultV += controls[j][i].v * weight;
      }
    }

    return { u: resultU, v: resultV };
  }

  /**
   * Quadratic bezier basis functions
   * B0(t) = (1-t)^2
   * B1(t) = 2t(1-t)
   * B2(t) = t^2
   */
  private static bezierBasis(t: number): [number, number, number] {
    const mt = 1 - t;
    return [
      mt * mt, // B0
      2 * t * mt, // B1
      t * t, // B2
    ];
  }
}

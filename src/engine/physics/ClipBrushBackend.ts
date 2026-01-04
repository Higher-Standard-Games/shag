/**
 * ClipBrushBackend - Generates collision brushes from floor-facing BSP faces
 * 
 * This backend analyzes BSP faces to find upward-facing surfaces (floors)
 * and generates simple collision planes from them.
 */

import { Vector3, Scene } from '@babylonjs/core';
import type { BspFile, BspFace } from '../loader/bsp/BspLoader';
import {
  CollisionBackend,
  CollisionBackendType,
  TraceResult,
  TraceOptions,
  CollisionStats,
  createDefaultTraceResult,
  Contents,
} from './CollisionBackend';

/**
 * Generated floor plane for collision
 */
interface FloorPlane {
  /** Plane normal (always roughly upward) */
  normal: Vector3;
  /** Distance from origin */
  distance: number;
  /** Bounding box min (XY only) */
  minBounds: Vector3;
  /** Bounding box max (XY only) */
  maxBounds: Vector3;
  /** Original face index */
  faceIndex: number;
}

const FLOOR_NORMAL_THRESHOLD = 0.7; // cos(45°) - surfaces more than 45° from vertical
const DIST_EPSILON = 0.03125;

export class ClipBrushBackend implements CollisionBackend {
  readonly type: CollisionBackendType = 'clipbrush';
  readonly name = 'Clip Brush (Generated Floors)';

  private bsp: BspFile | null = null;
  private floorPlanes: FloorPlane[] = [];
  private stats: CollisionStats = {
    traceCount: 0,
    hitCount: 0,
    avgTraceTimeMs: 0,
    backendStats: { floorPlanes: 0 },
  };

  async init(bsp: BspFile, _scene?: Scene): Promise<void> {
    this.bsp = bsp;
    this.floorPlanes = [];

    // Generate floor planes from upward-facing faces
    // Include all face types: 1=polygon, 2=patch, 3=mesh
    for (let fi = 0; fi < bsp.faces.length; fi++) {
      const face = bsp.faces[fi];
      
      // Skip billboards (type 4)
      if (face.faceType === 4) continue;
      
      // Get face vertices to compute normal and bounds
      const floorPlane = this.extractFloorPlane(face, fi);
      if (floorPlane) {
        this.floorPlanes.push(floorPlane);
      }
    }

    this.stats.backendStats.floorPlanes = this.floorPlanes.length;
    console.log(`[ClipBrushBackend] Generated ${this.floorPlanes.length} floor planes from ${bsp.faces.length} faces`);
    
    // Log some sample floor planes for debugging
    if (this.floorPlanes.length > 0) {
      const sample = this.floorPlanes.slice(0, 3);
      for (const p of sample) {
        console.log(`[ClipBrushBackend] Sample floor: normal=(${p.normal.x.toFixed(2)}, ${p.normal.y.toFixed(2)}, ${p.normal.z.toFixed(2)}) dist=${p.distance.toFixed(1)} bounds X[${p.minBounds.x.toFixed(0)},${p.maxBounds.x.toFixed(0)}] Y[${p.minBounds.y.toFixed(0)},${p.maxBounds.y.toFixed(0)}]`);
      }
    }
  }

  private extractFloorPlane(face: BspFace, faceIndex: number): FloorPlane | null {
    if (!this.bsp) return null;

    // Get vertices for this face
    const vertices: Vector3[] = [];
    for (let i = 0; i < face.numVertices; i++) {
      const v = this.bsp.vertices[face.firstVertex + i];
      // BSP stores Q3 coords, keep as-is for collision
      vertices.push(new Vector3(v.position[0], v.position[1], v.position[2]));
    }

    if (vertices.length < 3) return null;

    // Compute face normal from first 3 vertices
    const v0 = vertices[0];
    const v1 = vertices[1];
    const v2 = vertices[2];
    
    const edge1 = v1.subtract(v0);
    const edge2 = v2.subtract(v0);
    let normal = Vector3.Cross(edge1, edge2).normalize();

    // Check if this is a floor (normal pointing up in Q3 coords = +Z)
    // Also check for inverted normals (winding order may vary)
    if (Math.abs(normal.z) < FLOOR_NORMAL_THRESHOLD) return null;
    
    // Flip if pointing down
    if (normal.z < 0) {
      normal = normal.scale(-1);
    }

    // Compute plane distance (dot of normal with any vertex)
    const distance = Vector3.Dot(normal, v0);

    // Compute XY bounding box
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }

    return {
      normal,
      distance,
      minBounds: new Vector3(minX, minY, -Infinity),
      maxBounds: new Vector3(maxX, maxY, Infinity),
      faceIndex,
    };
  }

  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult {
    const startTime = performance.now();
    this.stats.traceCount++;

    const result = createDefaultTraceResult(start, end);
    const debug = options?.debug ?? false;

    // Convert Babylon coords to Q3 for plane testing
    // Babylon: Y-up, Q3: Z-up
    // Babylon (x, y, z) -> Q3 (x, z, y)
    const q3Start = new Vector3(start.x, start.z, start.y);
    const q3End = new Vector3(end.x, end.z, end.y);

    if (debug) {
      console.log(`[ClipBrush] Trace: Babylon(${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)}) → Q3(${q3Start.x.toFixed(1)}, ${q3Start.y.toFixed(1)}, ${q3Start.z.toFixed(1)})`);
    }

    let closestFrac = 1.0;
    let hitPlane: FloorPlane | null = null;

    // Test against all floor planes
    for (const plane of this.floorPlanes) {
      // Quick XY bounds check
      const traceX = q3Start.x;
      const traceY = q3Start.y;
      
      if (traceX < plane.minBounds.x || traceX > plane.maxBounds.x) continue;
      if (traceY < plane.minBounds.y || traceY > plane.maxBounds.y) continue;

      // Compute distances to plane
      const startDist = Vector3.Dot(q3Start, plane.normal) - plane.distance;
      const endDist = Vector3.Dot(q3End, plane.normal) - plane.distance;

      // Both on same side = no intersection
      if (startDist > 0 && endDist > 0) continue;
      if (startDist < 0 && endDist < 0) continue;

      // Calculate intersection fraction
      if (startDist > endDist) {
        // Entering the solid (floor)
        const frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        if (frac > 0 && frac < closestFrac) {
          closestFrac = frac;
          hitPlane = plane;
        }
      }
    }

    if (hitPlane) {
      result.fraction = Math.max(0, closestFrac);
      // Convert hit normal back to Babylon coords: Q3 (x, y, z) -> Babylon (x, z, y)
      result.normal = new Vector3(hitPlane.normal.x, hitPlane.normal.z, hitPlane.normal.y);
      result.contents = Contents.SOLID;
      
      // Calculate end position in Babylon coords
      const dir = end.subtract(start);
      result.endPos = start.add(dir.scale(result.fraction));
      
      this.stats.hitCount++;

      if (debug) {
        console.log(`[ClipBrush] HIT floor at fraction ${result.fraction.toFixed(4)}, face ${hitPlane.faceIndex}`);
      }
    }

    const elapsed = performance.now() - startTime;
    this.stats.avgTraceTimeMs = (this.stats.avgTraceTimeMs * (this.stats.traceCount - 1) + elapsed) / this.stats.traceCount;

    return result;
  }

  pointContents(point: Vector3): number {
    // Convert to Q3 coords
    const q3Point = new Vector3(point.x, point.z, point.y);

    // Check if point is below any floor plane within its bounds
    for (const plane of this.floorPlanes) {
      if (q3Point.x < plane.minBounds.x || q3Point.x > plane.maxBounds.x) continue;
      if (q3Point.y < plane.minBounds.y || q3Point.y > plane.maxBounds.y) continue;

      const dist = Vector3.Dot(q3Point, plane.normal) - plane.distance;
      if (dist < 0) {
        return Contents.SOLID;
      }
    }

    return 0;
  }

  isOnGround(point: Vector3, options?: TraceOptions): boolean {
    const groundCheck = this.trace(
      point,
      point.add(new Vector3(0, -2, 0)), // Check 2 units below
      options
    );
    return groundCheck.fraction < 1.0;
  }

  findGround(point: Vector3, maxDistance = 500): { position: Vector3; normal: Vector3 } | null {
    const result = this.trace(
      point,
      point.add(new Vector3(0, -maxDistance, 0))
    );

    if (result.fraction < 1.0 && result.normal) {
      return {
        position: result.endPos,
        normal: result.normal,
      };
    }

    return null;
  }

  getStats(): CollisionStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.floorPlanes = [];
    this.bsp = null;
  }
}

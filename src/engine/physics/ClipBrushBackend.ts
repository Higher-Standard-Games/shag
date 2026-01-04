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
 * Generated collision plane from a face
 */
interface CollisionPlane {
  /** Plane normal */
  normal: Vector3;
  /** Distance from origin (plane equation: dot(normal, point) = distance) */
  distance: number;
  /** Bounding box min */
  minBounds: Vector3;
  /** Bounding box max */
  maxBounds: Vector3;
  /** Original face index */
  faceIndex: number;
  /** Type: floor, wall, ceiling */
  type: 'floor' | 'wall' | 'ceiling';
}

const FLOOR_NORMAL_THRESHOLD = 0.7; // cos(45°) - surfaces more than 45° from vertical
const DIST_EPSILON = 0.03125;

export class ClipBrushBackend implements CollisionBackend {
  readonly type: CollisionBackendType = 'clipbrush';
  readonly name = 'Clip Brush (All Surfaces)';

  private bsp: BspFile | null = null;
  private collisionPlanes: CollisionPlane[] = [];
  private stats: CollisionStats = {
    traceCount: 0,
    hitCount: 0,
    avgTraceTimeMs: 0,
    backendStats: { collisionPlanes: 0, floors: 0, walls: 0, ceilings: 0 },
  };

  async init(bsp: BspFile, _scene?: Scene): Promise<void> {
    this.bsp = bsp;
    this.collisionPlanes = [];

    let floors = 0, walls = 0, ceilings = 0;

    // Generate collision planes from ALL faces (floors, walls, ceilings)
    // Include all face types: 1=polygon, 2=patch, 3=mesh
    for (let fi = 0; fi < bsp.faces.length; fi++) {
      const face = bsp.faces[fi];
      
      // Skip billboards (type 4)
      if (face.faceType === 4) continue;
      
      // Get face vertices to compute normal and bounds
      const plane = this.extractCollisionPlane(face, fi);
      if (plane) {
        this.collisionPlanes.push(plane);
        if (plane.type === 'floor') floors++;
        else if (plane.type === 'wall') walls++;
        else ceilings++;
      }
    }

    this.stats.backendStats.collisionPlanes = this.collisionPlanes.length;
    this.stats.backendStats.floors = floors;
    this.stats.backendStats.walls = walls;
    this.stats.backendStats.ceilings = ceilings;
    console.log(`[ClipBrushBackend] Generated ${this.collisionPlanes.length} collision planes (${floors} floors, ${walls} walls, ${ceilings} ceilings) from ${bsp.faces.length} faces`);
  }

  private extractCollisionPlane(face: BspFace, faceIndex: number): CollisionPlane | null {
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

    // Skip degenerate faces
    if (normal.length() < 0.5) return null;

    // Determine surface type based on normal direction in Q3 coords (Z-up)
    // For collision, we want all normals pointing "outward" (toward empty space)
    let surfaceType: 'floor' | 'wall' | 'ceiling';
    if (Math.abs(normal.z) > FLOOR_NORMAL_THRESHOLD) {
      // Vertical-ish surface (floor or ceiling)
      if (normal.z < 0) {
        // Normal points down - flip to point up for consistent collision
        normal = normal.scale(-1);
        surfaceType = 'ceiling';
      } else {
        surfaceType = 'floor';
      }
    } else {
      surfaceType = 'wall';
    }

    // Compute plane distance (dot of normal with any vertex)
    const distance = Vector3.Dot(normal, v0);

    // Compute 3D bounding box for quick rejection
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      minZ = Math.min(minZ, v.z);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
      maxZ = Math.max(maxZ, v.z);
    }

    return {
      normal,
      distance,
      minBounds: new Vector3(minX, minY, minZ),
      maxBounds: new Vector3(maxX, maxY, maxZ),
      faceIndex,
      type: surfaceType,
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
    let hitPlane: CollisionPlane | null = null;
    let debugBoundsSkip = 0;
    let debugDistSkip = 0;
    let debugPlanesChecked = 0;

    // Test against all collision planes
    for (const plane of this.collisionPlanes) {
      // Quick 3D bounds check - does trace potentially intersect this plane's bounds?
      const traceMinX = Math.min(q3Start.x, q3End.x);
      const traceMaxX = Math.max(q3Start.x, q3End.x);
      const traceMinY = Math.min(q3Start.y, q3End.y);
      const traceMaxY = Math.max(q3Start.y, q3End.y);
      const traceMinZ = Math.min(q3Start.z, q3End.z);
      const traceMaxZ = Math.max(q3Start.z, q3End.z);
      
      // Skip if trace bounds don't overlap plane bounds
      if (traceMaxX < plane.minBounds.x || traceMinX > plane.maxBounds.x) { debugBoundsSkip++; continue; }
      if (traceMaxY < plane.minBounds.y || traceMinY > plane.maxBounds.y) { debugBoundsSkip++; continue; }
      if (traceMaxZ < plane.minBounds.z || traceMinZ > plane.maxBounds.z) { debugBoundsSkip++; continue; }

      debugPlanesChecked++;

      // Compute distances to plane
      const startDist = Vector3.Dot(q3Start, plane.normal) - plane.distance;
      const endDist = Vector3.Dot(q3End, plane.normal) - plane.distance;

      // Only collide if:
      // 1. Start is in FRONT of plane (positive distance) - we're outside the surface
      // 2. End is BEHIND plane (negative distance) - we're moving into the surface
      // This prevents false positives when camera is already behind a plane
      if (startDist <= DIST_EPSILON) { debugDistSkip++; continue; }  // Already behind or on plane
      if (endDist >= -DIST_EPSILON) { debugDistSkip++; continue; }   // Not crossing into solid

      // Calculate intersection fraction (0 = start, 1 = end)
      const frac = startDist / (startDist - endDist);
      if (frac > 0 && frac < closestFrac) {
        closestFrac = frac;
        hitPlane = plane;
      }
    }
    
    if (debug) {
      console.log(`[ClipBrush] Checked ${debugPlanesChecked} planes (${debugBoundsSkip} bounds skip, ${debugDistSkip} dist skip)`);
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
        console.log(`[ClipBrush] HIT ${hitPlane.type} at fraction ${result.fraction.toFixed(4)}, face ${hitPlane.faceIndex}`);
      }
    }

    const elapsed = performance.now() - startTime;
    this.stats.avgTraceTimeMs = (this.stats.avgTraceTimeMs * (this.stats.traceCount - 1) + elapsed) / this.stats.traceCount;

    return result;
  }

  pointContents(point: Vector3): number {
    // Convert to Q3 coords
    const q3Point = new Vector3(point.x, point.z, point.y);

    // Check if point is inside any collision plane
    for (const plane of this.collisionPlanes) {
      if (q3Point.x < plane.minBounds.x || q3Point.x > plane.maxBounds.x) continue;
      if (q3Point.y < plane.minBounds.y || q3Point.y > plane.maxBounds.y) continue;
      if (q3Point.z < plane.minBounds.z || q3Point.z > plane.maxBounds.z) continue;

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
    this.collisionPlanes = [];
    this.bsp = null;
  }
}

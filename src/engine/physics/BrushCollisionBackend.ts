/**
 * BrushCollisionBackend - Uses BSP brush data for proper Q3-style collision
 * 
 * BSP brushes are convex volumes defined by planes. A point is inside a brush
 * if it's on the negative (back) side of ALL planes defining that brush.
 * 
 * This is the same approach used by Quake 3 and Warsow for collision detection.
 */

import { Vector3 } from '@babylonjs/core';
import type { BspFile } from '../loader/bsp/BspLoader';
import {
  CollisionBackend,
  CollisionBackendType,
  TraceResult,
  TraceOptions,
  CollisionStats,
  createDefaultTraceResult,
  Contents,
} from './CollisionBackend';

const DIST_EPSILON = 0.03125;

interface CollisionBrush {
  planes: { normal: Vector3; dist: number }[];
  shaderIndex: number;
  brushIndex: number;
}

export class BrushCollisionBackend implements CollisionBackend {
  readonly type: CollisionBackendType = 'brush';
  readonly name = 'Brush Collision (Q3-style)';

  private _bsp: BspFile | null = null;
  private brushes: CollisionBrush[] = [];
  private stats: CollisionStats = {
    traceCount: 0,
    hitCount: 0,
    avgTraceTimeMs: 0,
    backendStats: { brushCount: 0 },
  };

  async init(bsp: BspFile): Promise<void> {
    this._bsp = bsp;
    this.brushes = [];

    // Build collision brushes from BSP data
    for (let bi = 0; bi < bsp.brushes.length; bi++) {
      const brush = bsp.brushes[bi];
      
      // Check if brush shader is solid (contentFlags check could go here)
      // For now, include all brushes
      
      const collisionBrush: CollisionBrush = {
        planes: [],
        shaderIndex: brush.shaderIndex,
        brushIndex: bi,
      };

      // Get all planes for this brush
      for (let si = 0; si < brush.numSides; si++) {
        const sideIndex = brush.firstSide + si;
        if (sideIndex >= bsp.brushSides.length) continue;
        
        const side = bsp.brushSides[sideIndex];
        if (side.planeIndex >= bsp.planes.length) continue;
        
        const plane = bsp.planes[side.planeIndex];
        collisionBrush.planes.push({
          normal: new Vector3(plane.normal[0], plane.normal[1], plane.normal[2]),
          dist: plane.dist,
        });
      }

      if (collisionBrush.planes.length >= 4) {
        this.brushes.push(collisionBrush);
      }
    }

    this.stats.backendStats.brushCount = this.brushes.length;
    console.log(`[BrushCollisionBackend] Loaded ${this.brushes.length} collision brushes from ${bsp.brushes.length} BSP brushes`);
  }

  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult {
    const startTime = performance.now();
    this.stats.traceCount++;

    const result = createDefaultTraceResult(start, end);
    const debug = options?.debug ?? false;

    // Convert Babylon coords to Q3: Babylon (x, y, z) -> Q3 (x, z, y)
    const q3Start = new Vector3(start.x, start.z, start.y);
    const q3End = new Vector3(end.x, end.z, end.y);

    if (debug) {
      console.log(`[BrushCollision] Trace: Babylon(${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)}) → Q3(${q3Start.x.toFixed(1)}, ${q3Start.y.toFixed(1)}, ${q3Start.z.toFixed(1)})`);
    }

    let outputFraction = 1.0;
    let hitNormal: Vector3 | null = null;

    // Test trace against each brush
    for (const brush of this.brushes) {
      const brushResult = this.traceThroughBrush(brush, q3Start, q3End);
      
      if (brushResult.fraction < outputFraction) {
        outputFraction = brushResult.fraction;
        hitNormal = brushResult.normal;
      }
    }

    if (outputFraction < 1.0 && hitNormal) {
      result.fraction = outputFraction;
      // Convert normal back to Babylon: Q3 (x, y, z) -> Babylon (x, z, y)
      result.normal = new Vector3(hitNormal.x, hitNormal.z, hitNormal.y);
      result.contents = Contents.SOLID;
      
      const dir = end.subtract(start);
      result.endPos = start.add(dir.scale(result.fraction));
      
      this.stats.hitCount++;

      if (debug) {
        console.log(`[BrushCollision] HIT at fraction ${result.fraction.toFixed(4)}`);
      }
    }

    const elapsed = performance.now() - startTime;
    this.stats.avgTraceTimeMs = (this.stats.avgTraceTimeMs * (this.stats.traceCount - 1) + elapsed) / this.stats.traceCount;

    return result;
  }

  /**
   * Trace through a single brush - Q3-style brush intersection
   */
  private traceThroughBrush(
    brush: CollisionBrush,
    start: Vector3,
    end: Vector3
  ): { fraction: number; normal: Vector3 | null } {
    let enterFrac = -1.0;
    let leaveFrac = 1.0;
    let clipNormal: Vector3 | null = null;
    let startOut = false;
    let _getOut = false;

    for (const plane of brush.planes) {
      const startDist = Vector3.Dot(start, plane.normal) - plane.dist;
      const endDist = Vector3.Dot(end, plane.normal) - plane.dist;

      if (startDist > 0) startOut = true;
      if (endDist > 0) _getOut = true;

      // Both in front of plane - not inside brush
      if (startDist > 0 && endDist >= startDist) {
        return { fraction: 1.0, normal: null };
      }

      // Both behind plane - check next plane
      if (startDist <= 0 && endDist <= 0) {
        continue;
      }

      // Crossing the plane
      if (startDist > endDist) {
        // Entering the brush
        const frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        if (frac > enterFrac) {
          enterFrac = frac;
          clipNormal = plane.normal;
        }
      } else {
        // Leaving the brush
        const frac = (startDist + DIST_EPSILON) / (startDist - endDist);
        if (frac < leaveFrac) {
          leaveFrac = frac;
        }
      }
    }

    // Started outside brush
    if (!startOut) {
      // Started inside - no collision
      return { fraction: 1.0, normal: null };
    }

    if (enterFrac < leaveFrac) {
      if (enterFrac > -1 && enterFrac < 1.0) {
        if (enterFrac < 0) enterFrac = 0;
        return { fraction: enterFrac, normal: clipNormal };
      }
    }

    return { fraction: 1.0, normal: null };
  }

  pointContents(point: Vector3): number {
    // Convert to Q3 coords
    const q3Point = new Vector3(point.x, point.z, point.y);

    for (const brush of this.brushes) {
      let inside = true;
      
      for (const plane of brush.planes) {
        const dist = Vector3.Dot(q3Point, plane.normal) - plane.dist;
        if (dist > 0) {
          inside = false;
          break;
        }
      }
      
      if (inside) {
        return Contents.SOLID;
      }
    }

    return 0;
  }

  isOnGround(point: Vector3): boolean {
    const groundTrace = this.trace(point, point.add(new Vector3(0, -1, 0)));
    return groundTrace.fraction < 1.0 && !!groundTrace.normal && groundTrace.normal.y > 0.7;
  }

  findGround(point: Vector3, maxDistance = 1000): { position: Vector3; normal: Vector3 } | null {
    const groundTrace = this.trace(point, point.add(new Vector3(0, -maxDistance, 0)));
    if (groundTrace.fraction < 1.0 && groundTrace.normal) {
      return { position: groundTrace.endPos, normal: groundTrace.normal };
    }
    return null;
  }

  getStats(): CollisionStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.brushes = [];
    this._bsp = null;
  }
}

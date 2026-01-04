/**
 * BrushCollisionBackend - Uses existing BspCollision for proper Q3-style collision
 * 
 * Wraps the BspCollision class which uses BSP tree traversal and
 * filters brushes by content flags (only solid brushes).
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
import { BspCollision } from './BspCollision';

export class BrushCollisionBackend implements CollisionBackend {
  readonly type: CollisionBackendType = 'brush';
  readonly name = 'BSP Brush Collision (Q3-style)';

  private bspCollision: BspCollision | null = null;
  private stats: CollisionStats = {
    traceCount: 0,
    hitCount: 0,
    avgTraceTimeMs: 0,
    backendStats: { brushCount: 0, solidBrushCount: 0 },
  };

  async init(bsp: BspFile): Promise<void> {
    this.bspCollision = new BspCollision(bsp);
    
    // Count solid brushes for stats
    let solidCount = 0;
    for (const brush of bsp.brushes) {
      const texture = bsp.textures[brush.shaderIndex];
      if (texture) {
        // Check if solid (simplified check)
        const contentFlags = texture.contentFlags;
        const isSolid = (contentFlags & 0x1) !== 0;  // SOLID flag
        const isDetail = (contentFlags & 0x8000000) !== 0;  // DETAIL flag
        if (isSolid && !isDetail) {
          solidCount++;
        }
      }
    }
    
    this.stats.backendStats.brushCount = bsp.brushes.length;
    this.stats.backendStats.solidBrushCount = solidCount;
    console.log(`[BrushCollisionBackend] Initialized with ${solidCount} solid brushes (${bsp.brushes.length} total)`);
  }

  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult {
    const startTime = performance.now();
    this.stats.traceCount++;

    const result = createDefaultTraceResult(start, end);
    
    if (!this.bspCollision) {
      return result;
    }

    const debug = options?.debug ?? false;
    // Cast to any to handle babylonjs vs @babylonjs/core type mismatch
    const bspResult = this.bspCollision.tracePoint(start as never, end as never, debug);

    result.fraction = bspResult.fraction;
    result.endPos = bspResult.endPos as unknown as Vector3;
    result.startSolid = bspResult.startSolid;
    result.allSolid = bspResult.allSolid;
    result.contents = bspResult.contents;

    // Convert plane normal to Vector3 if we hit something
    if (bspResult.plane && bspResult.fraction < 1.0) {
      // BspCollision already handles coordinate conversion, plane is in Q3 coords
      // Convert to Babylon: Q3 (x, y, z) -> Babylon (x, z, y)
      result.normal = new Vector3(
        bspResult.plane.normal[0],
        bspResult.plane.normal[2],
        bspResult.plane.normal[1]
      );
      result.contents = Contents.SOLID;
      this.stats.hitCount++;
    }

    const elapsed = performance.now() - startTime;
    this.stats.avgTraceTimeMs = (this.stats.avgTraceTimeMs * (this.stats.traceCount - 1) + elapsed) / this.stats.traceCount;

    return result;
  }

  pointContents(point: Vector3): number {
    if (!this.bspCollision) return 0;
    return this.bspCollision.pointContents(point as never);
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
    this.bspCollision = null;
  }
}

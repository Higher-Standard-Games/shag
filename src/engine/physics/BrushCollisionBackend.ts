/**
 * BrushCollisionBackend - Uses existing BspCollision for proper Q3-style collision
 * 
 * Wraps the BspCollision class which uses BSP tree traversal and
 * filters brushes by content flags (only solid brushes).
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
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
    const radius = options?.radius ?? 0;
    const height = options?.height ?? 0;
    const contentsMask = options?.contentMask ?? (Contents.SOLID | Contents.PLAYERCLIP);
    const clipTexturesOnly = options?.clipTexturesOnly ?? false;
    const nodrawSolidsOnly = options?.nodrawSolidsOnly ?? false;

    // Quake3-style player hull is not centered on origin:
    // mins.z = -24, maxs.z = 32 (total height 56)
    // We scale this proportionally if a different height is provided.
    const h = height > 0 ? height : 56;
    const minsY = -(h * (24 / 56));
    const maxY = h + minsY;

    // Cast to any to handle babylonjs vs @babylonjs/core type mismatch
    const bspResult = (radius > 0 || height > 0)
      ? this.bspCollision.traceBox(
        start as never,
        end as never,
        new Vector3(-radius, minsY, -radius) as never,
        new Vector3(radius, maxY, radius) as never,
        debug,
        contentsMask,
        clipTexturesOnly,
        nodrawSolidsOnly
      )
      : this.bspCollision.tracePoint(start as never, end as never, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);

    result.fraction = bspResult.fraction;
    result.endPos = bspResult.endPos as unknown as Vector3;
    result.startSolid = bspResult.startSolid;
    result.allSolid = bspResult.allSolid;
    result.contents = bspResult.contents;
    result.hitBrushIndex = (bspResult as any).hitBrushIndex;
    result.hitTextureName = (bspResult as any).hitTextureName;

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

  /**
   * Generic slide move implementation
   */
  slideMove(
    startPos: Vector3,
    velocity: Vector3,
    options?: TraceOptions
  ): { endPos: Vector3; velocity: Vector3; hitCount: number } {
    const planes: Vector3[] = [];
    let numPlanes = 0;
    let currentPos = startPos.clone();
    let currentVel = velocity.clone();
    let timeLeft = 1.0;
    let hitCount = 0;

    for (let bump = 0; bump < 4; bump++) {
      if (currentVel.lengthSquared() < 0.0001) break;

      const endPos = currentPos.add(currentVel.scale(timeLeft));
      const trace = this.trace(currentPos, endPos, options);

      if (trace.allSolid) {
        currentVel.y = 0; // Stuck, try to slide horizontally
        return { endPos: currentPos, velocity: currentVel, hitCount };
      }

      if (trace.fraction > 0) {
        currentPos = trace.endPos.clone();
      }

      if (trace.fraction >= 1.0) break;

      hitCount++;
      timeLeft -= timeLeft * trace.fraction;

      if (!trace.normal) {
        currentVel = Vector3.Zero();
        break;
      }

      // Add this plane
      if (numPlanes >= 5) {
        currentVel = Vector3.Zero();
        break;
      }
      planes[numPlanes] = trace.normal.clone();
      numPlanes++;

      // Clip velocity
      let clippedVel = currentVel.clone();
      for (let i = 0; i < numPlanes; i++) {
        const into = Vector3.Dot(currentVel, planes[i]);
        if (into >= 0.1) continue; // Moving away

        // Clip
        let backoff = Vector3.Dot(currentVel, planes[i]);
        clippedVel = currentVel.subtract(planes[i].scale(backoff * 1.001));

        // Check if it enters another plane
        for (let j = 0; j < numPlanes; j++) {
          if (j === i) continue;
          if (Vector3.Dot(clippedVel, planes[j]) >= 0.1) continue;

          // Clip against second plane
          backoff = Vector3.Dot(clippedVel, planes[j]);
          clippedVel = clippedVel.subtract(planes[j].scale(backoff * 1.001));

          // Check if it goes back into first plane
          if (Vector3.Dot(clippedVel, planes[i]) >= 0) continue;

          // Slide along crease
          const dir = Vector3.Cross(planes[i], planes[j]).normalize();
          const d = Vector3.Dot(dir, currentVel);
          clippedVel = dir.scale(d);

          // Check third plane... (simplified here)
        }
        currentVel = clippedVel;
        break;
      }
    }

    return { endPos: currentPos, velocity: currentVel, hitCount };
  }

  pointContents(point: Vector3): number {
    if (!this.bspCollision) return 0;
    return this.bspCollision.pointContents(point as never);
  }

  isOnGround(point: Vector3): boolean {
    const groundTrace = this.trace(point, point.add(new Vector3(0, -1, 0)));
    return groundTrace.fraction < 1.0 && !!groundTrace.normal && groundTrace.normal.y > 0.7;
  }

  findGround(point: Vector3, maxDistance = 1000, options?: TraceOptions): { position: Vector3; normal: Vector3 } | null {
    const groundTrace = this.trace(point, point.add(new Vector3(0, -maxDistance, 0)), options);
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

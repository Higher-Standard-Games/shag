/**
 * BspCollision - BSP-based collision detection
 * 
 * Uses brush volumes and plane math for efficient collision testing.
 * Based on Q3/Warsow collision system.
 */

import { Vector3 } from 'babylonjs';
import type { BspFile, BspBrush, BspPlane, BspLeaf } from '../loader/bsp/BspLoader';
import { CollisionMasks, ContentFlags } from './ContentFlags';

/** Small epsilon for plane distance calculations */
const DIST_EPSILON = 0.03125; // 1/32

/** Result of a trace operation */
export interface TraceResult {
  /** Fraction of trace completed (0.0 = immediate hit, 1.0 = no hit) */
  fraction: number;
  /** Final position after trace */
  endPos: Vector3;
  /** Plane that was hit (null if no hit) */
  plane: BspPlane | null;
  /** True if trace started inside solid */
  startSolid: boolean;
  /** True if entire trace was inside solid */
  allSolid: boolean;
  /** Content flags at end position */
  contents: number;
}

/**
 * BSP Collision system
 */
export class BspCollision {
  private bsp: BspFile;
  private isFBSP: boolean;

  constructor(bsp: BspFile) {
    this.bsp = bsp;
    this.isFBSP = bsp.header.isFBSP;
    console.log(`[BspCollision] Initialized for ${this.isFBSP ? 'FBSP' : 'IBSP'} format`);
  }

  /**
   * Update BSP reference (e.g., after map change)
   */
  setBsp(bsp: BspFile): void {
    this.bsp = bsp;
  }

  /**
   * Trace a point from start to end
   * Returns collision info including fraction and hit plane
   */
  tracePoint(
    start: Vector3,
    end: Vector3,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false
  ): TraceResult {
    const result: TraceResult = {
      fraction: 1.0,
      endPos: end.clone(),
      plane: null,
      startSolid: false,
      allSolid: false,
      contents: 0,
    };

    // Convert from Babylon (Y-up) to Q3 (Z-up) coordinates
    // Babylon: x=right, y=up, z=forward
    // Q3:      x=right, y=forward, z=up
    // So: Q3.x=Babylon.x, Q3.y=Babylon.z, Q3.z=Babylon.y
    const q3Start: [number, number, number] = [start.x, start.z, start.y];
    const q3End: [number, number, number] = [end.x, end.z, end.y];

    if (debug) {
      console.log(`[BspCollision] Babylon input: (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)})`);
      console.log(`[BspCollision] Q3 coords: (${q3Start[0].toFixed(1)}, ${q3Start[1].toFixed(1)}, ${q3Start[2].toFixed(1)}) → (${q3End[0].toFixed(1)}, ${q3End[1].toFixed(1)}, ${q3End[2].toFixed(1)})`);
      console.log(`[BspCollision] BSP has ${this.bsp.brushes.length} brushes, ${this.bsp.leafs.length} leafs`);
    }

    // Trace through BSP tree
    this.traceNode(q3Start, q3End, 0, 0, 1, result, debug, contentsMask, clipTexturesOnly);

    // Calculate end position based on fraction
    if (result.fraction < 1.0) {
      result.endPos = Vector3.Lerp(start, end, result.fraction);
    }

    if (debug) {
      console.log(`[BspCollision] Result: fraction=${result.fraction.toFixed(4)}, startSolid=${result.startSolid}`);
    }

    return result;
  }

  traceBox(
    start: Vector3,
    end: Vector3,
    mins: Vector3,
    maxs: Vector3,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false
  ): TraceResult {
    const result: TraceResult & { realfraction: number } = {
      fraction: 1.0,
      realfraction: 1.0 + DIST_EPSILON,
      endPos: end.clone(),
      plane: null,
      startSolid: false,
      allSolid: false,
      contents: 0,
    };

    const q3Start: [number, number, number] = [start.x, start.z, start.y];
    const q3End: [number, number, number] = [end.x, end.z, end.y];
    const q3Mins: [number, number, number] = [mins.x, mins.z, mins.y];
    const q3Maxs: [number, number, number] = [maxs.x, maxs.z, maxs.y];
    const extents: [number, number, number] = [
      Math.max(Math.abs(q3Mins[0]), Math.abs(q3Maxs[0])),
      Math.max(Math.abs(q3Mins[1]), Math.abs(q3Maxs[1])),
      Math.max(Math.abs(q3Mins[2]), Math.abs(q3Maxs[2])),
    ];

    this.traceNodeBox(q3Start, q3End, 0, 0, 1, result, q3Mins, q3Maxs, extents, debug, contentsMask, clipTexturesOnly);

    if (result.fraction < 1.0) {
      result.endPos = Vector3.Lerp(start, end, result.fraction);
    }

    return result;
  }

  /**
   * Get content flags at a point
   */
  pointContents(point: Vector3): number {
    // Convert to Q3 coords
    const q3Point: [number, number, number] = [point.x, point.z, point.y];
    
    // Find leaf containing point
    const leaf = this.findLeaf(q3Point);
    if (!leaf) return 0;

    // Check all brushes in leaf
    let contents = 0;
    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      const brush = this.bsp.brushes[brushIndex];
      
      if (this.pointInBrush(q3Point, brush)) {
        const texture = this.bsp.textures[brush.shaderIndex];
        if (texture) {
          contents |= texture.contentFlags;
        }
      }
    }

    return contents;
  }

  /**
   * Clip velocity against a plane (for sliding)
   */
  clipVelocity(velocity: Vector3, normal: Vector3, overbounce: number = 1.0): Vector3 {
    const backoff = Vector3.Dot(velocity, normal) * overbounce;
    return velocity.subtract(normal.scale(backoff));
  }

  // =========================================================================
  // Internal Methods
  // =========================================================================

  /**
   * Trace through BSP tree recursively
   */
  private traceNode(
    start: [number, number, number],
    end: [number, number, number],
    nodeIndex: number,
    startFrac: number,
    endFrac: number,
    result: TraceResult,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false
  ): void {
    // If we already hit something closer, skip
    if (result.fraction <= startFrac) return;

    // Leaf node - test brushes
    if (nodeIndex < 0) {
      const leafIndex = -(nodeIndex + 1);
      const leaf = this.bsp.leafs[leafIndex];
      if (leaf) {
        if (debug) {
          console.log(`[BspCollision] Leaf ${leafIndex}: ${leaf.numLeafBrushes} brushes`);
        }
        this.traceLeaf(start, end, leaf, result, debug, contentsMask, clipTexturesOnly);
      }
      return;
    }

    const node = this.bsp.nodes[nodeIndex];
    if (!node) {
      if (debug) console.log(`[BspCollision] Node ${nodeIndex} is null!`);
      return;
    }

    const plane = this.bsp.planes[node.planeIndex];
    if (!plane) {
      if (debug) console.log(`[BspCollision] Plane ${node.planeIndex} is null!`);
      return;
    }

    // Calculate distances to plane
    const startDist = this.planeDist(start, plane);
    const endDist = this.planeDist(end, plane);
    
    if (debug && nodeIndex === 0) {
      console.log(`[BspCollision] Root node: planeIndex=${node.planeIndex}, children=[${node.children[0]}, ${node.children[1]}]`);
      console.log(`[BspCollision] Root plane: normal=(${plane.normal[0].toFixed(2)}, ${plane.normal[1].toFixed(2)}, ${plane.normal[2].toFixed(2)}), dist=${plane.dist.toFixed(1)}`);
      console.log(`[BspCollision] Distances: start=${startDist.toFixed(1)}, end=${endDist.toFixed(1)}`);
    }

    // Both points on same side of plane
    if (startDist >= DIST_EPSILON && endDist >= DIST_EPSILON) {
      // Both in front - recurse front only
      if (debug) console.log(`[BspCollision] Node ${nodeIndex}: both in front, going to ${node.children[0]}`);
      this.traceNode(start, end, node.children[0], startFrac, endFrac, result, debug, contentsMask, clipTexturesOnly);
      return;
    }
    
    if (startDist < -DIST_EPSILON && endDist < -DIST_EPSILON) {
      // Both behind - recurse back only
      if (debug) console.log(`[BspCollision] Node ${nodeIndex}: both behind, going to ${node.children[1]}`);
      this.traceNode(start, end, node.children[1], startFrac, endFrac, result, debug, contentsMask, clipTexturesOnly);
      return;
    }

    // Ray crosses plane - must check both sides
    let side: number;
    let frac1: number;
    let frac2: number;

    if (startDist < endDist) {
      side = 1; // Back side first
      const invDist = 1.0 / (startDist - endDist);
      frac1 = (startDist - DIST_EPSILON) * invDist;
      frac2 = (startDist + DIST_EPSILON) * invDist;
    } else if (startDist > endDist) {
      side = 0; // Front side first
      const invDist = 1.0 / (startDist - endDist);
      frac1 = (startDist + DIST_EPSILON) * invDist;
      frac2 = (startDist - DIST_EPSILON) * invDist;
    } else {
      side = 0;
      frac1 = 1;
      frac2 = 0;
    }

    // Clamp fractions
    frac1 = Math.max(0, Math.min(1, frac1));
    frac2 = Math.max(0, Math.min(1, frac2));

    // Calculate middle point
    const midFrac = startFrac + (endFrac - startFrac) * frac1;
    const mid: [number, number, number] = [
      start[0] + frac1 * (end[0] - start[0]),
      start[1] + frac1 * (end[1] - start[1]),
      start[2] + frac1 * (end[2] - start[2]),
    ];

    // Trace near side
    const nearNode = side === 0 ? node.children[0] : node.children[1];
    this.traceNode(start, mid, nearNode, startFrac, midFrac, result, debug, contentsMask, clipTexturesOnly);

    // Calculate far middle point
    const midFrac2 = startFrac + (endFrac - startFrac) * frac2;
    const mid2: [number, number, number] = [
      start[0] + frac2 * (end[0] - start[0]),
      start[1] + frac2 * (end[1] - start[1]),
      start[2] + frac2 * (end[2] - start[2]),
    ];

    // Trace far side
    const farNode = side === 0 ? node.children[1] : node.children[0];
    this.traceNode(mid2, end, farNode, midFrac2, endFrac, result, debug, contentsMask, clipTexturesOnly);
  }

  private traceNodeBox(
    start: [number, number, number],
    end: [number, number, number],
    nodeIndex: number,
    startFrac: number,
    endFrac: number,
    result: TraceResult & { realfraction: number },
    mins: [number, number, number],
    maxs: [number, number, number],
    extents: [number, number, number],
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false
  ): void {
    if (result.realfraction <= startFrac) return;

    if (nodeIndex < 0) {
      const leafIndex = -(nodeIndex + 1);
      const leaf = this.bsp.leafs[leafIndex];
      if (leaf) {
        this.traceLeafBox(start, end, leaf, result, mins, maxs, debug, contentsMask, clipTexturesOnly);
      }
      return;
    }

    const node = this.bsp.nodes[nodeIndex];
    if (!node) return;

    const plane = this.bsp.planes[node.planeIndex];
    if (!plane) return;

    const t1 = this.planeDist(start, plane);
    const t2 = this.planeDist(end, plane);
    const offset =
      Math.abs(extents[0] * plane.normal[0]) +
      Math.abs(extents[1] * plane.normal[1]) +
      Math.abs(extents[2] * plane.normal[2]);

    if (t1 >= offset && t2 >= offset) {
      this.traceNodeBox(start, end, node.children[0], startFrac, endFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly);
      return;
    }
    if (t1 < -offset && t2 < -offset) {
      this.traceNodeBox(start, end, node.children[1], startFrac, endFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly);
      return;
    }

    let side = 0;
    let frac = 1;
    let frac2 = 0;

    if (t1 < t2) {
      const idist = 1.0 / (t1 - t2);
      side = 1;
      frac2 = (t1 + offset) * idist;
      frac = (t1 - offset) * idist;
    } else if (t1 > t2) {
      const idist = 1.0 / (t1 - t2);
      side = 0;
      frac2 = (t1 - offset) * idist;
      frac = (t1 + offset) * idist;
    }

    frac = Math.max(0, Math.min(1, frac));
    const midFrac = startFrac + (endFrac - startFrac) * frac;
    const mid: [number, number, number] = [
      start[0] + frac * (end[0] - start[0]),
      start[1] + frac * (end[1] - start[1]),
      start[2] + frac * (end[2] - start[2]),
    ];

    const nearNode = node.children[side];
    this.traceNodeBox(start, mid, nearNode, startFrac, midFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly);

    frac2 = Math.max(0, Math.min(1, frac2));
    const midFrac2 = startFrac + (endFrac - startFrac) * frac2;
    const mid2: [number, number, number] = [
      start[0] + frac2 * (end[0] - start[0]),
      start[1] + frac2 * (end[1] - start[1]),
      start[2] + frac2 * (end[2] - start[2]),
    ];

    const farNode = node.children[side ^ 1];
    this.traceNodeBox(mid2, end, farNode, midFrac2, endFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly);
  }

  /**
   * Test trace against all solid brushes in a leaf
   */
  private traceLeaf(
    start: [number, number, number],
    end: [number, number, number],
    leaf: BspLeaf,
    result: TraceResult,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false
  ): void {
    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      const brush = this.bsp.brushes[brushIndex];
      if (!brush || brush.numSides < 1) continue;

      // Check if brush is solid for players
      const texture = this.bsp.textures[brush.shaderIndex];
      if (!texture) {
        if (debug) console.log(`[BspCollision] Brush ${brushIndex}: no texture`);
        continue;
      }

      if (clipTexturesOnly && !this.isClipTexture(texture.name, texture.contentFlags)) {
        continue;
      }

      if (!this.isContentsSolid(texture.contentFlags, contentsMask)) {
        if (debug) console.log(`[BspCollision] Brush ${brushIndex}: not solid (flags=0x${texture.contentFlags.toString(16)}, tex=${texture.name})`);
        continue;
      }

      if (debug) console.log(`[BspCollision] Testing brush ${brushIndex}: ${brush.numSides} sides, flags=0x${texture.contentFlags.toString(16)}`);

      // Test trace against brush
      this.traceBrush(start, end, brush, result, debug);
    }
  }

  private traceBrushBox(
    start: [number, number, number],
    end: [number, number, number],
    mins: [number, number, number],
    maxs: [number, number, number],
    brush: BspBrush,
    result: TraceResult & { realfraction: number },
    debug: boolean = false
  ): void {
    let enterFrac = -1.0;
    let enterFrac2 = -1.0;
    let leaveFrac = 1.0;
    let hitPlane: BspPlane | null = null;
    let startOut = false;
    let endOut = false;

    for (let i = 0; i < brush.numSides; i++) {
      const side = this.bsp.brushSides[brush.firstSide + i];
      if (!side) continue;

      const plane = this.bsp.planes[side.planeIndex];
      if (!plane) continue;

      // Calculate distances using box extents
      let startDist = 0;
      let endDist = 0;
      for (let j = 0; j < 3; j++) {
        const n = plane.normal[j];
        if (n > 0) {
          startDist += n * mins[j];
          endDist += n * mins[j];
        } else {
          startDist += n * maxs[j];
          endDist += n * maxs[j];
        }
      }
      startDist = this.brushPlaneDist(start, plane) + startDist;
      endDist = this.brushPlaneDist(end, plane) + endDist;

      if (startDist > 0) startOut = true;
      if (endDist > 0) endOut = true;

      // Both points outside this plane - no collision with brush
      if (startDist > 0 && endDist > 0) {
        if (debug) console.log(`  Box Side ${i}: both outside (${startDist.toFixed(1)}, ${endDist.toFixed(1)}) - SKIP BRUSH`);
        return;
      }

      // Both points inside this plane - check other planes
      if (startDist <= 0 && endDist <= 0) {
        if (debug) console.log(`  Box Side ${i}: both inside (${startDist.toFixed(1)}, ${endDist.toFixed(1)})`);
        continue;
      }

      // Ray crosses this plane
      if (startDist > endDist) {
        // Entering the brush
        let frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        let frac2 = (startDist - 2 * DIST_EPSILON) / (startDist - endDist);
        if (debug) console.log(`  Box Side ${i}: ENTER at ${frac.toFixed(4)} (nudged ${frac2.toFixed(4)}) (dists: ${startDist.toFixed(1)}, ${endDist.toFixed(1)})`);
        if (frac > enterFrac) {
          enterFrac = frac;
          enterFrac2 = frac2;
          hitPlane = plane;
        }
      } else {
        // Leaving the brush
        const frac = (startDist + DIST_EPSILON) / (startDist - endDist);
        if (debug) console.log(`  Box Side ${i}: LEAVE at ${frac.toFixed(4)} (dists: ${startDist.toFixed(1)}, ${endDist.toFixed(1)})`);
        if (frac < leaveFrac) {
          leaveFrac = frac;
        }
      }
    }

    // If we never left the brush, no collision
    if (!startOut && !endOut) {
      result.startSolid = true;
      if (!startOut && !endOut) {
        result.allSolid = true;
        result.fraction = 0;
        result.endPos = new Vector3(start[0], start[2], start[1]);
        if (debug) console.log(`  BOX: allSolid=true (never left brush)`);
      }
      return;
    }

    // If we entered before leaving, we hit the brush
    if (enterFrac > leaveFrac) return;

    if (enterFrac < result.realfraction) {
      if (enterFrac2 < result.fraction) {
        result.realfraction = enterFrac;
        result.fraction = Math.max(0, Math.min(1, enterFrac2));
        result.plane = hitPlane;
        if (debug) console.log(`  BOX HIT! fraction=${result.fraction.toFixed(4)}`);
      }
    }
  }

  private traceLeafBox(
    start: [number, number, number],
    end: [number, number, number],
    leaf: BspLeaf,
    result: TraceResult & { realfraction: number },
    mins: [number, number, number],
    maxs: [number, number, number],
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false
  ): void {
    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      const brush = this.bsp.brushes[brushIndex];
      if (!brush || brush.numSides < 1) continue;

      const texture = this.bsp.textures[brush.shaderIndex];
      if (!texture) continue;

      if (clipTexturesOnly && !this.isClipTexture(texture.name, texture.contentFlags)) continue;
      if (!this.isContentsSolid(texture.contentFlags, contentsMask)) continue;

      this.traceBrushBox(start, end, mins, maxs, brush, result, debug);
      if (result.fraction === 0) return;
    }
  }

  private isContentsSolid(contentFlags: number, contentsMask: number): boolean {
    if (contentFlags & ContentFlags.DETAIL) return false;
    return (contentFlags & contentsMask) !== 0;
  }

  private isClipTexture(textureName: string, contentFlags: number): boolean {
    if ((contentFlags & ContentFlags.DETAIL) !== 0) return false;
    if ((contentFlags & ContentFlags.PLAYERCLIP) !== 0) return true;
    const name = (textureName || '').toLowerCase();
    // Warsow/Quake3 common clip textures
    if (name.includes('fullclip')) return true;
    if (name.includes('playerclip')) return true;
    if (name.includes('common/clip')) return true;
    if (name.endsWith('/clip')) return true;
    if (name.includes('/clip_')) return true;
    return false;
  }

  /**
   * Trace a ray against a single convex brush
   * This is the core collision test
   */
  private traceBrush(
    start: [number, number, number],
    end: [number, number, number],
    brush: BspBrush,
    result: TraceResult,
    debug: boolean = false
  ): void {
    let enterFrac = -1.0;
    let leaveFrac = 1.0;
    let hitPlane: BspPlane | null = null;
    let startOut = false;
    let endOut = false;

    for (let i = 0; i < brush.numSides; i++) {
      const side = this.bsp.brushSides[brush.firstSide + i];
      if (!side) continue;

      const plane = this.bsp.planes[side.planeIndex];
      if (!plane) continue;

      // Calculate distances from start/end to plane (brush planes use negated convention)
      const startDist = this.brushPlaneDist(start, plane);
      const endDist = this.brushPlaneDist(end, plane);

      if (startDist > 0) startOut = true;
      if (endDist > 0) endOut = true;

      // Both points outside this plane - no collision with brush
      if (startDist > 0 && endDist > 0) {
        if (debug) console.log(`  Side ${i}: both outside (${startDist.toFixed(1)}, ${endDist.toFixed(1)}) - SKIP BRUSH`);
        return;
      }

      // Both points inside this plane - check other planes
      if (startDist <= 0 && endDist <= 0) {
        if (debug) console.log(`  Side ${i}: both inside (${startDist.toFixed(1)}, ${endDist.toFixed(1)})`);
        continue;
      }

      // Ray crosses this plane
      if (startDist > endDist) {
        // Entering the brush
        const frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        if (debug) console.log(`  Side ${i}: ENTER at ${frac.toFixed(4)} (dists: ${startDist.toFixed(1)}, ${endDist.toFixed(1)})`);
        if (frac > enterFrac) {
          enterFrac = frac;
          hitPlane = plane;
        }
      } else {
        // Leaving the brush
        const frac = (startDist + DIST_EPSILON) / (startDist - endDist);
        if (debug) console.log(`  Side ${i}: LEAVE at ${frac.toFixed(4)} (dists: ${startDist.toFixed(1)}, ${endDist.toFixed(1)})`);
        if (frac < leaveFrac) {
          leaveFrac = frac;
        }
      }
    }

    if (debug) console.log(`  Brush result: enterFrac=${enterFrac.toFixed(4)}, leaveFrac=${leaveFrac.toFixed(4)}, startOut=${startOut}, endOut=${endOut}`);

    // Started inside solid
    if (!startOut) {
      result.startSolid = true;
      if (!endOut) {
        result.allSolid = true;
        result.fraction = 0;
      }
      return;
    }

    // Check if we actually hit
    if (enterFrac < leaveFrac) {
      if (enterFrac > -1 && enterFrac < result.fraction) {
        // Clamp to valid range
        if (enterFrac < 0) enterFrac = 0;
        
        if (debug) console.log(`  HIT! fraction=${enterFrac.toFixed(4)}`);
        result.fraction = enterFrac;
        result.plane = hitPlane;
      }
    }
  }

  /**
   * Check if a point is inside a brush
   */
  private pointInBrush(point: [number, number, number], brush: BspBrush): boolean {
    for (let i = 0; i < brush.numSides; i++) {
      const side = this.bsp.brushSides[brush.firstSide + i];
      if (!side) continue;

      const plane = this.bsp.planes[side.planeIndex];
      if (!plane) continue;

      // Use brush plane distance (negated for FBSP)
      const dist = this.brushPlaneDist(point, plane);
      if (dist > 0) {
        return false; // Outside this plane = outside brush
      }
    }
    return true; // Inside all planes = inside brush
  }

  /**
   * Find the leaf containing a point
   */
  private findLeaf(point: [number, number, number]): BspLeaf | null {
    if (this.bsp.nodes.length === 0) return null;

    let nodeIndex = 0;

    while (nodeIndex >= 0) {
      const node = this.bsp.nodes[nodeIndex];
      if (!node) return null;

      const plane = this.bsp.planes[node.planeIndex];
      if (!plane) return null;

      const dist = this.planeDist(point, plane);

      if (dist >= 0) {
        nodeIndex = node.children[0];
      } else {
        nodeIndex = node.children[1];
      }
    }

    const leafIndex = -(nodeIndex + 1);
    return this.bsp.leafs[leafIndex] || null;
  }

  /**
   * Calculate signed distance from point to plane (for BSP node traversal)
   * Returns positive if point is in front of plane, negative if behind.
   */
  private planeDist(point: [number, number, number], plane: BspPlane): number {
    return (
      point[0] * plane.normal[0] +
      point[1] * plane.normal[1] +
      point[2] * plane.normal[2] -
      plane.dist
    );
  }

  /**
   * Calculate signed distance for brush collision testing.
   * 
   * IMPORTANT: FBSP (Warsow/qfusion) uses a DIFFERENT plane convention than IBSP (Q3)!
   * - IBSP: brush plane normals point OUTWARD from brush (standard Q3)
   * - FBSP: brush plane normals point INWARD into the brush (inverted)
   * 
   * For FBSP, we negate the distance so positive = outside brush.
   */
  private brushPlaneDist(point: [number, number, number], plane: BspPlane): number {
    const dist = (
      point[0] * plane.normal[0] +
      point[1] * plane.normal[1] +
      point[2] * plane.normal[2] -
      plane.dist
    );
    // FBSP uses inverted plane convention - negate to match Q3 expected behavior
    return this.isFBSP ? -dist : dist;
  }
}

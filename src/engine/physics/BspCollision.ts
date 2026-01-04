/**
 * BspCollision - BSP-based collision detection
 * 
 * Uses brush volumes and plane math for efficient collision testing.
 * Based on Q3/Warsow collision system.
 */

import { Vector3 } from 'babylonjs';
import type { BspFile, BspBrush, BspPlane, BspLeaf } from '../loader/bsp/BspLoader';
import { isPlayerSolid } from './ContentFlags';

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

  constructor(bsp: BspFile) {
    this.bsp = bsp;
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
  tracePoint(start: Vector3, end: Vector3, debug: boolean = false): TraceResult {
    const result: TraceResult = {
      fraction: 1.0,
      endPos: end.clone(),
      plane: null,
      startSolid: false,
      allSolid: false,
      contents: 0,
    };

    // Convert from Babylon (Y-up) to Q3 (Z-up) coordinates
    const q3Start: [number, number, number] = [start.x, start.z, start.y];
    const q3End: [number, number, number] = [end.x, end.z, end.y];

    if (debug) {
      console.log(`[BspCollision] Trace Q3 coords: (${q3Start[0].toFixed(1)}, ${q3Start[1].toFixed(1)}, ${q3Start[2].toFixed(1)}) → (${q3End[0].toFixed(1)}, ${q3End[1].toFixed(1)}, ${q3End[2].toFixed(1)})`);
      console.log(`[BspCollision] BSP has ${this.bsp.brushes.length} brushes, ${this.bsp.leafs.length} leafs`);
    }

    // Trace through BSP tree
    this.traceNode(q3Start, q3End, 0, 0, 1, result, debug);

    // Calculate end position based on fraction
    if (result.fraction < 1.0) {
      result.endPos = Vector3.Lerp(start, end, result.fraction);
    }

    if (debug) {
      console.log(`[BspCollision] Result: fraction=${result.fraction.toFixed(4)}, startSolid=${result.startSolid}`);
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
    debug: boolean = false
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
        this.traceLeaf(start, end, leaf, result, debug);
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
      this.traceNode(start, end, node.children[0], startFrac, endFrac, result, debug);
      return;
    }
    
    if (startDist < -DIST_EPSILON && endDist < -DIST_EPSILON) {
      // Both behind - recurse back only
      if (debug) console.log(`[BspCollision] Node ${nodeIndex}: both behind, going to ${node.children[1]}`);
      this.traceNode(start, end, node.children[1], startFrac, endFrac, result, debug);
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
    this.traceNode(start, mid, nearNode, startFrac, midFrac, result, debug);

    // Calculate far middle point
    const midFrac2 = startFrac + (endFrac - startFrac) * frac2;
    const mid2: [number, number, number] = [
      start[0] + frac2 * (end[0] - start[0]),
      start[1] + frac2 * (end[1] - start[1]),
      start[2] + frac2 * (end[2] - start[2]),
    ];

    // Trace far side
    const farNode = side === 0 ? node.children[1] : node.children[0];
    this.traceNode(mid2, end, farNode, midFrac2, endFrac, result, debug);
  }

  /**
   * Test trace against all solid brushes in a leaf
   */
  private traceLeaf(
    start: [number, number, number],
    end: [number, number, number],
    leaf: BspLeaf,
    result: TraceResult,
    debug: boolean = false
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
      if (!isPlayerSolid(texture.contentFlags)) {
        if (debug) console.log(`[BspCollision] Brush ${brushIndex}: not solid (flags=0x${texture.contentFlags.toString(16)}, tex=${texture.name})`);
        continue;
      }

      if (debug) console.log(`[BspCollision] Testing brush ${brushIndex}: ${brush.numSides} sides, flags=0x${texture.contentFlags.toString(16)}`);

      // Test trace against brush
      this.traceBrush(start, end, brush, result, debug);
    }
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

      // Calculate distances from start/end to plane
      const startDist = this.planeDist(start, plane);
      const endDist = this.planeDist(end, plane);

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

      const dist = this.planeDist(point, plane);
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
   * Calculate signed distance from point to plane
   */
  private planeDist(point: [number, number, number], plane: BspPlane): number {
    return (
      point[0] * plane.normal[0] +
      point[1] * plane.normal[1] +
      point[2] * plane.normal[2] -
      plane.dist
    );
  }
}

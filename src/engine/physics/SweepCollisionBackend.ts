/**
 * SweepCollisionBackend - Clean implementation of swept box collision
 * 
 * Based on the Q3 BSP collision detection algorithm:
 * - BSP tree traversal for spatial queries
 * - Swept AABB collision against brush planes
 * - Proper content flag handling
 * 
 * This is an experimental backend created from scratch following
 * the documented Q3 collision detection approach.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import type { BspFile, BspBrush, BspLeaf } from '../loader/bsp/BspLoader';
import { CollisionBackend, TraceResult, TraceOptions, CollisionStats, createDefaultTraceResult } from './CollisionBackend';
import {
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  PLAYER_MINS_Z,
  STEPSIZE,
} from './PlayerPhysicsConstants';

// Content flags (Q3-compatible)
const ContentFlags = {
  SOLID: 0x1,
  LAVA: 0x8,
  SLIME: 0x10,
  WATER: 0x20,
  FOG: 0x40,
  PLAYERCLIP: 0x10000,
  MONSTERCLIP: 0x20000,
  ORIGIN: 0x1000000,
  DETAIL: 0x8000000,
  STRUCTURAL: 0x10000000,
  TRANSLUCENT: 0x20000000,
  TRIGGER: 0x40000000,
} as const;

// Surface flags
const SurfaceFlags = {
  NODAMAGE: 0x1,
  SLICK: 0x2,
  SKY: 0x4,
  NODRAW: 0x80,
  HINT: 0x100,
  SKIP: 0x200,
  NONSOLID: 0x4000,
} as const;

// Default content mask for player collision
const PLAYER_CONTENTS = ContentFlags.SOLID | ContentFlags.PLAYERCLIP;

// Trace type
type TraceType = 'ray' | 'box';

// Internal trace state
interface TraceState {
  type: TraceType;
  start: [number, number, number];
  end: [number, number, number];
  mins: [number, number, number];
  maxs: [number, number, number];
  extents: [number, number, number];
  contentMask: number;
  result: InternalTraceResult;
  debug: boolean;
}

interface InternalTraceResult {
  fraction: number;
  endPos: [number, number, number];
  normal: [number, number, number] | null;
  startSolid: boolean;
  allSolid: boolean;
  contents: number;
  hitBrushIndex: number;
  hitTextureName: string;
}

/**
 * Q3-style collision backend
 */
export class SweepCollisionBackend implements CollisionBackend {
  readonly type = 'q3' as const;
  readonly name = 'Sweep Collision (Experimental)';

  private bsp: BspFile | null = null;
  private isFBSP = false;
  private loggedPlayerclipOnce = false;

  // Stats
  private stats = {
    traceCount: 0,
    hitCount: 0,
    totalTraceTime: 0,
  };

  async init(bsp: BspFile, _scene?: Scene): Promise<void> {
    this.bsp = bsp;
    this.isFBSP = (bsp as any).header?.isFBSP ?? false;
    console.log(`[SweepCollision] Initialized with ${bsp.brushes?.length || 0} brushes (FBSP=${this.isFBSP})`);
  }

  /**
   * Main trace function - performs swept box collision
   */
  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult {
    if (!this.bsp) {
      return createDefaultTraceResult(start, end);
    }

    const startTime = performance.now();
    this.stats.traceCount++;

    // Convert Babylon coords to Q3 coords (swap Y and Z)
    const q3Start: [number, number, number] = [start.x, start.z, start.y];
    const q3End: [number, number, number] = [end.x, end.z, end.y];

    // Get trace extents from options
    const radius = options?.radius ?? PLAYER_RADIUS;
    const height = options?.height ?? PLAYER_HEIGHT;

    // Q3-style ASYMMETRIC bounding box (Z is up in Q3 coords)
    // Box extends 24/56 of height BELOW origin, 32/56 ABOVE origin
    // This matches Q3's player hull: mins.z = -24, maxs.z = 32 for height 56
    const minsZ = -(height * (-PLAYER_MINS_Z / PLAYER_HEIGHT));  // -24 for height 56
    const maxsZ = height + minsZ;                                 // +32 for height 56

    const mins: [number, number, number] = [-radius, -radius, minsZ];
    const maxs: [number, number, number] = [radius, radius, maxsZ];

    // Content mask - default to SOLID | PLAYERCLIP for player collision
    const contentMask = options?.contentMask ?? PLAYER_CONTENTS;

    // Create trace state
    const state: TraceState = {
      type: 'box',
      start: q3Start,
      end: q3End,
      mins,
      maxs,
      extents: [
        Math.max(Math.abs(mins[0]), Math.abs(maxs[0])),
        Math.max(Math.abs(mins[1]), Math.abs(maxs[1])),
        Math.max(Math.abs(mins[2]), Math.abs(maxs[2])),
      ],
      contentMask,
      result: {
        fraction: 1.0,
        endPos: [...q3End],
        normal: null,
        startSolid: false,
        allSolid: false,
        contents: 0,
        hitBrushIndex: -1,
        hitTextureName: '',
      },
      debug: options?.debug ?? false,
    };

    if (state.debug) {
      console.log(`[SweepCollision] Trace start: (${q3Start[0].toFixed(1)}, ${q3Start[1].toFixed(1)}, ${q3Start[2].toFixed(1)})`);
      console.log(`[SweepCollision] Trace end: (${q3End[0].toFixed(1)}, ${q3End[1].toFixed(1)}, ${q3End[2].toFixed(1)})`);
      console.log(`[SweepCollision] ContentMask: 0x${contentMask.toString(16)}`);
    }

    // Traverse BSP tree for solid brushes
    this.traceNode(0, 0.0, 1.0, state.start, state.end, state);

    // ALSO check ALL clip brushes directly (they may not be in BSP tree leaves)
    // This is how Q3/clipviz handles clip brushes - iterate all, not just BSP traversal
    this.traceAllClipBrushes(state);

    // Calculate final position
    if (state.result.fraction < 1.0) {
      for (let i = 0; i < 3; i++) {
        state.result.endPos[i] = q3Start[i] + state.result.fraction * (q3End[i] - q3Start[i]);
      }
      this.stats.hitCount++;
    }

    // Convert back to Babylon coords (swap Y and Z back)
    const result: TraceResult = {
      fraction: state.result.fraction,
      endPos: new Vector3(state.result.endPos[0], state.result.endPos[2], state.result.endPos[1]),
      normal: state.result.normal
        ? new Vector3(state.result.normal[0], state.result.normal[2], state.result.normal[1])
        : undefined,
      startSolid: state.result.startSolid,
      allSolid: state.result.allSolid,
      contents: state.result.contents,
      hitBrushIndex: state.result.hitBrushIndex,
      hitTextureName: state.result.hitTextureName,
    };

    const elapsed = performance.now() - startTime;
    this.stats.totalTraceTime += elapsed;

    if (state.debug && result.fraction < 1.0) {
      console.log(`[SweepCollision] HIT: fraction=${result.fraction.toFixed(3)} brush=${result.hitBrushIndex} tex="${result.hitTextureName}"`);
    }

    return result;
  }

  /**
   * Traverse BSP node tree
   */
  private traceNode(
    nodeIndex: number,
    startFraction: number,
    endFraction: number,
    start: [number, number, number],
    end: [number, number, number],
    state: TraceState
  ): void {
    if (!this.bsp) return;

    // If already blocked, don't bother
    if (state.result.fraction <= startFraction) return;

    // Leaf node (negative index)
    if (nodeIndex < 0) {
      const leafIndex = -(nodeIndex + 1);
      const leaf = this.bsp.leafs[leafIndex];
      if (leaf) {
        this.traceLeaf(leaf, state);
      }
      return;
    }

    // Internal node
    const node = this.bsp.nodes[nodeIndex];
    if (!node) return;

    const plane = this.bsp.planes[node.planeIndex];
    if (!plane) return;

    // Calculate distance from plane for start and end points
    let startDist: number, endDist: number;
    let offset: number;

    // Axis-aligned plane optimization
    if (plane.normal[0] === 1 || plane.normal[0] === -1) {
      startDist = start[0] - plane.dist;
      endDist = end[0] - plane.dist;
      offset = state.extents[0];
    } else if (plane.normal[1] === 1 || plane.normal[1] === -1) {
      startDist = start[1] - plane.dist;
      endDist = end[1] - plane.dist;
      offset = state.extents[1];
    } else if (plane.normal[2] === 1 || plane.normal[2] === -1) {
      startDist = start[2] - plane.dist;
      endDist = end[2] - plane.dist;
      offset = state.extents[2];
    } else {
      // Non-axial plane
      startDist = this.dot(start, plane.normal) - plane.dist;
      endDist = this.dot(end, plane.normal) - plane.dist;
      offset = Math.abs(state.extents[0] * plane.normal[0]) +
        Math.abs(state.extents[1] * plane.normal[1]) +
        Math.abs(state.extents[2] * plane.normal[2]);
    }

    // Both sides of plane
    if (startDist >= offset && endDist >= offset) {
      // Entirely on front side
      this.traceNode(node.children[0], startFraction, endFraction, start, end, state);
    } else if (startDist < -offset && endDist < -offset) {
      // Entirely on back side
      this.traceNode(node.children[1], startFraction, endFraction, start, end, state);
    } else {
      // Crosses the plane - need to check both sides
      let side: number;
      let fraction1: number, fraction2: number;

      if (startDist < endDist) {
        side = 1; // Back side first
        const invDist = 1.0 / (startDist - endDist);
        fraction1 = (startDist - offset + 0.03125) * invDist;
        fraction2 = (startDist + offset + 0.03125) * invDist;
      } else if (startDist > endDist) {
        side = 0; // Front side first
        const invDist = 1.0 / (startDist - endDist);
        fraction1 = (startDist + offset + 0.03125) * invDist;
        fraction2 = (startDist - offset - 0.03125) * invDist;
      } else {
        side = 0;
        fraction1 = 1.0;
        fraction2 = 0.0;
      }

      // Clamp fractions
      fraction1 = Math.max(0, Math.min(1, fraction1));
      fraction2 = Math.max(0, Math.min(1, fraction2));

      // Calculate mid point
      const midFraction = startFraction + (endFraction - startFraction) * fraction1;
      const mid: [number, number, number] = [
        start[0] + fraction1 * (end[0] - start[0]),
        start[1] + fraction1 * (end[1] - start[1]),
        start[2] + fraction1 * (end[2] - start[2]),
      ];

      // Check near side first
      this.traceNode(node.children[side], startFraction, midFraction, start, mid, state);

      // Calculate second mid point
      const midFraction2 = startFraction + (endFraction - startFraction) * fraction2;
      const mid2: [number, number, number] = [
        start[0] + fraction2 * (end[0] - start[0]),
        start[1] + fraction2 * (end[1] - start[1]),
        start[2] + fraction2 * (end[2] - start[2]),
      ];

      // Check far side
      this.traceNode(node.children[side ^ 1], midFraction2, endFraction, mid2, end, state);
    }
  }

  /**
   * Check collision with brushes in a leaf
   */
  private traceLeaf(leaf: BspLeaf, state: TraceState): void {
    if (!this.bsp) return;

    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      const brush = this.bsp.brushes[brushIndex];
      if (!brush || brush.numSides < 1) continue;

      // Get brush texture for content flags
      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

      // Debug: Log playerclip brushes ONCE to understand why they're being skipped
      const isPlayerclipName = texture.name?.toLowerCase().includes('playerclip');
      if (isPlayerclipName && !this.loggedPlayerclipOnce) {
        this.loggedPlayerclipOnce = true;
        const contentFlags = texture.contentFlags;
        const surfaceFlags = texture.surfaceFlags;
        const hasNonsolid = (surfaceFlags & SurfaceFlags.NONSOLID) !== 0;
        const hasHint = (surfaceFlags & SurfaceFlags.HINT) !== 0;
        const hasDetail = (contentFlags & ContentFlags.DETAIL) !== 0;
        const hasSolid = (contentFlags & ContentFlags.SOLID) !== 0;
        const hasPlayerclip = (contentFlags & ContentFlags.PLAYERCLIP) !== 0;
        console.log(`[SweepCollision] PLAYERCLIP BRUSH DEBUG:`);
        console.log(`  name="${texture.name}"`);
        console.log(`  contentFlags=0x${contentFlags.toString(16)} surfaceFlags=0x${surfaceFlags.toString(16)}`);
        console.log(`  hasNonsolid=${hasNonsolid} hasHint=${hasHint} hasDetail=${hasDetail}`);
        console.log(`  hasSolid=${hasSolid} hasPlayerclip=${hasPlayerclip}`);
        console.log(`  contentMask=0x${state.contentMask.toString(16)}`);
      }

      // Check content flags
      if (!this.shouldCollideWith(texture, state.contentMask)) {
        continue;
      }

      // Check collision with brush
      this.traceBrush(brush, brushIndex, texture, state);
    }
  }

  /**
   * Check if we should collide with this brush based on content flags AND texture name
   */
  private shouldCollideWith(texture: { name: string; contentFlags: number; surfaceFlags: number }, contentMask: number): boolean {
    const contentFlags = texture.contentFlags;
    const surfaceFlags = texture.surfaceFlags;
    const name = (texture.name || '').toLowerCase();

    // Skip non-solid surfaces
    if (surfaceFlags & SurfaceFlags.NONSOLID) return false;

    // Skip hint brushes
    if (surfaceFlags & SurfaceFlags.HINT) return false;

    // Skip detail brushes (visual only)
    if (contentFlags & ContentFlags.DETAIL) return false;

    // Check by content flags
    const hasSolid = (contentFlags & ContentFlags.SOLID) !== 0;
    const hasPlayerclip = (contentFlags & ContentFlags.PLAYERCLIP) !== 0;
    const wantsSolid = (contentMask & ContentFlags.SOLID) !== 0;
    const wantsPlayerclip = (contentMask & ContentFlags.PLAYERCLIP) !== 0;

    // Also check by texture name (playerclip/fullclip are often identified by name)
    const isFullclipByName = name.includes('fullclip') || name.includes('clip') && !name.includes('playerclip');
    const isPlayerclipByName = name.includes('playerclip');

    // Fullclip and playerclip should both block players
    if (wantsSolid && hasSolid) return true;
    if (wantsSolid && isFullclipByName) return true;
    if (wantsPlayerclip && hasPlayerclip) return true;
    if (wantsPlayerclip && isPlayerclipByName) return true;

    return false;
  }

  /**
   * Get texture info for a brush
   */
  private getBrushTexture(brush: BspBrush): { name: string; contentFlags: number; surfaceFlags: number } | null {
    if (!this.bsp) return null;

    // Try brush.shaderIndex first
    let texture = this.bsp.textures[brush.shaderIndex];
    if (texture) {
      return {
        name: texture.name || '',
        contentFlags: texture.contentFlags || 0,
        surfaceFlags: texture.surfaceFlags || 0,
      };
    }

    // Fallback to first brush side
    const firstSide = this.bsp.brushSides[brush.firstSide];
    if (firstSide) {
      texture = this.bsp.textures[firstSide.shaderIndex];
      if (texture) {
        return {
          name: texture.name || '',
          contentFlags: texture.contentFlags || 0,
          surfaceFlags: texture.surfaceFlags || 0,
        };
      }
    }

    return null;
  }

  /**
   * Check ALL clip brushes directly (fullclip, playerclip)
   * This bypasses BSP tree traversal because clip brushes may not be in leafBrushes
   */
  private traceAllClipBrushes(state: TraceState): void {
    if (!this.bsp) return;

    const wantsPlayerclip = (state.contentMask & ContentFlags.PLAYERCLIP) !== 0;
    if (!wantsPlayerclip) return; // Only do this for player collision

    for (let bi = 0; bi < this.bsp.brushes.length; bi++) {
      const brush = this.bsp.brushes[bi];
      if (!brush || brush.numSides < 4) continue;

      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

      const name = (texture.name || '').toLowerCase();
      const isFullclip = name.includes('fullclip');
      const isPlayerclip = name.includes('playerclip');

      // Only check clip brushes
      if (!isFullclip && !isPlayerclip) continue;

      // Debug: log first playerclip found
      if (isPlayerclip && !this.loggedPlayerclipOnce) {
        this.loggedPlayerclipOnce = true;
        console.log(`[SweepCollision] Found playerclip via direct iteration: brush ${bi} "${texture.name}"`);
      }

      // Check collision with this brush
      this.traceBrush(brush, bi, texture, state);
    }
  }

  /**
   * Check collision with a single brush
   */
  private traceBrush(brush: BspBrush, brushIndex: number, texture: { name: string; contentFlags: number; surfaceFlags: number }, state: TraceState): void {
    if (!this.bsp) return;

    let enterFraction = -1.0;
    let leaveFraction = 1.0;
    let startOut = false;
    let endOut = false;
    let hitPlaneNormal: [number, number, number] | null = null;

    for (let i = 0; i < brush.numSides; i++) {
      const side = this.bsp.brushSides[brush.firstSide + i];
      if (!side) continue;

      const plane = this.bsp.planes[side.planeIndex];
      if (!plane) continue;

      // Calculate distances with box offset
      let startDist: number, endDist: number;

      // Calculate offset based on box size and plane normal
      const offset: [number, number, number] = [0, 0, 0];
      for (let j = 0; j < 3; j++) {
        if (plane.normal[j] < 0) {
          offset[j] = state.maxs[j];
        } else {
          offset[j] = state.mins[j];
        }
      }

      // Distance from plane (adjusted for box)
      startDist = (state.start[0] + offset[0]) * plane.normal[0] +
        (state.start[1] + offset[1]) * plane.normal[1] +
        (state.start[2] + offset[2]) * plane.normal[2] -
        plane.dist;

      endDist = (state.end[0] + offset[0]) * plane.normal[0] +
        (state.end[1] + offset[1]) * plane.normal[1] +
        (state.end[2] + offset[2]) * plane.normal[2] -
        plane.dist;

      if (startDist > 0) startOut = true;
      if (endDist > 0) endOut = true;

      // Both points outside this plane - not inside brush
      if (startDist > 0 && endDist > 0) return;

      // Both points inside this plane - continue to next plane
      if (startDist <= 0 && endDist <= 0) continue;

      // Crossing the plane
      if (startDist > endDist) {
        // Entering the brush
        const fraction = (startDist - 0.03125) / (startDist - endDist);
        if (fraction > enterFraction) {
          enterFraction = fraction;
          hitPlaneNormal = [...plane.normal] as [number, number, number];
        }
      } else {
        // Leaving the brush
        const fraction = (startDist + 0.03125) / (startDist - endDist);
        if (fraction < leaveFraction) {
          leaveFraction = fraction;
        }
      }
    }

    // Check results
    if (!startOut) {
      // Started inside brush
      state.result.startSolid = true;
      state.result.contents = texture.contentFlags;
      if (!endOut) {
        state.result.allSolid = true;
        state.result.fraction = 0;
      }
      return;
    }

    if (enterFraction < leaveFraction) {
      if (enterFraction > -1 && enterFraction < state.result.fraction) {
        // Valid collision
        if (enterFraction < 0) enterFraction = 0;

        state.result.fraction = enterFraction;
        state.result.normal = hitPlaneNormal;
        state.result.contents = texture.contentFlags;
        state.result.hitBrushIndex = brushIndex;
        state.result.hitTextureName = texture.name;
      }
    }
  }

  /**
   * Dot product helper
   */
  private dot(v1: [number, number, number], v2: [number, number, number]): number {
    return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  }

  // =========================================================================
  // Q3-STYLE SLIDE MOVE - Smooth collision response
  // =========================================================================

  private static readonly OVERCLIP = 1.001;
  private static readonly MAX_CLIP_PLANES = 5;
  private static readonly MAX_BUMPS = 4;
  // STEPSIZE now imported from PlayerPhysicsConstants

  /**
   * Clip velocity against a plane normal (Q3 PM_ClipVelocity)
   * Removes the component of velocity going INTO the surface
   */
  clipVelocity(velocity: Vector3, normal: Vector3, overbounce: number = SweepCollisionBackend.OVERCLIP): Vector3 {
    const backoff = Vector3.Dot(velocity, normal) * overbounce;
    const out = velocity.subtract(normal.scale(backoff));

    // Tiny velocities can cause problems, zero them out
    if (Math.abs(out.x) < 0.001) out.x = 0;
    if (Math.abs(out.y) < 0.001) out.y = 0;
    if (Math.abs(out.z) < 0.001) out.z = 0;

    return out;
  }

  /**
   * Q3-style slide move - smooth movement with wall sliding
   * Returns the final position after sliding along surfaces
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
    let timeLeft = 1.0; // Fraction of frame time remaining
    let hitCount = 0;

    for (let bump = 0; bump < SweepCollisionBackend.MAX_BUMPS; bump++) {
      if (currentVel.lengthSquared() < 0.0001) {
        break; // Velocity too small, stop
      }

      // Calculate end position for this iteration
      const endPos = currentPos.add(currentVel.scale(timeLeft));

      // Trace from current position to end
      const trace = this.trace(currentPos, endPos, options);

      if (trace.allSolid) {
        // Stuck in solid - zero vertical velocity, try to escape
        currentVel.y = 0;
        return { endPos: currentPos, velocity: currentVel, hitCount };
      }

      if (trace.fraction > 0) {
        // Actually moved some distance
        currentPos = trace.endPos.clone();
      }

      if (trace.fraction >= 1.0) {
        // Moved the full distance without hitting anything
        break;
      }

      // Hit something
      hitCount++;
      timeLeft -= timeLeft * trace.fraction;

      if (!trace.normal) {
        // No normal - can't slide, just stop
        currentVel = Vector3.Zero();
        break;
      }

      // Check if we hit this plane before (within tolerance)
      let hitSamePlane = false;
      for (let i = 0; i < numPlanes; i++) {
        if (Vector3.Dot(trace.normal, planes[i]) > 0.99) {
          // Same plane - nudge velocity along it
          currentVel = currentVel.add(trace.normal);
          hitSamePlane = true;
          break;
        }
      }

      if (hitSamePlane) {
        continue;
      }

      // Add this plane to the list
      if (numPlanes >= SweepCollisionBackend.MAX_CLIP_PLANES) {
        // Too many planes - stop
        currentVel = Vector3.Zero();
        break;
      }
      planes[numPlanes] = trace.normal.clone();
      numPlanes++;

      // Clip velocity against all planes
      let clippedVel = currentVel.clone();

      for (let i = 0; i < numPlanes; i++) {
        const into = Vector3.Dot(currentVel, planes[i]);
        if (into >= 0.1) {
          continue; // Moving away from this plane
        }

        // Clip against this plane
        clippedVel = this.clipVelocity(currentVel, planes[i]);

        // Check if clipped velocity enters another plane
        for (let j = 0; j < numPlanes; j++) {
          if (j === i) continue;
          if (Vector3.Dot(clippedVel, planes[j]) >= 0.1) {
            continue; // Moving away from this plane
          }

          // Clip against the second plane too
          clippedVel = this.clipVelocity(clippedVel, planes[j]);

          // Check if it goes back into the first plane
          if (Vector3.Dot(clippedVel, planes[i]) >= 0) {
            continue; // OK
          }

          // Slide along the crease (cross product of two planes)
          const dir = Vector3.Cross(planes[i], planes[j]).normalize();
          const d = Vector3.Dot(dir, currentVel);
          clippedVel = dir.scale(d);

          // Check for a third plane
          for (let k = 0; k < numPlanes; k++) {
            if (k === i || k === j) continue;
            if (Vector3.Dot(clippedVel, planes[k]) >= 0.1) {
              continue;
            }
            // Stuck in a corner - stop
            currentVel = Vector3.Zero();
            return { endPos: currentPos, velocity: currentVel, hitCount };
          }
        }

        // Use clipped velocity
        currentVel = clippedVel;
        break;
      }
    }

    return { endPos: currentPos, velocity: currentVel, hitCount };
  }

  /**
   * Q3-style step slide move - handles stairs and small obstacles
   * Tries to step up if blocked, then slide, then step back down
   *
   * IMPORTANT: This function expects startPos to be at ORIGIN level (Q3 style),
   * NOT at feet level. The asymmetric bounding box extends:
   * - 24 units DOWN from origin (to feet)
   * - 32 units UP from origin (to head)
   */
  stepSlideMove(
    startPos: Vector3,
    velocity: Vector3,
    options?: TraceOptions
  ): { endPos: Vector3; velocity: Vector3; hitCount: number; stepped: boolean } {
    const startO = startPos.clone();
    const startV = velocity.clone();

    // First, try a normal slide move
    const firstResult = this.slideMove(startPos, velocity, options);

    // If we moved the full distance without hitting anything, we're done
    if (firstResult.hitCount === 0) {
      return { ...firstResult, stepped: false };
    }

    // Check if we're on ground (can only step if grounded)
    // With asymmetric box, origin is 24 units above feet.
    // Tracing down by STEPSIZE checks if there's ground within step distance.
    const downTrace = this.trace(
      startO,
      startO.add(new Vector3(0, -STEPSIZE, 0)),
      options
    );

    // If not on ground (trace went full distance down), don't try to step
    if (downTrace.fraction >= 1.0) {
      return { ...firstResult, stepped: false };
    }

    // Check ground normal - only step on floors (normal pointing up)
    if (downTrace.normal && downTrace.normal.y < 0.7) {
      return { ...firstResult, stepped: false };
    }

    // Save the non-stepped result for comparison
    const downO = firstResult.endPos.clone();
    const downV = firstResult.velocity.clone();

    // Try stepping up by STEPSIZE
    const upDest = startO.add(new Vector3(0, STEPSIZE, 0));
    const upTrace = this.trace(startO, upDest, options);

    // Only abort if completely stuck (allSolid), not just touching a wall (startSolid)
    if (upTrace.allSolid) {
      return { ...firstResult, stepped: false };
    }

    // Calculate how much we actually stepped up
    const stepSize = upTrace.endPos.y - startO.y;

    // Try slide move from raised position
    const raisedResult = this.slideMove(upTrace.endPos, startV, options);

    // Step back down by the same amount we stepped up
    const downDest = raisedResult.endPos.add(new Vector3(0, -stepSize, 0));
    const stepDownTrace = this.trace(raisedResult.endPos, downDest, options);

    if (!stepDownTrace.allSolid) {
      // Use the stepped position
      const steppedPos = stepDownTrace.endPos;

      // Clip velocity to ground if we landed
      let finalVel = raisedResult.velocity;
      if (stepDownTrace.fraction < 1.0 && stepDownTrace.normal) {
        finalVel = this.clipVelocity(raisedResult.velocity, stepDownTrace.normal);
      }

      // Compare: did stepping get us further?
      const nonStepDist = Vector3.Distance(startO, downO);
      const stepDist = Vector3.Distance(startO, steppedPos);

      if (stepDist > nonStepDist + 0.1) {
        // Stepping was better
        return {
          endPos: steppedPos,
          velocity: finalVel,
          hitCount: raisedResult.hitCount,
          stepped: true,
        };
      }
    }

    // Non-stepped result was better or equal
    return {
      endPos: downO,
      velocity: downV,
      hitCount: firstResult.hitCount,
      stepped: false,
    };
  }

  /**
   * Get content flags at a point
   */
  pointContents(point: Vector3): number {
    // Simple trace to same point
    const result = this.trace(point, point, { debug: false });
    return result.contents;
  }

  /**
   * Check if on ground
   */
  isOnGround(point: Vector3, _options?: TraceOptions): boolean {
    const groundCheck = this.findGround(point, 2);
    return groundCheck !== null;
  }

  /**
   * Find ground below point
   */
  findGround(point: Vector3, maxDistance: number = 100, options?: TraceOptions): { position: Vector3; normal: Vector3 } | null {
    const end = point.add(new Vector3(0, -maxDistance, 0));
    // Default to player collision size (16, 56) if no options, but allow overrides
    const traceOpts = { radius: 16, height: 56, ...options };
    const result = this.trace(point, end, traceOpts);

    if (result.fraction < 1.0 && result.normal) {
      return {
        position: result.endPos,
        normal: result.normal,
      };
    }

    return null;
  }

  /**
   * Get statistics
   */
  getStats(): CollisionStats {
    return {
      traceCount: this.stats.traceCount,
      hitCount: this.stats.hitCount,
      avgTraceTimeMs: this.stats.traceCount > 0
        ? this.stats.totalTraceTime / this.stats.traceCount
        : 0,
      backendStats: {
        brushCount: this.bsp?.brushes?.length || 0,
        isFBSP: this.isFBSP ? 1 : 0,
      },
    };
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.bsp = null;
    this.stats = { traceCount: 0, hitCount: 0, totalTraceTime: 0 };
  }
}

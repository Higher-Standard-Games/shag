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
import type { BspFile, BspBrush, BspLeaf, BspFace } from '../loader/bsp/BspLoader';
import { CollisionBackend, TraceResult, TraceOptions, CollisionStats, createDefaultTraceResult } from './CollisionBackend';
import { PatchTessellator } from './PatchTessellator';
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

// Face collision geometry
interface FaceCollisionGeometry {
  vertices: Vector3[];
  indices: number[];
  mins: Vector3;
  maxs: Vector3;
}

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

  private faceCollisionMeshes: (FaceCollisionGeometry | null)[] = [];

  // Stats
  private stats = {
    traceCount: 0,
    hitCount: 0,
    totalTraceTime: 0,
  };

  // Pre-allocated scratch vectors for stepSlideMove (avoid per-tick allocations)
  private readonly _ssm_startO = Vector3.Zero();
  private readonly _ssm_startV = Vector3.Zero();
  private readonly _ssm_downO = Vector3.Zero();
  private readonly _ssm_downV = Vector3.Zero();
  private readonly _ssm_traceEnd = Vector3.Zero();

  // Pre-filtered clip brush indices (built once during init, avoids per-trace full scan)
  private clipBrushIndices: number[] = [];

  // Pooled trace state to avoid per-trace allocations
  private readonly _pooledState: TraceState = {
    type: 'box',
    start: [0, 0, 0],
    end: [0, 0, 0],
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    extents: [0, 0, 0],
    contentMask: 0,
    result: {
      fraction: 1.0,
      endPos: [0, 0, 0],
      normal: null,
      startSolid: false,
      allSolid: false,
      contents: 0,
      hitBrushIndex: -1,
      hitTextureName: '',
    },
    debug: false,
  };



  async init(bsp: BspFile, _scene?: Scene): Promise<void> {
    this.bsp = bsp;
    this.isFBSP = (bsp as any).header?.isFBSP ?? false;

    this.processFaces();
    this.buildClipBrushIndex();
  }

  /**
   * Pre-filter clip brushes once during init (avoids scanning ALL brushes every trace)
   */
  private buildClipBrushIndex(): void {
    if (!this.bsp) return;
    this.clipBrushIndices = [];

    for (let bi = 0; bi < this.bsp.brushes.length; bi++) {
      const brush = this.bsp.brushes[bi];
      if (!brush || brush.numSides < 4) continue;

      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

      const name = (texture.name || '').toLowerCase();
      if (name.includes('fullclip') || name.includes('playerclip')) {
        this.clipBrushIndices.push(bi);
      }
    }
  }

  private processFaces(): void {
    if (!this.bsp) return;

    this.faceCollisionMeshes = new Array(this.bsp.faces.length).fill(null);

    for (let i = 0; i < this.bsp.faces.length; i++) {
      const face = this.bsp.faces[i];

      // Filter by flags: Must be SOLID or PLAYERCLIP
      const texture = this.bsp.textures[face.textureIndex];
      if (!texture) {
        continue;
      }

      const isSolid = (texture.contentFlags & ContentFlags.SOLID) !== 0;
      const isPlayerClip = (texture.contentFlags & ContentFlags.PLAYERCLIP) !== 0;

      if (!isSolid && !isPlayerClip) {
        continue;
      }

      // Type 2: Patch
      if (face.faceType === 2) {
        // Use higher tessellation (5) to match visual mesh and prevent holes
        const mesh = PatchTessellator.buildPatch(this.bsp, face, 5);
        if (mesh) {
          this.faceCollisionMeshes[i] = mesh;
        }
      }
      // Type 3: Mesh (Triangle Soup)
      else if (face.faceType === 3) {
        const mesh = this.buildMeshFace(face);
        if (mesh) {
          this.faceCollisionMeshes[i] = mesh;
        }
      }
    }
  }


  private buildMeshFace(face: BspFace): FaceCollisionGeometry | null {
    if (!this.bsp) return null;

    const vertices: Vector3[] = [];
    const indices: number[] = [];
    const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    // Get vertices (Q3 to Babylon coords)
    for (let i = 0; i < face.numVertices; i++) {
      const v = this.bsp.vertices[face.firstVertex + i];
      const pos = new Vector3(v.position[0], v.position[2], v.position[1]); // Q3 to Babylon
      vertices.push(pos);

      min.x = Math.min(min.x, pos.x);
      min.y = Math.min(min.y, pos.y);
      min.z = Math.min(min.z, pos.z);
      max.x = Math.max(max.x, pos.x);
      max.y = Math.max(max.y, pos.y);
      max.z = Math.max(max.z, pos.z);
    }

    // Get indices and reverse winding
    for (let i = 0; i < face.numMeshVerts; i += 3) {
      const i0 = this.bsp.meshVerts[face.firstMeshVert + i];
      const i1 = this.bsp.meshVerts[face.firstMeshVert + i + 1];
      const i2 = this.bsp.meshVerts[face.firstMeshVert + i + 2];
      indices.push(i0, i2, i1); // Reverse winding
    }

    return {
      vertices,
      indices,
      mins: min,
      maxs: max
    };
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

    // Use exact bbox — Q3 does NOT shrink the collision hull.
    // SURFACE_CLIP_EPSILON in traceBrush provides the safety margin.
    const mins: [number, number, number] = [-radius, -radius, minsZ];
    const maxs: [number, number, number] = [radius, radius, maxsZ];

    // Content mask - default to SOLID | PLAYERCLIP for player collision
    const contentMask = options?.contentMask ?? PLAYER_CONTENTS;

    // Reset pooled trace state instead of allocating new objects
    const state = this._pooledState;
    state.type = 'box';
    state.start[0] = q3Start[0]; state.start[1] = q3Start[1]; state.start[2] = q3Start[2];
    state.end[0] = q3End[0]; state.end[1] = q3End[1]; state.end[2] = q3End[2];
    state.mins[0] = mins[0]; state.mins[1] = mins[1]; state.mins[2] = mins[2];
    state.maxs[0] = maxs[0]; state.maxs[1] = maxs[1]; state.maxs[2] = maxs[2];
    state.extents[0] = Math.max(Math.abs(mins[0]), Math.abs(maxs[0]));
    state.extents[1] = Math.max(Math.abs(mins[1]), Math.abs(maxs[1]));
    state.extents[2] = Math.max(Math.abs(mins[2]), Math.abs(maxs[2]));
    state.contentMask = contentMask;
    state.result.fraction = 1.0;
    state.result.endPos[0] = q3End[0]; state.result.endPos[1] = q3End[1]; state.result.endPos[2] = q3End[2];
    state.result.normal = null;
    state.result.startSolid = false;
    state.result.allSolid = false;
    state.result.contents = 0;
    state.result.hitBrushIndex = -1;
    state.result.hitTextureName = '';
    state.debug = options?.debug ?? false;

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



      // Check content flags
      if (!this.shouldCollideWith(texture, state.contentMask)) {
        continue;
      }

      // Check collision with brush
      this.traceBrush(brush, brushIndex, texture, state);
    }

    // Check patch/mesh faces
    this.traceLeafFaces(leaf, state);
  }

  /**
   * Check collision with patch/mesh faces in a leaf
   */
  private traceLeafFaces(leaf: BspLeaf, state: TraceState): void {
    if (!this.bsp || !this.faceCollisionMeshes || leaf.numLeafFaces === 0) return;

    // Calculate trace AABB for broadphase (Q3 coords)
    const traceMin: [number, number, number] = [
      Math.min(state.start[0], state.end[0]) + state.mins[0],
      Math.min(state.start[1], state.end[1]) + state.mins[1],
      Math.min(state.start[2], state.end[2]) + state.mins[2],
    ];
    const traceMax: [number, number, number] = [
      Math.max(state.start[0], state.end[0]) + state.maxs[0],
      Math.max(state.start[1], state.end[1]) + state.maxs[1],
      Math.max(state.start[2], state.end[2]) + state.maxs[2],
    ];

    for (let i = 0; i < leaf.numLeafFaces; i++) {
      const faceIndex = this.bsp.leafFaces[leaf.firstLeafFace + i];
      const mesh = this.faceCollisionMeshes[faceIndex];
      if (!mesh) continue;

      // Broadphase: AABB check (Babylon coords in mesh, Q3 coords in trace)
      // Convert mesh AABB to Q3 for comparison
      const meshMinQ3: [number, number, number] = [mesh.mins.x, mesh.mins.z, mesh.mins.y];
      const meshMaxQ3: [number, number, number] = [mesh.maxs.x, mesh.maxs.z, mesh.maxs.y];

      if (traceMax[0] < meshMinQ3[0] || traceMin[0] > meshMaxQ3[0] ||
        traceMax[1] < meshMinQ3[1] || traceMin[1] > meshMaxQ3[1] ||
        traceMax[2] < meshMinQ3[2] || traceMin[2] > meshMaxQ3[2]) {
        continue;
      }

      // Check each triangle
      for (let ti = 0; ti < mesh.indices.length; ti += 3) {
        const p1 = mesh.vertices[mesh.indices[ti]];
        const p2 = mesh.vertices[mesh.indices[ti + 1]];
        const p3 = mesh.vertices[mesh.indices[ti + 2]];

        this.traceTriangleSwept(p1, p2, p3, state);
      }
    }
  }

  /**
   * Swept box vs triangle collision (simplified - uses box center ray for now)
   */
  private traceTriangleSwept(p1: Vector3, p2: Vector3, p3: Vector3, state: TraceState): void {
    // Convert triangle from Babylon to Q3 coords
    const v1: [number, number, number] = [p1.x, p1.z, p1.y];
    const v2: [number, number, number] = [p2.x, p2.z, p2.y];
    const v3: [number, number, number] = [p3.x, p3.z, p3.y];

    // Calculate triangle edges and normal
    const edge1: [number, number, number] = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
    const edge2: [number, number, number] = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];

    // Cross product for normal
    const normal: [number, number, number] = [
      edge1[1] * edge2[2] - edge1[2] * edge2[1],
      edge1[2] * edge2[0] - edge1[0] * edge2[2],
      edge1[0] * edge2[1] - edge1[1] * edge2[0]
    ];

    // Normalize
    const len = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    if (len < 0.0001) return; // Degenerate triangle

    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;

    // Project box onto normal to find offset
    const offset = Math.abs(state.extents[0] * normal[0]) +
      Math.abs(state.extents[1] * normal[1]) +
      Math.abs(state.extents[2] * normal[2]);

    // Calculate plane distance
    const planeDist = this.dot(v1, normal);

    // Distance from start/end to plane (with box offset)
    const startDist = this.dot(state.start, normal) - planeDist;
    const endDist = this.dot(state.end, normal) - planeDist;

    // Check if crossing plane (accounting for box thickness)
    if (startDist > offset && endDist > offset) return; // entirely in front
    if (startDist < -offset && endDist < -offset) return; // entirely behind

    // Check for start penetration (startSolid)
    // If we are within the "slab" (between offset and -offset)
    let isStartSolid = false;
    if (startDist < offset && startDist > -offset) {
      // Check 2D overlap at START position
      // We need to project start position and test overlap

      // Calculate intersection point for START (just the start point projected onto plane)
      // Actually we test 2D overlap of the box at start pos

      // Determine 2D box size based on projection
      const absNx = Math.abs(normal[0]);
      const absNy = Math.abs(normal[1]);
      const absNz = Math.abs(normal[2]);

      let u1: number, u2: number, u3: number;
      let v1Value: number, v2Value: number, v3Value: number;
      let startU: number, startV: number;

      if (absNx >= absNy && absNx >= absNz) {
        // Project onto YZ plane
        u1 = v1[1]; v1Value = v1[2];
        u2 = v2[1]; v2Value = v2[2];
        u3 = v3[1]; v3Value = v3[2];
        startU = state.start[1]; startV = state.start[2];
      } else if (absNy >= absNz) {
        // Project onto XZ plane
        u1 = v1[0]; v1Value = v1[2];
        u2 = v2[0]; v2Value = v2[2];
        u3 = v3[0]; v3Value = v3[2];
        startU = state.start[0]; startV = state.start[2];
      } else {
        // Project onto XY plane
        u1 = v1[0]; v1Value = v1[1];
        u2 = v2[0]; v2Value = v2[1];
        u3 = v3[0]; v3Value = v3[1];
        startU = state.start[0]; startV = state.start[1];
      }

      // Determine 2D box size based on projection
      let boxHalfW: number, boxHalfH: number;
      if (absNx >= absNy && absNx >= absNz) {
        boxHalfW = state.extents[1]; boxHalfH = state.extents[2];
      } else if (absNy >= absNz) {
        boxHalfW = state.extents[0]; boxHalfH = state.extents[2];
      } else {
        boxHalfW = state.extents[0]; boxHalfH = state.extents[1];
      }

      if (this.triangleAabbOverlap2D(
        startU, startV, boxHalfW, boxHalfH,
        u1, v1Value, u2, v2Value, u3, v3Value
      )) {
        isStartSolid = true;
      }
    }

    // Calculate intersection fraction
    let fraction: number;
    let hitBack = false;
    const PARALLEL_EPSILON = 0.001;

    if (isStartSolid) {
      // Only block if moving significantly into the surface
      if (startDist > endDist + PARALLEL_EPSILON) {
        // Moving further in - BLOCK IT (fraction 0)
        fraction = 0;
      } else {
        // Moving out or parallel - allow it (ignore this collision)
        return;
      }
    } else {
      if (startDist > endDist) {
        // Entering from front
        fraction = (startDist - offset) / (startDist - endDist);
      } else if (startDist < endDist) {
        // Entering from back
        fraction = (startDist + offset) / (startDist - endDist);
        hitBack = true;
      } else {
        return; // Parallel
      }
    }

    // Handle tunneling: If we started inside (fraction < 0) but moving towards plane
    if (fraction < 0) {
      if (fraction > -0.001) fraction = 0; // Snap to 0 if very close
      else return; // Truly behind
    }

    if (fraction >= state.result.fraction) return;

    // If startSolid, update state and return (priority)
    if (isStartSolid) {
      state.result.startSolid = true;
      // Also treat as a hit at fraction 0
      state.result.fraction = 0;
      state.result.normal = [...normal] as [number, number, number];
      state.result.contents = ContentFlags.SOLID;
      return;
    }

    // Calculate intersection point
    const hitPoint: [number, number, number] = [
      state.start[0] + fraction * (state.end[0] - state.start[0]),
      state.start[1] + fraction * (state.end[1] - state.start[1]),
      state.start[2] + fraction * (state.end[2] - state.start[2]),
    ];

    // Check if hit point is inside triangle (2D test in dominant plane)
    // Find dominant axis
    const absNx = Math.abs(normal[0]);
    const absNy = Math.abs(normal[1]);
    const absNz = Math.abs(normal[2]);

    let u1: number, u2: number, u3: number;
    let v1Value: number, v2Value: number, v3Value: number;
    let hitU: number, hitV: number;

    if (absNx >= absNy && absNx >= absNz) {
      // Project onto YZ plane
      u1 = v1[1]; v1Value = v1[2];
      u2 = v2[1]; v2Value = v2[2];
      u3 = v3[1]; v3Value = v3[2];
      hitU = hitPoint[1]; hitV = hitPoint[2];
    } else if (absNy >= absNz) {
      // Project onto XZ plane
      u1 = v1[0]; v1Value = v1[2];
      u2 = v2[0]; v2Value = v2[2];
      u3 = v3[0]; v3Value = v3[2];
      hitU = hitPoint[0]; hitV = hitPoint[2];
    } else {
      // Project onto XY plane
      u1 = v1[0]; v1Value = v1[1];
      u2 = v2[0]; v2Value = v2[1];
      u3 = v3[0]; v3Value = v3[1];
      hitU = hitPoint[0]; hitV = hitPoint[1];
    }

    // Determine 2D box size based on projection
    let boxHalfW: number, boxHalfH: number;
    if (absNx >= absNy && absNx >= absNz) {
      boxHalfW = state.extents[1]; boxHalfH = state.extents[2];
    } else if (absNy >= absNz) {
      boxHalfW = state.extents[0]; boxHalfH = state.extents[2];
    } else {
      boxHalfW = state.extents[0]; boxHalfH = state.extents[1];
    }

    // Perform AABB-Triangle intersection test in 2D centered at hitU, hitV
    if (!this.triangleAabbOverlap2D(
      hitU, hitV, boxHalfW, boxHalfH,
      u1, v1Value, u2, v2Value, u3, v3Value
    )) {
      return;
    }

    // Valid hit!
    // Valid hit!
    state.result.fraction = fraction;
    state.result.normal = hitBack
      ? [-normal[0], -normal[1], -normal[2]] as [number, number, number]
      : [...normal] as [number, number, number];
    state.result.contents = ContentFlags.SOLID;
  }

  /**
   * 2D AABB vs Triangle overlap test
   * Tests if an AABB centered at (cx, cy) overlaps with a triangle
   */
  private triangleAabbOverlap2D(
    cx: number, cy: number, hw: number, hh: number,
    u0: number, v0: number, u1: number, v1: number, u2: number, v2: number
  ): boolean {
    // 1. Test AABB against Triangle AABB
    const triMinU = Math.min(u0, u1, u2);
    const triMaxU = Math.max(u0, u1, u2);
    const triMinV = Math.min(v0, v1, v2);
    const triMaxV = Math.max(v0, v1, v2);

    if (triMinU > cx + hw || triMaxU < cx - hw ||
      triMinV > cy + hh || triMaxV < cy - hh) {
      return false;
    }

    // 2. Test Box vertices against Triangle edges (Edge normals)
    // Offset triangle to be relative to box center (0,0)
    const p0u = u0 - cx, p0v = v0 - cy;
    const p1u = u1 - cx, p1v = v1 - cy;
    const p2u = u2 - cx, p2v = v2 - cy;

    const f0u = p1u - p0u, f0v = p1v - p0v;
    const f1u = p2u - p1u, f1v = p2v - p1v;
    const f2u = p0u - p2u, f2v = p0v - p2v;

    // Normal to edge 0: (-f0v, f0u)
    // Project box extents: hw * |nx| + hh * |ny|
    // Project triangle vertex (p0 or p2 - both are same distance from edge 0)
    let axisU = -f0v, axisV = f0u;
    let dist = Math.abs(axisU * hw) + Math.abs(axisV * hh);
    let pDist = axisU * p0u + axisV * p0v; // All points on edge 0 project to same value
    let p2Dist = axisU * p2u + axisV * p2v; // Third point
    if (Math.min(pDist, p2Dist) > dist || Math.max(pDist, p2Dist) < -dist) return false;

    // Normal to edge 1
    axisU = -f1v; axisV = f1u;
    dist = Math.abs(axisU * hw) + Math.abs(axisV * hh);
    pDist = axisU * p1u + axisV * p1v;
    let p0Dist = axisU * p0u + axisV * p0v;
    if (Math.min(pDist, p0Dist) > dist || Math.max(pDist, p0Dist) < -dist) return false;

    // Normal to edge 2
    axisU = -f2v; axisV = f2u;
    dist = Math.abs(axisU * hw) + Math.abs(axisV * hh);
    pDist = axisU * p2u + axisV * p2v;
    let p1Dist = axisU * p1u + axisV * p1v;
    if (Math.min(pDist, p1Dist) > dist || Math.max(pDist, p1Dist) < -dist) return false;

    return true;
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
   * Check pre-filtered clip brushes (fullclip, playerclip)
   * Uses pre-built index from init() instead of scanning all brushes every trace
   */
  private traceAllClipBrushes(state: TraceState): void {
    if (!this.bsp) return;

    const wantsPlayerclip = (state.contentMask & ContentFlags.PLAYERCLIP) !== 0;
    if (!wantsPlayerclip) return;

    for (const bi of this.clipBrushIndices) {
      const brush = this.bsp.brushes[bi];
      if (!brush || brush.numSides < 4) continue;

      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

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

      // Q3 early-out: if start is in front of the plane AND (end is >= epsilon
      // in front OR moving away from plane), the trace is entirely outside this
      // brush. Without this stricter guard, AABB edges can report false
      // collisions when grazing brush edges by less than epsilon.
      const SURFACE_CLIP_EPSILON = 0.125; // Q3 value (1/8 unit)
      if (startDist > 0 && (endDist >= SURFACE_CLIP_EPSILON || endDist >= startDist)) {
        return;
      }

      // Both points inside this plane - continue to next plane
      if (startDist <= 0 && endDist <= 0) continue;

      // Crossing the plane
      if (startDist > endDist) {
        // Entering the brush — use SURFACE_CLIP_EPSILON (Q3: 0.125)
        const fraction = (startDist - SURFACE_CLIP_EPSILON) / (startDist - endDist);
        if (fraction < 0 ? 0 : fraction > enterFraction) {
          enterFraction = fraction < 0 ? 0 : fraction;
          hitPlaneNormal = [...plane.normal] as [number, number, number];
        }
      } else {
        // Leaving the brush
        const fraction = (startDist + SURFACE_CLIP_EPSILON) / (startDist - endDist);
        const clampedFrac = fraction > 1 ? 1 : fraction;
        if (clampedFrac < leaveFraction) {
          leaveFraction = clampedFrac;
        }
      }
    }

    // Check results
    if (!startOut) {
      // Started inside brush — compute least-penetrated plane normal
      // (the plane we're closest to escaping through, Q3 CM_TraceThroughBrush behavior)
      let bestDist = -Infinity;
      let bestNormal: [number, number, number] | null = null;

      for (let i = 0; i < brush.numSides; i++) {
        const side = this.bsp.brushSides[brush.firstSide + i];
        if (!side) continue;
        const plane = this.bsp.planes[side.planeIndex];
        if (!plane) continue;

        // Calculate how far inside this plane the start point is
        // (same offset logic as above)
        const offset: [number, number, number] = [0, 0, 0];
        for (let j = 0; j < 3; j++) {
          if (plane.normal[j] < 0) {
            offset[j] = state.maxs[j];
          } else {
            offset[j] = state.mins[j];
          }
        }
        const dist = (state.start[0] + offset[0]) * plane.normal[0] +
          (state.start[1] + offset[1]) * plane.normal[1] +
          (state.start[2] + offset[2]) * plane.normal[2] -
          plane.dist;

        // dist < 0 means inside; the LEAST negative is closest to escape
        if (dist > bestDist) {
          bestDist = dist;
          bestNormal = [...plane.normal] as [number, number, number];
        }
      }

      state.result.startSolid = true;
      state.result.contents = texture.contentFlags;
      if (bestNormal) {
        state.result.normal = bestNormal;
      }
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
        // Stuck entirely inside solid — try to nudge out in multiple directions
        // Q3-style recovery: find an escape direction instead of trapping the player
        const NUDGE = 2.0;
        const nudges = [
          new Vector3(NUDGE, 0, 0), new Vector3(-NUDGE, 0, 0),
          new Vector3(0, NUDGE, 0), new Vector3(0, -NUDGE, 0),
          new Vector3(0, 0, NUDGE), new Vector3(0, 0, -NUDGE),
          // Diagonals for corner junctions
          new Vector3(NUDGE, NUDGE, 0), new Vector3(-NUDGE, NUDGE, 0),
          new Vector3(0, NUDGE, NUDGE), new Vector3(0, NUDGE, -NUDGE),
        ];
        let escaped = false;
        for (const nudge of nudges) {
          const testPos = currentPos.add(nudge);
          const testTrace = this.trace(testPos, testPos, options);
          if (!testTrace.allSolid && !testTrace.startSolid) {
            currentPos.copyFrom(testPos);
            escaped = true;
            break;
          }
        }
        if (!escaped) {
          currentVel = Vector3.Zero();
          return { endPos: currentPos, velocity: currentVel, hitCount };
        }
        continue;
      }

      // DEPENETRATION: If we started inside geometry, nudge out slightly along normal.
      // Use a gentle nudge (0.05u) and fall through to normal fraction/clip handling.
      // The traceBrush fix means this handler now fires (it previously was dead code
      // because brushes never returned a startSolid normal). Keep the nudge small
      // to avoid jitter during fast movement like crouch slides.
      if (trace.startSolid && trace.normal) {
        currentPos.addInPlace(trace.normal.scale(0.05));
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
        if (into >= 0) {
          continue; // Moving away from this plane
        }

        // Clip against this plane
        clippedVel = this.clipVelocity(currentVel, planes[i]);

        // Check if clipped velocity enters another plane
        for (let j = 0; j < numPlanes; j++) {
          if (j === i) continue;
          if (Vector3.Dot(clippedVel, planes[j]) >= 0) {
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
            if (Vector3.Dot(clippedVel, planes[k]) >= 0) {
              continue;
            }
            // Stuck in a 3-plane corner — full stop (Q3 PM_SlideMove behavior)
            // Pushing downward can clip through floors; zeroing is always safe.
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
    const startO = this._ssm_startO;
    const startV = this._ssm_startV;
    startO.copyFrom(startPos);
    startV.copyFrom(velocity);

    // First, try a normal slide move
    const firstResult = this.slideMove(startPos, velocity, options);



    // If we moved the full distance without hitting anything, we're done
    if (firstResult.hitCount === 0) {
      return {
        endPos: firstResult.endPos,
        velocity: firstResult.velocity,
        hitCount: 0,
        stepped: false,
      };
    }

    // Check if we're on ground (can only step if grounded)
    // With asymmetric box, origin is 24 units above feet.
    // Tracing down by STEPSIZE checks if there's ground within step distance.
    this._ssm_traceEnd.set(startO.x, startO.y - STEPSIZE, startO.z);
    const downTrace = this.trace(
      startO,
      this._ssm_traceEnd,
      options
    );

    // If not on ground (trace went full distance down), don't try to step
    if (downTrace.fraction >= 1.0) {
      return {
        endPos: firstResult.endPos,
        velocity: firstResult.velocity,
        hitCount: firstResult.hitCount,
        stepped: false,
      };
    }

    // Check ground normal - only step on walkable floors (MIN_WALK_NORMAL = 0.7)
    if (downTrace.normal && downTrace.normal.y < 0.7) {
      return {
        endPos: firstResult.endPos,
        velocity: firstResult.velocity,
        hitCount: firstResult.hitCount,
        stepped: false,
      };
    }

    // Save the non-stepped result for comparison
    const downO = this._ssm_downO;
    const downV = this._ssm_downV;
    downO.copyFrom(firstResult.endPos);
    downV.copyFrom(firstResult.velocity);

    // Try stepping up by STEPSIZE
    this._ssm_traceEnd.set(startO.x, startO.y + STEPSIZE, startO.z);
    const upTrace = this.trace(startO, this._ssm_traceEnd, options);

    // Only abort if completely stuck (allSolid), not just touching a wall (startSolid)
    if (upTrace.allSolid) {
      return {
        endPos: firstResult.endPos,
        velocity: firstResult.velocity,
        hitCount: firstResult.hitCount,
        stepped: false,
      };
    }

    // Calculate how much we actually stepped up
    const stepSize = upTrace.endPos.y - startO.y;

    // Try slide move from raised position
    const raisedResult = this.slideMove(upTrace.endPos, startV, options);

    // Step back down by the same amount we stepped up
    this._ssm_traceEnd.set(
      raisedResult.endPos.x,
      raisedResult.endPos.y - stepSize,
      raisedResult.endPos.z
    );
    const stepDownTrace = this.trace(raisedResult.endPos, this._ssm_traceEnd, options);

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
      endPos: downO.clone(),
      velocity: downV.clone(),
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

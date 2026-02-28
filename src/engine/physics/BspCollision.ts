/**
 * BSP Collision Detection
 * 
 * Handles collision against Q3 BSP geometry (brushes and patches).
 * Supports both IBSP (Quake 3) and FBSP (Warsow/qfusion) formats.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { BspFile, BspBrush, BspPlane, BspLeaf, BspFace } from '../loader/bsp/BspLoader';
import { CollisionMasks, ContentFlags, SurfaceFlags } from './ContentFlags';
import { PatchTessellator } from './PatchTessellator';

/** Small epsilon for plane distance calculations */
const DIST_EPSILON = 0.03125; // 1/32

/**
 * Interface for pre-processed face collision geometry
 */
interface FaceCollisionGeometry {
  vertices: Vector3[];
  indices: number[];
  mins: Vector3;
  maxs: Vector3;
}

/** Result of a trace operation */
export interface TraceResult {
  /** Fraction of trace completed (0.0 = immediate hit, 1.0 = no hit) */
  fraction: number;
  /** End position of the trace */
  endPos: Vector3;
  /** Plane that was hit (if any) */
  plane: BspPlane | null;
  /** True if trace started inside a solid brush */
  startSolid: boolean;
  /** True if trace never left solid */
  allSolid: boolean;
  /** Content flags of the brush/volume hit */
  contents: number;

  /** Debug info */
  hitBrushIndex?: number;
  hitTextureName?: string;
}

export class BspCollision {
  private bsp: BspFile;
  private isFBSP: boolean;
  private faceCollisionMeshes: (FaceCollisionGeometry | null)[] = [];

  constructor(bsp: BspFile) {
    this.bsp = bsp;
    this.isFBSP = bsp.header.isFBSP;

    this.processFaces();
  }

  private processFaces(): void {
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
        const mesh = PatchTessellator.buildPatch(this.bsp, face); // Uses default tessLevel (5)
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
    const vertices: Vector3[] = [];
    const indices: number[] = [];
    const min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    const max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    // Get vertices
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

    // Get indices
    for (let i = 0; i < face.numMeshVerts; i++) {
      indices.push(this.bsp.meshVerts[face.firstMeshVert + i]);
    }

    // Reverse winding
    const reversedIndices: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      reversedIndices.push(indices[i], indices[i + 2], indices[i + 1]);
    }

    return {
      vertices,
      indices: reversedIndices,
      mins: min,
      maxs: max
    };
  }

  private getBrushTexture(brush: BspBrush): { name: string; contentFlags: number; surfaceFlags: number } | null {
    const textures = this.bsp.textures;
    if (brush.numSides <= 0) return null;

    const firstSide = this.bsp.brushSides[brush.firstSide];
    const bySide = firstSide?.shaderIndex;
    if (Number.isFinite(bySide) && bySide >= 0 && bySide < textures.length) {
      return textures[bySide] ?? null;
    }

    return null;
  }

  private getPlaneWithFlip(plane: BspPlane, flip: boolean): BspPlane {
    const sign = (this.isFBSP ? -1 : 1) * (flip ? -1 : 1);
    if (sign === 1) return plane;
    return {
      normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]],
      dist: -plane.dist,
    };
  }

  private traceBrushWithFlip(
    start: [number, number, number],
    end: [number, number, number],
    brush: BspBrush,
    result: TraceResult,
    _debug: boolean,
    flip: boolean
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

      const startDist = this.brushPlaneDistWithFlip(start, plane, flip);
      const endDist = this.brushPlaneDistWithFlip(end, plane, flip);

      if (startDist > 0) startOut = true;
      if (endDist > 0) endOut = true;

      if (startDist > 0 && endDist > 0) {
        return;
      }

      if (startDist <= 0 && endDist <= 0) {
        continue;
      }

      if (startDist > endDist) {
        // Entering the brush
        const frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        if (frac > enterFrac) {
          enterFrac = frac;
          hitPlane = this.getPlaneWithFlip(plane, flip);
        }
      } else {
        // Leaving the brush
        const frac = (startDist + DIST_EPSILON) / (startDist - endDist);
        if (frac < leaveFrac) {
          leaveFrac = frac;
        }
      }
    }

    if (!startOut) {
      result.startSolid = true;
      if (!endOut) {
        result.allSolid = true;
        result.fraction = 0;
        result.endPos = new Vector3(start[0], start[2], start[1]);
      }
      return;
    }

    if (enterFrac < leaveFrac) {
      if (enterFrac > -1 && enterFrac < result.fraction) {
        if (enterFrac < 0) enterFrac = 0;
        result.fraction = enterFrac;
        result.plane = hitPlane;
      }
    }
  }



  /**
   * Ray-Triangle Intersection (Möller–Trumbore)
   */
  private traceTriangle(
    start: Vector3,
    end: Vector3,
    p1: Vector3,
    p2: Vector3,
    p3: Vector3,
    result: TraceResult,
    debug: boolean
  ): void {
    const edge1 = p2.subtract(p1);
    const edge2 = p3.subtract(p1);
    const direction = end.subtract(start);
    const len = direction.length();
    if (len < 0.001) return;
    const dir = direction.scale(1 / len);

    const h = Vector3.Cross(dir, edge2);
    const a = Vector3.Dot(edge1, h);

    if (a > -0.00001 && a < 0.00001) return; // Parallel

    const f = 1.0 / a;
    const s = start.subtract(p1);
    const u = f * Vector3.Dot(s, h);

    if (u < 0.0 || u > 1.0) return;

    const q = Vector3.Cross(s, edge1);
    const v = f * Vector3.Dot(dir, q);

    if (v < 0.0 || u + v > 1.0) return;

    const t = f * Vector3.Dot(edge2, q);

    if (t > 0.001 && t < len) {
      const frac = t / len;
      if (frac < result.fraction) {
        result.fraction = frac;
        // Calculate normal
        const normal = Vector3.Cross(edge1, edge2).normalize();
        // Ensure normal points against ray
        if (Vector3.Dot(normal, dir) > 0) {
          normal.scaleInPlace(-1);
        }
        // Create BSP plane from normal/dist
        result.plane = {
          normal: [normal.x, normal.z, normal.y], // Babylon to Q3
          dist: Vector3.Dot(normal, p1)
        };
        if (debug) console.log(`  TRI HIT! fraction=${frac.toFixed(4)}`);
      }
    }
  }

  /**
   * Box-Triangle Intersection (Simplified for Q3 AABB trace)
   */
  private traceTriangleBox(
    start: Vector3,
    end: Vector3,
    _mins: Vector3,
    _maxs: Vector3,
    p1: Vector3,
    p2: Vector3,
    p3: Vector3,
    result: TraceResult,
    debug: boolean
  ): void {
    this.traceTriangle(start, end, p1, p2, p3, result, debug);
  }

  private traceLeafFaces(
    leaf: BspLeaf,
    start: Vector3,
    end: Vector3,
    result: TraceResult,
    debug: boolean,
    mins?: Vector3,
    maxs?: Vector3
  ): void {
    if (!this.faceCollisionMeshes || leaf.numLeafFaces === 0) return;

    const traceMin = new Vector3(
      Math.min(start.x, end.x) + (mins?.x || 0),
      Math.min(start.y, end.y) + (mins?.y || 0),
      Math.min(start.z, end.z) + (mins?.z || 0)
    );
    const traceMax = new Vector3(
      Math.max(start.x, end.x) + (maxs?.x || 0),
      Math.max(start.y, end.y) + (maxs?.y || 0),
      Math.max(start.z, end.z) + (maxs?.z || 0)
    );

    for (let i = 0; i < leaf.numLeafFaces; i++) {
      const faceIndex = this.bsp.leafFaces[leaf.firstLeafFace + i];
      const mesh = this.faceCollisionMeshes[faceIndex];
      if (!mesh) continue;

      // AABB Check
      if (traceMax.x < mesh.mins.x || traceMin.x > mesh.maxs.x ||
        traceMax.y < mesh.mins.y || traceMin.y > mesh.maxs.y ||
        traceMax.z < mesh.mins.z || traceMin.z > mesh.maxs.z) {
        continue;
      }

      // Trace Triangles
      for (let ti = 0; ti < mesh.indices.length; ti += 3) {
        const p1 = mesh.vertices[mesh.indices[ti]];
        const p2 = mesh.vertices[mesh.indices[ti + 1]];
        const p3 = mesh.vertices[mesh.indices[ti + 2]];

        if (mins && maxs) {
          this.traceTriangleBox(start, end, mins, maxs, p1, p2, p3, result as any, debug);
        } else {
          this.traceTriangle(start, end, p1, p2, p3, result, debug);
        }
      }
    }
  }

  /**
   * Update BSP reference (e.g., after map change)
   */
  public setBsp(bsp: BspFile): void {
    this.bsp = bsp;
    this.isFBSP = bsp.header.isFBSP;
    this.processFaces();
  }

  /**
   * Trace a point from start to end
   * Returns collision info including fraction and hit plane
   */
  public tracePoint(
    start: Vector3,
    end: Vector3,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false,
    nodrawSolidsOnly: boolean = false
  ): TraceResult {
    const result: TraceResult = {
      fraction: 1.0,
      endPos: end.clone(),
      plane: null,
      startSolid: false,
      allSolid: false,
      contents: 0,
    };

    const q3Start: [number, number, number] = [start.x, start.z, start.y];
    const q3End: [number, number, number] = [end.x, end.z, end.y];

    if (debug) {
      console.log(`[BspCollision] Babylon input: (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)})`);
      console.log(`[BspCollision] Q3 coords: (${q3Start[0].toFixed(1)}, ${q3Start[1].toFixed(1)}, ${q3Start[2].toFixed(1)}) → (${q3End[0].toFixed(1)}, ${q3End[1].toFixed(1)}, ${q3End[2].toFixed(1)})`);
      console.log(`[BspCollision] BSP has ${this.bsp.brushes.length} brushes, ${this.bsp.leafs.length} leafs`);
    }

    this.traceNode(q3Start, q3End, 0, 0, 1, result, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);

    if (result.fraction < 1.0) {
      result.endPos = Vector3.Lerp(start, end, result.fraction);
    }

    if (debug) {
      console.log(`[BspCollision] Result: fraction=${result.fraction.toFixed(4)}, startSolid=${result.startSolid}`);
    }

    return result;
  }

  public traceBox(
    start: Vector3,
    end: Vector3,
    mins: Vector3,
    maxs: Vector3,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false,
    nodrawSolidsOnly: boolean = false
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

    this.traceNodeBox(q3Start, q3End, 0, 0, 1, result, q3Mins, q3Maxs, extents, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);

    if (result.fraction < 1.0) {
      result.endPos = Vector3.Lerp(start, end, result.fraction);
    }

    return result;
  }

  public pointContents(point: Vector3): number {
    const q3Point: [number, number, number] = [point.x, point.z, point.y];
    const leaf = this.findLeaf(q3Point);
    if (!leaf) return 0;

    let contents = 0;
    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      const brush = this.bsp.brushes[brushIndex];

      if (this.pointInBrush(q3Point, brush)) {
        const texture = this.getBrushTexture(brush);
        if (texture) {
          contents |= texture.contentFlags;
        }
      }
    }
    return contents;
  }

  public clipVelocity(velocity: Vector3, normal: Vector3, overbounce: number = 1.0): Vector3 {
    const backoff = Vector3.Dot(velocity, normal) * overbounce;
    return velocity.subtract(normal.scale(backoff));
  }

  // =========================================================================
  // Internal Methods
  // =========================================================================

  private traceNode(
    start: [number, number, number],
    end: [number, number, number],
    nodeIndex: number,
    startFrac: number,
    endFrac: number,
    result: TraceResult,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false,
    nodrawSolidsOnly: boolean = false
  ): void {
    if (result.fraction <= startFrac) return;

    if (nodeIndex < 0) {
      const leafIndex = -(nodeIndex + 1);
      const leaf = this.bsp.leafs[leafIndex];
      if (leaf) {
        if (debug) {
          console.log(`[BspCollision] Leaf ${leafIndex}: ${leaf.numLeafBrushes} brushes`);
        }
        this.traceLeaf(start, end, leaf, result, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
      }
      return;
    }

    const node = this.bsp.nodes[nodeIndex];
    if (!node) return;

    const plane = this.bsp.planes[node.planeIndex];
    if (!plane) return;

    const startDist = this.planeDist(start, plane);
    const endDist = this.planeDist(end, plane);

    if (startDist >= DIST_EPSILON && endDist >= DIST_EPSILON) {
      this.traceNode(start, end, node.children[0], startFrac, endFrac, result, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
      return;
    }

    if (startDist < -DIST_EPSILON && endDist < -DIST_EPSILON) {
      this.traceNode(start, end, node.children[1], startFrac, endFrac, result, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
      return;
    }

    let side: number;
    let frac1: number;
    let frac2: number;

    if (startDist < endDist) {
      side = 1;
      const invDist = 1.0 / (startDist - endDist);
      frac1 = (startDist - DIST_EPSILON) * invDist;
      frac2 = (startDist + DIST_EPSILON) * invDist;
    } else if (startDist > endDist) {
      side = 0;
      const invDist = 1.0 / (startDist - endDist);
      frac1 = (startDist + DIST_EPSILON) * invDist;
      frac2 = (startDist - DIST_EPSILON) * invDist;
    } else {
      side = 0;
      frac1 = 1;
      frac2 = 0;
    }

    frac1 = Math.max(0, Math.min(1, frac1));
    frac2 = Math.max(0, Math.min(1, frac2));

    const midFrac = startFrac + (endFrac - startFrac) * frac1;
    const mid: [number, number, number] = [
      start[0] + frac1 * (end[0] - start[0]),
      start[1] + frac1 * (end[1] - start[1]),
      start[2] + frac1 * (end[2] - start[2]),
    ];

    const nearNode = side === 0 ? node.children[0] : node.children[1];
    this.traceNode(start, mid, nearNode, startFrac, midFrac, result, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);

    const midFrac2 = startFrac + (endFrac - startFrac) * frac2;
    const mid2: [number, number, number] = [
      start[0] + frac2 * (end[0] - start[0]),
      start[1] + frac2 * (end[1] - start[1]),
      start[2] + frac2 * (end[2] - start[2]),
    ];

    const farNode = side === 0 ? node.children[1] : node.children[0];
    this.traceNode(mid2, end, farNode, midFrac2, endFrac, result, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
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
    clipTexturesOnly: boolean = false,
    nodrawSolidsOnly: boolean = false
  ): void {
    if (result.realfraction <= startFrac) return;

    if (nodeIndex < 0) {
      const leafIndex = -(nodeIndex + 1);
      const leaf = this.bsp.leafs[leafIndex];
      if (leaf) {
        this.traceLeafBox(start, end, leaf, result, mins, maxs, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
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
      this.traceNodeBox(start, end, node.children[0], startFrac, endFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
      return;
    }
    if (t1 < -offset && t2 < -offset) {
      this.traceNodeBox(start, end, node.children[1], startFrac, endFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
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
    this.traceNodeBox(start, mid, nearNode, startFrac, midFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);

    frac2 = Math.max(0, Math.min(1, frac2));
    const midFrac2 = startFrac + (endFrac - startFrac) * frac2;
    const mid2: [number, number, number] = [
      start[0] + frac2 * (end[0] - start[0]),
      start[1] + frac2 * (end[1] - start[1]),
      start[2] + frac2 * (end[2] - start[2]),
    ];

    const farNode = node.children[side ^ 1];
    this.traceNodeBox(mid2, end, farNode, midFrac2, endFrac, result, mins, maxs, extents, debug, contentsMask, clipTexturesOnly, nodrawSolidsOnly);
  }

  private traceLeaf(
    start: [number, number, number],
    end: [number, number, number],
    leaf: BspLeaf,
    result: TraceResult,
    debug: boolean = false,
    contentsMask: number = CollisionMasks.PLAYERSOLID,
    clipTexturesOnly: boolean = false,
    nodrawSolidsOnly: boolean = false
  ): void {
    // 1. Trace Faces (Patches/Meshes)
    const vStart = new Vector3(start[0], start[2], start[1]);
    const vEnd = new Vector3(end[0], end[2], end[1]);
    this.traceLeafFaces(leaf, vStart, vEnd, result, debug);

    // 2. Trace Brushes
    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      const brush = this.bsp.brushes[brushIndex];
      if (!brush || brush.numSides < 1) continue;

      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

      if (clipTexturesOnly && !this.isClipTexture(texture.name, texture.contentFlags)) continue;
      if (nodrawSolidsOnly && !this.isNodrawSolidTexture(texture.name, texture.surfaceFlags)) continue;

      if (clipTexturesOnly && brush.numSides < 4) continue;

      if (!this.isContentsSolid(texture.contentFlags, texture.surfaceFlags, contentsMask)) continue;

      const prevFrac = result.fraction;
      const prevStartSolid = result.startSolid;
      if (clipTexturesOnly && this.isFBSP) {
        const snap = this.cloneTraceResult(result);
        const candA = this.cloneTraceResult(result);
        this.traceBrushWithFlip(start, end, brush, candA, debug, false);
        const candB = this.cloneTraceResult(result);
        this.traceBrushWithFlip(start, end, brush, candB, debug, true);
        const best = this.pickBetterTraceResult(candA, candB);
        this.applyTraceResult(result, snap, best);
      } else {
        this.traceBrush(start, end, brush, result, debug);
      }
      if (result.fraction < prevFrac || (!prevStartSolid && result.startSolid)) {
        result.hitBrushIndex = brushIndex;
        result.hitTextureName = texture.name;
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
    clipTexturesOnly: boolean = false,
    nodrawSolidsOnly: boolean = false
  ): void {
    // 1. Trace Faces (Patches/Meshes) - Approximated as ray for now in traceLeafFaces
    const vStart = new Vector3(start[0], start[2], start[1]);
    const vEnd = new Vector3(end[0], end[2], end[1]);
    const vMins = new Vector3(mins[0], mins[2], mins[1]);
    const vMaxs = new Vector3(maxs[0], maxs[2], maxs[1]);
    this.traceLeafFaces(leaf, vStart, vEnd, result, debug, vMins, vMaxs);

    // 2. Trace Brushes
    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      const brush = this.bsp.brushes[brushIndex];
      if (!brush || brush.numSides < 1) continue;

      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

      if (clipTexturesOnly && !this.isClipTexture(texture.name, texture.contentFlags)) continue;
      if (nodrawSolidsOnly && !this.isNodrawSolidTexture(texture.name, texture.surfaceFlags)) continue;

      if (!this.isContentsSolid(texture.contentFlags, texture.surfaceFlags, contentsMask)) continue;

      if (clipTexturesOnly && brush.numSides < 4) continue;

      const prevRealFrac = result.realfraction;
      const prevStartSolid = result.startSolid;
      if (clipTexturesOnly && this.isFBSP) {
        const snap = this.cloneTraceResultBox(result);
        const candA = this.cloneTraceResultBox(result);
        this.traceBrushBoxWithFlip(start, end, mins, maxs, brush, candA, debug, false);
        const candB = this.cloneTraceResultBox(result);
        this.traceBrushBoxWithFlip(start, end, mins, maxs, brush, candB, debug, true);
        const best = this.pickBetterTraceResultBox(candA, candB);
        this.applyTraceResultBox(result, snap, best);
      } else {
        this.traceBrushBox(start, end, mins, maxs, brush, result, debug);
      }
      if (result.realfraction < prevRealFrac || (!prevStartSolid && result.startSolid)) {
        (result as TraceResult).hitBrushIndex = brushIndex;
        (result as TraceResult).hitTextureName = texture.name;
      }
    }
  }

  private cloneTraceResult(r: TraceResult): TraceResult {
    return {
      fraction: r.fraction,
      endPos: r.endPos.clone(),
      plane: r.plane,
      startSolid: r.startSolid,
      allSolid: r.allSolid,
      contents: r.contents,
      hitBrushIndex: r.hitBrushIndex,
      hitTextureName: r.hitTextureName,
    };
  }

  private applyTraceResult(dst: TraceResult, snap: TraceResult, best: TraceResult): void {
    if (best.fraction < snap.fraction || (!snap.startSolid && best.startSolid)) {
      dst.fraction = best.fraction;
      dst.endPos = best.endPos;
      dst.plane = best.plane;
      dst.startSolid = best.startSolid;
      dst.allSolid = best.allSolid;
      dst.contents = best.contents;
      dst.hitBrushIndex = best.hitBrushIndex;
      dst.hitTextureName = best.hitTextureName;
    }
  }

  private pickBetterTraceResult(a: TraceResult, b: TraceResult): TraceResult {
    if (a.fraction < b.fraction) return a;
    if (b.fraction < a.fraction) return b;
    if (!a.startSolid && b.startSolid) return b;
    return a;
  }

  private cloneTraceResultBox(r: TraceResult & { realfraction: number }): TraceResult & { realfraction: number } {
    return {
      fraction: r.fraction,
      realfraction: r.realfraction,
      endPos: r.endPos.clone(),
      plane: r.plane,
      startSolid: r.startSolid,
      allSolid: r.allSolid,
      contents: r.contents,
      hitBrushIndex: (r as any).hitBrushIndex,
      hitTextureName: (r as any).hitTextureName,
    };
  }

  private applyTraceResultBox(
    dst: TraceResult & { realfraction: number },
    snap: TraceResult & { realfraction: number },
    best: TraceResult & { realfraction: number }
  ): void {
    if (best.realfraction < snap.realfraction || (!snap.startSolid && best.startSolid)) {
      dst.fraction = best.fraction;
      dst.realfraction = best.realfraction;
      dst.endPos = best.endPos;
      dst.plane = best.plane;
      dst.startSolid = best.startSolid;
      dst.allSolid = best.allSolid;
      dst.contents = best.contents;
      (dst as any).hitBrushIndex = (best as any).hitBrushIndex;
      (dst as any).hitTextureName = (best as any).hitTextureName;
    }
  }

  private pickBetterTraceResultBox(
    a: TraceResult & { realfraction: number },
    b: TraceResult & { realfraction: number }
  ): TraceResult & { realfraction: number } {
    if (a.realfraction < b.realfraction) return a;
    if (b.realfraction < a.realfraction) return b;
    if (!a.startSolid && b.startSolid) return b;
    return a;
  }

  private isContentsSolid(contentFlags: number, surfaceFlags: number, contentsMask: number): boolean {
    if ((surfaceFlags & SurfaceFlags.NONSOLID) !== 0) return false;
    if ((surfaceFlags & SurfaceFlags.HINT) !== 0) return false;
    if (contentFlags & ContentFlags.DETAIL) return false;
    return (contentFlags & contentsMask) !== 0;
  }

  private isClipTexture(textureName: string, contentFlags: number): boolean {
    if ((contentFlags & ContentFlags.DETAIL) !== 0) return false;
    const name = (textureName || '').toLowerCase();
    return name === 'textures/common/fullclip' || name === 'textures/common/playerclip';
  }

  private isNodrawSolidTexture(textureName: string, surfaceFlags: number): boolean {
    if ((surfaceFlags & SurfaceFlags.NODRAW) !== 0) return true;
    const name = (textureName || '').toLowerCase();
    return name === 'textures/common/caulk' || name === 'textures/common/nodraw' || name.endsWith('/caulk') || name.endsWith('/nodraw');
  }

  private traceBrush(
    start: [number, number, number],
    end: [number, number, number],
    brush: BspBrush,
    result: TraceResult,
    _debug: boolean = false
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

      const startDist = this.brushPlaneDist(start, plane);
      const endDist = this.brushPlaneDist(end, plane);

      if (startDist > 0) startOut = true;
      if (endDist > 0) endOut = true;

      if (startDist > 0 && endDist > 0) return;
      if (startDist <= 0 && endDist <= 0) continue;

      if (startDist > endDist) {
        const frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        if (frac > enterFrac) {
          enterFrac = frac;
          hitPlane = this.getPlaneWithFlip(plane, false);
        }
      } else {
        const frac = (startDist + DIST_EPSILON) / (startDist - endDist);
        if (frac < leaveFrac) {
          leaveFrac = frac;
        }
      }
    }

    if (!startOut) {
      result.startSolid = true;
      if (!endOut) {
        result.allSolid = true;
        result.fraction = 0;
      }
      return;
    }

    if (enterFrac < leaveFrac) {
      if (enterFrac > -1 && enterFrac < result.fraction) {
        if (enterFrac < 0) enterFrac = 0;
        result.fraction = enterFrac;
        result.plane = hitPlane;
      }
    }
  }

  private traceBrushBox(
    start: [number, number, number],
    end: [number, number, number],
    mins: [number, number, number],
    maxs: [number, number, number],
    brush: BspBrush,
    result: TraceResult & { realfraction: number },
    _debug: boolean = false
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

      if (startDist > 0 && endDist > 0) return;
      if (startDist <= 0 && endDist <= 0) continue;

      if (startDist > endDist) {
        const frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        const frac2 = (startDist - 2 * DIST_EPSILON) / (startDist - endDist);
        if (frac > enterFrac) {
          enterFrac = frac;
          enterFrac2 = frac2;
          hitPlane = this.getPlaneWithFlip(plane, false);
        }
      } else {
        const frac = (startDist + DIST_EPSILON) / (startDist - endDist);
        if (frac < leaveFrac) {
          leaveFrac = frac;
        }
      }
    }

    if (!startOut) {
      result.startSolid = true;
      if (!endOut) {
        result.allSolid = true;
        result.fraction = 0;
        result.endPos = new Vector3(start[0], start[2], start[1]);
      }
      return;
    }

    if (enterFrac > leaveFrac) return;

    if (enterFrac < result.realfraction) {
      if (enterFrac2 < result.fraction) {
        result.realfraction = enterFrac;
        result.fraction = Math.max(0, Math.min(1, enterFrac2));
        result.plane = hitPlane;
      }
    }
  }

  private traceBrushBoxWithFlip(
    start: [number, number, number],
    end: [number, number, number],
    mins: [number, number, number],
    maxs: [number, number, number],
    brush: BspBrush,
    result: TraceResult & { realfraction: number },
    _debug: boolean,
    flip: boolean
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
      startDist = this.brushPlaneDistWithFlip(start, plane, flip) + startDist;
      endDist = this.brushPlaneDistWithFlip(end, plane, flip) + endDist;

      if (startDist > 0) startOut = true;
      if (endDist > 0) endOut = true;

      if (startDist > 0 && endDist > 0) return;
      if (startDist <= 0 && endDist <= 0) continue;

      if (startDist > endDist) {
        const frac = (startDist - DIST_EPSILON) / (startDist - endDist);
        const frac2 = (startDist - 2 * DIST_EPSILON) / (startDist - endDist);
        if (frac > enterFrac) {
          enterFrac = frac;
          enterFrac2 = frac2;
          hitPlane = this.getPlaneWithFlip(plane, flip);
        }
      } else {
        const frac = (startDist + DIST_EPSILON) / (startDist - endDist);
        if (frac < leaveFrac) {
          leaveFrac = frac;
        }
      }
    }

    if (!startOut) {
      result.startSolid = true;
      if (!endOut) {
        result.allSolid = true;
        result.fraction = 0;
        result.endPos = new Vector3(start[0], start[2], start[1]);
      }
      return;
    }

    if (enterFrac > leaveFrac) return;

    if (enterFrac < result.realfraction) {
      if (enterFrac2 < result.fraction) {
        result.realfraction = enterFrac;
        result.fraction = Math.max(0, Math.min(1, enterFrac2));
        result.plane = hitPlane;
      }
    }
  }

  private pointInBrush(point: [number, number, number], brush: BspBrush): boolean {
    for (let i = 0; i < brush.numSides; i++) {
      const side = this.bsp.brushSides[brush.firstSide + i];
      if (!side) continue;
      const plane = this.bsp.planes[side.planeIndex];
      if (!plane) continue;
      const dist = this.brushPlaneDist(point, plane);
      if (dist > 0) return false;
    }
    return true;
  }

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

  private planeDist(point: [number, number, number], plane: BspPlane): number {
    return (
      point[0] * plane.normal[0] +
      point[1] * plane.normal[1] +
      point[2] * plane.normal[2] -
      plane.dist
    );
  }

  private brushPlaneDist(point: [number, number, number], plane: BspPlane): number {
    const dist = (
      point[0] * plane.normal[0] +
      point[1] * plane.normal[1] +
      point[2] * plane.normal[2] -
      plane.dist
    );
    return this.isFBSP ? -dist : dist;
  }

  private brushPlaneDistWithFlip(point: [number, number, number], plane: BspPlane, flip: boolean): number {
    const dist = (
      point[0] * plane.normal[0] +
      point[1] * plane.normal[1] +
      point[2] * plane.normal[2] -
      plane.dist
    );
    const sign = (this.isFBSP ? -1 : 1) * (flip ? -1 : 1);
    return sign * dist;
  }
}

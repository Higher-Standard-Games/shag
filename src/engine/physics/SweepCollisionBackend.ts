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

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { extractLifts, LiftSystem } from "../../shared/bsp/LiftSystem";
import type { BspBrush, BspFace, BspFile, BspLeaf } from "../loader/bsp/BspLoader";
import {
  type CollisionBackend,
  type CollisionStats,
  createDefaultTraceResult,
  type TraceOptions,
  type TraceResult,
} from "./CollisionBackend";
import { type CollisionBounds, CollisionSpatialIndex, planeBounds } from "./CollisionSpatialIndex";
import { buildFacetPlanes, type FacetPlane } from "./FacetBevels";
import { PatchTessellator } from "./PatchTessellator";
import { PLAYER_HEIGHT, PLAYER_MINS_Z, PLAYER_RADIUS, STEPSIZE } from "./PlayerPhysicsConstants";

/** Shader-prefix exclusions for the triangle-soup compatibility collider.
 * Shader names do not establish the original entity or authored collision intent.
 */
const DECORATION_SHADER_RE = /^(models\/|mapobjects)/i;

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
  LADDER: 0x8,
  NODRAW: 0x80,
  HINT: 0x100,
  SKIP: 0x200,
  NONSOLID: 0x4000,
} as const;

// Default content mask for player collision
const PLAYER_CONTENTS = ContentFlags.SOLID | ContentFlags.PLAYERCLIP;

interface CollisionTexture {
  name: string;
  contentFlags: number;
  surfaceFlags: number;
  collisionMask: number;
}

// Face collision geometry
export interface FaceCollisionGeometry {
  vertices: Vector3[];
  indices: number[];
  mins: Vector3;
  maxs: Vector3;
  /**
   * Convex plane set per triangle, in Q3 space, built once at load: a flat run
   * of [nx, ny, nz, dist] quads, with {@link facetRanges} marking where each
   * triangle's planes begin.
   *
   * A swept box against a bare triangle plane slips in at the edges; these are
   * the bevels that close it (see FacetBevels). Packed rather than held as
   * objects because a busy map carries over a million of them — wbomb6 has
   * 1.13M across 92k collision triangles, which as `{normal: [], dist}` would
   * cost more heap than the rest of the map put together.
   */
  facetPlanes?: Float32Array;
  /** Start index into {@link facetPlanes} per triangle, plus a final end marker. */
  facetRanges?: Int32Array;
  facetIndex?: CollisionSpatialIndex;
}

// Trace type
type TraceType = "ray" | "box";

// Internal trace state
interface TraceState {
  type: TraceType;
  start: [number, number, number];
  end: [number, number, number];
  mins: [number, number, number];
  maxs: [number, number, number];
  extents: [number, number, number];
  contentMask: number;
  faceIndex: number;
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
  public lifts: LiftSystem | undefined;
  private liftBrushes = new Map<number, number>();
  private liftFaces = new Set<number>();

  /**
   * Brushes carrying SURF_LADDER, collected once at init.
   *
   * Climbing tests scan this list directly instead of walking the BSP tree.
   * Ladder brushes sit flush against the wall they are bolted to and stick out
   * about 16 units, so the player hull straddles a leaf boundary at exactly the
   * position where climbing has to work — a leaf lookup from the player origin
   * would find the open-air leaf and miss the brush. Shipped maps carry at most
   * ten of these (four of thirty-nine maps have any), so the scan is free.
   */
  private ladderBrushes: number[] = [];
  readonly type = "q3" as const;
  readonly name = "Sweep Collision (Experimental)";

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
  private brushVisits = new Uint32Array(0);
  private faceVisits = new Uint32Array(0);
  private traceGeneration = 0;
  private collisionTextures: CollisionTexture[] = [];
  private brushBounds: (CollisionBounds | null)[] = [];
  private clipIndex: CollisionSpatialIndex | null = null;
  private collisionTriangleCount = 0;
  private boundedTriangleCount = 0;
  private brushParents = new Int32Array(0);
  private prunedBrushTests = 0;

  // Pooled trace state to avoid per-trace allocations
  private readonly _pooledState: TraceState = {
    type: "box",
    start: [0, 0, 0],
    end: [0, 0, 0],
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    extents: [0, 0, 0],
    contentMask: 0,
    faceIndex: -1,
    result: {
      fraction: 1.0,
      endPos: [0, 0, 0],
      normal: null,
      startSolid: false,
      allSolid: false,
      contents: 0,
      hitBrushIndex: -1,
      hitTextureName: "",
    },
    debug: false,
  };

  async init(bsp: BspFile, _scene?: Scene): Promise<void> {
    this.bsp = bsp;
    this.liftBrushes.clear();
    this.liftFaces.clear();
    const definitions = extractLifts(bsp.entities, bsp.models);
    for (const d of definitions) {
      const model = bsp.models[d.modelIndex];
      for (let i = model.firstBrush; i < model.firstBrush + model.numBrushes; i++)
        this.liftBrushes.set(i, d.modelIndex);
      for (let i = model.firstFace; i < model.firstFace + model.numFaces; i++) this.liftFaces.add(i);
    }
    this.lifts = new LiftSystem(definitions, (start, end, exclude, only) => {
      const hit = this.trace(
        new Vector3(start.x, start.y, start.z),
        new Vector3(end.x, end.y, end.z),
        { radius: 16, height: 64 },
        exclude,
        only,
      );
      return {
        fraction: hit.fraction,
        solid: !!hit.startSolid,
        normalY: hit.normal?.y ?? 0,
        modelIndex: this.liftBrushes.get(hit.hitBrushIndex ?? -1) ?? -1,
      };
    });
    this.isFBSP = (bsp as any).header?.isFBSP ?? false;
    this.brushVisits = new Uint32Array(bsp.brushes.length);
    this.faceVisits = new Uint32Array(bsp.faces.length);
    this.traceGeneration = 0;
    this.collisionTextures = bsp.textures.map((texture) => {
      const name = (texture.name || "").toLowerCase();
      const flags = texture.contentFlags || 0;
      const surfaceFlags = texture.surfaceFlags || 0;
      let collisionMask = 0;
      if (!(surfaceFlags & (SurfaceFlags.NONSOLID | SurfaceFlags.HINT))) {
        if (
          flags & ContentFlags.SOLID ||
          name.includes("fullclip") ||
          (name.includes("clip") && !name.includes("playerclip"))
        )
          collisionMask |= ContentFlags.SOLID;
        if (flags & ContentFlags.PLAYERCLIP || name.includes("playerclip")) collisionMask |= ContentFlags.PLAYERCLIP;
      }
      return { name: texture.name || "", contentFlags: flags, surfaceFlags, collisionMask };
    });

    this.brushBounds = bsp.brushes.map((brush) => {
      const planes: number[] = [];
      for (let i = 0; i < brush.numSides; i++) {
        const side = bsp.brushSides[brush.firstSide + i];
        const plane = side && bsp.planes[side.planeIndex];
        if (!plane) return null;
        planes.push(...plane.normal, plane.dist);
      }
      return planeBounds(planes);
    });
    this.collisionTriangleCount = 0;
    this.boundedTriangleCount = 0;
    this.processFaces();
    this.buildClipBrushIndex();
    this.buildLadderBrushIndex();
    this.buildBrushContainment();
  }

  /** Strict containment only; keep original BSP data for contents and entities. */
  private buildBrushContainment(): void {
    if (!this.bsp) return;
    const bsp = this.bsp;
    this.brushParents = new Int32Array(bsp.brushes.length).fill(-1);
    this.prunedBrushTests = 0;
    const inline = new Set<number>();
    for (const model of bsp.models.slice(1)) {
      for (let i = model.firstBrush; i < model.firstBrush + model.numBrushes; i++) inline.add(i);
    }
    const ladders = new Set(this.ladderBrushes);
    const clips = new Set(this.clipBrushIndices);
    const leaves = bsp.brushes.map(() => new Set<number>());
    const leafBrushes = bsp.leafs.map((leaf, li) => {
      const references = new Set<number>();
      for (let i = 0; i < leaf.numLeafBrushes; i++) {
        const bi = bsp.leafBrushes[leaf.firstLeafBrush + i];
        references.add(bi);
        leaves[bi]?.add(li);
      }
      return references;
    });
    const eligible = bsp.brushes
      .map((brush, id) => ({ id, bounds: this.brushBounds[id], texture: this.getBrushTexture(brush) }))
      .filter(({ id, bounds, texture }) => bounds && texture?.collisionMask && !inline.has(id) && !ladders.has(id));
    const index = new CollisionSpatialIndex(eligible);
    for (const inner of eligible) {
      for (const id of index.query(inner.bounds!)) {
        if (id === inner.id || !this.brushBounds[id]) continue;
        const outer = bsp.brushes[id],
          texture = this.getBrushTexture(outer)!;
        if (
          texture.contentFlags !== inner.texture!.contentFlags ||
          texture.collisionMask !== inner.texture!.collisionMask
        )
          continue;
        // The containing brush must be encountered wherever the child could
        // be tested, including the independent clip fallback and unusual masks.
        if (clips.has(inner.id) && !clips.has(id)) continue;
        if (!leaves[inner.id].size && !clips.has(inner.id)) continue;
        if ([...leaves[inner.id]].some((li) => !leafBrushes[li].has(id))) continue;
        let contained = true;
        for (let i = 0; i < outer.numSides; i++) {
          const plane = bsp.planes[bsp.brushSides[outer.firstSide + i].planeIndex];
          let distance = 0;
          for (let axis = 0; axis < 3; axis++)
            distance += plane.normal[axis] * inner.bounds![axis + (plane.normal[axis] < 0 ? 0 : 3)];
          if (!(distance < plane.dist - 0.125)) {
            contained = false;
            break;
          }
        }
        if (contained) {
          this.brushParents[inner.id] = id;
          break;
        }
      }
    }
  }

  private hullStartsOutsideBrush(brush: BspBrush, state: TraceState): boolean {
    if (!this.bsp) return false;
    for (let i = 0; i < brush.numSides; i++) {
      const plane = this.bsp.planes[this.bsp.brushSides[brush.firstSide + i].planeIndex];
      let distance = -plane.dist;
      for (let axis = 0; axis < 3; axis++)
        distance +=
          (state.start[axis] + (plane.normal[axis] < 0 ? state.maxs[axis] : state.mins[axis])) * plane.normal[axis];
      if (distance > 0) return true;
    }
    return false;
  }

  /** Collect SURF_LADDER brushes once; see {@link ladderBrushes}. */
  private buildLadderBrushIndex(): void {
    if (!this.bsp) return;
    this.ladderBrushes = [];

    for (let bi = 0; bi < this.bsp.brushes.length; bi++) {
      const brush = this.bsp.brushes[bi];
      if (!brush || brush.numSides < 4) continue;
      if (this.isLadderBrush(brush)) this.ladderBrushes.push(bi);
    }
  }

  /**
   * A ladder brush is tagged on its faces, not on the brush shader, and which
   * of the two carries the flag varies by map — so both are checked.
   */
  private isLadderBrush(brush: BspBrush): boolean {
    if (!this.bsp) return false;
    if ((this.bsp.textures[brush.shaderIndex]?.surfaceFlags ?? 0) & SurfaceFlags.LADDER) return true;

    for (let i = 0; i < brush.numSides; i++) {
      const side = this.bsp.brushSides[brush.firstSide + i];
      if (!side) continue;
      if ((this.bsp.textures[side.shaderIndex]?.surfaceFlags ?? 0) & SurfaceFlags.LADDER) return true;
    }
    return false;
  }

  /**
   * Is any part of this body inside a climbable brush?
   *
   * Takes the whole hull rather than a point on purpose. Ladder brushes are
   * nonsolid volumes flush against their wall, reaching roughly a hull radius
   * into the room, so a player pressed up against the ladder has their ORIGIN
   * tangent to the brush's outer face — never inside it. Testing the origin as
   * a point makes climbing a coin flip on floating-point noise.
   */
  isInLadder(min: Vector3, max: Vector3): boolean {
    if (!this.bsp || !this.ladderBrushes.length) return false;

    // Babylon -> Q3 (Y and Z swap). Both corners are axis-aligned, so per-axis
    // min/max survive the swap and the box stays a box.
    const centre: [number, number, number] = [(min.x + max.x) / 2, (min.z + max.z) / 2, (min.y + max.y) / 2];
    const half: [number, number, number] = [(max.x - min.x) / 2, (max.z - min.z) / 2, (max.y - min.y) / 2];

    for (const brushIndex of this.ladderBrushes) {
      const brush = this.bsp.brushes[brushIndex];
      if (brush && this.pointInBrush(centre, brush, half)) return true;
    }
    return false;
  }

  /**
   * Collision geometry built for a BSP face, or null where a face carries none.
   *
   * Diagnostics only — `npm run audit:stuck` walks these triangles looking for
   * places a hull can penetrate. Nothing in the game path reads it.
   */
  getFaceCollision(faceIndex: number): FaceCollisionGeometry | null {
    return this.faceCollisionMeshes[faceIndex] ?? null;
  }

  /**
   * Pre-filter clip brushes once during init (avoids scanning ALL brushes every trace)
   */
  private buildClipBrushIndex(): void {
    if (!this.bsp) return;
    this.clipBrushIndices = [];

    for (let bi = 0; bi < this.bsp.brushes.length; bi++) {
      if (this.liftBrushes.has(bi)) continue;
      const brush = this.bsp.brushes[bi];
      if (!brush || brush.numSides < 4) continue;

      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

      const name = (texture.name || "").toLowerCase();
      if (name.includes("fullclip") || name.includes("playerclip")) {
        this.clipBrushIndices.push(bi);
      }
    }
    this.clipIndex = new CollisionSpatialIndex(
      this.clipBrushIndices.map((id) => ({ id, bounds: this.brushBounds[id] })),
    );
  }

  private sweptBounds(state: TraceState): CollisionBounds {
    return [
      Math.min(state.start[0], state.end[0]) + state.mins[0],
      Math.min(state.start[1], state.end[1]) + state.mins[1],
      Math.min(state.start[2], state.end[2]) + state.mins[2],
      Math.max(state.start[0], state.end[0]) + state.maxs[0],
      Math.max(state.start[1], state.end[1]) + state.maxs[1],
      Math.max(state.start[2], state.end[2]) + state.maxs[2],
    ];
  }

  private processFaces(): void {
    if (!this.bsp) return;

    this.faceCollisionMeshes = new Array(this.bsp.faces.length).fill(null);

    for (let i = 0; i < this.bsp.faces.length; i++) {
      if (this.liftFaces.has(i)) continue;
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
          this.buildFacets(mesh);
          this.faceCollisionMeshes[i] = mesh;
        }
      }
      // Type 3: Mesh (Triangle Soup)
      else if (face.faceType === 3) {
        // Triangle-soup compatibility collision is separate from authored BSP
        // brushes and patches. Decoration prefixes are a heuristic exclusion;
        // draw-surface shaders alone do not establish collision intent.
        if (DECORATION_SHADER_RE.test(texture.name || "")) {
          continue;
        }
        const mesh = this.buildMeshFace(face);
        if (mesh) {
          this.buildFacets(mesh);
          this.faceCollisionMeshes[i] = mesh;
        }
      }
    }
  }

  /**
   * Expand a face's triangles into convex facets, once, at load.
   *
   * Done here rather than per trace because the plane set is a pure function of
   * the geometry and the sweep is hot. Degenerate triangles produce no planes
   * and are skipped by the trace rather than swept as slivers.
   */
  private buildFacets(mesh: FaceCollisionGeometry): void {
    const triangleCount = Math.floor(mesh.indices.length / 3);
    const built: FacetPlane[][] = [];
    let total = 0;

    for (let i = 0; i < triangleCount; i++) {
      const a = mesh.vertices[mesh.indices[i * 3]];
      const b = mesh.vertices[mesh.indices[i * 3 + 1]];
      const c = mesh.vertices[mesh.indices[i * 3 + 2]];
      // Babylon -> Q3 (Y and Z swap), matching the space the sweep works in.
      const planes = a && b && c ? buildFacetPlanes([a.x, a.z, a.y], [b.x, b.z, b.y], [c.x, c.z, c.y]) : [];
      built.push(planes);
      total += planes.length;
    }

    const packed = new Float32Array(total * 4);
    const ranges = new Int32Array(triangleCount + 1);
    let cursor = 0;

    for (let i = 0; i < triangleCount; i++) {
      ranges[i] = cursor;
      for (const plane of built[i]) {
        packed[cursor * 4] = plane.normal[0];
        packed[cursor * 4 + 1] = plane.normal[1];
        packed[cursor * 4 + 2] = plane.normal[2];
        packed[cursor * 4 + 3] = plane.dist;
        cursor++;
      }
    }
    ranges[triangleCount] = cursor;

    mesh.facetPlanes = packed;
    mesh.facetRanges = ranges;
    const items = [];
    for (let i = 0; i < triangleCount; i++) {
      if (ranges[i + 1] <= ranges[i]) continue;
      const bounds = planeBounds(packed, ranges[i], ranges[i + 1]);
      items.push({ id: i, bounds });
      this.collisionTriangleCount++;
      if (bounds) this.boundedTriangleCount++;
    }
    mesh.facetIndex = new CollisionSpatialIndex(items);
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
      maxs: max,
    };
  }

  /**
   * Main trace function - performs swept box collision
   */
  trace(start: Vector3, end: Vector3, options?: TraceOptions, excludeModel = -1, onlyModel = -1): TraceResult {
    if (!this.bsp) {
      return createDefaultTraceResult(start, end);
    }

    const startTime = performance.now();
    this.stats.traceCount++;
    this.traceGeneration = (this.traceGeneration + 1) >>> 0;
    if (this.traceGeneration === 0) {
      this.brushVisits.fill(0);
      this.faceVisits.fill(0);
      this.traceGeneration = 1;
    }

    // Convert Babylon coords to Q3 coords (swap Y and Z)
    const q3Start: [number, number, number] = [start.x, start.z, start.y];
    const q3End: [number, number, number] = [end.x, end.z, end.y];

    // Get trace extents from options
    const radius = options?.radius ?? PLAYER_RADIUS;
    const height = options?.height ?? PLAYER_HEIGHT;

    // Q3-style ASYMMETRIC bounding box (Z is up in Q3 coords).
    // Preserves the player's below/above-origin split (PLAYER_MINS_Z / PLAYER_HEIGHT)
    // for any requested height. For the default PLAYER_HEIGHT (64): mins.z = -24,
    // maxs.z = +40 (PLAYER_MINS_Z = -24, PLAYER_MAXS_Z = 40).
    const minsZ = -(height * (-PLAYER_MINS_Z / PLAYER_HEIGHT)); // -24 at the default height 64
    const maxsZ = height + minsZ; // +40 at the default height 64

    // Use exact bbox — Q3 does NOT shrink the collision hull.
    // SURFACE_CLIP_EPSILON in traceBrush provides the safety margin.
    const mins: [number, number, number] = [-radius, -radius, minsZ];
    const maxs: [number, number, number] = [radius, radius, maxsZ];

    // Content mask - default to SOLID | PLAYERCLIP for player collision
    const contentMask = options?.contentMask ?? PLAYER_CONTENTS;

    // Reset pooled trace state instead of allocating new objects
    const state = this._pooledState;
    state.type = "box";
    state.start[0] = q3Start[0];
    state.start[1] = q3Start[1];
    state.start[2] = q3Start[2];
    state.end[0] = q3End[0];
    state.end[1] = q3End[1];
    state.end[2] = q3End[2];
    state.mins[0] = mins[0];
    state.mins[1] = mins[1];
    state.mins[2] = mins[2];
    state.maxs[0] = maxs[0];
    state.maxs[1] = maxs[1];
    state.maxs[2] = maxs[2];
    state.extents[0] = Math.max(Math.abs(mins[0]), Math.abs(maxs[0]));
    state.extents[1] = Math.max(Math.abs(mins[1]), Math.abs(maxs[1]));
    state.extents[2] = Math.max(Math.abs(mins[2]), Math.abs(maxs[2]));
    state.contentMask = contentMask;
    state.result.fraction = 1.0;
    state.result.endPos[0] = q3End[0];
    state.result.endPos[1] = q3End[1];
    state.result.endPos[2] = q3End[2];
    state.result.normal = null;
    state.result.startSolid = false;
    state.result.allSolid = false;
    state.result.contents = 0;
    state.result.hitBrushIndex = -1;
    state.result.hitTextureName = "";
    state.debug = options?.debug ?? false;

    if (state.debug) {
      console.log(
        `[SweepCollision] Trace start: (${q3Start[0].toFixed(1)}, ${q3Start[1].toFixed(1)}, ${q3Start[2].toFixed(1)})`,
      );
      console.log(
        `[SweepCollision] Trace end: (${q3End[0].toFixed(1)}, ${q3End[1].toFixed(1)}, ${q3End[2].toFixed(1)})`,
      );
      console.log(`[SweepCollision] ContentMask: 0x${contentMask.toString(16)}`);
    }

    // Traverse BSP tree for solid brushes
    if (onlyModel < 0) this.traceNode(0, 0.0, 1.0, state.start, state.end, state);

    // Spatial fallback for named clip brushes not reached through BSP leaves.
    if (onlyModel < 0) this.traceAllClipBrushes(state);

    // Inline brushes use model-local traces; retain the earliest world/model hit.
    for (const d of this.lifts?.definitions ?? []) {
      if (d.modelIndex === excludeModel || (onlyModel >= 0 && d.modelIndex !== onlyModel)) continue;
      const offset = this.lifts!.offset(d.modelIndex)!;
      const shift = [offset.x, offset.z, offset.y];
      const model = this.bsp.models[d.modelIndex];
      if (
        [0, 1, 2].some(
          (j) =>
            Math.min(q3Start[j], q3End[j]) + mins[j] > model.maxs[j] + shift[j] + 0.1 ||
            Math.max(q3Start[j], q3End[j]) + maxs[j] < model.mins[j] + shift[j] - 0.1,
        )
      )
        continue;
      for (let j = 0; j < 3; j++) {
        state.start[j] = q3Start[j] - shift[j];
        state.end[j] = q3End[j] - shift[j];
      }
      for (let i = model.firstBrush; i < model.firstBrush + model.numBrushes; i++) {
        const brush = this.bsp.brushes[i];
        const texture = this.getBrushTexture(brush);
        if (texture && this.shouldCollideWith(texture, contentMask)) this.traceBrush(brush, i, texture, state);
      }
    }
    for (let j = 0; j < 3; j++) {
      state.start[j] = q3Start[j];
      state.end[j] = q3End[j];
    }

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
      console.log(
        `[SweepCollision] HIT: fraction=${result.fraction.toFixed(3)} brush=${result.hitBrushIndex} tex="${result.hitTextureName}"`,
      );
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
    state: TraceState,
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
      offset =
        Math.abs(state.extents[0] * plane.normal[0]) +
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
      if (this.liftBrushes.has(brushIndex)) continue;
      if (this.brushVisits[brushIndex] === this.traceGeneration) continue;
      const brush = this.bsp.brushes[brushIndex];
      if (!brush || brush.numSides < 1) continue;

      // Get brush texture for content flags
      const texture = this.getBrushTexture(brush);
      if (!texture) continue;

      // Check content flags
      if (!this.shouldCollideWith(texture, state.contentMask)) {
        continue;
      }
      this.brushVisits[brushIndex] = this.traceGeneration;

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
      if (this.faceVisits[faceIndex] === this.traceGeneration) continue;
      this.faceVisits[faceIndex] = this.traceGeneration;

      // Broadphase: AABB check (Babylon coords in mesh, Q3 coords in trace)
      // Convert mesh AABB to Q3 for comparison
      const meshMinQ3: [number, number, number] = [mesh.mins.x, mesh.mins.z, mesh.mins.y];
      const meshMaxQ3: [number, number, number] = [mesh.maxs.x, mesh.maxs.z, mesh.maxs.y];

      if (
        traceMax[0] < meshMinQ3[0] ||
        traceMin[0] > meshMaxQ3[0] ||
        traceMax[1] < meshMinQ3[1] ||
        traceMin[1] > meshMaxQ3[1] ||
        traceMax[2] < meshMinQ3[2] ||
        traceMin[2] > meshMaxQ3[2]
      ) {
        continue;
      }

      const texture = this.collisionTextures[this.bsp.faces[faceIndex].textureIndex];
      if (!texture || !this.shouldCollideWith(texture, state.contentMask)) continue;

      // Sweep each triangle as a convex facet. Testing the triangle's own plane
      // alone leaves the box unblocked near every edge, which is how a hull
      // ends up inside a patch handrail it cannot escape.
      const planes = mesh.facetPlanes;
      const ranges = mesh.facetRanges;
      if (!planes || !ranges) continue;
      state.faceIndex = faceIndex;
      const candidates = mesh.facetIndex?.query(this.sweptBounds(state));
      if (candidates) {
        for (const ti of candidates) this.traceFacet(planes, ranges[ti], ranges[ti + 1], texture, state);
      } else {
        for (let ti = 0; ti + 1 < ranges.length; ti++) {
          if (ranges[ti + 1] > ranges[ti]) this.traceFacet(planes, ranges[ti], ranges[ti + 1], texture, state);
        }
      }
    }
  }

  /**
   * Sweep the box against one convex facet, using the same enter/leave solve as
   * traceBrush.
   *
   * Deliberately a sibling of traceBrush rather than a shared routine: that one
   * reads planes straight out of the BSP lumps by index, this one walks a
   * prebuilt array, and threading an accessor through the hottest loop in the
   * engine costs more than the twenty lines it would save.
   *
   * Each plane is offset by the box's support point along its normal, which
   * turns the swept-box problem into a point-vs-expanded-solid one. That is
   * exact here because the facet carries its edge and axial bevels (see
   * FacetBevels) — without them the same solve would let a hull through an edge.
   */
  private traceFacet(
    planes: Float32Array,
    first: number,
    last: number,
    texture: { name: string; contentFlags: number; surfaceFlags: number } | undefined,
    state: TraceState,
  ): void {
    if (!texture) return;

    let enterFraction = -1.0;
    let leaveFraction = 1.0;
    let startOut = false;
    let endOut = false;
    let hitPlane = -1;

    for (let i = first; i < last; i++) {
      const nx = planes[i * 4];
      const ny = planes[i * 4 + 1];
      const nz = planes[i * 4 + 2];
      const dist = planes[i * 4 + 3];

      const offsetX = nx < 0 ? state.maxs[0] : state.mins[0];
      const offsetY = ny < 0 ? state.maxs[1] : state.mins[1];
      const offsetZ = nz < 0 ? state.maxs[2] : state.mins[2];

      const startDist =
        (state.start[0] + offsetX) * nx + (state.start[1] + offsetY) * ny + (state.start[2] + offsetZ) * nz - dist;
      const endDist =
        (state.end[0] + offsetX) * nx + (state.end[1] + offsetY) * ny + (state.end[2] + offsetZ) * nz - dist;

      if (startDist > 0) startOut = true;
      if (endDist > 0) endOut = true;

      // Outside this plane for the whole move: the facet cannot be touched.
      if (startDist > 0 && endDist > 0) return;
      if (startDist <= 0 && endDist <= 0) continue;

      if (startDist > endDist) {
        const fraction = (startDist - 0.03125) / (startDist - endDist);
        if (fraction > enterFraction) {
          enterFraction = fraction;
          hitPlane = i;
        }
      } else {
        const fraction = (startDist + 0.03125) / (startDist - endDist);
        if (fraction < leaveFraction) leaveFraction = fraction;
      }
    }

    if (!startOut) {
      // Embedded contacts overwrite the recovery normal in visit order. Keep
      // their repeated visits; only non-embedded surfaces are order-independent.
      this.faceVisits[state.faceIndex] = 0;
      // Already inside. Report the plane the body is closest to escaping
      // through, which is the one that actually pushes it out — the flat face
      // of a facet is usually the wrong answer for an edge contact.
      let bestDist = -Infinity;
      let bestPlane = -1;

      for (let i = first; i < last; i++) {
        const nx = planes[i * 4];
        const ny = planes[i * 4 + 1];
        const nz = planes[i * 4 + 2];
        const offsetX = nx < 0 ? state.maxs[0] : state.mins[0];
        const offsetY = ny < 0 ? state.maxs[1] : state.mins[1];
        const offsetZ = nz < 0 ? state.maxs[2] : state.mins[2];
        const dist =
          (state.start[0] + offsetX) * nx +
          (state.start[1] + offsetY) * ny +
          (state.start[2] + offsetZ) * nz -
          planes[i * 4 + 3];
        if (dist > bestDist) {
          bestDist = dist;
          bestPlane = i;
        }
      }

      state.result.startSolid = true;
      state.result.contents = texture.contentFlags;
      if (bestPlane >= 0) {
        state.result.normal = [planes[bestPlane * 4], planes[bestPlane * 4 + 1], planes[bestPlane * 4 + 2]];
      }
      if (!endOut) {
        state.result.allSolid = true;
        state.result.fraction = 0;
      }
      return;
    }

    if (enterFraction < leaveFraction && enterFraction > -1 && enterFraction < state.result.fraction) {
      state.result.fraction = enterFraction < 0 ? 0 : enterFraction;
      state.result.normal =
        hitPlane >= 0 ? [planes[hitPlane * 4], planes[hitPlane * 4 + 1], planes[hitPlane * 4 + 2]] : null;
      state.result.contents = texture.contentFlags;
      state.result.hitTextureName = texture.name;
    }
  }

  /**
   * Apply the query mask to precomputed per-shader collision rules.
   */
  private shouldCollideWith(texture: CollisionTexture, contentMask: number): boolean {
    return (texture.collisionMask & contentMask) !== 0;
  }

  /** Immutable texture properties shared by brush and face queries. */
  private getBrushTexture(brush: BspBrush): CollisionTexture | null {
    if (!this.bsp) return null;
    return (
      this.collisionTextures[brush.shaderIndex] ??
      this.collisionTextures[this.bsp.brushSides[brush.firstSide]?.shaderIndex] ??
      null
    );
  }

  /**
   * Check pre-filtered clip brushes (fullclip, playerclip)
   * Uses pre-built index from init() instead of scanning all brushes every trace
   */
  private traceAllClipBrushes(state: TraceState): void {
    if (!this.bsp) return;

    const wantsPlayerclip = (state.contentMask & ContentFlags.PLAYERCLIP) !== 0;
    if (!wantsPlayerclip) return;

    for (const bi of this.clipIndex?.query(this.sweptBounds(state)) ?? this.clipBrushIndices) {
      if (this.brushVisits[bi] === this.traceGeneration) continue;
      this.brushVisits[bi] = this.traceGeneration;
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
  private traceBrush(
    brush: BspBrush,
    brushIndex: number,
    texture: { name: string; contentFlags: number; surfaceFlags: number },
    state: TraceState,
  ): void {
    if (!this.bsp) return;

    const bounds = this.brushBounds[brushIndex];
    if (bounds) {
      for (let axis = 0; axis < 3; axis++) {
        if (
          Math.max(state.start[axis], state.end[axis]) + state.maxs[axis] < bounds[axis] ||
          Math.min(state.start[axis], state.end[axis]) + state.mins[axis] > bounds[axis + 3]
        )
          return;
      }
    }
    const parent = this.brushParents[brushIndex] ?? -1;
    // Starting embedded can expose the child's recovery normal. Preserve it.
    if (parent >= 0 && this.hullStartsOutsideBrush(this.bsp.brushes[parent], state)) {
      this.prunedBrushTests++;
      return;
    }

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
      startDist =
        (state.start[0] + offset[0]) * plane.normal[0] +
        (state.start[1] + offset[1]) * plane.normal[1] +
        (state.start[2] + offset[2]) * plane.normal[2] -
        plane.dist;

      endDist =
        (state.end[0] + offset[0]) * plane.normal[0] +
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
      this.brushVisits[brushIndex] = 0;
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
        const dist =
          (state.start[0] + offset[0]) * plane.normal[0] +
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
    return out;
  }

  /**
   * Q3-style slide move - smooth movement with wall sliding
   * Returns the final position after sliding along surfaces
   */
  slideMove(
    startPos: Vector3,
    velocity: Vector3,
    options?: TraceOptions,
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
          new Vector3(NUDGE, 0, 0),
          new Vector3(-NUDGE, 0, 0),
          new Vector3(0, NUDGE, 0),
          new Vector3(0, -NUDGE, 0),
          new Vector3(0, 0, NUDGE),
          new Vector3(0, 0, -NUDGE),
          // Diagonals for corner junctions
          new Vector3(NUDGE, NUDGE, 0),
          new Vector3(-NUDGE, NUDGE, 0),
          new Vector3(0, NUDGE, NUDGE),
          new Vector3(0, NUDGE, -NUDGE),
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
    options?: TraceOptions,
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
    const downTrace = this.trace(startO, this._ssm_traceEnd, options);

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
    this._ssm_traceEnd.set(raisedResult.endPos.x, raisedResult.endPos.y - stepSize, raisedResult.endPos.z);
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
   * Content flags of the volumes containing a point.
   *
   * A genuine point query: descend the BSP tree to the leaf holding the point,
   * test the point against every brush that leaf references, and OR together
   * the contents of the ones it is inside. Nothing is filtered by solidity, so
   * water, slime, lava, fog and trigger volumes all report — which is the whole
   * reason to ask.
   *
   * Volumes overlap, so the result is a union rather than the contents of one
   * brush. Read individual bits, never equality.
   *
   * @param point Babylon-space position.
   * @param contentMask Optional filter. Omitted means "tell me everything".
   */
  pointContents(point: Vector3, contentMask?: number): number {
    if (!this.bsp) return 0;

    // Babylon -> Q3 (Y and Z swap)
    const q3: [number, number, number] = [point.x, point.z, point.y];

    const leaf = this.bsp.leafs[this.pointLeafIndex(q3)];
    if (!leaf) return 0;

    let contents = 0;
    for (let i = 0; i < leaf.numLeafBrushes; i++) {
      const brushIndex = this.bsp.leafBrushes[leaf.firstLeafBrush + i];
      if (this.liftBrushes.has(brushIndex)) continue;
      const brush = this.bsp.brushes[brushIndex];
      if (!brush || brush.numSides < 1) continue;

      const texture = this.getBrushTexture(brush);
      if (!texture || texture.contentFlags === 0) continue;
      // Nothing new to learn from this brush; skip the side test.
      if ((contents & texture.contentFlags) === texture.contentFlags) continue;

      if (this.pointInBrush(q3, brush)) {
        contents |= texture.contentFlags;
      }
    }

    for (const d of this.lifts?.definitions ?? []) {
      const offset = this.lifts!.offset(d.modelIndex)!;
      const local: [number, number, number] = [point.x - offset.x, point.z - offset.z, point.y - offset.y];
      const model = this.bsp.models[d.modelIndex];
      if ([0, 1, 2].some((j) => local[j] < model.mins[j] || local[j] > model.maxs[j])) continue;
      for (let i = model.firstBrush; i < model.firstBrush + model.numBrushes; i++) {
        const brush = this.bsp.brushes[i];
        const texture = this.getBrushTexture(brush);
        if (texture && this.pointInBrush(local, brush)) contents |= texture.contentFlags;
      }
    }
    return contentMask === undefined ? contents : contents & contentMask;
  }

  /**
   * Walk the BSP tree to the leaf containing a Q3-space point.
   *
   * Point descent, not the swept-box traversal — no hull extents, so a point
   * one unit above a floor lands in the room rather than in the floor.
   */
  private pointLeafIndex(q3: [number, number, number]): number {
    if (!this.bsp) return -1;

    let nodeIndex = 0;
    while (nodeIndex >= 0) {
      const node = this.bsp.nodes[nodeIndex];
      if (!node) return -1;
      const plane = this.bsp.planes[node.planeIndex];
      if (!plane) return -1;

      const dist = this.dot(q3, plane.normal) - plane.dist;
      nodeIndex = dist >= 0 ? node.children[0] : node.children[1];
    }

    return -(nodeIndex + 1);
  }

  /**
   * Is a Q3-space point inside this convex brush?
   *
   * Brush side planes face outward, so the point is inside only when it is
   * behind every one of them. No epsilon: a point exactly on the surface counts
   * as inside, which is what makes a waterline at z=56 report water at z=56
   * rather than depending on which way a float rounded.
   */
  /**
   * @param half - Optional Q3-space half-extents of a box centred on `q3`.
   *   Each plane is pushed out by the box's reach along that plane's normal,
   *   which turns a box-vs-brush overlap into a point-vs-expanded-brush test.
   *   Exact for any convex brush, not only axis-aligned ones — several shipped
   *   ladder brushes have angled faces.
   */
  private pointInBrush(
    q3: [number, number, number],
    brush: BspBrush,
    half?: readonly [number, number, number],
  ): boolean {
    if (!this.bsp) return false;

    for (let i = 0; i < brush.numSides; i++) {
      const side = this.bsp.brushSides[brush.firstSide + i];
      if (!side) return false;
      const plane = this.bsp.planes[side.planeIndex];
      if (!plane) return false;

      const offset = half
        ? Math.abs(half[0] * plane.normal[0]) +
          Math.abs(half[1] * plane.normal[1]) +
          Math.abs(half[2] * plane.normal[2])
        : 0;
      if (this.dot(q3, plane.normal) - plane.dist > offset) return false;
    }

    return true;
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
  findGround(
    point: Vector3,
    maxDistance: number = 100,
    options?: TraceOptions,
  ): { position: Vector3; normal: Vector3 } | null {
    const end = point.add(new Vector3(0, -maxDistance, 0));
    // Default to the canonical player hull, but allow overrides. (Previously
    // hardcoded height:56 — a stale leftover from before PLAYER_MAXS_Z was
    // raised 32→40; the probe hull was 3u shorter than the actual player.)
    const traceOpts = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT, ...options };
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
      avgTraceTimeMs: this.stats.traceCount > 0 ? this.stats.totalTraceTime / this.stats.traceCount : 0,
      backendStats: {
        brushCount: this.bsp?.brushes?.length || 0,
        isFBSP: this.isFBSP ? 1 : 0,
        boundedBrushCount: this.brushBounds.filter(Boolean).length,
        clipBrushCount: this.clipBrushIndices.length,
        collisionTriangleCount: this.collisionTriangleCount,
        boundedTriangleCount: this.boundedTriangleCount,
        redundantBrushCount: this.brushParents.filter((id) => id >= 0).length,
        prunedBrushTests: this.prunedBrushTests,
      },
    };
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.lifts = undefined;
    this.liftBrushes.clear();
    this.liftFaces.clear();
    this.ladderBrushes = [];
    this.brushVisits = new Uint32Array(0);
    this.faceVisits = new Uint32Array(0);
    this.faceCollisionMeshes = [];
    this.clipBrushIndices = [];
    this.collisionTextures = [];
    this.brushBounds = [];
    this.clipIndex = null;
    this.collisionTriangleCount = 0;
    this.boundedTriangleCount = 0;
    this.brushParents = new Int32Array(0);
    this.prunedBrushTests = 0;
    this.traceGeneration = 0;
    this.bsp = null;
    this.stats = { traceCount: 0, hitCount: 0, totalTraceTime: 0 };
  }
}

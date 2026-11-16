/**
 * The world part of SweepCollisionBackend.trace (the BSP node walk, leaf
 * brushes with their containment pruning, the clip-brush fallback and patch
 * facets) compiled from Rust to WebAssembly: native/collision-wasm, built into
 * WorldTrace.wasm beside this file. It reads the backend's own prepared
 * tables, copied into its memory once, and gives the same answers bit for bit
 * (native/collision-wasm/compare.ts replays recorded traces through both);
 * the movers stay in TypeScript. About twice as fast as the TypeScript walk.
 *
 * Built by the backend (`useCompiledWorldTrace`) from an instance of the
 * module, one per map: `WorldTraceWasm.ts` makes them in Node,
 * `WorldTraceWasmBrowser.ts` in the browser.
 */

import type { BspCollisionData } from "../loader/bsp/BspLoader";
import { type CollisionBounds, planeBounds } from "./CollisionSpatialIndex";

/** What the kernel's tables are built from: the backend's prepared data. */
export interface CompiledWorldSource {
  bsp: BspCollisionData;
  textures: readonly { name: string; contentFlags: number; surfaceFlags: number; collisionMask: number }[];
  /** A brush's collision texture (the backend's getBrushTexture), or null. */
  brushTexture(brushIndex: number): { name: string } | null;
  brushBounds: readonly (CollisionBounds | null)[];
  brushParents: Int32Array;
  /** Brushes of movers, which the world part leaves to them. */
  excludedBrush(brushIndex: number): boolean;
  clipBrushIndices: readonly number[];
  faceMeshes: readonly ({
    mins: { x: number; y: number; z: number };
    maxs: { x: number; y: number; z: number };
    facetPlanes?: Float64Array;
    facetRanges?: Int32Array;
  } | null)[];
}

/** The trace the kernel reads and writes: Q3 axes, as SweepCollisionBackend's trace state. */
export interface CompiledTraceState {
  start: ArrayLike<number>;
  end: ArrayLike<number>;
  mins: ArrayLike<number>;
  maxs: ArrayLike<number>;
  contentMask: number;
  result: {
    fraction: number;
    normal: [number, number, number] | null;
    startSolid: boolean;
    allSolid: boolean;
    contents: number;
    hitBrushIndex: number;
    hitTextureName: string;
    hitSurfaceFlags: number;
  };
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc(n: number): number;
  set_table(id: number, ptr: number, len: number): void;
  init(brushes: number, faces: number): void;
  trace_batch(input: number, output: number, count: number): void;
}

const IN = 13;
const OUT = 14;

export class CompiledWorldTrace {
  private readonly input: Float64Array;
  private readonly output: Float64Array;
  private readonly inputPtr: number;
  private readonly outputPtr: number;

  private constructor(
    private readonly kernel: Exports,
    private readonly textureNames: readonly string[],
  ) {
    this.inputPtr = kernel.alloc(IN);
    this.outputPtr = kernel.alloc(OUT);
    // After every allocation: views onto memory that no longer grows
    this.input = new Float64Array(kernel.memory.buffer, this.inputPtr, IN);
    this.output = new Float64Array(kernel.memory.buffer, this.outputPtr, OUT);
  }

  /** The kernel for a map in `instance`, a fresh instance of the module, which it then owns. */
  static create(instance: WebAssembly.Instance, source: CompiledWorldSource): CompiledWorldTrace {
    const kernel = instance.exports as unknown as Exports;
    const tables = worldTables(source);
    tables.forEach((table, id) => {
      const ptr = kernel.alloc(Math.ceil(table.byteLength / 8));
      const view =
        table instanceof Float64Array
          ? new Float64Array(kernel.memory.buffer, ptr, table.length)
          : new Int32Array(kernel.memory.buffer, ptr, table.length);
      view.set(table);
      kernel.set_table(id, ptr, table.length);
    });
    kernel.init(source.bsp.brushes.length, source.bsp.faces.length);
    return new CompiledWorldTrace(
      kernel,
      source.textures.map((texture) => texture.name),
    );
  }

  /** The world part of a trace: `state.result` as the TypeScript walk leaves it. */
  trace(state: CompiledTraceState): void {
    const input = this.input;
    for (let a = 0; a < 3; a++) {
      input[a] = state.start[a];
      input[3 + a] = state.end[a];
      input[6 + a] = state.mins[a];
      input[9 + a] = state.maxs[a];
    }
    input[12] = state.contentMask;
    this.kernel.trace_batch(this.inputPtr, this.outputPtr, 1);
    const out = this.output;
    const result = state.result;
    result.fraction = out[0];
    if (out[7] === 1) result.normal = [out[4], out[5], out[6]];
    result.startSolid = out[8] === 1;
    result.allSolid = out[9] === 1;
    result.contents = out[10];
    result.hitBrushIndex = out[11];
    result.hitSurfaceFlags = out[12];
    if (out[13] >= 0) result.hitTextureName = this.textureNames[out[13]] ?? "";
  }
}

/** The kernel's tables, in the layout native/collision-wasm/src/lib.rs `set_table` describes. */
function worldTables(source: CompiledWorldSource): (Float64Array | Int32Array)[] {
  const { bsp, textures } = source;
  const textureIndex = new Map(textures.map((texture, i) => [texture, i]));
  const indexOf = (texture: object | null | undefined) =>
    texture ? (textureIndex.get(texture as (typeof textures)[number]) ?? -1) : -1;

  const planes = new Float64Array(bsp.planes.length * 4);
  bsp.planes.forEach((p, k) => {
    planes.set([p.normal[0], p.normal[1], p.normal[2], p.dist], k * 4);
  });
  const nodes = new Int32Array(bsp.nodes.length * 3);
  bsp.nodes.forEach((n, k) => {
    nodes.set([n.planeIndex, n.children[0], n.children[1]], k * 3);
  });
  const leafs = new Int32Array(bsp.leafs.length * 4);
  bsp.leafs.forEach((l, k) => {
    leafs.set([l.firstLeafBrush, l.numLeafBrushes, l.firstLeafFace, l.numLeafFaces], k * 4);
  });
  const brushes = new Int32Array(bsp.brushes.length * 6);
  const brushBounds = new Float64Array(bsp.brushes.length * 6);
  bsp.brushes.forEach((brush, k) => {
    const bounds = source.brushBounds[k];
    const row = [
      brush.firstSide,
      brush.numSides,
      indexOf(source.brushTexture(k)),
      source.brushParents[k] ?? -1,
      source.excludedBrush(k) ? 1 : 0,
      bounds ? 1 : 0,
    ];
    brushes.set(row, k * 6);
    if (bounds) brushBounds.set(bounds, k * 6);
  });
  const sides = new Int32Array(bsp.brushSides.length * 2);
  bsp.brushSides.forEach((side, k) => {
    sides.set([side.planeIndex, bsp.textures[side.shaderIndex]?.surfaceFlags ?? -1], k * 2);
  });
  const textureRows = new Int32Array(textures.length * 3);
  textures.forEach((t, k) => {
    textureRows.set([t.contentFlags, t.surfaceFlags, t.collisionMask], k * 3);
  });

  const faces = new Int32Array(bsp.faces.length * 5).fill(-1);
  const facetRows: number[] = [];
  const facetBounds: number[] = [];
  const facetPlanes: number[] = [];
  const meshBounds: number[] = [];
  source.faceMeshes.forEach((mesh, k) => {
    if (!mesh) return;
    const texture = textures[bsp.faces[k].textureIndex];
    const firstFacet = facetRows.length / 3;
    const planeBase = facetPlanes.length / 4;
    const ranges = mesh.facetRanges ?? new Int32Array(1);
    const packed = mesh.facetPlanes ?? new Float64Array(0);
    for (const v of packed) facetPlanes.push(v);
    for (let t = 0; t + 1 < ranges.length; t++) {
      const [lo, hi] = [ranges[t], ranges[t + 1]];
      if (hi <= lo) {
        // A degenerate triangle: no planes, never traced
        facetRows.push(0, 0, 0);
        facetBounds.push(0, 0, 0, 0, 0, 0);
        continue;
      }
      // The same bounds the backend's facet index holds
      const bounds = planeBounds(packed, lo, hi, true);
      facetRows.push(planeBase + lo, planeBase + hi, bounds ? 2 : 1);
      facetBounds.push(...(bounds ?? [0, 0, 0, 0, 0, 0]));
    }
    faces.set([meshBounds.length / 6, indexOf(texture), firstFacet, facetRows.length / 3 - firstFacet, 0], k * 5);
    // Q3 axes: the mesh's bounds are kept in Babylon's
    meshBounds.push(mesh.mins.x, mesh.mins.z, mesh.mins.y, mesh.maxs.x, mesh.maxs.z, mesh.maxs.y);
  });

  return [
    planes,
    nodes,
    leafs,
    Int32Array.from(bsp.leafBrushes),
    brushes,
    brushBounds,
    sides,
    textureRows,
    Int32Array.from(source.clipBrushIndices),
    Int32Array.from(bsp.leafFaces),
    faces,
    Float64Array.from(meshBounds),
    Int32Array.from(facetRows),
    Float64Array.from(facetBounds),
    Float64Array.from(facetPlanes),
  ];
}

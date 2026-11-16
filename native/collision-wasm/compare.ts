// Replay recorded traces through SweepCollisionBackend's world trace in
// TypeScript and through the Rust/WebAssembly kernel; compare the results bit
// for bit and time both.
// Usage: node node_modules/vite-node/vite-node.mjs native/collision-wasm/compare.ts -- <map> <traces.f64>
import { readFileSync } from "node:fs";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import path from "node:path";
import { BspLoader } from "../../src/engine/loader/bsp/BspLoader";
import { PK3Loader } from "../../src/engine/loader/pk3/PK3Loader";
import { resolveMapBspViaIndex } from "../../src/engine/loader/pk3/NodePk3";
import { planeBounds } from "../../src/engine/physics/CollisionSpatialIndex";
import { PLAYER_HEIGHT, PLAYER_MINS_Z, PLAYER_RADIUS } from "../../src/engine/physics/PlayerPhysicsConstants";
import { SweepCollisionBackend } from "../../src/engine/physics/SweepCollisionBackend";

const args = process.argv.slice(2).filter((a) => a !== "--");
const [map = "washoi_dm2", tracesFile = `.cache/traces-${map}.f64`] = args;
const PLAYER_CONTENTS = 0x1 | 0x10000;
const IN = 13;
/** The kernel writes 14 values a trace; the first 13 are compared (the 14th, the hit texture, is checked by the engine's test). */
const OUT = 14;
const COMPARED = 13;

// ── The map and the TypeScript backend ───────────────────────────────
const buffer = await resolveMapBspViaIndex(
  [path.resolve("./public/data"), path.resolve("./dist/data")],
  map,
  PK3Loader.createTransient(),
);
if (!buffer) throw new Error(`no map ${map}`);
const bsp = BspLoader.loadCollision(buffer);
const backend = new SweepCollisionBackend();
await backend.init(bsp);
// biome-ignore lint/suspicious/noExplicitAny: the prototype reads the backend's prepared tables.
const b = backend as any;

// ── Traces: Babylon start/end, radius, height, mask -> Q3 inputs ──────
const raw = new Float64Array(readFileSync(tracesFile).buffer.slice(0));
const count = raw.length / 9;
const inputs = new Float64Array(count * IN);
for (let k = 0; k < count; k++) {
  const r = raw.subarray(k * 9, k * 9 + 9);
  const radius = Number.isNaN(r[6]) ? PLAYER_RADIUS : r[6];
  const height = Number.isNaN(r[7]) ? PLAYER_HEIGHT : r[7];
  const minsZ = -(height * (-PLAYER_MINS_Z / PLAYER_HEIGHT));
  const o = k * IN;
  inputs.set([r[0], r[2], r[1], r[3], r[5], r[4], -radius, -radius, minsZ, radius, radius, height + minsZ], o);
  inputs[o + 12] = Number.isNaN(r[8]) ? PLAYER_CONTENTS : r[8];
}

/** The world part of backend.trace, as it runs there (generation, state, node walk, clip fallback). */
function tsWorld(input: Float64Array, o: number, out: Float64Array, w: number): void {
  b.traceGeneration = (b.traceGeneration + 1) >>> 0;
  if (b.traceGeneration === 0) {
    b.brushVisits.fill(0);
    b.faceVisits.fill(0);
    b.traceGeneration = 1;
  }
  const s = b._pooledState;
  for (let a = 0; a < 3; a++) {
    s.start[a] = input[o + a];
    s.end[a] = input[o + 3 + a];
    s.mins[a] = input[o + 6 + a];
    s.maxs[a] = input[o + 9 + a];
    s.extents[a] = Math.max(Math.abs(s.mins[a]), Math.abs(s.maxs[a]));
  }
  s.contentMask = input[o + 12];
  s.result.fraction = 1;
  s.result.normal = null;
  s.result.startSolid = false;
  s.result.allSolid = false;
  s.result.contents = 0;
  s.result.hitBrushIndex = -1;
  s.result.hitSurfaceFlags = 0;
  s.debug = false;
  b.splitDepth = 0;
  b.traceNode(0, 0, 1, s.start, s.end, s);
  b.traceAllClipBrushes(s);
  const f = s.result.fraction;
  out[w] = f;
  for (let a = 0; a < 3; a++) out[w + 1 + a] = f < 1 ? s.start[a] + f * (s.end[a] - s.start[a]) : s.end[a];
  const n = s.result.normal;
  out[w + 4] = n ? n[0] : 0;
  out[w + 5] = n ? n[1] : 0;
  out[w + 6] = n ? n[2] : 0;
  out[w + 7] = n ? 1 : 0;
  out[w + 8] = s.result.startSolid ? 1 : 0;
  out[w + 9] = s.result.allSolid ? 1 : 0;
  out[w + 10] = s.result.contents;
  out[w + 11] = s.result.hitBrushIndex;
  out[w + 12] = s.result.hitSurfaceFlags;
}

// ── Tables for the kernel ────────────────────────────────────────────
const textures = b.collisionTextures as { contentFlags: number; surfaceFlags: number; collisionMask: number }[];
const textureIndex = new Map(textures.map((t, i) => [t, i]));
const brushTex = (brush: { shaderIndex: number; firstSide: number }) => {
  const t = b.getBrushTexture(brush);
  return t ? (textureIndex.get(t) ?? -1) : -1;
};
const planes = new Float64Array(bsp.planes.length * 4);
bsp.planes.forEach((p, k) => planes.set([...p.normal, p.dist], k * 4));
const nodes = new Int32Array(bsp.nodes.length * 3);
bsp.nodes.forEach((n, k) => nodes.set([n.planeIndex, n.children[0], n.children[1]], k * 3));
const leafs = new Int32Array(bsp.leafs.length * 4);
bsp.leafs.forEach((l, k) => leafs.set([l.firstLeafBrush, l.numLeafBrushes, l.firstLeafFace, l.numLeafFaces], k * 4));
const brushes = new Int32Array(bsp.brushes.length * 6);
const brushBounds = new Float64Array(bsp.brushes.length * 6);
bsp.brushes.forEach((brush, k) => {
  const bounds = b.brushBounds[k];
  const excluded = b.liftBrushes.has(k) || b.brushModelBrushes.has(k) ? 1 : 0;
  brushes.set([brush.firstSide, brush.numSides, brushTex(brush), b.brushParents[k], excluded, bounds ? 1 : 0], k * 6);
  if (bounds) brushBounds.set(bounds, k * 6);
});
const sides = new Int32Array(bsp.brushSides.length * 2);
bsp.brushSides.forEach((side, k) => sides.set([side.planeIndex, bsp.textures[side.shaderIndex]?.surfaceFlags ?? -1], k * 2));
const textureRows = new Int32Array(textures.length * 3);
textures.forEach((t, k) => textureRows.set([t.contentFlags, t.surfaceFlags, t.collisionMask], k * 3));
const clips = Int32Array.from(b.clipBrushIndices as number[]);
const meshes: { mins: { x: number; y: number; z: number }; maxs: { x: number; y: number; z: number } }[] = [];
const faces = new Int32Array(bsp.faces.length * 5).fill(-1);
const facetRows: number[] = [];
const facetBounds: number[] = [];
const facetPlanes: number[] = [];
let movers = 0;
b.faceCollisionMeshes.forEach(
  (
    mesh: {
      mins: { x: number; y: number; z: number };
      maxs: { x: number; y: number; z: number };
      facetPlanes?: Float64Array;
      facetRanges?: Int32Array;
    } | null,
    k: number,
  ) => {
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
        facetRows.push(0, 0, 0);
        facetBounds.push(0, 0, 0, 0, 0, 0);
        continue;
      }
      // The same bounds buildFacets gave the facet index.
      const fb = planeBounds(packed, lo, hi, true);
      facetRows.push(planeBase + lo, planeBase + hi, fb ? 2 : 1);
      facetBounds.push(...(fb ?? [0, 0, 0, 0, 0, 0]));
    }
    faces.set(
      [meshes.length, texture ? (textureIndex.get(texture) ?? -1) : -1, firstFacet, facetRows.length / 3 - firstFacet, 0],
      k * 5,
    );
    meshes.push(mesh);
  },
);
movers = b.brushModelPatches.size + (b.lifts?.definitions.length ?? 0) + (b.brushModels?.definitions.length ?? 0);
const meshBounds = new Float64Array(meshes.length * 6);
meshes.forEach((m, k) => meshBounds.set([m.mins.x, m.mins.z, m.mins.y, m.maxs.x, m.maxs.z, m.maxs.y], k * 6));

// ── The kernel ───────────────────────────────────────────────────────
const wasmFile = "src/engine/physics/WorldTrace.wasm";
const { instance } = await WebAssembly.instantiate(readFileSync(wasmFile));
const k = instance.exports as {
  memory: WebAssembly.Memory;
  alloc(n: number): number;
  set_table(id: number, ptr: number, len: number): void;
  init(brushes: number, faces: number): void;
  trace_batch(input: number, output: number, count: number): void;
};
const tables: (Float64Array | Int32Array)[] = [
  planes,
  nodes,
  leafs,
  Int32Array.from(bsp.leafBrushes),
  brushes,
  brushBounds,
  sides,
  textureRows,
  clips,
  Int32Array.from(bsp.leafFaces),
  faces,
  meshBounds,
  Int32Array.from(facetRows),
  Float64Array.from(facetBounds),
  Float64Array.from(facetPlanes),
];
tables.forEach((table, id) => {
  const ptr = k.alloc(Math.ceil(table.byteLength / 8));
  const view = table instanceof Float64Array ? new Float64Array(k.memory.buffer, ptr, table.length) : new Int32Array(k.memory.buffer, ptr, table.length);
  view.set(table);
  k.set_table(id, ptr, table.length);
});
k.init(bsp.brushes.length, bsp.faces.length);
const tableBytes = tables.reduce((sum, t) => sum + t.byteLength, 0) + (bsp.brushes.length + bsp.faces.length) * 4;
const inPtr = k.alloc(count * IN);
const outPtr = k.alloc(count * OUT);
new Float64Array(k.memory.buffer, inPtr, count * IN).set(inputs);

// ── Exactness ────────────────────────────────────────────────────────
const ts = new Float64Array(count * OUT);
for (let t = 0; t < count; t++) tsWorld(inputs, t * IN, ts, t * OUT);
k.trace_batch(inPtr, outPtr, count);
const wasm = new Float64Array(k.memory.buffer, outPtr, count * OUT).slice();
const names = ["fraction", "endX", "endY", "endZ", "nX", "nY", "nZ", "hasNormal", "startSolid", "allSolid", "contents", "hitBrush", "surfaceFlags"];
const fieldDiffs = new Array(COMPARED).fill(0);
let differ = 0;
let firstDiff = -1;
for (let t = 0; t < count; t++) {
  let any = false;
  for (let f = 0; f < COMPARED; f++) {
    if (!Object.is(ts[t * OUT + f], wasm[t * OUT + f])) {
      fieldDiffs[f]++;
      any = true;
    }
  }
  if (any) {
    differ++;
    if (firstDiff < 0) firstDiff = t;
  }
}
const hits = [...Array(count).keys()].filter((t) => ts[t * OUT] < 1).length;
const solid = [...Array(count).keys()].filter((t) => ts[t * OUT + 8] === 1).length;
const points = [...Array(count).keys()].filter((t) => inputs[t * IN + 9] === 0).length;
console.log(`${map}: ${count} traces (${points} point traces, ${hits} hits, ${solid} start solid); map movers ${movers}`);
console.log(`  differ: ${differ}${differ ? ` (${names.map((n, f) => (fieldDiffs[f] ? `${n} ${fieldDiffs[f]}` : "")).filter(Boolean).join(", ")})` : ""}`);
if (firstDiff >= 0) {
  console.log("  first: ts", [...ts.subarray(firstDiff * OUT, firstDiff * OUT + OUT)].join(" "));
  console.log("       wasm", [...wasm.subarray(firstDiff * OUT, firstDiff * OUT + OUT)].join(" "));
}

// ── Time ─────────────────────────────────────────────────────────────
const time = (label: string, fn: () => void, rounds = 5) => {
  fn();
  const runs: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  runs.sort((x, y) => x - y);
  const best = runs[0];
  console.log(`  ${label.padEnd(34)} ${best.toFixed(1)} ms for ${count} (${((best * 1e6) / count).toFixed(0)} ns a trace)`);
  return best;
};
const scratch = new Float64Array(OUT);
const tsTime = time("TypeScript, world part", () => {
  for (let t = 0; t < count; t++) tsWorld(inputs, t * IN, scratch, 0);
});
const batchTime = time("WebAssembly, one batch", () => k.trace_batch(inPtr, outPtr, count));
const one = k.alloc(IN);
const oneOut = k.alloc(OUT);
const callTime = time("WebAssembly, a call per trace", () => {
  const view = new Float64Array(k.memory.buffer, one, IN);
  const res = new Float64Array(k.memory.buffer, oneOut, OUT);
  for (let t = 0; t < count; t++) {
    view.set(inputs.subarray(t * IN, t * IN + IN));
    k.trace_batch(one, oneOut, 1);
    scratch[0] = res[0];
  }
});
const fullTime = time("TypeScript, full backend.trace", () => {
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    backend.trace(new Vector3(raw[o], raw[o + 1], raw[o + 2]), new Vector3(raw[o + 3], raw[o + 4], raw[o + 5]), {
      radius: Number.isNaN(raw[o + 6]) ? undefined : raw[o + 6],
      height: Number.isNaN(raw[o + 7]) ? undefined : raw[o + 7],
      contentMask: Number.isNaN(raw[o + 8]) ? undefined : raw[o + 8],
    });
  }
}, 3);
console.log(
  `  speed-up: batch ${(tsTime / batchTime).toFixed(2)}x, call per trace ${(tsTime / callTime).toFixed(2)}x (full trace ${(fullTime / tsTime).toFixed(2)}x the world part); the world in WebAssembly memory ${(tableBytes / 1048576).toFixed(1)} MB (with the replay buffers ${(k.memory.buffer.byteLength / 1048576).toFixed(1)} MB)`,
);

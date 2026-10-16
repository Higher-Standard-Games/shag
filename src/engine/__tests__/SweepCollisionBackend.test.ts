/**
 * SweepCollisionBackend.test.ts — unit coverage for the Q3-style swept-box
 * collision backend (the second "golden jewel", shared client + server).
 *
 * Prior to this file the backend had ZERO direct unit tests — CollisionWorld.test.ts
 * only exercised the NullCollisionWorld fallback. These tests lock the core
 * trace/brush/slide/step contract so the deferred modularisation split
 * (feature/sweep-collision-modularise, matrix #18/#29) has a safety net.
 *
 * COORDINATE NOTE (read before editing fixtures):
 *  - BSP brushes/planes are authored in Q3 coordinates where Z is UP.
 *  - The public trace()/slideMove()/stepSlideMove() API takes Babylon
 *    coordinates where Y is UP. trace() swaps Y<->Z internally.
 *  - So a "floor" is a brush whose top is at Q3 z=0, and the player traces
 *    in Babylon space with motion along Babylon Y for vertical movement.
 *
 * The player hull is asymmetric (Q3 standard): for the default height 56 the
 * origin sits 24 units above the feet and 32 below the head. So a player
 * standing on a floor at Babylon y=0 has its ORIGIN at Babylon y=24.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it, vi } from "vitest";
import type { BspBrushSide, BspFile, BspPlane } from "../loader/bsp/BspLoader";
import { SweepCollisionBackend } from "../physics/SweepCollisionBackend";

// Q3 content flags (mirror the private table in SweepCollisionBackend).
const SOLID = 0x1;
const PLAYERCLIP = 0x10000;

type Vec3 = [number, number, number];

interface BoxSpec {
  /** Axis-aligned box bounds in Q3 coords (z up). */
  min: Vec3;
  max: Vec3;
  /** Texture name (used for clip-by-name detection). Default "solid". */
  name?: string;
  /** Content flags. Default SOLID. */
  contentFlags?: number;
  surfaceFlags?: number;
}

/** Outward-facing planes of an axis-aligned box, in Q3 coords. */
function boxPlanes(min: Vec3, max: Vec3): BspPlane[] {
  return [
    { normal: [1, 0, 0], dist: max[0] },
    { normal: [-1, 0, 0], dist: -min[0] },
    { normal: [0, 1, 0], dist: max[1] },
    { normal: [0, -1, 0], dist: -min[1] },
    { normal: [0, 0, 1], dist: max[2] },
    { normal: [0, 0, -1], dist: -min[2] },
  ];
}

/**
 * Build a minimal BspFile from a list of solid boxes. The BSP tree is a single
 * root node whose children both point to a single leaf containing every brush,
 * so every trace is guaranteed to test every brush (traceBrush always works off
 * the full trace segment, not the node sub-segment).
 */
function buildBsp(boxes: BoxSpec[]): BspFile {
  const planes: BspPlane[] = [];
  const brushSides: BspBrushSide[] = [];
  const brushes: BspFile["brushes"] = [];
  const textures: BspFile["textures"] = [];
  const leafBrushes: number[] = [];

  boxes.forEach((box, i) => {
    textures.push({
      name: box.name ?? "solid",
      contentFlags: box.contentFlags ?? SOLID,
      surfaceFlags: box.surfaceFlags ?? 0,
    });

    const firstSide = brushSides.length;
    for (const p of boxPlanes(box.min, box.max)) {
      const planeIndex = planes.length;
      planes.push(p);
      brushSides.push({ planeIndex, shaderIndex: i });
    }
    brushes.push({ firstSide, numSides: 6, shaderIndex: i });
    leafBrushes.push(i);
  });

  const big: Vec3 = [1e6, 1e6, 1e6];
  const negBig: Vec3 = [-1e6, -1e6, -1e6];

  const bsp = {
    header: { isFBSP: false },
    lumps: [],
    entities: [],
    textures,
    planes,
    nodes: [{ planeIndex: 0, children: [-1, -1] as [number, number], mins: negBig, maxs: big }],
    leafs: [
      {
        cluster: 0,
        area: 0,
        mins: negBig,
        maxs: big,
        firstLeafFace: 0,
        numLeafFaces: 0,
        firstLeafBrush: 0,
        numLeafBrushes: leafBrushes.length,
      },
    ],
    leafFaces: [],
    leafBrushes,
    models: [],
    brushes,
    brushSides,
    vertices: [],
    meshVerts: [],
    effects: [],
    faces: [],
    lightmaps: [],
    lightVols: [],
    visData: null,
    lightmapSize: 128,
  };

  return bsp as unknown as BspFile;
}

/** A large floor with its top surface at Babylon y=0 (Q3 z=0). */
const FLOOR: BoxSpec = { min: [-1000, -1000, -1000], max: [1000, 1000, 0] };

async function makeBackend(boxes: BoxSpec[]): Promise<SweepCollisionBackend> {
  const backend = new SweepCollisionBackend();
  await backend.init(buildBsp(boxes));
  return backend;
}

// ── No map loaded ───────────────────────────────────────────────────

describe("SweepCollisionBackend — uninitialised", () => {
  it("returns a no-hit default when no BSP is loaded", () => {
    const backend = new SweepCollisionBackend();
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));
    expect(r.fraction).toBe(1);
    expect(r.startSolid).toBe(false);
    expect(r.allSolid).toBe(false);
  });
});

// ── Plane crossing / enter fraction ─────────────────────────────────

describe("SweepCollisionBackend — trace against a floor", () => {
  it("stops a downward trace on the floor with an upward normal", async () => {
    const backend = await makeBackend([FLOOR]);
    // Drop the player from y=100 straight down through the floor plane (y=0).
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));

    expect(r.fraction).toBeLessThan(1);
    expect(r.fraction).toBeGreaterThan(0);
    // Origin lands ~24u above the floor (feet at y≈0 due to asymmetric hull).
    expect(r.endPos.y).toBeGreaterThan(23);
    expect(r.endPos.y).toBeLessThan(25);
    // Normal points up in Babylon space.
    expect(r.normal).toBeDefined();
    expect(r.normal?.y).toBeGreaterThan(0.9);
    expect(r.startSolid).toBe(false);
  });

  it("misses cleanly when the trace stays above the floor", async () => {
    const backend = await makeBackend([FLOOR]);
    const r = backend.trace(new Vector3(0, 500, 0), new Vector3(50, 500, 0));
    expect(r.fraction).toBe(1);
    expect(r.normal).toBeUndefined();
  });

  it("reports startSolid + allSolid for a point buried inside the brush", async () => {
    const backend = await makeBackend([FLOOR]);
    // Babylon y=-50 → Q3 z=-50, well inside the floor box (z in [-1000, 0]).
    const r = backend.trace(new Vector3(0, -50, 0), new Vector3(0, -50, 0));
    expect(r.startSolid).toBe(true);
    expect(r.allSolid).toBe(true);
    expect(r.fraction).toBe(0);
    expect(r.contents & SOLID).toBeTruthy();
  });
});

// ── Content-mask filtering ──────────────────────────────────────────

describe("SweepCollisionBackend — content mask", () => {
  it("ignores a PLAYERCLIP-only brush when the mask requests SOLID only", async () => {
    const backend = await makeBackend([
      { min: [-1000, -1000, -1000], max: [1000, 1000, 0], name: "playerclip", contentFlags: PLAYERCLIP },
    ]);
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0), { contentMask: SOLID });
    expect(r.fraction).toBe(1);
  });

  it("collides with a PLAYERCLIP brush under the default player mask", async () => {
    const backend = await makeBackend([
      { min: [-1000, -1000, -1000], max: [1000, 1000, 0], name: "playerclip", contentFlags: PLAYERCLIP },
    ]);
    // Default contentMask = SOLID | PLAYERCLIP.
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));
    expect(r.fraction).toBeLessThan(1);
  });
});

// ── clipVelocity ────────────────────────────────────────────────────

describe("SweepCollisionBackend — clipVelocity", () => {
  it("removes the velocity component going into a floor, preserving horizontal", () => {
    const backend = new SweepCollisionBackend();
    const out = backend.clipVelocity(new Vector3(50, -10, 0), new Vector3(0, 1, 0));
    expect(out.y).toBeCloseTo(0, 1); // downward component clipped (tiny + overclip residue)
    expect(out.x).toBe(50); // horizontal untouched
  });

  it("projects out the full normal component while preserving the tangent (wall slide)", () => {
    const backend = new SweepCollisionBackend();
    // Q3 clipVelocity always removes the whole normal-aligned component (the
    // caller guards direction); here velocity drives into a +x wall.
    const out = backend.clipVelocity(new Vector3(10, 0, 5), new Vector3(1, 0, 0));
    expect(out.x).toBeCloseTo(0, 1); // into-wall component removed
    expect(out.z).toBe(5); // tangential preserved
  });
});

// ── slideMove ───────────────────────────────────────────────────────

describe("SweepCollisionBackend — slideMove", () => {
  it("moves the full distance when nothing is in the way", async () => {
    const backend = await makeBackend([FLOOR]);
    const r = backend.slideMove(new Vector3(0, 500, 0), new Vector3(40, 0, 0));
    expect(r.hitCount).toBe(0);
    expect(r.endPos.x).toBeCloseTo(40, 5);
    expect(r.endPos.y).toBeCloseTo(500, 5);
    expect(r.velocity.x).toBeCloseTo(40, 5);
  });

  it("slides along a wall instead of penetrating it", async () => {
    // Vertical wall: solid for Q3 x >= 100.
    const backend = await makeBackend([{ min: [100, -1000, -1000], max: [1000, 1000, 1000] }]);
    // Start clear of the wall, push diagonally into +x (toward wall) and +z (along it).
    const r = backend.slideMove(new Vector3(0, 0, 0), new Vector3(200, 0, 50));

    expect(r.hitCount).toBeGreaterThanOrEqual(1);
    // Did not punch through: origin stops at most ~radius(16) short of x=100.
    expect(r.endPos.x).toBeLessThan(85);
    // Into-wall velocity removed, along-wall velocity preserved.
    expect(Math.abs(r.velocity.x)).toBeLessThan(1);
    expect(r.velocity.z).toBeCloseTo(50, 1);
  });
});

// ── stepSlideMove ───────────────────────────────────────────────────

describe("SweepCollisionBackend — stepSlideMove", () => {
  it("steps up onto a low ledge (< STEPSIZE) and lands on top", async () => {
    // Floor at y=0 plus a 16u-tall step starting at Q3 x=50.
    const backend = await makeBackend([FLOOR, { min: [50, -1000, -1000], max: [1000, 1000, 16] }]);
    // Player grounded just above the floor (feet ≈ y=1), walking +x into the step.
    const r = backend.stepSlideMove(new Vector3(0, 25, 0), new Vector3(40, 0, 0));

    expect(r.stepped).toBe(true);
    // Landed on the 16u step → origin ≈ 16 + 24 = 40.
    expect(r.endPos.y).toBeGreaterThan(38);
    // Made forward progress past where a plain slide would have stopped (~x=34).
    expect(r.endPos.x).toBeGreaterThan(36);
  });

  it("does not step up a wall taller than STEPSIZE; blocks instead", async () => {
    // 100u-tall wall starting at Q3 x=50 — too tall to step.
    const backend = await makeBackend([FLOOR, { min: [50, -1000, -1000], max: [1000, 1000, 100] }]);
    const r = backend.stepSlideMove(new Vector3(0, 25, 0), new Vector3(40, 0, 0));

    expect(r.stepped).toBe(false);
    // Blocked short of the wall face (x=50) by roughly the player radius.
    expect(r.endPos.x).toBeGreaterThan(30);
    expect(r.endPos.x).toBeLessThan(50);
    expect(Math.abs(r.velocity.x)).toBeLessThan(1);
  });
});

// ── ground queries ──────────────────────────────────────────────────

describe("SweepCollisionBackend — ground queries", () => {
  // findGround() now defaults to the canonical player hull (PLAYER_RADIUS,
  // PLAYER_HEIGHT=64), so its probe feet sit 24u below origin — matching the
  // trace hull. isOnGround() (findGround(point, 2)) reports true while the
  // player hull's feet are within ~2u of the floor, i.e. origin y ≲ 26 over a
  // floor at y=0.
  it("findGround locates the floor below and returns an upward normal", async () => {
    const backend = await makeBackend([FLOOR]);
    const ground = backend.findGround(new Vector3(0, 50, 0), 100);
    expect(ground).not.toBeNull();
    expect(ground?.normal.y).toBeGreaterThan(0.9);
    expect(ground?.position.y).toBeGreaterThan(20);
    expect(ground?.position.y).toBeLessThan(30);
  });

  it("findGround returns null over a bottomless gap", async () => {
    const backend = await makeBackend([FLOOR]);
    // Far outside the floor's XZ extent → nothing below.
    const ground = backend.findGround(new Vector3(5000, 50, 0), 100);
    expect(ground).toBeNull();
  });

  it("isOnGround is true when the player hull rests on the floor, false high up", async () => {
    const backend = await makeBackend([FLOOR]);
    // origin y=24 → feet at the floor (y=0); clearly grounded.
    expect(backend.isOnGround(new Vector3(0, 24, 0))).toBe(true);
    expect(backend.isOnGround(new Vector3(0, 200, 0))).toBe(false);
  });
});

// ── stats / lifecycle ───────────────────────────────────────────────

describe("SweepCollisionBackend — stats & dispose", () => {
  it("counts traces and hits", async () => {
    const backend = await makeBackend([FLOOR]);
    backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0)); // hit
    backend.trace(new Vector3(0, 500, 0), new Vector3(50, 500, 0)); // miss
    const stats = backend.getStats();
    expect(stats.traceCount).toBe(2);
    expect(stats.hitCount).toBe(1);
    expect(stats.backendStats?.brushCount).toBe(1);
  });

  it("returns the no-hit default after dispose()", async () => {
    const backend = await makeBackend([FLOOR]);
    backend.dispose();
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));
    expect(r.fraction).toBe(1);
    expect(backend.getStats().traceCount).toBe(0);
  });
});

// ── triangle-soup collision (world vs. baked decoration) ────────────

/**
 * Build a BSP whose only collision geometry is a single horizontal triangle-soup
 * quad (faceType 3) at Q3 z=0, spanning x/y ∈ [-64, 64], on the given shader.
 *
 * Regression guard for v0.9.21: dropping collision for ALL triangle soup (the
 * Q3-authentic rule — CMod_LoadPatches only loads MST_PATCH) opened holes in
 * 336 walkable surfaces across 10 shipping maps, because q3map2 emits
 * MST_TRIANGLE_SOUP for vertex-lit WORLD geometry too, not just misc_models.
 * World soup must stay solid; only `models/`|`mapobjects` decorations are skipped.
 */
function buildSoupBsp(shaderName: string): BspFile {
  const quad: Vec3[] = [
    [-64, -64, 0],
    [64, -64, 0],
    [64, 64, 0],
    [-64, 64, 0],
  ];
  const big: Vec3 = [1e6, 1e6, 1e6];
  const negBig: Vec3 = [-1e6, -1e6, -1e6];

  const bsp = {
    header: { isFBSP: false },
    lumps: [],
    entities: [],
    textures: [{ name: shaderName, contentFlags: SOLID, surfaceFlags: 0 }],
    planes: [{ normal: [0, 0, 1], dist: 0 }],
    nodes: [{ planeIndex: 0, children: [-1, -1] as [number, number], mins: negBig, maxs: big }],
    leafs: [
      {
        cluster: 0,
        area: 0,
        mins: negBig,
        maxs: big,
        firstLeafFace: 0,
        numLeafFaces: 1,
        firstLeafBrush: 0,
        numLeafBrushes: 0,
      },
    ],
    leafFaces: [0],
    leafBrushes: [],
    models: [],
    brushes: [],
    brushSides: [],
    vertices: quad.map((p) => ({ position: p })),
    meshVerts: [0, 1, 2, 0, 2, 3],
    effects: [],
    faces: [
      {
        textureIndex: 0,
        effectIndex: -1,
        faceType: 3,
        firstVertex: 0,
        numVertices: 4,
        firstMeshVert: 0,
        numMeshVerts: 6,
        lightmapIndex: -1,
        normal: [0, 0, 1],
        patchSize: [0, 0],
      },
    ],
    lightmaps: [],
    lightVols: [],
    visData: null,
    lightmapSize: 128,
  };

  return bsp as unknown as BspFile;
}

async function soupBackend(shaderName: string): Promise<SweepCollisionBackend> {
  const backend = new SweepCollisionBackend();
  await backend.init(buildSoupBsp(shaderName));
  return backend;
}

describe("SweepCollisionBackend — per-query visits", () => {
  it("prunes strictly contained brushes only for non-embedded hulls", async () => {
    const bsp = buildBsp([
      { min: [-100, -100, -100], max: [100, 100, 100] },
      { min: [-10, -10, -10], max: [10, 10, 10] },
    ]);
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    expect(backend.getStats().backendStats?.redundantBrushCount).toBe(1);
    const internals = backend as unknown as { brushParents: Int32Array };
    for (const start of [new Vector3(200, 0, 0), new Vector3(0, 0, 0), new Vector3(0, 110, 0)]) {
      const end = new Vector3(-200, -5, 0);
      const accelerated = backend.trace(start, end, { radius: 0, height: 0 });
      const parents = internals.brushParents;
      internals.brushParents = new Int32Array(parents.length).fill(-1);
      const original = backend.trace(start, end, { radius: 0, height: 0 });
      internals.brushParents = parents;
      expect(accelerated).toEqual(original);
    }
    expect(backend.getStats().backendStats?.prunedBrushTests).toBeGreaterThan(0);
    expect(bsp.brushes).toHaveLength(2);
    expect(backend.pointContents(Vector3.Zero())).toBe(SOLID);
  });

  it("retains touching, differently masked and insufficiently referenced brush pairs", async () => {
    for (const variant of ["touching", "mask", "references"] as const) {
      const bsp = buildBsp([
        { min: [-100, -100, -100], max: [100, 100, 100] },
        {
          min: [-10, -10, -10],
          max: [variant === "touching" ? 100 : 10, 10, 10],
          contentFlags: variant === "mask" ? PLAYERCLIP : SOLID,
        },
      ]);
      if (variant === "references") {
        bsp.leafBrushes = [1];
        bsp.leafs[0].numLeafBrushes = 1;
      }
      const backend = new SweepCollisionBackend();
      await backend.init(bsp);
      expect(backend.getStats().backendStats?.redundantBrushCount).toBe(0);
    }
  });

  it("indexes distant facets while preserving linear-scan results at edges and embedded starts", async () => {
    const bsp = buildSoupBsp("textures/world");
    const quad = bsp.vertices.slice();
    bsp.vertices = [];
    bsp.meshVerts = [];
    for (let i = 0; i < 64; i++) {
      for (const v of quad)
        bsp.vertices.push({ ...v, position: [v.position[0] + i * 200, v.position[1], v.position[2]] });
      bsp.meshVerts.push(...[0, 1, 2, 0, 2, 3].map((v) => v + i * 4));
    }
    bsp.faces[0].numVertices = bsp.vertices.length;
    bsp.faces[0].numMeshVerts = bsp.meshVerts.length;
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    const mesh = backend.getFaceCollision(0)!;
    const index = mesh.facetIndex;
    const spy = vi.spyOn(backend as unknown as { traceFacet: (...args: unknown[]) => void }, "traceFacet");
    backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    for (let i = 0; i < 40; i++) {
      const start = new Vector3(i * 200 + (i % 3 === 0 ? 64 : 0), i % 2 ? 24 : 100, 0);
      const end = start.add(new Vector3(20, -100, 3));
      const indexed = backend.trace(start, end);
      mesh.facetIndex = undefined;
      const linear = backend.trace(start, end);
      mesh.facetIndex = index;
      expect(indexed).toEqual(linear);
    }
  });

  it("spatially finds unreferenced clip brushes without scanning distant clips", async () => {
    const bsp = buildBsp([
      { ...FLOOR, name: "textures/common/fullclip" },
      { min: [9000, 9000, 9000], max: [9100, 9100, 9100], name: "textures/common/fullclip" },
    ]);
    bsp.leafs[0].numLeafBrushes = 0;
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    const spy = vi.spyOn(backend as unknown as { traceBrush: (...args: unknown[]) => void }, "traceBrush");
    expect(backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0)).fraction).toBeLessThan(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("checks face contents once before its facet loop", async () => {
    const backend = await soupBackend("textures/world");
    const spy = vi.spyOn(
      backend as unknown as { shouldCollideWith: (...args: unknown[]) => boolean },
      "shouldCollideWith",
    );
    backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([0x4000, 0x100])("keeps excluded face flags out of the facet loop (%i)", async (surfaceFlags) => {
    const bsp = buildSoupBsp("textures/world");
    bsp.textures[0].surfaceFlags = surfaceFlags;
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    const spy = vi.spyOn(backend as unknown as { traceFacet: (...args: unknown[]) => void }, "traceFacet");
    expect(backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0)).fraction).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("retains repeated embedded-face visits for recovery-normal ordering", async () => {
    const backend = await soupBackend("textures/world");
    const spy = vi.spyOn(backend as unknown as { traceFacet: (...args: unknown[]) => void }, "traceFacet");
    const result = backend.trace(new Vector3(0, 24, 0), new Vector3(0, 80, 0));
    expect(result.startSolid).toBe(true);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("tests a face once across overlapping leaves, including generation wrap", async () => {
    const backend = await soupBackend("textures/world");
    const internals = backend as unknown as { traceFacet: (...args: unknown[]) => void; traceGeneration: number };
    const spy = vi.spyOn(internals, "traceFacet");
    const start = new Vector3(0, 100, 0),
      end = new Vector3(0, -100, 0);
    const reference = backend.trace(start, end);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    internals.traceGeneration = 0xffffffff;
    expect(backend.trace(start, end)).toEqual(reference);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    expect(backend.trace(start, end)).toEqual(reference);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not retest a leaf clip brush in the global fallback", async () => {
    const backend = await makeBackend([{ ...FLOOR, name: "textures/common/fullclip" }]);
    const spy = vi.spyOn(backend as unknown as { traceBrush: (...args: unknown[]) => void }, "traceBrush");
    expect(backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0)).fraction).toBeLessThan(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resets visits when initialized on a new map", async () => {
    const backend = await soupBackend("textures/world");
    const start = new Vector3(0, 100, 0),
      end = new Vector3(0, -100, 0);
    const reference = backend.trace(start, end);
    await backend.init(buildSoupBsp("textures/world"));
    expect(backend.trace(start, end)).toEqual(reference);
  });
});

describe("SweepCollisionBackend — triangle-soup faces", () => {
  it("collides world triangle soup so vertex-lit walkways stay solid", async () => {
    const backend = await soupBackend("textures/plastic_vertex/vertex_grey65");
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));

    expect(r.fraction).toBeLessThan(1);
    expect(r.endPos.y).toBeGreaterThan(23);
    expect(r.endPos.y).toBeLessThan(25);
    expect(r.normal?.y).toBeGreaterThan(0.9);
  });

  it("does not collide baked misc_model decorations (models/ shader)", async () => {
    const backend = await soupBackend("models/mapobjects/lights/coldlight_01");
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));

    expect(r.fraction).toBe(1);
  });

  it("does not collide decorations authored under the mapobjects_ prefix", async () => {
    const backend = await soupBackend("mapobjects_decor_misc_spanner");
    const r = backend.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));

    expect(r.fraction).toBe(1);
  });
});

describe("SweepCollisionBackend — face hull is asymmetric like the brush hull", () => {
  it("rests the origin 24u above a soup floor, not max(24, 40)=40", async () => {
    const soup = await soupBackend("textures/plastic_vertex/vertex_grey65");
    const brush = await makeBackend([FLOOR]);

    const onSoup = soup.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));
    const onBrush = brush.trace(new Vector3(0, 100, 0), new Vector3(0, -100, 0));

    // Both surfaces sit at y=0; a player must stand at the same height on either.
    // Using a symmetric half-extent for faces floated the player exactly 16u.
    expect(onSoup.endPos.y).toBeCloseTo(onBrush.endPos.y, 1);
    expect(onSoup.endPos.y - onBrush.endPos.y).toBeLessThan(0.5);
  });

  it("still stops the head against a soup ceiling at the full 40u", async () => {
    const backend = await soupBackend("textures/plastic_vertex/vertex_grey65");
    // Rise from well below the surface; the head (+40) should hit it.
    const r = backend.trace(new Vector3(0, -100, 0), new Vector3(0, 100, 0));

    expect(r.fraction).toBeLessThan(1);
    expect(r.endPos.y).toBeGreaterThan(-41);
    expect(r.endPos.y).toBeLessThan(-39);
  });
});

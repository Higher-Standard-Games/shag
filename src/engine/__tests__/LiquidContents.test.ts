/**
 * Liquid collision contract (water Phase 0).
 *
 * Everything mechanical about water rests on being able to ask "what am I
 * standing in" at a point. Before this, `pointContents` could not answer that:
 * it was a player-hull box trace, masked to solids, behind a filter whose first
 * rule discarded NONSOLID surfaces before reading their contents — and liquid
 * brushes are NONSOLID by definition. It returned 0 inside water on every map.
 *
 * COORDINATES: BSP brushes are authored in Q3 space (z up); the backend's
 * public API takes Babylon space (y up) and swaps internally. A pool whose
 * surface is at Q3 z=56 is queried at Babylon y=56.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { Contents, MASK_LIQUID, MASK_SOLID } from "../../shared/collision/CollisionWorld";
import type { BspBrushSide, BspFile, BspPlane } from "../loader/bsp/BspLoader";
import { ContentFlags, SurfaceFlags } from "../physics/ContentFlags";
import { toSharedContents } from "../physics/SweepBackendAdapter";
import { SweepCollisionBackend } from "../physics/SweepCollisionBackend";

type Vec3 = [number, number, number];

interface BoxSpec {
  min: Vec3;
  max: Vec3;
  name?: string;
  contentFlags?: number;
  surfaceFlags?: number;
}

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

/** One leaf holding every brush, so a point query has to reject by geometry. */
function buildBsp(boxes: BoxSpec[]): BspFile {
  const planes: BspPlane[] = [];
  const brushSides: BspBrushSide[] = [];
  const brushes: BspFile["brushes"] = [];
  const textures: BspFile["textures"] = [];
  const leafBrushes: number[] = [];

  boxes.forEach((box, i) => {
    textures.push({
      name: box.name ?? "solid",
      contentFlags: box.contentFlags ?? ContentFlags.SOLID,
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

  return {
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
  } as unknown as BspFile;
}

async function makeBackend(boxes: BoxSpec[]): Promise<SweepCollisionBackend> {
  const backend = new SweepCollisionBackend();
  await backend.init(buildBsp(boxes));
  return backend;
}

/**
 * A pool modelled the way maps actually do it: water sitting in a basin, with
 * its surface at Q3 z=56 (the acidwdm2 waterline).
 *
 * Liquid brushes carry NONSOLID — that flag is what the old solid-seeking
 * filter rejected them on.
 */
const POOL: BoxSpec = {
  min: [-256, -256, -128],
  max: [256, 256, 56],
  name: "textures/test/water1",
  contentFlags: ContentFlags.WATER | ContentFlags.TRANSLUCENT,
  surfaceFlags: SurfaceFlags.NONSOLID | SurfaceFlags.NOLIGHTMAP,
};

const FLOOR: BoxSpec = { min: [-1000, -1000, -1000], max: [1000, 1000, -128] };

describe("pointContents — liquid", () => {
  it("reports water inside a pool", async () => {
    const backend = await makeBackend([FLOOR, POOL]);

    const contents = backend.pointContents(new Vector3(0, 0, 0));

    expect(contents & ContentFlags.WATER).toBeTruthy();
  });

  it("reports nothing above the surface", async () => {
    const backend = await makeBackend([FLOOR, POOL]);

    expect(backend.pointContents(new Vector3(0, 100, 0)) & ContentFlags.WATER).toBe(0);
  });

  it("counts the surface itself as submerged", async () => {
    // A waterline is a plane, and a sample exactly on it must not depend on
    // which way a float rounded. Q3 treats on-surface as inside.
    const backend = await makeBackend([FLOOR, POOL]);

    expect(backend.pointContents(new Vector3(0, 56, 0)) & ContentFlags.WATER).toBeTruthy();
  });

  it("is a point query, not a hull query", async () => {
    // The whole basis of three-point water sampling: the feet, waist and eye of
    // one standing player must be able to disagree. Under the old box query all
    // three inflated to the same 32x32x64 hull and returned the same answer.
    const backend = await makeBackend([FLOOR, POOL]);

    // A player whose origin is at y=40: feet at 16, eye at 74.
    const foot = backend.pointContents(new Vector3(0, 17, 0));
    const waist = backend.pointContents(new Vector3(0, 45, 0));
    const eye = backend.pointContents(new Vector3(0, 74, 0));

    expect(foot & ContentFlags.WATER).toBeTruthy();
    expect(waist & ContentFlags.WATER).toBeTruthy();
    expect(eye & ContentFlags.WATER).toBe(0);
  });

  it("does not report liquid the player is merely standing next to", async () => {
    const backend = await makeBackend([FLOOR, POOL]);

    // One unit outside the pool wall, at a depth that is underwater inside it.
    expect(backend.pointContents(new Vector3(257, 0, 0)) & ContentFlags.WATER).toBe(0);
  });

  it("unions overlapping volumes rather than reporting the first brush", async () => {
    const fog: BoxSpec = {
      min: [-256, -256, -128],
      max: [256, 256, 56],
      name: "textures/test/fog",
      contentFlags: ContentFlags.FOG,
      surfaceFlags: SurfaceFlags.NONSOLID,
    };
    const backend = await makeBackend([FLOOR, POOL, fog]);

    const contents = backend.pointContents(new Vector3(0, 0, 0));

    expect(contents & ContentFlags.WATER).toBeTruthy();
    expect(contents & ContentFlags.FOG).toBeTruthy();
  });

  it("reports a brush that is both water and slime as both", async () => {
    // Four shaders in the shipped map pack declare WATER|SLIME on one brush.
    // Collapsing to a single kind here would lose the bit with consequences.
    const backend = await makeBackend([FLOOR, { ...POOL, contentFlags: ContentFlags.WATER | ContentFlags.SLIME }]);

    const contents = backend.pointContents(new Vector3(0, 0, 0));

    expect(contents & ContentFlags.WATER).toBeTruthy();
    expect(contents & ContentFlags.SLIME).toBeTruthy();
  });

  it("sees a NODRAW liquid volume", async () => {
    // `common/nodrawwater` is the mapper's idiom for a volume you swim in with
    // no surface to look at — 22 of wdm5's 22 liquid brushes are this. If the
    // invisible brush does not report, that map has no water at all.
    const backend = await makeBackend([
      FLOOR,
      { ...POOL, name: "textures/common/nodrawwater", surfaceFlags: SurfaceFlags.NONSOLID | SurfaceFlags.NODRAW },
    ]);

    expect(backend.pointContents(new Vector3(0, 0, 0)) & ContentFlags.WATER).toBeTruthy();
  });

  it("filters by an explicit content mask", async () => {
    const backend = await makeBackend([FLOOR, POOL]);

    const liquidOnly = backend.pointContents(new Vector3(0, 0, 0), ContentFlags.WATER);

    expect(liquidOnly).toBe(ContentFlags.WATER);
    // TRANSLUCENT is on the brush but was not asked for.
    expect(liquidOnly & ContentFlags.TRANSLUCENT).toBe(0);
  });

  it("still reports solid, so it has not stopped answering the old question", async () => {
    const backend = await makeBackend([FLOOR, POOL]);

    expect(backend.pointContents(new Vector3(0, -500, 0)) & ContentFlags.SOLID).toBeTruthy();
  });

  it("returns nothing when no map is loaded", () => {
    expect(new SweepCollisionBackend().pointContents(new Vector3(0, 0, 0))).toBe(0);
  });
});

describe("contents translation at the shared boundary", () => {
  it("translates each liquid to its shared counterpart", () => {
    expect(toSharedContents(ContentFlags.WATER)).toBe(Contents.WATER);
    expect(toSharedContents(ContentFlags.SLIME)).toBe(Contents.SLIME);
    expect(toSharedContents(ContentFlags.LAVA)).toBe(Contents.LAVA);
  });

  it("does not let raw LAVA read as shared SLIME", () => {
    // The trap this translation exists for: raw LAVA is 0x8, and so is
    // Contents.SLIME. Passing BSP values straight through would have reported
    // slime for every lava pit on wdm7, wdm13, wbomb2 and wda1.
    expect(ContentFlags.LAVA).toBe(Contents.SLIME);

    const translated = toSharedContents(ContentFlags.LAVA);

    expect(translated & Contents.LAVA).toBeTruthy();
    expect(translated & Contents.SLIME).toBe(0);
  });

  it("keeps SOLID, the one value both vocabularies agree on", () => {
    expect(toSharedContents(ContentFlags.SOLID)).toBe(Contents.SOLID);
  });

  it("translates combined liquids without losing either bit", () => {
    const translated = toSharedContents(ContentFlags.WATER | ContentFlags.SLIME);

    expect(translated & Contents.WATER).toBeTruthy();
    expect(translated & Contents.SLIME).toBeTruthy();
  });

  it("drops BSP bits with no shared meaning rather than passing them through", () => {
    // TRANSLUCENT is 0x20000000 and DETAIL is 0x8000000. Passed through, they
    // would collide with nothing today and with whatever gets added tomorrow.
    expect(toSharedContents(ContentFlags.TRANSLUCENT | ContentFlags.DETAIL)).toBe(Contents.EMPTY);
  });

  it("separates liquid from solid under the shared masks", () => {
    const water = toSharedContents(ContentFlags.WATER | ContentFlags.TRANSLUCENT);

    expect(water & MASK_LIQUID).toBeTruthy();
    expect(water & MASK_SOLID).toBe(0);
  });

  it("keeps playerclip solid for movement but out of the liquid mask", () => {
    const clip = toSharedContents(ContentFlags.PLAYERCLIP);

    expect(clip & MASK_SOLID).toBeTruthy();
    expect(clip & MASK_LIQUID).toBe(0);
  });
});

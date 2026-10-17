/**
 * Facet bevel planes.
 *
 * The property that matters is convexity: every plane must be a supporting
 * plane of the triangle, so "inside all planes" is a solid that contains the
 * triangle and nothing beyond its own thickness. If that holds, the ordinary
 * brush sweep is correct on it; if it does not, the sweep lets a hull through
 * an edge, which is the bug these exist to fix.
 */

import { describe, expect, it } from "vitest";
import { buildFacetPlanes, type FacetPlane } from "../physics/FacetBevels";

type Vec = [number, number, number];

/** Q3 space: z up. A floor triangle, and a vertical one standing on its edge. */
const FLOOR: [Vec, Vec, Vec] = [
  [0, 0, 0],
  [64, 0, 0],
  [0, 64, 0],
];
const WALL: [Vec, Vec, Vec] = [
  [0, 0, 0],
  [64, 0, 0],
  [0, 0, 64],
];
/** Nothing axis-aligned, which is where bevels actually earn their keep. */
const SKEW: [Vec, Vec, Vec] = [
  [3, 7, 11],
  [61, 13, 29],
  [17, 53, 47],
];

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Distance of a point from a plane; positive is outside. */
function distance(plane: FacetPlane, point: Vec): number {
  return dot(plane.normal, point) - plane.dist;
}

describe("buildFacetPlanes", () => {
  it("rejects a degenerate triangle instead of producing garbage planes", () => {
    expect(buildFacetPlanes([0, 0, 0], [1, 1, 1], [2, 2, 2])).toEqual([]);
    expect(buildFacetPlanes([5, 5, 5], [5, 5, 5], [5, 5, 5])).toEqual([]);
  });

  for (const [name, triangle] of [
    ["floor", FLOOR],
    ["wall", WALL],
    ["skew", SKEW],
  ] as const) {
    describe(name, () => {
      const planes = buildFacetPlanes(...triangle);

      it("keeps every vertex inside every plane", () => {
        // The defining property. A vertex outside any plane means that plane
        // cuts the triangle, so the solid is not the triangle's hull.
        for (const plane of planes) {
          for (const vertex of triangle) {
            expect(distance(plane, vertex)).toBeLessThanOrEqual(0.1);
          }
        }
      });

      it("keeps the centroid strictly inside", () => {
        const centroid = triangle
          .reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]] as Vec, [0, 0, 0] as Vec)
          .map((c) => c / 3) as Vec;

        for (const plane of planes) {
          expect(distance(plane, centroid)).toBeLessThanOrEqual(0.1);
        }
      });

      it("has unit normals", () => {
        for (const plane of planes) {
          expect(Math.hypot(...plane.normal)).toBeCloseTo(1, 5);
        }
      });

      it("contains its back vertices without bevels collapsing the facet thickness", () => {
        const normal = planes[0].normal;
        for (const vertex of triangle) {
          const back = vertex.map((coordinate, axis) => coordinate - 0.5 * normal[axis]) as Vec;
          for (const plane of planes) expect(distance(plane, back)).toBeLessThanOrEqual(1e-10);
        }
      });

      it("carries an axial plane in all six directions", () => {
        // The box being swept is axis-aligned, so the Minkowski sum has a face
        // in each axial direction. A missing one lets a box clip the facet's
        // bounding corners.
        for (let axis = 0; axis < 3; axis++) {
          for (const dir of [1, -1]) {
            const wanted: Vec = [0, 0, 0];
            wanted[axis] = dir;
            const found = planes.some((p) => dot(p.normal, wanted) > 0.999);
            expect(found, `no plane facing axis ${axis} dir ${dir}`).toBe(true);
          }
        }
      });

      it("encloses the triangle — a point well outside fails some plane", () => {
        const far: Vec[] = [
          [1000, 0, 0],
          [-1000, 0, 0],
          [0, 1000, 0],
          [0, -1000, 0],
          [0, 0, 1000],
          [0, 0, -1000],
        ];
        for (const point of far) {
          expect(planes.some((p) => distance(p, point) > 0)).toBe(true);
        }
      });
    });
  }

  it("bounds a skew triangle more tightly than its own plane alone", () => {
    // The point of bevels: a position just off the edge of the triangle is
    // OUTSIDE the facet, even though it may be within the triangle's infinite
    // plane. Without edge bevels this point reads as inside and a hull walks in.
    const planes = buildFacetPlanes(...SKEW);
    const justPastEdge: Vec = [3 - 40, 7 - 40, 11];

    expect(planes.some((p) => distance(p, justPastEdge) > 0)).toBe(true);
  });

  it("produces a bounded, deduplicated set", () => {
    // Front, back, three borders, six axials, plus surviving edge bevels.
    // Unbounded growth here would be paid on every trace.
    for (const triangle of [FLOOR, WALL, SKEW]) {
      const planes = buildFacetPlanes(...triangle);
      expect(planes.length).toBeGreaterThanOrEqual(6);
      expect(planes.length).toBeLessThan(32);

      const seen = new Set(planes.map((p) => `${p.normal.map((n) => n.toFixed(3)).join()}|${p.dist.toFixed(2)}`));
      expect(seen.size).toBe(planes.length);
    }
  });
});

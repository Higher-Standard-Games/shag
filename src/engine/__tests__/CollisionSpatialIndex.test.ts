import { describe, expect, it } from "vitest";
import { type CollisionBounds, CollisionSpatialIndex, planeBounds } from "../physics/CollisionSpatialIndex";

describe("conservative collision bounds", () => {
  const box = [1, 0, 0, 10, -1, 0, 0, 10, 0, 1, 0, 10, 0, -1, 0, 10, 0, 0, 1, 10, 0, 0, -1, 10];
  it("pads the actual axial collision planes", () => {
    expect(planeBounds(box)).toEqual([-10.125, -10.125, -10.125, 10.125, 10.125, 10.125]);
  });
  it("keeps missing or near-axial constraints unbounded", () => {
    expect(planeBounds(box.slice(4))).toBeNull();
    const skewed = [...box];
    skewed[1] = 0.000001;
    expect(planeBounds(skewed)).toBeNull();
    expect(planeBounds([NaN, 0, 0, 10])).toBeNull();
  });
  it("keeps uncertain primitives and returns stable source order", () => {
    const index = new CollisionSpatialIndex([
      { id: 4, bounds: [100, 100, 100, 110, 110, 110] },
      { id: 3, bounds: null },
      { id: 1, bounds: [0, 0, 0, 10, 10, 10] },
    ]);
    expect(index.query([10, 10, 10, 10, 10, 10])).toEqual([1, 3]);
    expect(index.query([50, 50, 50, 51, 51, 51])).toEqual([3]);
  });
  it("retains proven slab constraints without treating near-axial planes as axial", () => {
    const skewed = [...box];
    skewed[1] = 0.000001;
    expect(planeBounds(skewed, 0, 6, true)).toEqual([-10.125, -10.125, -10.125, Infinity, 10.125, 10.125]);
    expect(planeBounds([0.1, 0.2, 0.3, 10], 0, 1, true)).toBeNull();
    expect(planeBounds([NaN, 0, 0, 10], 0, 1, true)).toBeNull();
  });
  it("matches a linear oracle for mixed finite, half-infinite and unknown bounds", () => {
    const items = Array.from({ length: 200 }, (_, id) => ({
      id,
      bounds:
        id % 13 === 0
          ? null
          : ([id % 2 ? -Infinity : id * 2, -id, 0, id * 2 + 3, -id + 5, id % 3 ? 8 : Infinity] as CollisionBounds),
    }));
    const index = new CollisionSpatialIndex(items);
    for (let i = 0; i < 200; i++) {
      const q: CollisionBounds = [i, -100, -1, i + 20, -20, 1];
      const expected = items
        .filter(
          ({ bounds: b }) =>
            !b || (b[0] <= q[3] && b[3] >= q[0] && b[1] <= q[4] && b[4] >= q[1] && b[2] <= q[5] && b[5] >= q[2]),
        )
        .map((x) => x.id);
      expect(index.query(q)).toEqual(expected);
    }
  });
  it("matches a linear overlap oracle across tree partitions", () => {
    const items = Array.from({ length: 200 }, (_, id) => ({
      id,
      bounds: [id * 2, -id, 0, id * 2 + 3, -id + 5, 8] as CollisionBounds,
    }));
    const index = new CollisionSpatialIndex(items);
    for (let i = 0; i < 200; i++) {
      const q: CollisionBounds = [i, -100, -1, i + 20, -20, 1];
      const expected = items
        .filter(
          ({ bounds: b }) =>
            b[0] <= q[3] && b[3] >= q[0] && b[1] <= q[4] && b[4] >= q[1] && b[2] <= q[5] && b[5] >= q[2],
        )
        .map((item) => item.id);
      expect(index.query(q)).toEqual(expected);
    }
  });
  it("reuses output storage without stale candidates or aliasing ordinary query results", () => {
    const index = new CollisionSpatialIndex([
      { id: 1, bounds: [0, 0, 0, 10, 10, 10] },
      { id: 2, bounds: [100, 100, 100, 110, 110, 110] },
    ]);
    const near: CollisionBounds = [0, 0, 0, 1, 1, 1];
    const far: CollisionBounds = [100, 100, 100, 101, 101, 101];
    const independent = index.query(near);
    const buffer = [99, 98];
    expect(index.queryInto(near, buffer)).toBe(buffer);
    expect(buffer).toEqual([1]);
    index.queryInto(far, buffer);
    expect(buffer).toEqual([2]);
    expect(independent).toEqual([1]);
    index.queryInto([500, 500, 500, 501, 501, 501], buffer);
    expect(buffer).toEqual([]);
  });
});

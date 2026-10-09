import { describe, expect, it } from "vitest";
import { readTimedemoBundleCounters, summarizeTimedemoBundles } from "../TimedemoBundles";

describe("timedemo bundle capture contract", () => {
  it("preserves real zeros and copies counters instead of retaining Babylon's mutable frame object", () => {
    const raw = { numBundleCreationNonCompatMode: 0, numBundleReuseNonCompatMode: 4 };
    const result = readTimedemoBundleCounters(raw);
    raw.numBundleReuseNonCompatMode = 100;
    expect(result).toEqual({ created: 0, reused: 4 });
  });
  it.each([
    undefined,
    {},
    { numBundleCreationNonCompatMode: -1, numBundleReuseNonCompatMode: 1 },
    { numBundleCreationNonCompatMode: 1, numBundleReuseNonCompatMode: Infinity },
    { numBundleCreationNonCompatMode: 1.5, numBundleReuseNonCompatMode: 1 },
  ])("keeps unavailable/malformed counters null: %j", (value) => {
    expect(readTimedemoBundleCounters(value)).toBeNull();
  });
  it("distinguishes weighted submission share from percentage of frames with rebuilds", () => {
    const report = summarizeTimedemoBundles([
      { bundles: { created: 2, reused: 2 } },
      { bundles: { created: 0, reused: 6 } },
      { bundles: null },
    ]);
    expect(report).toEqual({
      sampledFrames: 2,
      missingFrames: 1,
      created: 2,
      reused: 8,
      createdPerFrame: 1,
      reusedPerFrame: 4,
      creationSharePercent: 20,
      framesWithCreation: 1,
      framesWithCreationPercent: 50,
    });
    expect(summarizeTimedemoBundles([{ bundles: null }])).toBeNull();
    expect(summarizeTimedemoBundles([{ bundles: { created: 0, reused: 0 } }])?.creationSharePercent).toBeNull();
  });
});

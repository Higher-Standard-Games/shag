/**
 * SequenceBuilder.test.ts — Unit tests for Phase 2 cinematic reel builder
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { DemoAnalysis, HighlightCandidate } from "../DemoAnalyzer";
import type { DemoHeader } from "../DemoReader";
import { SequenceBuilder } from "../SequenceBuilder";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHighlight(overrides: Partial<HighlightCandidate> = {}): HighlightCandidate {
  return {
    startTick: 100,
    peakTick: 110,
    endTick: 150,
    score: 20,
    type: "frag",
    primaryPlayer: "player_1",
    primaryPlayerName: "Alice",
    victimPlayer: "player_2",
    victimPlayerName: "Bob",
    weaponId: "rocket_launcher",
    killCount: 1,
    tags: [],
    killerPos: { x: 0, y: 0, z: 0 },
    victimPos: { x: 100, y: 0, z: 0 },
    killerVelocity: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function makeAnalysis(highlights: HighlightCandidate[], totalTicks = 10000): DemoAnalysis {
  return {
    highlights,
    totalTicks,
    totalDurationMs: (totalTicks / 20) * 1000,
    playerNames: new Map([
      ["player_1", "Alice"],
      ["player_2", "Bob"],
      ["player_3", "Charlie"],
    ]),
  };
}

const HEADER: DemoHeader = {
  version: 1,
  map: "q3dm1",
  gametype: "ffa",
  tickRate: 60,
  snapshotRate: 20,
  startTime: 0,
  players: [
    { playerId: "1", name: "Alice", team: "" },
    { playerId: "2", name: "Bob", team: "" },
  ],
};

const TICK_RATE = HEADER.tickRate;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SequenceBuilder", () => {
  let builder: SequenceBuilder;

  beforeEach(() => {
    builder = new SequenceBuilder();
  });

  // 1. Empty highlights → empty reel
  it("returns an empty reel when there are no highlights", () => {
    const reel = builder.build(makeAnalysis([]), 5, TICK_RATE, HEADER);
    expect(reel.segments).toHaveLength(0);
    expect(reel.totalDurationMs).toBe(0);
    expect(reel.totalSegments).toBe(0);
  });

  // 2. Single highlight → 1 segment
  it("produces a single segment from a single highlight", () => {
    const h = makeHighlight({ peakTick: 110, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    // At minimum 1 base segment (replay may be added for top scorer)
    const baseSegments = reel.segments.filter((s) => !s.isReplay);
    expect(baseSegments).toHaveLength(1);
    expect(baseSegments[0].highlight).toBe(h);
  });

  // 3. Two non-overlapping highlights → 2 base segments, chronological order
  it("orders two non-overlapping highlights chronologically", () => {
    const h1 = makeHighlight({ startTick: 100, peakTick: 110, endTick: 150, score: 30 });
    const h2 = makeHighlight({
      startTick: 500,
      peakTick: 510,
      endTick: 550,
      score: 25,
      primaryPlayer: "player_2",
    });
    const reel = builder.build(makeAnalysis([h1, h2]), 5, TICK_RATE, HEADER);
    const base = reel.segments.filter((s) => !s.isReplay);
    expect(base).toHaveLength(2);
    expect(base[0].highlight.peakTick).toBeLessThan(base[1].highlight.peakTick);
  });

  // 4. Two overlapping highlights → only 1 base segment (lower score dropped)
  it("drops the lower-scored highlight when two overlap", () => {
    const h1 = makeHighlight({ startTick: 100, peakTick: 110, endTick: 150, score: 50 });
    const h2 = makeHighlight({ startTick: 120, peakTick: 130, endTick: 160, score: 10 });
    const reel = builder.build(makeAnalysis([h1, h2]), 5, TICK_RATE, HEADER);
    const base = reel.segments.filter((s) => !s.isReplay);
    expect(base).toHaveLength(1);
    expect(base[0].highlight.score).toBe(50);
  });

  // 5. Budget enforcement: many highlights, 1-minute budget → reasonable segments
  it("respects budget when many highlights are provided", () => {
    const highlights: HighlightCandidate[] = [];
    for (let i = 0; i < 30; i++) {
      highlights.push(
        makeHighlight({
          startTick: i * 300,
          peakTick: i * 300 + 50,
          endTick: i * 300 + 100,
          score: 30 - i,
        }),
      );
    }
    const reel = builder.build(makeAnalysis(highlights, 50000), 1, TICK_RATE, HEADER);
    // 1 minute / 8s avg = ~7 base segments max
    const base = reel.segments.filter((s) => !s.isReplay);
    expect(base.length).toBeGreaterThan(0);
    expect(base.length).toBeLessThanOrEqual(8);
  });

  // 6. rocket_jump tag → rocket_jump_hero preset
  it("assigns rocket_jump_hero preset for rocket_jump tag", () => {
    const h = makeHighlight({ tags: ["rocket_jump"], peakTick: 200, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    const base = reel.segments.filter((s) => !s.isReplay);
    expect(base[0].cameraPreset).toBe("rocket_jump_hero");
  });

  // 7. multi_kill with killCount=3 → orbit_kill preset
  it("assigns orbit_kill preset for multi_kill with killCount>=3", () => {
    const h = makeHighlight({
      tags: ["multi_kill"],
      killCount: 3,
      peakTick: 100, // 100 % 5 === 0 but multi_kill takes priority
      score: 20,
    });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    const base = reel.segments.filter((s) => !s.isReplay);
    expect(base[0].cameraPreset).toBe("orbit_kill");
  });

  // 8. long_range tag → dramatic_zoom preset
  it("assigns dramatic_zoom preset for long_range tag", () => {
    const h = makeHighlight({ tags: ["long_range"], peakTick: 200, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    const base = reel.segments.filter((s) => !s.isReplay);
    expect(base[0].cameraPreset).toBe("dramatic_zoom");
  });

  // 9. Top-scored highlight gets replay segment inserted after it
  it("inserts a replay segment after the highest-scored highlight", () => {
    const h1 = makeHighlight({ startTick: 100, peakTick: 110, endTick: 150, score: 100 });
    const h2 = makeHighlight({
      startTick: 500,
      peakTick: 510,
      endTick: 550,
      score: 5,
      primaryPlayer: "player_2",
    });
    const reel = builder.build(makeAnalysis([h1, h2], 2000), 5, TICK_RATE, HEADER);
    const replaySegs = reel.segments.filter((s) => s.isReplay);
    expect(replaySegs.length).toBeGreaterThan(0);
    expect(replaySegs[0].cameraPreset).toBe("replay_orbit");
    expect(replaySegs[0].playbackSpeed).toBe(0.25);
  });

  // 10. First segment transitionIn is fade_to_black
  it("gives the first segment a fade_to_black transitionIn", () => {
    const h = makeHighlight({ peakTick: 110, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    expect(reel.segments[0].transitionIn).toBe("fade_to_black");
  });

  // 11. Segment indexes are sequential 0-based
  it("assigns sequential 0-based segmentIndexes to all segments", () => {
    const highlights = [
      makeHighlight({ startTick: 100, peakTick: 110, endTick: 150, score: 50 }),
      makeHighlight({
        startTick: 500,
        peakTick: 510,
        endTick: 550,
        score: 30,
        primaryPlayer: "player_2",
      }),
    ];
    const reel = builder.build(makeAnalysis(highlights, 2000), 5, TICK_RATE, HEADER);
    for (let i = 0; i < reel.segments.length; i++) {
      expect(reel.segments[i].segmentIndex).toBe(i);
    }
  });

  // 12. totalDurationMs is sum of all segment durations (plus transitions)
  it("computes totalDurationMs as sum of segment durations plus transitions", () => {
    const highlights = [
      makeHighlight({ startTick: 100, peakTick: 110, endTick: 150, score: 50 }),
      makeHighlight({
        startTick: 500,
        peakTick: 510,
        endTick: 550,
        score: 30,
        primaryPlayer: "player_2",
      }),
    ];
    const reel = builder.build(makeAnalysis(highlights, 2000), 5, TICK_RATE, HEADER);
    const expectedSegmentSum = reel.segments.reduce((sum, s) => sum + s.durationMs, 0);
    const expectedTotal = expectedSegmentSum + reel.segments.length * 500;
    expect(reel.totalDurationMs).toBeCloseTo(expectedTotal, 0);
  });

  it("computes segment duration from server tick rate rather than requested snapshot rate", () => {
    const header = { ...HEADER, tickRate: 125, snapshotRate: 60 };
    const h = makeHighlight({ startTick: 100, peakTick: 111, endTick: 225 });
    const reel = builder.build(makeAnalysis([h], 1000), 5, header.tickRate, header);
    const base = reel.segments.find((segment) => !segment.isReplay);

    expect(reel.tickRate).toBe(125);
    expect(base?.durationMs).toBe(1000);
  });
});

describe("SequenceBuilder killer or victim view", () => {
  it("shows the victim's eyes when they saw it coming, never twice running", () => {
    const highlights = [0, 1, 2].map((i) =>
      makeHighlight({
        startTick: 1000 + i * 2000,
        peakTick: 1010 + i * 2000,
        endTick: 1050 + i * 2000,
        victimFacedKiller: true,
      }),
    );
    highlights.push(makeHighlight({ startTick: 9000, peakTick: 9010, endTick: 9050, victimFacedKiller: false }));
    const reel = new SequenceBuilder().build(makeAnalysis(highlights, 20000), 5, TICK_RATE, HEADER);
    const shots = reel.segments.filter((s) => !s.isReplay).map((s) => s.cameraPreset);
    expect(shots).toEqual(["victim_pov", "chase_hero", "victim_pov", "chase_hero"]);
    expect(reel.segments.find((s) => s.cameraPreset === "victim_pov")?.cameraTarget).toBe("player_2");
  });
});

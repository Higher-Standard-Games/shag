/**
 * SequenceBuilder.test.ts — Unit tests for Phase 2 cinematic reel builder
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { DemoAnalysis, HighlightCandidate } from "../DemoAnalyzer";
import type { DemoHeader } from "../DemoReader";
import {
  alignSceneCutsToBeats,
  type CinematicSegment,
  plannedDurationMs,
  plannedSpeedAt,
  SequenceBuilder,
} from "../SequenceBuilder";

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
    frags: new Map(),
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

  // 2. Single highlight → one scene of three shots
  it("films a highlight as one scene: third person, then the player's eyes, then an ending orbit", () => {
    const h = makeHighlight({ peakTick: 110, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    expect(reel.totalScenes).toBe(1);
    expect(reel.segments.map((s) => s.role)).toEqual(["intro", "pov", "ending"]);
    expect(reel.segments.map((s) => s.cameraPreset)).toEqual(["orbit_kill", "chase_hero", "replay_orbit"]);
    expect(reel.segments.every((s) => s.highlight === h && s.scene === 0)).toBe(true);
    expect(reel.segments.map((s) => s.isReplay)).toEqual([false, false, true]);
  });

  it("replays the same frag in each shot: the fly-by up to it slowing down, the eyes through it", () => {
    const h = makeHighlight({ startTick: 100, peakTick: 400, endTick: 520 });
    const [intro, pov, ending] = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER).segments;
    expect(intro).toMatchObject({ startTick: 400 - 2 * TICK_RATE, endTick: 400 });
    expect(intro.speedKeyframes).toEqual([{ tick: 400 - 0.6 * TICK_RATE, speed: 0.35, ramp: 24 }]);
    expect(pov).toMatchObject({ startTick: 400 - 2 * TICK_RATE, endTick: 520 });
    expect(ending.startTick).toBeLessThan(400);
    expect(ending.endTick).toBeGreaterThan(400);
    expect(ending.playbackSpeed).toBeLessThan(1);
    expect(intro.transitionOut).toBe("white_flash");
    expect(pov.transitionIn).toBe("white_flash");
    expect(ending.transitionIn).toBe("crossfade");
  });

  // 3. Two non-overlapping highlights → two scenes, chronological order
  it("orders two non-overlapping highlights chronologically", () => {
    const h1 = makeHighlight({ startTick: 100, peakTick: 110, endTick: 150, score: 30 });
    const h2 = makeHighlight({
      startTick: 500,
      peakTick: 510,
      endTick: 550,
      score: 25,
      primaryPlayer: "player_2",
    });
    const reel = builder.build(makeAnalysis([h2, h1]), 5, TICK_RATE, HEADER);
    expect(reel.totalScenes).toBe(2);
    expect(reel.segments.map((s) => s.scene)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(reel.segments[0].highlight).toBe(h1);
    expect(reel.segments[3].highlight).toBe(h2);
  });

  // 4. Two overlapping highlights → only one scene (lower score dropped)
  it("drops the lower-scored highlight when two overlap", () => {
    const h1 = makeHighlight({ startTick: 100, peakTick: 110, endTick: 150, score: 50 });
    const h2 = makeHighlight({ startTick: 120, peakTick: 130, endTick: 160, score: 10 });
    const reel = builder.build(makeAnalysis([h1, h2]), 5, TICK_RATE, HEADER);
    expect(reel.totalScenes).toBe(1);
    expect(reel.segments[0].highlight.score).toBe(50);
  });

  // 5. Budget enforcement: many highlights, 1-minute budget → about 11 s a scene
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
    expect(reel.totalScenes).toBe(5);
    expect(reel.segments).toHaveLength(15);
  });

  // 6. rocket_jump tag → rocket_jump_hero intro, from the start of the jump
  it("opens a rocket jump with rocket_jump_hero from the start of the jump", () => {
    const h = makeHighlight({ tags: ["rocket_jump"], startTick: 20, peakTick: 200, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    expect(reel.segments[0]).toMatchObject({ role: "intro", cameraPreset: "rocket_jump_hero", startTick: 20 });
  });

  // 7. multi-kill → the eyes shot covers every kill
  it("shows a multi-kill's whole run from the killer's eyes", () => {
    const h = makeHighlight({ tags: ["multi_kill"], killCount: 3, startTick: 0, peakTick: 300, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    expect(reel.segments[0].cameraPreset).toBe("orbit_kill");
    expect(reel.segments[1].startTick).toBe(0);
  });

  // 8. long_range tag → dramatic_zoom intro
  it("opens a long-range frag with dramatic_zoom", () => {
    const h = makeHighlight({ tags: ["long_range"], peakTick: 200, score: 20 });
    const reel = builder.build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    expect(reel.segments[0].cameraPreset).toBe("dramatic_zoom");
  });

  // 9. Scene end effects: repeatable, the next scene comes in through them, the reel ends in black
  it("ends each scene with an effect picked per highlight, and the reel with a fade to black", () => {
    const highlights = Array.from({ length: 6 }, (_, i) =>
      makeHighlight({
        startTick: 1000 + i * 2000,
        peakTick: 1100 + i * 2000,
        endTick: 1200 + i * 2000,
        primaryPlayer: `player_${i}`,
      }),
    );
    const reel = builder.build(makeAnalysis(highlights, 20000), 5, TICK_RATE, HEADER);
    const again = builder.build(makeAnalysis(highlights, 20000), 5, TICK_RATE, HEADER);
    const endings = reel.segments.filter((s) => s.role === "ending");
    expect(endings).toHaveLength(6);
    expect(endings.map((s) => s.transitionOut)).toEqual(
      again.segments.filter((s) => s.role === "ending").map((s) => s.transitionOut),
    );
    expect(endings.at(-1)!.transitionOut).toBe("fade_to_black");
    for (const ending of endings.slice(0, -1)) {
      expect(["fade_to_black", "white_flash", "crossfade", "speed_wipe"]).toContain(ending.transitionOut);
      expect(reel.segments[ending.segmentIndex + 1].transitionIn).toBe(ending.transitionOut);
    }
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

  // 12. totalDurationMs is sum of all segment durations plus their transitions
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
    const expectedTotal = reel.segments.reduce((sum, s) => sum + s.durationMs + s.transitionDurationMs, 0);
    expect(reel.totalDurationMs).toBeCloseTo(expectedTotal, 0);
  });

  it("computes segment duration from server tick rate and its slow motion", () => {
    const header = { ...HEADER, tickRate: 125, snapshotRate: 60 };
    const h = makeHighlight({ startTick: 0, peakTick: 250, endTick: 375 });
    const reel = builder.build(makeAnalysis([h], 1000), 5, header.tickRate, header);
    const intro = reel.segments[0];

    expect(reel.tickRate).toBe(125);
    // 2 s up to the frag: 1.4 s at full speed, then 0.6 s at 0.35×, with
    // a little more for easing into the slow motion over the ramp before it
    expect(intro.durationMs).toBeCloseTo(plannedDurationMs(intro, intro.startTick, intro.endTick, 125), 6);
    expect(intro.durationMs).toBeGreaterThan(1400 + 600 / 0.35);
    expect(intro.durationMs).toBeLessThan(1400 + 600 / 0.35 + 400 / 0.35);
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
    const shots = reel.segments.filter((s) => s.role === "pov").map((s) => s.cameraPreset);
    expect(shots).toEqual(["victim_pov", "chase_hero", "victim_pov", "chase_hero"]);
    expect(reel.segments.find((s) => s.cameraPreset === "victim_pov")?.cameraTarget).toBe("player_2");
  });
});

describe("SequenceBuilder movement clips", () => {
  const frag = (i: number) =>
    makeHighlight({ startTick: i * 3000, peakTick: i * 3000 + 180, endTick: i * 3000 + 300, score: 20 });
  const move = (at: number, score = 6) =>
    makeHighlight({
      type: "movement",
      startTick: at,
      peakTick: at + 120,
      endTick: at + 240,
      score,
      victimPlayer: undefined,
      victimPlayerName: undefined,
      tags: ["wall_jump"],
    });

  it("cuts movement clips in between frag scenes, never first or last, at most two in a gap", () => {
    const highlights = [0, 1, 2, 3, 4, 5].map(frag);
    // Before the first frag, after the last, three in one gap, one in another
    highlights.push(move(-600), move(16000), move(600, 9), move(1100, 8), move(1600, 7), move(9600, 5));
    const reel = new SequenceBuilder().build(makeAnalysis(highlights, 20000), 5, TICK_RATE, HEADER);
    const scenes = [...new Set(reel.segments.map((s) => s.scene))].map(
      (scene) => reel.segments.find((s) => s.scene === scene)!.highlight,
    );
    const kinds = scenes.map((h) => (h.type === "movement" ? "M" : "F")).join("");
    expect(kinds.startsWith("F") && kinds.endsWith("F")).toBe(true);
    expect(kinds).not.toContain("MMM");
    expect(kinds.split("").filter((k) => k === "M")).toHaveLength(3);
    expect(reel.totalScenes).toBe(scenes.length);
  });

  it("films a movement clip following the run, then the player's eyes on its peak", () => {
    const highlights = [frag(0), move(1400), frag(1)];
    const reel = new SequenceBuilder().build(makeAnalysis(highlights, 20000), 5, TICK_RATE, HEADER);
    const shots = reel.segments.filter((s) => s.highlight.type === "movement");
    expect(shots.map((s) => [s.role, s.cameraPreset])).toEqual([
      ["intro", "trick_follow"],
      ["pov", "chase_hero"],
    ]);
    expect(shots[0]).toMatchObject({ startTick: 1400, endTick: 1640 });
    expect(shots[1]).toMatchObject({ startTick: 1430, endTick: 1610, cameraTarget: "player_1" });
    // The clip ends like a scene: into the next frag scene through the same effect
    const next = reel.segments[shots[1].segmentIndex + 1];
    expect(next.transitionIn).toBe(shots[1].transitionOut);
  });

  it("makes a reel of movement alone when the demo has no frags", () => {
    const reel = new SequenceBuilder().build(makeAnalysis([move(100), move(2000)], 20000), 5, TICK_RATE, HEADER);
    expect(reel.totalScenes).toBe(2);
    expect(reel.segments.at(-1)!.transitionOut).toBe("fade_to_black");
  });
});

describe("SequenceBuilder victim's eyes", () => {
  it("ends the victim's eyes on the frag and cuts straight into the orbit there", () => {
    const h = makeHighlight({ startTick: 100, peakTick: 400, endTick: 520, victimFacedKiller: true });
    const [, pov, ending] = new SequenceBuilder().build(makeAnalysis([h]), 5, TICK_RATE, HEADER).segments;
    expect(pov).toMatchObject({ cameraPreset: "victim_pov", cameraTarget: "player_2", endTick: 400 });
    expect(ending).toMatchObject({ cameraPreset: "replay_orbit", startTick: 400, transitionIn: "cut" });
  });

  it("never shows a multi-kill through a victim's eyes", () => {
    const h = makeHighlight({ type: "multi_kill", killCount: 2, victimFacedKiller: true, peakTick: 130 });
    const reel = new SequenceBuilder().build(makeAnalysis([h]), 5, TICK_RATE, HEADER);
    expect(reel.segments.find((s) => s.role === "pov")?.cameraPreset).toBe("chase_hero");
  });
});

describe("SequenceBuilder frag sequences", () => {
  // Frags at 2 s, 4 s and 12 s of a window from 0 to 14 s
  const sequence = (killTimes = [2, 4, 12]) =>
    makeHighlight({
      type: "frag_sequence",
      startTick: 1000,
      peakTick: 1000 + killTimes[killTimes.length - 1] * TICK_RATE,
      endTick: 1000 + (killTimes[killTimes.length - 1] + 2) * TICK_RATE,
      killCount: killTimes.length,
      score: 40,
      kills: killTimes.map((t, i) => ({ tick: 1000 + t * TICK_RATE, victimPlayer: `player_${i + 5}` })),
    });

  it("chases the killer between frags and sees each frag through their eyes, counted", () => {
    const reel = new SequenceBuilder().build(makeAnalysis([sequence()], 20000), 5, TICK_RATE, HEADER);
    const shots = reel.segments.map((s) => s.cameraPreset);
    expect(shots).toEqual(["trick_follow", "chase_hero", "trick_follow", "chase_hero", "replay_orbit"]);
    const [opening, eyes, between, lastEyes] = reel.segments;
    // The first two frags share one eyes shot; each eyes shot counts its frags
    expect(eyes.stamps?.map((s) => s.text)).toEqual(["1", "2"]);
    expect(lastEyes.stamps?.map((s) => s.text)).toEqual(["3"]);
    expect(eyes.cameraTarget).toBe("player_1");
    // The chase frames the victim of the frag it leads to, and runs fast
    expect(opening.victimTarget).toBe("player_5");
    expect(between.victimTarget).toBe("player_7");
    expect(between.playbackSpeed).toBeGreaterThan(1);
    // Every shot follows on from the one before in time
    for (let i = 1; i < 4; i++) expect(reel.segments[i].startTick).toBeGreaterThanOrEqual(reel.segments[i - 1].endTick);
  });

  it("holds the slow motion through frags closer than its beat", () => {
    const reel = new SequenceBuilder().build(makeAnalysis([sequence([2, 2.25, 12])], 20000), 5, TICK_RATE, HEADER);
    const eyes = reel.segments[1];
    const ticks = eyes.speedKeyframes?.map((k) => k.tick) ?? [];
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(eyes.speedKeyframes?.map((k) => k.speed)).toEqual([0.5, 1]);
    const second = 1000 + 2.25 * TICK_RATE;
    expect(plannedSpeedAt(eyes, second)).toBe(0.5);
    expect(plannedSpeedAt(eyes, second + Math.round(0.35 * TICK_RATE))).toBe(1);
  });

  it("jumps ahead through speed lines across a long wait between frags", () => {
    const reel = new SequenceBuilder().build(makeAnalysis([sequence()], 20000), 5, TICK_RATE, HEADER);
    const [, eyes, between] = reel.segments;
    expect(eyes.transitionOut).toBe("speed_wipe");
    expect(between.transitionIn).toBe("speed_wipe");
    expect(between.endTick - between.startTick).toBeLessThanOrEqual(3 * TICK_RATE);
  });

  it("cuts straight from eyes to chase when the wait is short", () => {
    const reel = new SequenceBuilder().build(makeAnalysis([sequence([2, 6])], 20000), 5, TICK_RATE, HEADER);
    const between = reel.segments.find((s, i) => i > 1 && s.cameraPreset === "trick_follow");
    expect(between?.transitionIn).toBe("cut");
  });

  it("ends a three-frag sequence on a freeze frame with its count", () => {
    const reel = new SequenceBuilder().build(makeAnalysis([sequence()], 20000), 5, TICK_RATE, HEADER);
    const ending = reel.segments[reel.segments.length - 1];
    expect(ending.freeze).toMatchObject({ caption: "TRIPLE!", ms: 1400 });
    expect(ending.freeze?.tick).toBeGreaterThan(ending.highlight.peakTick);
    expect(ending.freeze?.tick).toBeLessThan(ending.endTick);
  });
});

describe("SequenceBuilder freeze frames and speed lines", () => {
  const frags = (scores: number[]) =>
    scores.map((score, i) =>
      makeHighlight({
        startTick: 1000 + i * 2000,
        peakTick: 1100 + i * 2000,
        endTick: 1200 + i * 2000,
        score,
        primaryPlayer: `player_${i}`,
      }),
    );

  it("freezes three frag scenes, the best scores among equal plays", () => {
    const reel = new SequenceBuilder().build(makeAnalysis(frags([10, 30, 20, 5, 25]), 20000), 5, TICK_RATE, HEADER);
    const frozen = reel.segments.filter((s) => s.freeze);
    expect(frozen.map((s) => s.highlight.score)).toEqual([30, 20, 25]);
    expect(frozen.every((s) => s.role === "ending")).toBe(true);
  });

  it("saves the freezes for three-frag plays, air rockets and blade frags before a higher score", () => {
    const [a, b, c, d, e] = frags([10, 30, 20, 5, 25]);
    const plays = [
      { ...a, tags: ["blade" as const] },
      b,
      { ...c, killCount: 3 },
      { ...d, tags: ["air_rocket" as const] },
      e,
    ];
    const reel = new SequenceBuilder().build(makeAnalysis(plays, 20000), 5, TICK_RATE, HEADER);
    const frozen = reel.segments.filter((s) => s.freeze);
    expect(frozen.map((s) => s.freeze?.caption)).toEqual(["SLICED!", "TRIPLE!", "AIR ROCKET!"]);
  });

  it("freezes every frag scene of a reel with fewer than three", () => {
    const reel = new SequenceBuilder().build(makeAnalysis(frags([10, 30]), 20000), 5, TICK_RATE, HEADER);
    expect(reel.segments.filter((s) => s.freeze)).toHaveLength(2);
  });

  it("brings some of the reel's best scenes in on speed lines: one cut in three, never two running", () => {
    const scores = [10, 30, 25, 5, 6, 7, 20, 8];
    const reel = new SequenceBuilder().build(makeAnalysis(frags(scores), 20000), 5, TICK_RATE, HEADER);
    const wiped = scores.filter(
      (score) => reel.segments.find((s) => s.highlight.score === score)?.transitionIn === "speed_wipe",
    );
    // Seven cuts: two wipes. 25 comes straight after 30, so 20 has the other.
    expect(wiped).toEqual([30, 20]);
  });
});

describe("planned speed", () => {
  const plan: Pick<CinematicSegment, "playbackSpeed" | "speedKeyframes"> = {
    playbackSpeed: 1,
    speedKeyframes: [
      { tick: 100, speed: 0.5, ramp: 20 },
      { tick: 150, speed: 1, ramp: 10 },
    ],
  };

  it("eases over each keyframe's ramp, then holds", () => {
    expect(plannedSpeedAt(plan, 70)).toBe(1);
    expect(plannedSpeedAt(plan, 90)).toBeCloseTo(0.75);
    expect(plannedSpeedAt(plan, 100)).toBe(0.5);
    expect(plannedSpeedAt(plan, 130)).toBe(0.5);
    expect(plannedSpeedAt(plan, 145)).toBeCloseTo(0.75);
    expect(plannedSpeedAt(plan, 200)).toBe(1);
  });

  it("times a stretch at its planned speeds", () => {
    const steps = { playbackSpeed: 1, speedKeyframes: [{ tick: 60, speed: 0.5 }] };
    expect(plannedDurationMs(steps, 0, 120, 60)).toBeCloseTo(1000 + 2000, 6);
    // A ramp into slow motion takes longer than the step it smooths
    const ramped = { playbackSpeed: 1, speedKeyframes: [{ tick: 60, speed: 0.5, ramp: 12 }] };
    expect(plannedDurationMs(ramped, 0, 120, 60)).toBeGreaterThan(3000);
  });
});

describe("cuts on the beat", () => {
  const reel = () =>
    new SequenceBuilder().build(
      makeAnalysis(
        [0, 1, 2].map((i) =>
          makeHighlight({
            startTick: 1000 + i * 2000,
            peakTick: 1100 + i * 2000,
            endTick: 1200 + i * 2000,
            primaryPlayer: `player_${i}`,
          }),
        ),
        20000,
      ),
      5,
      TICK_RATE,
      HEADER,
    );
  /** Where each scene's last shot ends, in reel time, as planned. */
  const sceneEnds = (r: ReturnType<typeof reel>, titleMs: number) => {
    let at = titleMs;
    const ends: number[] = [];
    r.segments.forEach((s, i) => {
      at = s.cutAtMs ?? at + s.durationMs;
      if (r.segments[i + 1] && r.segments[i + 1].scene !== s.scene) ends.push(at);
    });
    return ends;
  };

  it("moves each cut between scenes onto the nearest beat, running a shot on to reach a later one", () => {
    const original = reel();
    const planned = sceneEnds(original, 2000);
    // The first cut moving 300 ms later moves the second scene's end with it
    const beats = [planned[0] + 300, planned[0] + 2000, planned[1] + 300 - 200, planned[1] + 5000];
    const aligned = alignSceneCutsToBeats(original, beats, 2000);
    const cuts = aligned.segments.filter((s) => s.cutAtMs !== undefined);
    expect(cuts.map((s) => s.cutAtMs)).toEqual([beats[0], beats[2]]);
    // The first scene's ending runs on past its planned end to reach its beat
    const first = cuts[0].segmentIndex;
    expect(aligned.segments[first].endTick).toBeGreaterThan(original.segments[first].endTick);
    // The given reel is left as it was
    expect(original.segments.every((s) => s.cutAtMs === undefined)).toBe(true);
  });

  it("leaves a cut where it was when no beat is near it", () => {
    const aligned = alignSceneCutsToBeats(reel(), [], 2000);
    expect(aligned.segments.every((s) => s.cutAtMs === undefined)).toBe(true);
  });
});

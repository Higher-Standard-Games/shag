import { describe, expect, it } from "vitest";
import {
  sampleTimedemoCamera,
  segmentAt,
  selectTimedemoTarget,
  summarizeTimedemoSamples,
  type TimedemoFixture,
  type TimedemoSample,
  validateTimedemoFixture,
} from "../TimedemoFixture";

const fixture = (): TimedemoFixture => ({
  schemaVersion: 1,
  id: "wdm2-test",
  demo: { file: "demo.shagdemo", sha256: "a".repeat(64), map: "wdm2", players: 10, tickRate: 63, version: 1 },
  startSeconds: 5,
  durationSeconds: 2,
  seed: 927,
  profile: { width: 1280, height: 720, fov: 90, requiredCvars: { r_ssr: 0 } },
  provenance: {},
  segments: [
    {
      name: "tour",
      start: 0,
      end: 1,
      camera: "freefly",
      keyframes: [
        { tick: 0, position: { x: 0, y: 10, z: 0 }, lookAt: { x: 10, y: 10, z: 10 } },
        { tick: 1, position: { x: 20, y: 10, z: 0 }, lookAt: { x: 30, y: 10, z: 10 } },
      ],
    },
    { name: "pov", start: 1, end: 2, camera: "spectator", targets: ["player_2", "player_1"] },
  ],
});

describe("timedemo fixture contract", () => {
  it("uses measured seconds for route interpolation and exact camera cuts", () => {
    const f = validateTimedemoFixture(fixture());
    expect(sampleTimedemoCamera(segmentAt(f, 0.5), 0.5).position.x).toBe(10);
    expect(segmentAt(f, 1).camera).toBe("spectator");
  });
  it.each(["../escape", "a/b", ""])("rejects unsafe fixture IDs %s", (id) => {
    expect(() => validateTimedemoFixture({ ...fixture(), id })).toThrow("Invalid fixture ID");
  });
  it("rejects incomplete or discontinuous camera schedules and invalid coordinates", () => {
    const gap = fixture();
    gap.segments[1].start = 1.1;
    expect(() => validateTimedemoFixture(gap)).toThrow("contiguous");
    const bad = fixture();
    bad.segments[0].keyframes![0].position.x = NaN;
    expect(() => validateTimedemoFixture(bad)).toThrow("coordinates");
    const short = fixture();
    short.segments[0].keyframes![1].tick = 0.8;
    expect(() => validateTimedemoFixture(short)).toThrow("cover");
  });
  it("keeps the saved random order while excluding dead and absent bots", () => {
    const state = {
      entities: new Map([
        ["player_1", {}],
        ["player_2", {}],
      ]),
      events: [{ type: "combat_state", entityId: "player_2", dead: true }],
    };
    expect(selectTimedemoTarget(["player_3", "player_2", "player_1"], state)).toBe("player_1");
    state.events[0].dead = false;
    expect(selectTimedemoTarget(["player_2", "player_1"], state)).toBe("player_2");
    expect(selectTimedemoTarget(["player_9"], state)).toBeNull();
  });
  it("summarizes raw frame times without claiming uncapped FPS; empty phases are explicit", () => {
    const samples = [5, 10, 15, 20].map(
      (wallMs) =>
        ({
          wallMs,
          sceneCpuMs: wallMs / 2,
          playbackCpuMs: 1,
          animationMs: 2,
          drawCalls: 10,
          triangles: 100,
          alivePlayers: 10,
          loadedBodies: 10,
        }) as TimedemoSample,
    );
    const report = summarizeTimedemoSamples(samples, 10);
    expect(report.wallMs.p50).toBe(12.5);
    expect(report.wallMs.p95).toBeCloseTo(19.25);
    expect(report.overBudgetPercent).toBe(50);
    expect(summarizeTimedemoSamples([]).wallMs.p95).toBeNull();
    const unknown = summarizeTimedemoSamples([{ ...samples[0], sceneReady: null }]);
    expect(unknown.unreadySceneFrames).toBe(0);
    expect(unknown.sceneReadinessObservedFrames).toBe(0);
    expect(unknown.pendingSceneDataFrames).toBeNull();
  });
});

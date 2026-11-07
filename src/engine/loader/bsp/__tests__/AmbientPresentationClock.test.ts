import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("../../../AudioManager", () => ({
  AudioManager: { getInstance: () => ({ playSfx2D: audio.play, playSfx3D: audio.play }) },
}));
vi.mock("../BspMeshBuilder", () => ({ buildBrushModel: vi.fn() }));

import { EntityHandlerRegistry } from "../../../core/EntityHandlerRegistry";
import { ownPresentationClock } from "../../../core/PresentationTime";
import { registerAmbientEntityHandlers, unregisterAmbientEntityHandlers } from "../AmbientEntityHandlers";

afterEach(() => {
  vi.useRealTimers();
  audio.play.mockClear();
  unregisterAmbientEntityHandlers();
});

describe("periodic map speakers in an owned presentation clock", () => {
  it("ignores wall stalls and readiness redraws, repeats seeded timing on reload, and removes its observer", async () => {
    vi.useFakeTimers();
    const engine = new NullEngine(),
      scene = new Scene(engine),
      clock = { nowMs: 0 };
    const release = ownPresentationClock(clock);
    registerAmbientEntityHandlers();
    const collect = async (stall: number) => {
      clock.nowMs = 0;
      const baseline = scene.onBeforeRenderObservable.observers.filter(
        (observer) => !observer._willBeUnregistered,
      ).length;
      const result = await EntityHandlerRegistry.getHandler("target_speaker")!(
        {
          classname: "target_speaker",
          properties: { noise: "test.ogg", wait: "0.15", random: "0.08", spawnflags: "4" },
        },
        scene,
      );
      const times: number[] = [];
      audio.play.mockImplementation(() => times.push(clock.nowMs));
      for (let frame = 0; frame < 120; frame++) {
        clock.nowMs = (frame * 1000) / 60;
        vi.advanceTimersByTime(stall);
        scene.onBeforeRenderObservable.notifyObservers(scene);
        const count = times.length;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        expect(times).toHaveLength(count);
      }
      result.node!.dispose();
      expect(scene.onBeforeRenderObservable.observers.filter((observer) => !observer._willBeUnregistered)).toHaveLength(
        baseline,
      );
      const count = times.length;
      clock.nowMs += 10000;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(times).toHaveLength(count);
      return times;
    };
    try {
      const first = await collect(10),
        second = await collect(200);
      expect(first.length).toBeGreaterThan(5);
      expect(second).toEqual(first);
    } finally {
      release();
      scene.dispose();
      engine.dispose();
    }
  });

  it("preserves live wall-timer scheduling and cancels it with the node", async () => {
    vi.useFakeTimers();
    const engine = new NullEngine(),
      scene = new Scene(engine);
    registerAmbientEntityHandlers();
    try {
      const result = await EntityHandlerRegistry.getHandler("target_speaker")!(
        { classname: "target_speaker", properties: { noise: "test.ogg", wait: "1", random: "0", spawnflags: "4" } },
        scene,
      );
      vi.advanceTimersByTime(1000);
      expect(audio.play).toHaveBeenCalledOnce();
      result.node!.dispose();
      vi.advanceTimersByTime(2000);
      expect(audio.play).toHaveBeenCalledOnce();
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

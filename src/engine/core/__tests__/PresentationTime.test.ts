import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ownPresentationClock,
  presentationInterval,
  presentationNow,
  presentationTimeout,
  runPresentationTimers,
} from "../PresentationTime";

let release: (() => void) | null = null;
afterEach(() => {
  release?.();
  release = null;
  vi.useRealTimers();
});

describe("presentation timers", () => {
  it("use the wall clock when no one owns presentation time", () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    presentationTimeout(fired, 100);
    vi.advanceTimersByTime(99);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledOnce();
  });

  it("fire on the owned clock only, in due order, reading their own due time", () => {
    vi.useFakeTimers();
    const clock = { nowMs: 1000 };
    release = ownPresentationClock(clock);
    const seen: Array<[string, number]> = [];
    presentationTimeout(() => seen.push(["late", presentationNow()]), 300);
    presentationTimeout(() => seen.push(["early", presentationNow()]), 100);
    vi.advanceTimersByTime(10_000);
    runPresentationTimers();
    expect(seen).toEqual([]);
    clock.nowMs = 1250;
    runPresentationTimers();
    expect(seen).toEqual([["early", 1100]]);
    expect(presentationNow()).toBe(1250);
    clock.nowMs = 2000;
    runPresentationTimers();
    expect(seen).toEqual([
      ["early", 1100],
      ["late", 1300],
    ]);
  });

  it("repeat intervals once per period the clock moves, and cancel", () => {
    const clock = { nowMs: 0 };
    release = ownPresentationClock(clock);
    const ticks: number[] = [];
    const timer = presentationInterval(() => ticks.push(presentationNow()), 50);
    clock.nowMs = 175;
    runPresentationTimers();
    expect(ticks).toEqual([50, 100, 150]);
    timer.cancel();
    clock.nowMs = 400;
    runPresentationTimers();
    expect(ticks).toEqual([50, 100, 150]);
  });

  it("run a timer a callback schedules if it falls due within the same step", () => {
    const clock = { nowMs: 0 };
    release = ownPresentationClock(clock);
    const order: string[] = [];
    presentationTimeout(() => {
      order.push("first");
      presentationTimeout(() => order.push("chained"), 10);
    }, 10);
    clock.nowMs = 30;
    runPresentationTimers();
    expect(order).toEqual(["first", "chained"]);
  });

  it("drop the owner's timers when it releases the clock", () => {
    const clock = { nowMs: 0 };
    const releaseOwned = ownPresentationClock(clock);
    const fired = vi.fn();
    presentationTimeout(fired, 10);
    releaseOwned();
    release = ownPresentationClock(clock);
    clock.nowMs = 100;
    runPresentationTimers();
    expect(fired).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { ownPresentationClock, presentationNow } from "../core/PresentationTime";

describe("document presentation clock", () => {
  it("does not let an old release revoke a later lease on the same clock", () => {
    const clock = { nowMs: 42 };
    const first = ownPresentationClock(clock);
    first();
    const second = ownPresentationClock(clock);
    try {
      first();
      expect(presentationNow()).toBe(42);
    } finally {
      second();
    }
  });
  it("stays fixed through wall-clock stalls and restores the live clock", () => {
    const wall = vi.spyOn(performance, "now").mockReturnValue(9000);
    const clock = { nowMs: 0 };
    const release = ownPresentationClock(clock);
    try {
      expect(presentationNow()).toBe(0);
      wall.mockReturnValue(19000);
      expect(presentationNow()).toBe(0);
      clock.nowMs = 1000 / 60;
      expect(presentationNow()).toBe(1000 / 60);
      expect(() => ownPresentationClock({ nowMs: 0 })).toThrow("already owned");
    } finally {
      release();
    }
    expect(presentationNow()).toBe(19000);
    const releaseNext = ownPresentationClock({ nowMs: 5 });
    release();
    expect(presentationNow()).toBe(5);
    releaseNext();
    wall.mockRestore();
  });
});

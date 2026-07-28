/**
 * ChannelledAction — hold-to-act progress, and the ways it must be interrupted.
 *
 * Arm and defuse are the first users. The interesting cases are all about
 * STOPPING: a channel that keeps running after the player walked away is a bomb
 * that arms itself from across the room.
 */

import { describe, expect, it } from "vitest";
import { type ChannelRequest, ChannelTracker, channelProgress } from "../ChannelledAction";

const ARM: ChannelRequest = { kind: "arm", targetId: 0, durationTicks: 5 };
const DEFUSE: ChannelRequest = { kind: "defuse", targetId: 0, durationTicks: 5 };

/** Run `ticks` updates with the same request, returning the final outcome. */
function hold(tracker: ChannelTracker, entity: number, request: ChannelRequest | null, ticks: number, from = 0) {
  let outcome = tracker.update(entity, request, from);
  for (let i = 1; i < ticks; i++) outcome = tracker.update(entity, request, from + i);
  return outcome;
}

describe("channel lifecycle", () => {
  it("starts, progresses, then completes exactly once", () => {
    const t = new ChannelTracker();
    expect(t.update(1, ARM, 0).kind).toBe("started");
    expect(t.update(1, ARM, 1).kind).toBe("progress");
    expect(t.update(1, ARM, 2).kind).toBe("progress");
    expect(t.update(1, ARM, 3).kind).toBe("progress");
    // Five ticks of holding completes on the fifth update, not the sixth.
    expect(t.update(1, ARM, 4).kind).toBe("completed");
    // Completion clears the channel, so holding again starts a fresh one rather
    // than completing every tick forever.
    expect(t.update(1, ARM, 5).kind).toBe("started");
  });

  it("takes exactly durationTicks of holding", () => {
    const t = new ChannelTracker();
    expect(hold(t, 1, ARM, 4).kind).toBe("progress");
    expect(t.update(1, ARM, 4).kind).toBe("completed");
    // ...and a duration of 1 needs exactly one update.
    expect(new ChannelTracker().update(9, { ...ARM, durationTicks: 1 }, 0).kind).toBe("completed");
  });

  it("reports idle when nothing is happening", () => {
    expect(new ChannelTracker().update(1, null, 0).kind).toBe("idle");
  });
});

describe("interruption", () => {
  it("cancels when the precondition stops holding", () => {
    // The core safety property: the caller states what is possible NOW, so a
    // player who walks out of the radius simply stops passing a request.
    const t = new ChannelTracker();
    hold(t, 1, ARM, 3);
    const out = t.update(1, null, 3);
    expect(out.kind).toBe("cancelled");
    expect(out.reason).toBe("interrupted");
  });

  it("discards progress — resuming starts over rather than resuming", () => {
    const t = new ChannelTracker();
    hold(t, 1, ARM, 4); // one tick from completion
    const almostDone = t.progress(1);
    expect(almostDone).toBeCloseTo(0.8, 5);

    t.update(1, null, 5); // interrupted
    expect(t.update(1, ARM, 5).kind).toBe("started");
    // Back to a single tick of holding, not 4/5 of the way there.
    expect(t.progress(1)).toBeCloseTo(1 / ARM.durationTicks, 5);
    expect(t.progress(1)).toBeLessThan(almostDone);
  });

  it("cancels when the target changes, so progress never carries between sites", () => {
    const t = new ChannelTracker();
    hold(t, 1, ARM, 3);
    const out = t.update(1, { ...ARM, targetId: 1 }, 3);
    expect(out.kind).toBe("cancelled");
    expect(out.reason).toBe("retargeted");
  });

  it("cancels when the kind changes", () => {
    const t = new ChannelTracker();
    hold(t, 1, ARM, 3);
    expect(t.update(1, DEFUSE, 3).reason).toBe("retargeted");
  });

  it("treats a zero or negative duration as no channel at all", () => {
    const t = new ChannelTracker();
    expect(t.update(1, { ...ARM, durationTicks: 0 }, 0).kind).toBe("idle");
    expect(t.update(1, { ...ARM, durationTicks: -5 }, 0).kind).toBe("idle");
  });

  it("completes immediately for a one-tick channel rather than stalling", () => {
    const t = new ChannelTracker();
    expect(t.update(1, { ...ARM, durationTicks: 1 }, 0).kind).toBe("completed");
    expect(t.get(1)).toBeUndefined();
  });

  it("clears on demand, for death and round end", () => {
    const t = new ChannelTracker();
    hold(t, 1, ARM, 3);
    t.clear(1);
    expect(t.get(1)).toBeUndefined();

    hold(t, 1, ARM, 2);
    hold(t, 2, ARM, 2);
    t.clearAll();
    expect([...t.entries()]).toHaveLength(0);
  });
});

describe("progress", () => {
  it("rises from 0 toward 1 across the hold", () => {
    const t = new ChannelTracker();
    t.update(1, ARM, 0);
    expect(t.progress(1)).toBeCloseTo(0.2, 5);
    t.update(1, ARM, 1);
    expect(t.progress(1)).toBeCloseTo(0.4, 5);
    t.update(1, ARM, 2);
    expect(t.progress(1)).toBeCloseTo(0.6, 5);
  });

  it("is 0 for an entity with no channel", () => {
    expect(new ChannelTracker().progress(99)).toBe(0);
    expect(channelProgress(undefined)).toBe(0);
  });

  it("never leaves the 0..1 range", () => {
    expect(channelProgress({ kind: "arm", targetId: 0, durationTicks: 5, elapsedTicks: 99, startedAtTick: 0 })).toBe(1);
    expect(channelProgress({ kind: "arm", targetId: 0, durationTicks: 0, elapsedTicks: 3, startedAtTick: 0 })).toBe(0);
  });
});

describe("multiple entities", () => {
  it("keeps separate progress per entity on the same target", () => {
    // Two defenders on one bomb: each holds their own progress and whoever
    // completes first wins. Falls out rather than needing a rule.
    const t = new ChannelTracker();
    hold(t, 1, DEFUSE, 3);
    hold(t, 2, DEFUSE, 1);
    expect(t.progress(1)).toBeGreaterThan(t.progress(2));
    expect(t.update(1, DEFUSE, 4).kind).toBe("progress");
    expect(t.update(1, DEFUSE, 5).kind).toBe("completed");
    expect(t.get(2)).toBeDefined();
  });

  it("interrupting one does not touch the other", () => {
    const t = new ChannelTracker();
    hold(t, 1, DEFUSE, 3);
    hold(t, 2, DEFUSE, 3);
    t.update(1, null, 3);
    expect(t.get(1)).toBeUndefined();
    expect(t.progress(2)).toBeGreaterThan(0);
  });

  it("exposes every active channel for replication", () => {
    const t = new ChannelTracker();
    hold(t, 1, ARM, 2);
    hold(t, 2, DEFUSE, 2);
    const all = [...t.entries()];
    expect(all).toHaveLength(2);
    expect(all.map(([id]) => id).sort()).toEqual([1, 2]);
  });
});

describe("duration changes mid-channel", () => {
  it("keeps progress rather than discarding the holding already done", () => {
    const t = new ChannelTracker();
    hold(t, 1, ARM, 3);
    const before = t.get(1)?.elapsedTicks ?? 0;
    t.update(1, { ...ARM, durationTicks: 10 }, 3);
    expect(t.get(1)?.durationTicks).toBe(10);
    expect(t.get(1)?.elapsedTicks).toBe(before + 1);
  });
});

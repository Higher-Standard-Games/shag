// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The curtain stays down until the GAME is ready, not just the map.
 *
 * `loading:complete` means the map finished. The FPS client then decodes audio
 * banks, builds a collision world, extracts trigger volumes and warms its
 * viewmodel — seconds of work that used to happen with the overlay already
 * faded, so the player watched the world assemble itself.
 *
 * Modelled against the hold rule rather than the overlay, which needs a DOM,
 * an EventBus and an animation loop to instantiate. What broke was the ordering.
 */
class HoldGate {
  private holds = new Set<string>();
  private completed = false;
  faded = false;

  hold(name: string): void {
    this.holds.add(name);
  }

  complete(): void {
    this.completed = true;
    this.maybeFade();
  }

  release(name: string): void {
    if (!this.holds.delete(name)) return;
    this.maybeFade();
  }

  private maybeFade(): void {
    if (this.completed && this.holds.size === 0) this.faded = true;
  }
}

describe("loading overlay holds", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not fade while a hold is outstanding", () => {
    const gate = new HoldGate();
    gate.hold("fps:postload");

    gate.complete();

    expect(gate.faded).toBe(false);
  });

  it("fades once the last hold is released", () => {
    const gate = new HoldGate();
    gate.hold("fps:postload");
    gate.complete();

    gate.release("fps:postload");

    expect(gate.faded).toBe(true);
  });

  it("still fades when nothing ever held it", () => {
    const gate = new HoldGate();

    gate.complete();

    expect(gate.faded).toBe(true);
  });

  it("waits for every holder, not just one", () => {
    const gate = new HoldGate();
    gate.hold("fps:postload");
    gate.hold("audio");
    gate.complete();

    gate.release("audio");
    expect(gate.faded).toBe(false);

    gate.release("fps:postload");
    expect(gate.faded).toBe(true);
  });

  it("releasing before the map completes does not fade early", () => {
    const gate = new HoldGate();
    gate.hold("fps:postload");

    gate.release("fps:postload");
    expect(gate.faded).toBe(false);

    gate.complete();
    expect(gate.faded).toBe(true);
  });
});

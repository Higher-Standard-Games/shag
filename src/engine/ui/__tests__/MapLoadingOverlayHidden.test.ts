// @vitest-environment jsdom

/**
 * MapLoadingOverlay announces when it has finished fading out, so a load can
 * check what is on screen at the moment the player first sees the world.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/EventBus";
import { LOADING_EVENTS } from "../../core/LoadingEvents";
import { MapLoadingOverlay } from "../MapLoadingOverlay";

let hidden: ReturnType<typeof vi.fn>;
let unsubscribe: () => void;

const start = () => EventBus.emit(LOADING_EVENTS.START, { type: "map", id: "wdm2" });
const complete = () => EventBus.emit(LOADING_EVENTS.COMPLETE, { type: "map", success: true, duration: 0 });
const oneFrame = () => vi.advanceTimersByTime(16);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  MapLoadingOverlay.configure({
    animationEnabled: false,
    showLogo: false,
    showBranding: false,
    minDisplayMs: 0,
    completeHoldMs: 0,
    fadeDurationMs: 50,
  });
  MapLoadingOverlay.enable();
  hidden = vi.fn();
  unsubscribe = EventBus.on(LOADING_EVENTS.HIDDEN, hidden);
});

afterEach(() => {
  unsubscribe();
  MapLoadingOverlay.disable();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MapLoadingOverlay hidden event", () => {
  it("is emitted once the overlay has faded out after the map completes", () => {
    start();
    oneFrame();
    complete();
    vi.advanceTimersByTime(20);
    expect(hidden).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(hidden).toHaveBeenCalledTimes(1);
  });

  it("waits for every hold, as the fade does", () => {
    MapLoadingOverlay.hold("fps:postload");
    start();
    oneFrame();
    complete();
    vi.advanceTimersByTime(1000);
    expect(hidden).not.toHaveBeenCalled();

    MapLoadingOverlay.release("fps:postload");
    vi.advanceTimersByTime(1000);

    expect(hidden).toHaveBeenCalledTimes(1);
  });

  it("still fades after a hold when the map completed before the overlay's first frame", () => {
    MapLoadingOverlay.hold("fps:postload");
    start();
    complete();
    // The late first frame arrives while the hold keeps the screen up.
    vi.advanceTimersByTime(1000);

    MapLoadingOverlay.release("fps:postload");
    vi.advanceTimersByTime(1000);

    expect(hidden).toHaveBeenCalledTimes(1);
  });
});

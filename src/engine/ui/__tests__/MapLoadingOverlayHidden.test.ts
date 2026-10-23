// @vitest-environment jsdom

/**
 * MapLoadingOverlay announces when it has finished fading out, so a load can
 * check what is on screen at the moment the player first sees the world.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioManager } from "../../AudioManager";
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
    holdTimeoutMs: 20000,
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
  it("starts the post-load watchdog after a slow map finishes", () => {
    MapLoadingOverlay.configure({ holdTimeoutMs: 100 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    MapLoadingOverlay.hold("test:slow-map");
    start();
    vi.advanceTimersByTime(200);
    complete();
    vi.advanceTimersByTime(60);
    expect(hidden).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(hidden).toHaveBeenCalledOnce();
  });
  it("keeps SFX muted through holds and fading, then restores the prior levels without changing music", () => {
    const audio = AudioManager.getInstance();
    audio.setSfxVolume(0.37);
    audio.setMusicVolume(0.23);
    const backend = (audio as unknown as { sfxBackend: { setMuted(muted: boolean): void } }).sfxBackend;
    const mute = vi.spyOn(backend, "setMuted");
    MapLoadingOverlay.hold("test:ready");
    start();
    complete();
    vi.advanceTimersByTime(1000);
    expect(mute.mock.calls).toEqual([[true]]);
    MapLoadingOverlay.release("test:ready");
    vi.advanceTimersByTime(1);
    expect(mute.mock.calls).toEqual([[true]]);
    vi.advanceTimersByTime(100);
    expect(mute.mock.calls).toEqual([[true], [false]]);
    expect(audio.getSfxVolume()).toBe(0.37);
    expect(audio.getMusicVolume()).toBe(0.23);
  });

  it("does not unmute or hide a replacement load when the previous fade expires", () => {
    const audio = AudioManager.getInstance();
    const backend = (audio as unknown as { sfxBackend: { setMuted(muted: boolean): void } }).sfxBackend;
    const mute = vi.spyOn(backend, "setMuted");
    start();
    complete();
    vi.advanceTimersByTime(1);
    start();
    vi.advanceTimersByTime(100);
    expect(hidden).not.toHaveBeenCalled();
    expect(mute.mock.calls).toEqual([[true]]);
    MapLoadingOverlay.disable();
    expect(mute.mock.calls).toEqual([[true], [false]]);
  });
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

// @vitest-environment jsdom

/** The loading overlay's message lines show map names and loader errors as text, never as markup. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/EventBus";
import { LOADING_EVENTS } from "../../core/LoadingEvents";
import { MapLoadingOverlay } from "../MapLoadingOverlay";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  MapLoadingOverlay.configure({
    animationEnabled: false,
    showLogo: false,
    showBranding: false,
    showMessages: true,
    minDisplayMs: 0,
    completeHoldMs: 0,
    fadeDurationMs: 50,
    holdTimeoutMs: 20000,
  });
  MapLoadingOverlay.enable();
});

afterEach(() => {
  MapLoadingOverlay.disable();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MapLoadingOverlay messages", () => {
  it("shows a map name and a loader error as text", () => {
    const name = '<img src=x onerror="window.pwned=1">';
    EventBus.emit(LOADING_EVENTS.START, { type: "map", id: "custom", meta: { displayName: name } });
    EventBus.emit(LOADING_EVENTS.COMPLETE, { type: "map", success: false, duration: 0, error: "<b>bad</b>" });
    const lines = [...document.querySelectorAll(".ui-map-loading-overlay__message")].map((el) => el.textContent);
    expect(lines).toContain(`loading ${name}...`);
    expect(lines).toContain("error: <b>bad</b>");
    expect(document.querySelector(".ui-map-loading-overlay__messages img, .ui-map-loading-overlay__messages b")).toBe(
      null,
    );
  });
});

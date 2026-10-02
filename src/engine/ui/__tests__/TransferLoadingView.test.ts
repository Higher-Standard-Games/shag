// @vitest-environment jsdom

/**
 * The map loading screen in the match handoff's look: what it says as a load
 * moves through its phases, and how it takes over from the handoff screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/EventBus";
import { LOADING_EVENTS } from "../../core/LoadingEvents";
import { ConnectingOverlay } from "../components/ConnectingOverlay";
import { clearNetworkConnector, registerNetworkConnector } from "../components/NetworkConnector";
import { MapLoadingOverlay } from "../MapLoadingOverlay";
import { forgetMapTitles, rememberMapTitle } from "../MapTitles";
import { phaseProgress, TransferLoadingView, titleLines } from "../TransferLoadingView";

const start = (id = "wdm2") => EventBus.emit(LOADING_EVENTS.START, { type: "map", id, meta: { displayName: id } });
const progress = (phase: string, detail?: string, percent?: number) =>
  EventBus.emit(LOADING_EVENTS.PROGRESS, { type: "map", phase, detail, percent });
const complete = (success = true, error?: string) =>
  EventBus.emit(LOADING_EVENTS.COMPLETE, { type: "map", success, error, duration: 2340 });
const oneFrame = () => vi.advanceTimersByTime(16);

const screen = () => document.querySelector<HTMLElement>(".connecting-overlay--loading");
const text = (selector: string) => screen()?.querySelector(selector)?.textContent ?? null;
const steps = () =>
  [...(screen()?.querySelectorAll(".connecting-overlay__step") ?? [])].map((step) => ({
    label: step.querySelector(".connecting-overlay__step-label")?.textContent,
    state: [...step.classList].find((name) => name.startsWith("is-")),
  }));
const share = () => Number(screen()?.style.getPropertyValue("--co-progress"));

describe("title lines", () => {
  it("splits a name where its two lines come out most even", () => {
    expect(titleLines("Proving Grounds")).toEqual(["Proving", "Grounds"]);
    expect(titleLines("The Longest Yard")).toEqual(["The Longest", "Yard"]);
  });

  it("keeps a one-word name on one line", () => {
    expect(titleLines("Aerowalk")).toEqual(["Aerowalk"]);
  });
});

describe("phase progress", () => {
  it("runs from the first phase to the map's share of the bar", () => {
    expect(phaseProgress({ type: "map", phase: "cleanup" })).toBe(0);
    expect(phaseProgress({ type: "map", phase: "Complete" })).toBeCloseTo(0.9);
  });

  it("moves within a phase by its percent, whichever scale it reports on", () => {
    const fraction = phaseProgress({ type: "map", phase: "Dependencies", percent: 0.5 });
    const percent = phaseProgress({ type: "map", phase: "Dependencies", percent: 50 });
    expect(fraction).toBeCloseTo(percent ?? -1);
    expect(fraction).toBeGreaterThan(phaseProgress({ type: "map", phase: "Dependencies" }) ?? 1);
    expect(fraction).toBeLessThan(phaseProgress({ type: "map", phase: "Shaders" }) ?? 0);
  });

  it("has no share for a phase it does not know", () => {
    expect(phaseProgress({ type: "map", phase: "Something new" })).toBeNull();
  });
});

describe("TransferLoadingView on the loading overlay", () => {
  let hidden: ReturnType<typeof vi.fn>;
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    document.body.innerHTML = "";
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    MapLoadingOverlay.configure({
      view: () => new TransferLoadingView(),
      minDisplayMs: 0,
      completeHoldMs: 0,
      failureHoldMs: 2500,
      fadeDurationMs: 50,
    });
    MapLoadingOverlay.enable();
    hidden = vi.fn();
    unsubscribe = EventBus.on(LOADING_EVENTS.HIDDEN, hidden);
  });

  afterEach(() => {
    unsubscribe();
    MapLoadingOverlay.disable();
    MapLoadingOverlay.configure({ view: null });
    clearNetworkConnector();
    forgetMapTitles();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("names the map as the lobby named it, over its levelshot", () => {
    rememberMapTitle("wdm2", "Proving Grounds");
    start("wdm2");

    const lines = [...(screen()?.querySelectorAll(".connecting-overlay__title span") ?? [])].map((s) => s.textContent);
    expect(lines).toEqual(["PROVING", "GROUNDS"]);
    expect(screen()?.getAttribute("aria-label")).toBe("Loading Proving Grounds");
    expect(text(".connecting-overlay__server")).toBe("wdm2");
    const shot = screen()?.querySelector<HTMLElement>(".connecting-overlay__shot");
    expect(shot?.style.getPropertyValue("--co-shot")).toBe('url("/data/levelshots/wdm2.jpg")');
  });

  it("keeps the file name for a map nobody has named", () => {
    start("wbomb6");
    const lines = [...(screen()?.querySelectorAll(".connecting-overlay__title span") ?? [])].map((s) => s.textContent);
    expect(lines).toEqual(["WBOMB6"]);
  });

  it("walks a local load through its own steps and fills the bar forward only", () => {
    start();
    expect(text(".connecting-overlay__rail-kicker")).toBe("LOCAL MAP");
    expect(steps().map((step) => step.label)).toEqual(["MAP DATA", "WORLD", "GAME"]);
    expect(steps().map((step) => step.state)).toEqual(["is-active", "is-pending", "is-pending"]);

    progress("Textures", "Loading and applying");
    expect(text(".connecting-overlay__status")).toContain("TEXTURES");
    expect(text(".connecting-overlay__detail")).toBe("Loading and applying");
    expect(steps().map((step) => step.state)).toEqual(["is-done", "is-active", "is-pending"]);
    const afterTextures = share();
    expect(afterTextures).toBeGreaterThan(0);

    // A phase reported out of order does not pull the bar back
    progress("Shaders");
    expect(share()).toBe(afterTextures);

    progress("Assets", "Preloading pickup models");
    expect(steps().map((step) => step.state)).toEqual(["is-done", "is-done", "is-active"]);
  });

  it("shows a networked load as the handoff's last step", () => {
    registerNetworkConnector({ isConnected: () => true, connect: vi.fn() });
    start();
    expect(text(".connecting-overlay__rail-kicker")).toBe("MATCH HANDOFF");
    expect(steps()).toEqual([
      { label: "SERVER", state: "is-done" },
      { label: "HANDSHAKE", state: "is-done" },
      { label: "MAP LOAD", state: "is-active" },
    ]);
  });

  it("says the game is setting up while a hold keeps it down, then ready", () => {
    MapLoadingOverlay.hold("fps:postload");
    start();
    oneFrame();
    complete();

    expect(screen()?.dataset.state).toBe("setting-up");
    expect(text(".connecting-overlay__status")).toContain("SETTING UP");
    expect(text(".connecting-overlay__detail")).toBe("Map loaded in 2.3 s");
    expect(screen()?.getAttribute("aria-busy")).toBe("true");

    MapLoadingOverlay.release("fps:postload");
    expect(screen()?.dataset.state).toBe("ready");
    expect(text(".connecting-overlay__kicker")).toBe("ARENA READY");
    expect(share()).toBe(1);
    expect(screen()?.getAttribute("aria-busy")).toBe("false");
    expect(steps().every((step) => step.state === "is-done")).toBe(true);

    vi.advanceTimersByTime(100);
    expect(hidden).toHaveBeenCalledTimes(1);
    expect(screen()).toBeNull();
  });

  it("keeps a failure on screen long enough to read", () => {
    start();
    oneFrame();
    complete(false, "Map not found: nowhere");

    expect(screen()?.dataset.state).toBe("load-failed");
    expect(screen()?.querySelector("[role='alert']")?.textContent).toBe("Map not found: nowhere");
    expect(steps().some((step) => step.state === "is-error")).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(hidden).not.toHaveBeenCalled();
    expect(text(".connecting-overlay__kicker")).toBe("MAP ERROR");

    vi.advanceTimersByTime(1000);
    expect(hidden).toHaveBeenCalledTimes(1);
  });

  it("takes over from the handoff screen in place", async () => {
    registerNetworkConnector({ isConnected: () => false, connect: () => new Promise<void>(() => {}) });
    void new ConnectingOverlay().show("ws://localhost:7777", false, "seat-ticket");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(".connecting-overlay--handoff")).not.toBeNull();

    start();

    expect(document.querySelector(".connecting-overlay--handoff")).toBeNull();
    expect(screen()?.classList.contains("connecting-overlay--continued")).toBe(true);
    expect(document.querySelector(".ui-map-loading-overlay--instant")).not.toBeNull();
  });

  it("fades in on its own when no handoff came before it", () => {
    // A screen in the same look that is not the handoff, such as the join screen
    const other = document.createElement("div");
    other.className = "connecting-overlay connecting-overlay--join";
    other.style.display = "none";
    document.body.appendChild(other);
    start();
    expect(screen()?.classList.contains("connecting-overlay--continued")).toBe(false);
    expect(document.querySelector(".ui-map-loading-overlay--instant")).toBeNull();
  });
});

// @vitest-environment jsdom

/**
 * The start-up screen: the boot's steps on the rail, and the ring with the
 * engine's logo that starts the game and turns the sound on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({ unlockAudio: vi.fn(), loadPlaylist: vi.fn() }));
vi.mock("../../AudioManager", () => ({ AudioManager: { getInstance: () => audio } }));

import { LoadingScreen } from "../LoadingScreen";
import { UIStyles } from "../UIStyles";

const root = () => document.querySelector<HTMLElement>(".ui-loading-screen");
const steps = () =>
  [...(root()?.querySelectorAll(".connecting-overlay__step") ?? [])].map((step) =>
    [...step.classList].find((name) => name.startsWith("is-")),
  );
const ring = () => root()?.querySelector<HTMLButtonElement>(".connecting-overlay__ring");
const caption = () => root()?.querySelector<HTMLElement>(".connecting-overlay__ring-caption");
const share = () => Number(root()?.style.getPropertyValue("--co-progress"));

describe("start-up screen", () => {
  let screen: LoadingScreen;

  beforeEach(() => {
    vi.useFakeTimers();
    audio.unlockAudio.mockClear();
    audio.loadPlaylist.mockClear();
    screen = new LoadingScreen();
    screen.show();
  });

  afterEach(() => {
    screen.hide();
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("starts on the renderer, with the other steps still to come", () => {
    expect(steps()).toEqual(["is-active", "is-pending", "is-pending", "is-pending"]);
    expect(root()?.querySelector(".connecting-overlay__status")?.textContent).toBe("RENDERER");
    expect(share()).toBe(0);
  });

  it("moves through the boot's steps, and never back", () => {
    screen.setStep("engine");
    expect(steps()).toEqual(["is-done", "is-done", "is-active", "is-pending"]);
    expect(share()).toBe(0.5);

    screen.setStep("packages");
    expect(steps()).toEqual(["is-done", "is-done", "is-active", "is-pending"]);
  });

  it("shows what it is doing now on the rail", () => {
    screen.setStatus("Indexing packages 3/12");
    expect(root()?.querySelector(".connecting-overlay__server")?.textContent).toBe("Indexing packages 3/12");
  });

  it("offers the ring once the engine can take the click, and says what it is for", () => {
    expect(ring()?.disabled).toBe(true);
    expect(caption()?.hidden).toBe(true);
    void screen.waitForReady();

    expect(ring()?.disabled).toBe(false);
    expect(caption()?.hidden).toBe(false);
    expect(caption()?.textContent).toContain("Click to start");
    expect(root()?.classList.contains("ui-loading-screen--ready")).toBe(true);
  });

  it("starts on a click on the ring, turning the sound on, and says so while boot finishes", async () => {
    const ready = screen.waitForReady();
    ring()?.click();
    await ready;

    expect(audio.unlockAudio).toHaveBeenCalledOnce();
    expect(ring()?.disabled).toBe(true);
    expect(caption()?.textContent).toBe("Starting");
    expect(LoadingScreen.isWaitingForReady()).toBe(false);
  });

  it("starts on Enter too", async () => {
    const ready = screen.waitForReady();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await ready;
    expect(audio.unlockAudio).toHaveBeenCalledOnce();
  });

  it("leaves the menus' key styles for the menus to inject, in their own order", () => {
    // Injected here, before the lobby's own sheets, they came first and lost to them
    const inject = vi.spyOn(UIStyles, "injectCSS");
    const another = new LoadingScreen();
    void another.waitForReady();
    expect(inject.mock.calls.map(([id]) => id)).not.toContain("raised-key");
    inject.mockRestore();
    another.hide();
  });

  it("can be dismissed from the console", async () => {
    const ready = screen.waitForReady();
    expect(LoadingScreen.isWaitingForReady()).toBe(true);
    LoadingScreen.forceDismiss();
    await ready;
    expect(audio.unlockAudio).toHaveBeenCalledOnce();
  });

  it("marks every step done and fills the bar as it goes", () => {
    screen.setStep("lobby");
    screen.hide();
    expect(steps()).toEqual(["is-done", "is-done", "is-done", "is-done"]);
    expect(share()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(root()).toBeNull();
  });
});

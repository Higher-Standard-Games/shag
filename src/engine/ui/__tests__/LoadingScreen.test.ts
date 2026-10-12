// @vitest-environment jsdom

/**
 * The start-up screen, built as the lobby's twin: the boot's steps as the
 * rail's keys, a log where the lobby lists rooms, and the ring with the
 * engine's logo that spins while loading; once everything has loaded, a start
 * button starts the game and turns the sound on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({ unlockAudio: vi.fn(), loadPlaylist: vi.fn() }));
vi.mock("../../AudioManager", () => ({ AudioManager: { getInstance: () => audio } }));

import { configureLobbyTwin } from "../components/LobbyTwin";
import { LoadingScreen } from "../LoadingScreen";
import { UIStyles } from "../UIStyles";

const root = () => document.querySelector<HTMLElement>(".ui-loading-screen");
const steps = () =>
  [...(root()?.querySelectorAll(".twin__steps .twin-key") ?? [])].map((step) =>
    [...step.classList].find((name) => name.startsWith("is-")),
  );
const ring = () => root()?.querySelector<HTMLButtonElement>(".boot__ring");
const caption = () => root()?.querySelector<HTMLElement>(".boot__caption");
const start = () => root()?.querySelector<HTMLButtonElement>(".boot__start");
const share = () => Number(root()?.style.getPropertyValue("--boot-progress"));
const logLines = () => [...(root()?.querySelectorAll(".twin__log-line") ?? [])].map((line) => line.textContent);

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
    expect(root()?.querySelector(".boot__status")?.textContent).toBe("RENDERER");
    expect(share()).toBe(0);
  });

  it("offers reload after a fatal renderer failure without leaking the exception into diagnostics", async () => {
    void screen.waitForReady();
    const reload = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    screen.fail(new TypeError("private-key-and-invite"), reload);
    expect(root()?.getAttribute("aria-busy")).toBe("false");
    expect(root()?.querySelector("[role=alert]")?.textContent).toContain("hardware acceleration");
    expect(root()?.textContent).not.toContain("private-key-and-invite");
    expect(LoadingScreen.isWaitingForReady()).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(audio.unlockAudio).not.toHaveBeenCalled();
    start()?.click();
    expect(reload).toHaveBeenCalledOnce();
    root()?.querySelector<HTMLButtonElement>(".boot__copy")?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Boot step: renderer\nFailure: TypeError"));
    screen.markReady();
    expect(root()?.querySelector(".boot__status")?.textContent).toBe("FAILED");
    vi.unstubAllGlobals();
  });

  it("moves through the boot's steps, and never back", () => {
    screen.setStep("engine");
    expect(steps()).toEqual(["is-done", "is-done", "is-active", "is-pending"]);
    expect(share()).toBe(0.5);

    screen.setStep("packages");
    expect(steps()).toEqual(["is-done", "is-done", "is-active", "is-pending"]);
  });

  it("latches the step in progress as the lobby latches the page you are on", () => {
    screen.setStep("packages");
    const keys = [...(root()?.querySelectorAll(".twin__steps .twin-key") ?? [])];
    expect(keys.map((key) => key.getAttribute("aria-current"))).toEqual([null, "step", null, null]);
    expect(keys.map((key) => key.querySelector(".twin-key__hint")?.textContent)).toEqual(["Done", "Loading", "", ""]);
  });

  it("logs what it is doing on the rail, newest last, once per line", () => {
    screen.setStatus("Indexing packages 3/12");
    screen.setStatus("Indexing packages 3/12");
    screen.setStatus("Compiling shaders");
    expect(logLines()).toEqual(["Indexing packages 3/12", "Compiling shaders"]);
    for (let i = 0; i < 60; i++) screen.setStatus(`line ${i}`);
    expect(logLines()).toHaveLength(40);
    expect(logLines().at(-1)).toBe("line 59");
  });

  it("says it is loading until everything is, and only then offers the start button", () => {
    expect(caption()?.hidden).toBe(true);
    void screen.waitForReady();
    screen.setStep("lobby");

    // Still loading: no prompt, not ready, the bar short of full
    expect(caption()?.hidden).toBe(true);
    expect(root()?.classList.contains("ui-loading-screen--ready")).toBe(false);
    expect(share()).toBeLessThan(1);

    screen.markReady();
    expect(caption()?.hidden).toBe(false);
    expect(start()?.textContent).toBe("Click to start");
    expect(root()?.classList.contains("ui-loading-screen--ready")).toBe(true);
    expect(root()?.querySelector(".boot__kicker")?.textContent).toBe("Ready");
    expect(steps()).toEqual(["is-done", "is-done", "is-done", "is-done"]);
    expect(share()).toBe(1);
  });

  it("starts from the start button", async () => {
    const ready = screen.waitForReady();
    screen.markReady();
    start()?.click();
    await ready;
    expect(audio.unlockAudio).toHaveBeenCalledOnce();
  });

  it("keeps a click made before everything has loaded, and then says it is starting", async () => {
    const ready = screen.waitForReady();
    ring()?.click();
    await ready;
    screen.markReady();
    expect(audio.unlockAudio).toHaveBeenCalledOnce();
    expect(start()?.textContent).toBe("Starting");
    expect(start()?.disabled).toBe(true);
  });

  it("starts on a click on the ring, turning the sound on, and says so while boot finishes", async () => {
    const ready = screen.waitForReady();
    ring()?.click();
    await ready;

    expect(audio.unlockAudio).toHaveBeenCalledOnce();
    expect(ring()?.disabled).toBe(true);
    expect(start()?.textContent).toBe("Starting");
    expect(start()?.disabled).toBe(true);
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

  it("wears the game's logo where the lobby does, with its name until the logo loads", () => {
    configureLobbyTwin({ brand: { logo: "/data/logo.png", name: "WASHIKI WASHOI" } });
    const branded = new LoadingScreen();
    branded.show();
    const brand = document.querySelectorAll<HTMLElement>(".twin__brand")[1];
    const logo = brand.querySelector("img");
    expect(logo?.getAttribute("src")).toBe("/data/logo.png");
    expect(logo?.hidden).toBe(true);
    expect(brand.querySelector("span")?.textContent).toBe("WASHIKI WASHOI");
    branded.hide();
  });

  it("opens the console from the rail without taking it for the start click", async () => {
    const onConsole = vi.fn();
    configureLobbyTwin({ onConsole });
    const withConsole = new LoadingScreen();
    withConsole.show();
    const ready = withConsole.waitForReady();
    const keys = [...document.querySelectorAll<HTMLButtonElement>(".twin__utility .twin-key")].slice(-3);
    expect(keys.map((key) => key.disabled)).toEqual([true, true, false]);
    keys[2].click();
    expect(onConsole).toHaveBeenCalledOnce();
    expect(audio.unlockAudio).not.toHaveBeenCalled();
    LoadingScreen.forceDismiss();
    await ready;
    withConsole.hide();
  });
});

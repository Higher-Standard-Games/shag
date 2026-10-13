// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputSystem } from "../../input/InputSystem";
import { requestBrowserFullscreen } from "../BrowserControlFeedback";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.electronAPI;
  delete (document.documentElement as unknown as { requestFullscreen?: unknown }).requestFullscreen;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  document.body.replaceChildren();
});
describe("fullscreen failure feedback", () => {
  it("uses the actual Electron fullscreen state for a toggle", async () => {
    const setFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { window: { isFullscreen: async () => true, setFullscreen } },
    });
    expect(await requestBrowserFullscreen()).toBe(true);
    expect(setFullscreen).toHaveBeenCalledWith(false);
  });
  it("explains rejection without claiming fullscreen changed and permits retry", async () => {
    document.documentElement.requestFullscreen = vi
      .fn()
      .mockRejectedValueOnce(new Error("Denied"))
      .mockResolvedValue(undefined);
    const failed = vi.fn();
    expect(await requestBrowserFullscreen(true, failed)).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
    expect(document.fullscreenElement).toBeNull();
    expect(await requestBrowserFullscreen(true, failed)).toBe(true);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("supports legacy void results and explains an unavailable API", async () => {
    delete (document.documentElement as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    expect(await requestBrowserFullscreen(true)).toBe(false);
    expect(document.getElementById("browser-control-feedback")?.textContent).toContain("not available");
    document.documentElement.requestFullscreen = vi.fn(() => undefined) as unknown as HTMLElement["requestFullscreen"];
    expect(await requestBrowserFullscreen(true)).toBe(true);
    expect(document.getElementById("browser-control-feedback")).toBeNull();
  });

  it("routes Alt+Enter rejection through the same visible feedback", async () => {
    document.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new Error("Denied"));
    const event = new KeyboardEvent("keydown", { code: "Enter", altKey: true, cancelable: true });
    Reflect.get(InputSystem.getInstance(), "onKeyDown").call(InputSystem.getInstance(), event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(document.getElementById("browser-control-feedback")?.getAttribute("role")).toBe("alert");
  });
});

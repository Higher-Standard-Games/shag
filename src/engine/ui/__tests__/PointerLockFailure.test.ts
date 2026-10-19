// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBrowserPointerLock } from "../BrowserControlFeedback";

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(document, "pointerLockElement", { configurable: true, value: null });
});

describe("pointer-lock request failures", () => {
  it("handles rejected promises and permits a new gesture to retry", async () => {
    const canvas = document.createElement("canvas");
    canvas.requestPointerLock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Document not focused"))
      .mockResolvedValue(undefined);
    requestBrowserPointerLock(canvas);
    await Promise.resolve();
    expect(document.getElementById("browser-control-feedback")?.textContent).toContain("Click the game to try again");
    requestBrowserPointerLock(canvas);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
  });

  it("handles legacy void and throwing implementations", () => {
    const canvas = document.createElement("canvas");
    canvas.requestPointerLock = vi.fn(() => undefined) as unknown as HTMLCanvasElement["requestPointerLock"];
    expect(() => requestBrowserPointerLock(canvas)).not.toThrow();
    canvas.requestPointerLock = vi.fn(() => {
      throw new Error("Unavailable");
    });
    requestBrowserPointerLock(canvas);
    expect(document.getElementById("browser-control-feedback")?.getAttribute("role")).toBe("alert");
  });

  it("does not request again when the canvas is already locked", () => {
    const canvas = document.createElement("canvas");
    canvas.requestPointerLock = vi.fn();
    Object.defineProperty(document, "pointerLockElement", { configurable: true, value: canvas });
    requestBrowserPointerLock(canvas);
    requestBrowserPointerLock(null);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });
});

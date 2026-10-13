// @vitest-environment jsdom
import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraInputHandler } from "../CameraInputHandler";

const handler = new CameraInputHandler();
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const notice = () => document.getElementById("browser-control-feedback");
function setup(request: () => Promise<void> | void) {
  const canvas = document.body.appendChild(document.createElement("canvas"));
  canvas.requestPointerLock = request as HTMLCanvasElement["requestPointerLock"];
  handler.setup(canvas, {} as FreeCamera, {}, "Capture test");
  return canvas;
}
afterEach(() => {
  Object.defineProperty(document, "pointerLockElement", { configurable: true, value: null });
  document.dispatchEvent(new Event("pointerlockchange"));
  handler.teardown();
  document.body.replaceChildren();
});
describe("pointer capture failure feedback", () => {
  it("handles a rejected promise, permits retry and clears feedback on capture", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("Denied")).mockResolvedValue(undefined);
    const canvas = setup(request);
    canvas.click();
    await flush();
    expect(notice()?.textContent).toContain("Click the game to try again");
    canvas.click();
    Object.defineProperty(document, "pointerLockElement", { configurable: true, value: canvas });
    document.dispatchEvent(new Event("pointerlockchange"));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(notice()).toBeNull();
    expect(handler.isPointerLocked).toBe(true);
    document.dispatchEvent(new Event("pointerlockerror"));
    expect(notice()).toBeNull();
  });

  it("handles the legacy error event, deduplicates repeated errors and permits dismissal", () => {
    const canvas = setup(() => {});
    canvas.click();
    document.dispatchEvent(new Event("pointerlockerror"));
    document.dispatchEvent(new Event("pointerlockerror"));
    expect(document.querySelectorAll("#browser-control-feedback")).toHaveLength(1);
    notice()!.querySelector<HTMLButtonElement>("button")!.click();
    expect(notice()).toBeNull();
    canvas.click();
    document.dispatchEvent(new Event("pointerlockerror"));
    expect(notice()).not.toBeNull();
  });

  it("does not show a late rejection after controller teardown or editor handoff", async () => {
    let reject!: (reason: Error) => void;
    const canvas = setup(
      () =>
        new Promise<void>((_resolve, failure) => {
          reject = failure;
        }),
    );
    canvas.click();
    handler.teardown();
    reject(new Error("late"));
    await flush();
    document.dispatchEvent(new Event("pointerlockerror"));
    expect(notice()).toBeNull();
    const next = setup(() => Promise.reject(new Error("Denied")));
    next.click();
    handler.setCaptureEnabled(false);
    await flush();
    expect(notice()).toBeNull();
    handler.setCaptureEnabled(true);
  });

  it("reports synchronous API failures without throwing from the click handler", () => {
    const canvas = setup(() => {
      throw new Error("Unsupported");
    });
    expect(() => canvas.click()).not.toThrow();
    expect(notice()?.getAttribute("role")).toBe("alert");
  });
});

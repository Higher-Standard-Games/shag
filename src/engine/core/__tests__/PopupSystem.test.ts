// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PopupSystem } from "../PopupSystem";

afterEach(() => {
  PopupSystem.closeAll();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const show = (id: string, onClose = vi.fn()) =>
  PopupSystem.show({ id, title: id, content: "body", buttons: [{ label: "Close", action: "close" }], onClose });

describe("a popup", () => {
  it("shown again under its id while the last one fades is open, and closes", () => {
    vi.useFakeTimers();
    show("notice");
    PopupSystem.close("notice");
    show("notice");
    vi.advanceTimersByTime(300);
    expect(PopupSystem.isOpen("notice")).toBe(true);
    PopupSystem.close("notice");
    vi.advanceTimersByTime(300);
    expect(PopupSystem.isOpen("notice")).toBe(false);
    expect(document.querySelectorAll(".popup-overlay")).toHaveLength(0);
  });

  it("closes once, however often it is asked", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    show("twice", onClose);
    PopupSystem.close("twice");
    PopupSystem.close("twice");
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("takes its Escape listener with it when closed by its button", () => {
    vi.useFakeTimers();
    const removed = vi.spyOn(document, "removeEventListener");
    const aborted = vi.spyOn(AbortController.prototype, "abort");
    show("button");
    document.querySelector<HTMLButtonElement>("[data-action=close]")?.click();
    expect(aborted.mock.calls.length + removed.mock.calls.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(300);
    // The next popup of that id closes on its own Escape, once
    const onClose = vi.fn();
    show("button", onClose);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

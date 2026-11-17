// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIManager } from "../../UIManager";
import { ConfirmDialog } from "../ConfirmDialog";

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>(".ui-confirm-panel button")];

afterEach(() => {
  vi.useRealTimers();
  ConfirmDialog.hide();
  document.body.replaceChildren();
});

describe("a confirm dialog", () => {
  it("runs only Confirm's callback when confirmed, once", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    ConfirmDialog.show({ title: "Leave?", message: "Sure?", onConfirm, onCancel });
    buttons()[1].click();
    buttons()[1]?.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("runs Cancel's callback once when cancelled", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    ConfirmDialog.show({ title: "Leave?", message: "Sure?", onConfirm, onCancel });
    buttons()[0].click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("takes its panel down with it when Escape closes it", () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    ConfirmDialog.show({ title: "Leave?", message: "Sure?", onConfirm: vi.fn(), onCancel });
    // Escape closes the overlay on top (the game's key handling asks UIManager)
    expect(UIManager.getInstance().closeTopOverlay()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(ConfirmDialog.isVisible()).toBe(false);
    expect(document.querySelector(".ui-confirm-panel")).toBeNull();
  });

  it("keeps a dialog shown right after another one closed", () => {
    vi.useFakeTimers();
    ConfirmDialog.show({ title: "First", message: "", onConfirm: vi.fn() });
    buttons()[1].click();
    ConfirmDialog.show({ title: "Second", message: "", onConfirm: vi.fn() });
    vi.advanceTimersByTime(300);
    expect(document.querySelector(".ui-confirm-title")?.textContent).toBe("Second");
    expect(ConfirmDialog.isVisible()).toBe(true);
  });
});

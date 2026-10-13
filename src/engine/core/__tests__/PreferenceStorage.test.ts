// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../EventBus";
import {
  deferPreferenceWrites,
  failedPreferenceKeys,
  flushPreferenceWrites,
  PREFERENCE_STORAGE_EVENT,
  writePreference,
} from "../PreferenceStorage";

afterEach(() => {
  flushPreferenceWrites();
  vi.useRealTimers();
  vi.restoreAllMocks();
  writePreference("quality_preference", "{}");
});
describe("preference save status", () => {
  it("coalesces a burst while retaining the latest value and flushing on page hide", () => {
    vi.useFakeTimers();
    const save = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    for (let i = 0; i < 100; i++)
      deferPreferenceWrites(() => {
        writePreference("quality_preference", String(i));
      });
    expect(save).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    expect(save).toHaveBeenCalledExactlyOnceWith("quality_preference", "99");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes after a pause and reports failure then recovery", () => {
    vi.useFakeTimers();
    const save = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    deferPreferenceWrites(() => {
      writePreference("quality_preference", "latest");
    });
    vi.advanceTimersByTime(200);
    expect(failedPreferenceKeys()).toContain("quality_preference");
    save.mockImplementation(() => {});
    deferPreferenceWrites(() => {
      writePreference("quality_preference", "retry");
    });
    window.dispatchEvent(new Event("blur"));
    expect(failedPreferenceKeys()).not.toContain("quality_preference");
    expect(save).toHaveBeenLastCalledWith("quality_preference", "retry");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never overwrites a newer immediate write with a queued value", () => {
    vi.useFakeTimers();
    deferPreferenceWrites(() => {
      writePreference("quality_preference", "old");
    });
    writePreference("quality_preference", "new");
    vi.advanceTimersByTime(200);
    expect(localStorage.getItem("quality_preference")).toBe("new");
  });

  it("reports failure once, keeps values out of the event and reports recovery", () => {
    writePreference("quality_preference", "{}");
    const changed = vi.fn();
    const unsubscribe = EventBus.on(PREFERENCE_STORAGE_EVENT, changed);
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(writePreference("quality_preference", "private contents")).toBe(false);
    expect(writePreference("quality_preference", "more contents")).toBe(false);
    expect(changed).toHaveBeenCalledExactlyOnceWith({ key: "quality_preference", saved: false });
    expect(failedPreferenceKeys()).toContain("quality_preference");
    blocked.mockRestore();
    expect(writePreference("quality_preference", "{}")).toBe(true);
    expect(changed).toHaveBeenLastCalledWith({ key: "quality_preference", saved: true });
    expect(failedPreferenceKeys()).not.toContain("quality_preference");
    unsubscribe();
  });
});

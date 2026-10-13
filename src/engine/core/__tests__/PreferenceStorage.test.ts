// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../EventBus";
import { failedPreferenceKeys, PREFERENCE_STORAGE_EVENT, writePreference } from "../PreferenceStorage";

afterEach(() => {
  vi.restoreAllMocks();
  writePreference("quality_preference", "{}");
});
describe("preference save status", () => {
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

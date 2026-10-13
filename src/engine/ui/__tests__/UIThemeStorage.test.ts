// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UITheme } from "../UITheme";

describe("optional theme storage", () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;

  beforeEach(() => {
    Reflect.set(UITheme, "instance", undefined);
    localStorage.clear();
    document.head.replaceChildren();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    vi.restoreAllMocks();
    Reflect.set(UITheme, "instance", undefined);
  });

  it.each(["getter", "read"])("initializes the default theme when the storage %s throws", (failure) => {
    if (failure === "getter") {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => {
          throw new DOMException("Storage denied", "SecurityError");
        },
      });
    } else {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("Storage denied", "SecurityError");
      });
    }
    const theme = UITheme.getInstance();
    expect(theme.getMode()).toBe("light");
    expect(() => theme.init()).not.toThrow();
    expect(document.head.querySelector("style")).not.toBeNull();
  });

  it.each(["getter", "write"])("applies styles and notifies subscribers when the storage %s throws", (failure) => {
    const theme = UITheme.getInstance();
    theme.init();
    const before = document.head.innerHTML;
    const changed = vi.fn();
    const unsubscribe = theme.onModeChange(changed);
    if (failure === "getter") {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => {
          throw new DOMException("Storage denied", "SecurityError");
        },
      });
    } else {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Full", "QuotaExceededError");
      });
    }
    expect(() => theme.setMode("dark")).not.toThrow();
    expect(theme.getMode()).toBe("dark");
    expect(document.head.innerHTML).not.toBe(before);
    expect(changed).toHaveBeenCalledExactlyOnceWith("dark");
    unsubscribe();
    theme.setMode("light");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("retains normal persistence and ignores unknown stored modes", () => {
    localStorage.setItem("ui_theme_mode", "invalid");
    const theme = UITheme.getInstance();
    expect(theme.getMode()).toBe("light");
    theme.setMode("dark");
    expect(localStorage.getItem("ui_theme_mode")).toBe("dark");
    Reflect.set(UITheme, "instance", undefined);
    expect(UITheme.getInstance().getMode()).toBe("dark");
  });
});

// @vitest-environment jsdom

/**
 * The native splash is configured with `launchAutoHide: false`, which hands the
 * job of hiding it to the app. Nothing called `hideSplashScreen()`, so on a
 * device the splash stayed up forever. The bootstrap calls it now, and these
 * pin what that call must do — including doing nothing in a browser, which is
 * what makes it safe to call unconditionally.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const hide = vi.fn().mockResolvedValue(undefined);
const isNativePlatform = vi.fn().mockReturnValue(false);
const getPlatform = vi.fn().mockReturnValue("web");

vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform, getPlatform } }));
vi.mock("@capacitor/status-bar", () => ({ StatusBar: { hide: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn() } }));
vi.mock("../../ui/styles/mobile.css?raw", () => ({ default: "" }));

const { CapacitorBridge } = await import("../CapacitorBridge");

function freshBridge(): ReturnType<typeof CapacitorBridge.getInstance> {
  // biome-ignore lint/suspicious/noExplicitAny: resets the singleton between cases
  (CapacitorBridge as any).instance = undefined;
  return CapacitorBridge.getInstance();
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.className = "";
});

describe("in a browser", () => {
  it("hides no splash, because there is none", async () => {
    isNativePlatform.mockReturnValue(false);
    await freshBridge().hideSplashScreen();
    expect(hide).not.toHaveBeenCalled();
  });

  it("still marks the platform on the body, so CSS can target it", async () => {
    isNativePlatform.mockReturnValue(false);
    getPlatform.mockReturnValue("web");
    await freshBridge().init();
    expect(document.body.className).toContain("capacitor-web");
  });
});

describe("on a device", () => {
  it("hides the splash it was told not to auto-hide", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    await freshBridge().hideSplashScreen();
    expect(hide).toHaveBeenCalledWith({ fadeOutDuration: 300 });
  });

  it("does not throw when the plugin refuses", async () => {
    isNativePlatform.mockReturnValue(true);
    hide.mockRejectedValueOnce(new Error("no splash"));
    await expect(freshBridge().hideSplashScreen()).resolves.toBeUndefined();
  });

  it("initialises once, however many times it is called", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    const bridge = freshBridge();
    await bridge.init();
    await bridge.init();
    expect(document.body.className).toContain("capacitor-android");
    expect(document.body.className).toContain("capacitor-native");
  });
});

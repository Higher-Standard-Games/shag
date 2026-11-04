import { describe, expect, it, vi } from "vitest";
import { enterTouchFullscreen } from "../TouchFullscreen";

describe("touch fullscreen", () => {
  it("enters fullscreen, then locks landscape", async () => {
    const order: string[] = [];
    const requestFullscreen = vi.fn(async () => {
      order.push("fullscreen");
    });
    const lock = vi.fn(async () => {
      order.push("lock");
    });
    await enterTouchFullscreen(
      { fullscreenElement: null, documentElement: { requestFullscreen } as unknown as HTMLElement },
      { lock } as unknown as ScreenOrientation,
    );
    expect(order).toEqual(["fullscreen", "lock"]);
    expect(lock).toHaveBeenCalledWith("landscape");
  });

  it("only locks when already fullscreen, and stays quiet when refused", async () => {
    const requestFullscreen = vi.fn();
    const lock = vi.fn(async () => {
      throw new Error("not supported");
    });
    await expect(
      enterTouchFullscreen(
        { fullscreenElement: {} as Element, documentElement: { requestFullscreen } as unknown as HTMLElement },
        { lock } as unknown as ScreenOrientation,
      ),
    ).resolves.toBeUndefined();
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForBotPreparation } from "../BotPreparation";

afterEach(() => vi.useRealTimers());
describe("bounded bot preparation", () => {
  it("settles stalled preparation and ignores late completion", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const result = waitForBotPreparation(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
      undefined,
      100,
    );
    const rejected = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    release();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels promptly and cleans timers on success and failure", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = waitForBotPreparation(new Promise<void>(() => {}), controller.signal);
    const rejected = expect(result).rejects.toThrow("cancelled");
    controller.abort();
    await rejected;
    await waitForBotPreparation(Promise.resolve());
    await expect(waitForBotPreparation(Promise.reject(new Error("load failed")))).rejects.toThrow("load failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { unloadClientMap } from "../ClientMapLoader";

const dispose = vi.hoisted(() => vi.fn());
vi.mock("../MapLoader", () => ({ MapLoader: { getInstance: () => ({ disposeCurrentMap: dispose }) } }));
afterEach(() => dispose.mockReset());

describe("client map unload completion", () => {
  it("waits for resource cleanup", async () => {
    let finish!: () => void;
    dispose.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let done = false;
    const pending = unloadClientMap().then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(done).toBe(false);
    finish();
    await pending;
    expect(done).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { clearNetworkConnector, registerNetworkConnector } from "../../ui/components/NetworkConnector";
import JoinCommand from "../commands/JoinCommand";

afterEach(() => clearNetworkConnector());

describe("JoinCommand game adapter", () => {
  const noConnection = 'No server connection. Use "developer 1" then "map <mapname> [gametype]" or "connect <url>".';

  it("works without an installed game adapter and reports no connection", async () => {
    await expect(new JoinCommand().execute([])).resolves.toBe(noConnection);
  });

  it("does not join when the registered game is disconnected", async () => {
    const join = vi.fn();
    registerNetworkConnector({ isConnected: () => false, connect: vi.fn(), join });

    await expect(new JoinCommand().execute([])).resolves.toBe(noConnection);
    expect(join).not.toHaveBeenCalled();
  });

  it("reports a connected game without a join capability", async () => {
    registerNetworkConnector({ isConnected: () => true, connect: vi.fn() });

    await expect(new JoinCommand().execute([])).resolves.toBe(
      "The active game does not support joining the connected server.",
    );
  });

  it("awaits the game's join flow without reconnecting or supplying team or seat overrides", async () => {
    let finishJoin: (() => void) | undefined;
    const join = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishJoin = resolve;
        }),
    );
    const connect = vi.fn();
    registerNetworkConnector({ isConnected: () => true, connect, join });
    let finished = false;
    const result = new JoinCommand().execute([]).then((response) => {
      finished = true;
      return response;
    });

    await Promise.resolve();
    expect(finished).toBe(false);
    expect(join).toHaveBeenCalledExactlyOnceWith();
    expect(connect).not.toHaveBeenCalled();
    finishJoin?.();
    await expect(result).resolves.toBe("Join requested");
  });

  it("preserves the game's join failure response", async () => {
    registerNetworkConnector({
      isConnected: () => true,
      connect: vi.fn(),
      join: vi.fn().mockRejectedValue(new Error("Seat unavailable")),
    });

    await expect(new JoinCommand().execute([])).resolves.toBe("Failed to join: Error: Seat unavailable");
  });
});

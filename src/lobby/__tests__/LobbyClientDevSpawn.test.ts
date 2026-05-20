import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyClient } from "../LobbyClient";

describe("LobbyClient dev spawn requests", () => {
  let send: ReturnType<typeof vi.fn>;
  let originalWebSocket: unknown;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = { OPEN: 1 };
    send = vi.fn();
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  function makeClient(): LobbyClient {
    const client = new LobbyClient();
    (client as any).ws = { readyState: 1, send };
    return client;
  }

  it("resolves the matching success response", async () => {
    const client = makeClient();
    const promise = client.spawnDevServer("wdm2", "duel", 1000);
    const request = JSON.parse(send.mock.calls[0][0]);

    (client as any).emit("dev:server_spawned", {
      type: "dev:server_spawned",
      requestId: request.requestId,
      serverUrl: "ws://localhost:7777",
      map: "wdm2",
      gametype: "duel",
      matchId: "m_1",
    });

    await expect(promise).resolves.toEqual({
      serverUrl: "ws://localhost:7777",
      map: "wdm2",
      gametype: "duel",
      matchId: "m_1",
    });
  });

  it("rejects matching failure responses", async () => {
    const client = makeClient();
    const promise = client.spawnDevServer("wdm2", "duel", 1000);
    const request = JSON.parse(send.mock.calls[0][0]);

    (client as any).emit("dev:server_spawn_failed", {
      type: "dev:server_spawn_failed",
      requestId: request.requestId,
      error: "no server",
    });

    await expect(promise).rejects.toThrow("no server");
  });

  it("rejects on timeout and disconnect", async () => {
    vi.useFakeTimers();
    const timeoutClient = makeClient();
    const timeoutPromise = timeoutClient.spawnDevServer("wdm2", "duel", 5);
    const timeoutExpectation = expect(timeoutPromise).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(6);
    await timeoutExpectation;

    const disconnectClient = makeClient();
    const disconnectPromise = disconnectClient.spawnDevServer("wdm2", "duel", 1000);
    (disconnectClient as any).emit("_disconnected", {});
    await expect(disconnectPromise).rejects.toThrow("disconnected");
  });
});

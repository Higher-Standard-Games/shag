import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { GameServerSpawner } from "../GameServerSpawner";
import { LobbyServer } from "../LobbyServer";

it("allows announced cold preparation beyond eight seconds, but cannot extend the budget repeatedly", async () => {
  const control = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(control, "listening");
  const server = new LobbyServer(0, new GameServerSpawner(), {
    botSecret: "secret",
    botServerUrl: `ws://127.0.0.1:${(control.address() as { port: number }).port}`,
  });
  const internal = server as unknown as {
    requestBotForLobby(room: unknown): Promise<string>;
    cancelBotInvites(id: string): void;
  };
  const originalTimeout = globalThis.setTimeout;
  let fakeTimeout: typeof setTimeout | undefined;
  try {
    vi.useFakeTimers();
    fakeTimeout = globalThis.setTimeout;
    const timeouts: Array<number | undefined> = [];
    // A spy on a fake global timer can reinstall its stopped clock during a
    // later restoreAllMocks(). Use a scoped wrapper, restored before uninstall.
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      timeouts.push(args[1]);
      return fakeTimeout!(...args);
    }) as typeof setTimeout;
    const connection = once(control, "connection");
    const pending = internal.requestBotForLobby({ id: "room", gametype: { id: "duel" } });
    const [socket] = await connection;
    socket.send(JSON.stringify({ type: "bot_preparing" }));
    // Poll network delivery without advancing its timeout.
    await vi.waitFor(() => expect(timeouts).toContain(75000));
    await vi.advanceTimersByTimeAsync(9000);
    let settled = false;
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    expect(settled).toBe(false);
    socket.send(JSON.stringify({ type: "bot_preparing" }));
    await vi.advanceTimersByTimeAsync(65000);
    expect(settled).toBe(false);
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    socket.close();
  } finally {
    if (fakeTimeout) globalThis.setTimeout = fakeTimeout;
    vi.restoreAllMocks();
    vi.useRealTimers();
    internal.cancelBotInvites("room");
    for (const client of control.clients) client.terminate();
    await new Promise<void>((resolve) => control.close(() => resolve()));
    await server.stop();
  }
  vi.restoreAllMocks();
  expect(globalThis.setTimeout).toBe(originalTimeout);
});

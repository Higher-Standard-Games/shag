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
  try {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const connection = once(control, "connection");
    const pending = internal.requestBotForLobby({ id: "room", gametype: { id: "duel" } });
    const [socket] = await connection;
    socket.send(JSON.stringify({ type: "bot_preparing" }));
    // Poll network delivery without advancing its timeout.
    await vi.waitFor(() => expect(timer).toHaveBeenCalledWith(expect.any(Function), 75000));
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
    vi.restoreAllMocks();
    vi.useRealTimers();
    internal.cancelBotInvites("room");
    for (const client of control.clients) client.terminate();
    await new Promise<void>((resolve) => control.close(() => resolve()));
    await server.stop();
  }
});

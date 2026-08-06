import { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";
import { isLoopbackAddress, LobbyServer, normalizeGametype } from "../LobbyServer";

function makePlayer(overrides: Partial<any> = {}) {
  const sent: any[] = [];
  return {
    player: {
      id: "p_1",
      ws: {
        readyState: WebSocket.OPEN,
        send: (data: string) => sent.push(JSON.parse(data)),
      },
      name: "Dev",
      status: "online",
      lobbyId: null,
      authenticated: true,
      address: "127.0.0.1",
      ...overrides,
    },
    sent,
  };
}

function lastMessage(sent: any[]): any {
  return sent[sent.length - 1];
}

function makeServer(spawn = vi.fn()) {
  const spawner = {
    onServerExit: undefined as unknown,
    spawn,
    shutdownAll: vi.fn(),
  };
  return new LobbyServer(0, spawner as any);
}

describe("LobbyServer dev spawn", () => {
  it("normalizes gametype aliases", () => {
    expect(normalizeGametype(undefined)).toBe("duel");
    expect(normalizeGametype("1v1")).toBe("duel");
    expect(normalizeGametype("searchanddestroy")).toBe("snd");
    expect(normalizeGametype("bomb")).toBe("snd");
    expect(normalizeGametype("dm")).toBe("ffa");
    expect(normalizeGametype("ctf")).toBeNull();
    // TDM was replaced by S&D on the menu; its alias is gone with it.
    expect(normalizeGametype("teamdeathmatch")).toBeNull();
  });

  it("recognizes loopback addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.0.10")).toBe(false);
  });

  it("spawns a shutdown dedicated server for an authenticated loopback dev request", async () => {
    const spawn = vi.fn().mockResolvedValue({
      url: "ws://localhost:7777",
      matchId: "m_dev",
    });
    const server = makeServer(spawn);
    const { player, sent } = makePlayer();

    await (server as any).handleDevSpawnServer(player, "req_1", "WDM2", "1v1");

    expect(spawn).toHaveBeenCalledWith({
      map: "wdm2",
      gametype: "duel",
      maxClients: 2,
      shutdown: true,
    });
    expect(lastMessage(sent)).toEqual({
      type: "dev:server_spawned",
      requestId: "req_1",
      serverUrl: "ws://localhost:7777",
      map: "wdm2",
      gametype: "duel",
      matchId: "m_dev",
    });
  });

  it("returns a failure response when spawning fails", async () => {
    const server = makeServer(vi.fn().mockRejectedValue(new Error("port unavailable")));
    const { player, sent } = makePlayer();

    await (server as any).handleDevSpawnServer(player, "req_2", "wdm2", "duel");

    expect(lastMessage(sent)).toEqual({
      type: "dev:server_spawn_failed",
      requestId: "req_2",
      error: "port unavailable",
    });
  });

  it("rejects unknown gametypes and non-loopback clients", async () => {
    const spawn = vi.fn();
    const server = makeServer(spawn);
    const unknown = makePlayer();
    const remote = makePlayer({ address: "10.0.0.5" });

    await (server as any).handleDevSpawnServer(unknown.player, "req_3", "wdm2", "ctf");
    await (server as any).handleDevSpawnServer(remote.player, "req_4", "wdm2", "duel");

    expect(spawn).not.toHaveBeenCalled();
    expect(lastMessage(unknown.sent)).toMatchObject({ type: "dev:server_spawn_failed", requestId: "req_3" });
    expect(lastMessage(remote.sent)).toMatchObject({ type: "dev:server_spawn_failed", requestId: "req_4" });
  });

  it("requires authentication before accepting dev spawn messages", () => {
    const server = makeServer();
    const { player, sent } = makePlayer({ authenticated: false });

    (server as any).handleMessage(player, {
      type: "dev:spawn_server",
      requestId: "req_5",
      map: "wdm2",
      gametype: "duel",
    });

    expect(lastMessage(sent)).toEqual({
      type: "lobby:error",
      error: "Not authenticated. Send auth message first.",
    });
  });
});

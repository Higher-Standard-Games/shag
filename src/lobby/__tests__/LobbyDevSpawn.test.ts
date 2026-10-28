import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { isLoopbackAddress, LobbyServer, normalizeGametype } from "../LobbyServer";

type Sent = Record<string, unknown>;

function makePlayer(overrides: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
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

function lastMessage(sent: Sent[]): Sent | undefined {
  return sent[sent.length - 1];
}

function makeServer(spawn = vi.fn()) {
  const spawner = {
    onServerExit: undefined as unknown,
    spawn,
    shutdownAll: vi.fn(),
  };
  return new LobbyServer(0, spawner as never);
}

/** The server's private handlers, which these tests call directly. */
type ServerInternals = {
  handleDevSpawnServer(
    player: unknown,
    requestId: string,
    map: string,
    gametype: string,
    trainingDemo?: string,
  ): Promise<void>;
  handleMessage(player: unknown, message: unknown): void;
  handleServerExit(matchId: string, code: number | null): void;
  gametypes: { id: string; mapPool: string[]; maxPlayers: number }[];
};
const internals = (server: LobbyServer) => server as unknown as ServerInternals;

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

    await internals(server).handleDevSpawnServer(player, "req_1", "WDM2", "1v1");

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

    await internals(server).handleDevSpawnServer(player, "req_2", "wdm2", "duel");

    expect(lastMessage(sent)).toEqual({
      type: "dev:server_spawn_failed",
      requestId: "req_2",
      error: "port unavailable",
    });
  });

  it("rejects unknown gametypes", async () => {
    const spawn = vi.fn();
    const server = makeServer(spawn);
    const { player, sent } = makePlayer();

    await internals(server).handleDevSpawnServer(player, "req_3", "wdm2", "ctf");

    expect(spawn).not.toHaveBeenCalled();
    expect(lastMessage(sent)).toMatchObject({ type: "dev:server_spawn_failed", requestId: "req_3" });
  });

  it("requires authentication before accepting dev spawn messages", () => {
    const server = makeServer();
    const { player, sent } = makePlayer({ authenticated: false });

    internals(server).handleMessage(player, {
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

describe("LobbyServer practice spawn", () => {
  /** A lobby offering duel and S&D maps, spawning servers m_1, m_2, ... */
  function practiceServer() {
    let next = 0;
    const spawn = vi.fn().mockImplementation(async () => ({ url: "ws://game:7777", matchId: `m_${++next}` }));
    const server = makeServer(spawn);
    internals(server).gametypes = [
      { id: "duel", mapPool: ["washoi_dm2", "washoi_dm5"], maxPlayers: 2 },
      { id: "snd", mapPool: ["washoi_snd1"], maxPlayers: 10 },
    ];
    return { server, spawn };
  }
  const remote = (overrides: Record<string, unknown> = {}) =>
    makePlayer({ address: "203.0.113.7", accountId: 42, ...overrides });

  it("gives a remote player a server of their own on one of the lobby's maps", async () => {
    const { server, spawn } = practiceServer();
    const { player, sent } = remote();

    await internals(server).handleDevSpawnServer(player, "r1", "washoi_dm2", "duel");

    expect(spawn).toHaveBeenCalledWith({ map: "washoi_dm2", gametype: "duel", maxClients: 1, shutdown: true });
    expect(lastMessage(sent)).toMatchObject({ type: "dev:server_spawned", requestId: "r1", gametype: "duel" });
  });

  it("plays a map in a gametype it is made for, and refuses maps the lobby does not offer", async () => {
    const { server, spawn } = practiceServer();
    const { player, sent } = remote();

    await internals(server).handleDevSpawnServer(player, "r1", "washoi_snd1", "duel");
    expect(spawn).toHaveBeenLastCalledWith(expect.objectContaining({ map: "washoi_snd1", gametype: "snd" }));

    const other = remote({ id: "p_2", address: "198.51.100.1", accountId: 7 });
    await internals(server).handleDevSpawnServer(other.player, "r2", "secret_wip", "duel");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(lastMessage(other.sent)).toMatchObject({ type: "dev:server_spawn_failed", requestId: "r2" });
    expect(String(lastMessage(other.sent)?.error)).toContain("washoi_dm2");
    expect(lastMessage(sent)).toMatchObject({ type: "dev:server_spawned", requestId: "r1", gametype: "snd" });
  });

  it("allows one practice server per account and per address, also while one is starting", async () => {
    let started: (value: unknown) => void = () => {};
    const spawn = vi.fn().mockImplementation(() => new Promise((resolve) => (started = resolve)));
    const server = makeServer(spawn);
    internals(server).gametypes = [{ id: "duel", mapPool: ["washoi_dm2"], maxPlayers: 2 }];
    const first = remote();
    const sameAccount = remote({ id: "p_2", address: "198.51.100.1" });
    const sameAddress = remote({ id: "p_3", accountId: 9 });

    const starting = internals(server).handleDevSpawnServer(first.player, "r1", "washoi_dm2", "duel");
    await internals(server).handleDevSpawnServer(sameAccount.player, "r2", "washoi_dm2", "duel");
    await internals(server).handleDevSpawnServer(sameAddress.player, "r3", "washoi_dm2", "duel");
    started({ url: "ws://game:7777", matchId: "m_1" });
    await starting;

    expect(spawn).toHaveBeenCalledTimes(1);
    for (const refused of [sameAccount, sameAddress])
      expect(lastMessage(refused.sent)).toMatchObject({ type: "dev:server_spawn_failed" });

    // Once that server exits, the player may start another
    internals(server).handleServerExit("m_1", 0);
    const again = internals(server).handleDevSpawnServer(sameAccount.player, "r4", "washoi_dm2", "duel");
    started({ url: "ws://game:7777", matchId: "m_2" });
    await again;
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("starts at most three practice servers a minute from one address", async () => {
    const { server, spawn } = practiceServer();
    const { player, sent } = remote();
    for (let i = 1; i <= 4; i++) {
      await internals(server).handleDevSpawnServer(player, `r${i}`, "washoi_dm2", "duel");
      internals(server).handleServerExit(`m_${i}`, 0);
    }
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(lastMessage(sent)).toMatchObject({ type: "dev:server_spawn_failed", requestId: "r4" });
  });

  it("records training demos from the lobby's machine only", async () => {
    const { server, spawn } = practiceServer();
    const { player, sent } = remote();

    await internals(server).handleDevSpawnServer(player, "r1", "washoi_dm2", "duel", "my_demo");

    expect(spawn).not.toHaveBeenCalled();
    expect(lastMessage(sent)).toMatchObject({ type: "dev:server_spawn_failed", requestId: "r1" });
  });
});

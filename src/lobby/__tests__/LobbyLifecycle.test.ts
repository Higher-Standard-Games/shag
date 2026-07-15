/**
 * LobbyServer lifecycle tests (QA-WO2 / QA-9).
 *
 * LobbyServer (1400+ lines) broke repeatedly this cycle — isStarting not reset,
 * the lobby destroyed during the server→lobby return trip, votes not cleared —
 * yet every one of those paths had zero assertions. These tests pin them.
 *
 * Uses the fake-ws harness from LobbyDevSpawn.test.ts: a plain object stands in
 * for the WebSocket, capturing sent JSON. The server is constructed without
 * calling start() (no port bind); gametypes/mapNames are injected directly since
 * those are normally loaded from disk in start().
 */
import { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";
import { LobbyServer } from "../LobbyServer";

// biome-ignore lint/suspicious/noExplicitAny: injected test fixture for a private-shaped config
const GAMETYPE: any = {
  id: "duel",
  name: "DUEL",
  description: "test duel",
  maxPlayers: 2,
  hasTeams: false,
  mapPool: ["wdm2", "wdm3", "wdm4"],
};
const MAP_NAMES: Record<string, string> = { wdm2: "WDM2", wdm3: "WDM3", wdm4: "WDM4" };

let nextId = 1;

// biome-ignore lint/suspicious/noExplicitAny: fake ConnectedPlayer
function makePlayer(overrides: Partial<any> = {}): { player: any; sent: any[] } {
  const sent: any[] = [];
  const player = {
    id: `p_${nextId++}`,
    ws: { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)) },
    name: "Tester",
    status: "online",
    lobbyId: null,
    authenticated: true,
    address: "127.0.0.1",
    isBot: false,
    ...overrides,
  };
  return { player, sent };
}

// biome-ignore lint/suspicious/noExplicitAny: reaches private lobby internals
function setup(spawn: any = vi.fn()): { server: any; spawn: any } {
  const spawner = { onServerExit: undefined as unknown, spawn, shutdownAll: vi.fn() };
  const server = new LobbyServer(0, spawner as never) as any;
  server.gametypes = [GAMETYPE];
  server.mapNames = MAP_NAMES;
  return { server, spawn };
}

// biome-ignore lint/suspicious/noExplicitAny: test wiring
function register(server: any, player: any): any {
  server.players.set(player.id, player);
  return player;
}

// biome-ignore lint/suspicious/noExplicitAny: test wiring
function createLobby(server: any, player: any): any {
  register(server, player);
  server.handleLobbyCreate(player, "duel");
  return [...server.lobbies.values()][0];
}

const lastMessage = (sent: unknown[]): unknown => sent[sent.length - 1];

describe("LobbyServer lifecycle", () => {
  it("creates a lobby and adds the creator", () => {
    const { server } = setup();
    const { player } = makePlayer();

    const lobby = createLobby(server, player);

    expect(server.lobbies.size).toBe(1);
    expect(lobby.players.has(player.id)).toBe(true);
    expect(player.lobbyId).toBe(lobby.id);
    expect(player.status).toBe("in_lobby");
  });

  it("lets a second player join and rejects a third (full)", () => {
    const { server } = setup();
    const host = makePlayer().player;
    const lobby = createLobby(server, host);

    const joiner = register(server, makePlayer().player);
    server.handleLobbyJoin(joiner, lobby.id);
    expect(lobby.players.size).toBe(2);

    const third = makePlayer();
    register(server, third.player);
    server.handleLobbyJoin(third.player, lobby.id);

    expect(lobby.players.size).toBe(2); // still full at maxPlayers
    expect(lastMessage(third.sent)).toEqual({ type: "lobby:error", error: "Lobby is full." });
    expect(third.player.lobbyId).toBeNull();
  });

  it("destroys an empty lobby once the grace window has passed", () => {
    const { server } = setup();
    const { player } = makePlayer();
    const lobby = createLobby(server, player); // keepAliveUntil defaults to 0

    server.handleLobbyLeave(player, lobby.id);

    expect(server.lobbies.has(lobby.id)).toBe(false);
    expect(player.lobbyId).toBeNull();
    expect(player.status).toBe("online");
  });

  it("keeps an empty lobby alive during the return-trip grace window", () => {
    // Regression: reloading back from a match drops every lobby socket at once;
    // the lobby must survive being briefly empty so players rejoin via ?lobby=.
    const { server } = setup();
    const { player } = makePlayer();
    const lobby = createLobby(server, player);
    lobby.keepAliveUntil = Date.now() + 60_000;

    server.handleLobbyLeave(player, lobby.id);

    expect(server.lobbies.has(lobby.id)).toBe(true);
    expect(lobby.players.size).toBe(0);
  });

  it("handleServerExit returns the lobby to waiting, resets isStarting, clears votes, and keeps the lobby", () => {
    // The core single-match regression cluster: after the match server exits the
    // lobby IS the rematch screen, so it must NOT be destroyed, isStarting must
    // reset (or re-ready/findWaitingLobby stay blocked), and votes must clear.
    const { server } = setup();
    const host = makePlayer();
    const lobby = createLobby(server, host.player);
    const joiner = register(server, makePlayer().player);
    server.handleLobbyJoin(joiner, lobby.id);

    // Simulate a running match.
    lobby.voteMap(host.player.id, "wdm2");
    expect(lobby.votes.size).toBe(1);
    lobby.isStarting = true;
    lobby.state = "playing";
    lobby.matchMap = "wdm2";
    lobby.serverUrl = "ws://localhost:7777";
    server.matchToLobby.set("m_1", lobby.id);
    host.player.status = "in_match";

    server.handleServerExit("m_1", 0);

    expect(server.lobbies.has(lobby.id)).toBe(true); // not destroyed
    expect(lobby.isStarting).toBe(false);
    expect(lobby.state).toBe("waiting");
    expect(lobby.matchMap).toBe("");
    expect(lobby.serverUrl).toBe("");
    expect(lobby.votes.size).toBe(0);
    expect(lobby.keepAliveUntil).toBeGreaterThan(Date.now());
    expect(server.matchToLobby.has("m_1")).toBe(false);
    // Players returned to the lobby (rematch screen) + not-ready.
    expect(host.player.status).toBe("in_lobby");
    expect(lobby.players.get(host.player.id).ready).toBe(false);
    expect(host.sent.some((m: any) => m.type === "match:ended")).toBe(true);
  });

  it("handleAllReady spawns the server and marks the lobby playing", async () => {
    const spawn = vi.fn().mockResolvedValue({ url: "ws://localhost:7777", matchId: "m_1" });
    const { server } = setup(spawn);
    const host = makePlayer();
    const lobby = createLobby(server, host.player);
    const joiner = register(server, makePlayer().player);
    server.handleLobbyJoin(joiner, lobby.id);

    await server.handleAllReady(lobby);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(lobby.isStarting).toBe(true);
    expect(lobby.state).toBe("playing");
    expect(lobby.serverUrl).toBe("ws://localhost:7777");
    expect(server.matchToLobby.get("m_1")).toBe(lobby.id);
    expect(host.player.status).toBe("in_match");
  });

  it("handleAllReady reverts isStarting/state when the spawn fails", async () => {
    const spawn = vi.fn().mockRejectedValue(new Error("port unavailable"));
    const { server } = setup(spawn);
    const host = makePlayer();
    const lobby = createLobby(server, host.player);
    const joiner = register(server, makePlayer().player);
    server.handleLobbyJoin(joiner, lobby.id);
    lobby.setReady(host.player.id, true);
    lobby.setReady(joiner.id, true);

    await server.handleAllReady(lobby);

    expect(lobby.isStarting).toBe(false);
    expect(lobby.state).toBe("waiting");
    expect(lobby.matchMap).toBe("");
    expect(lobby.players.get(host.player.id).ready).toBe(false);
  });

  it("findWaitingLobby skips a lobby that is already starting", () => {
    const { server } = setup();
    const lobby = createLobby(server, makePlayer().player);

    lobby.isStarting = true;
    expect(server.findWaitingLobby("duel")).toBeUndefined();

    lobby.isStarting = false;
    expect(server.findWaitingLobby("duel")).toBe(lobby);
  });
});

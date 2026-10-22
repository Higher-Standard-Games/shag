/**
 * Coming back from a match is a new lobby socket, and the socket that carried
 * the player into the game may not be known to be gone yet. The room has to
 * hand the seat to the newest connection of that account — otherwise a duel
 * room reads as full against the player it belongs to, which is what happened
 * to RETURN TO LOBBY (see docs/research/NEW_UI.md).
 */

import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LobbyServer } from "../LobbyServer";

// biome-ignore lint/suspicious/noExplicitAny: injected test fixtures for a private-shaped config
const DUEL: any = {
  id: "duel",
  name: "DUEL",
  description: "two players",
  maxPlayers: 2,
  hasTeams: false,
  mapPool: ["wdm2"],
};
// biome-ignore lint/suspicious/noExplicitAny: as above
const SND: any = {
  id: "snd",
  name: "S&D",
  description: "two sides",
  maxPlayers: 4,
  hasTeams: true,
  mapPool: ["wsnd1"],
};

let nextId = 1;

// biome-ignore lint/suspicious/noExplicitAny: fake ConnectedPlayer
function makePlayer(overrides: Partial<any> = {}): { player: any; sent: any[] } {
  const sent: unknown[] = [];
  const number = nextId++;
  const player = {
    id: `p_${number}`,
    ws: { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)) },
    name: `Tester_${number}`,
    status: "online",
    lobbyId: null,
    authenticated: true,
    address: "127.0.0.1",
    isBot: false,
    accountId: number,
    ...overrides,
  };
  return { player, sent };
}

// biome-ignore lint/suspicious/noExplicitAny: reaches private lobby internals
function setup(): any {
  const spawner = {
    onServerExit: undefined as unknown,
    spawn: vi.fn(),
    shutdownAll: vi.fn(),
    reissueUnclaimedSeat: vi.fn(),
  };
  const server = new LobbyServer(0, spawner as never) as any;
  server.gametypes = [DUEL, SND];
  server.mapNames = { wdm2: "WDM2", wsnd1: "WSND1" };
  return server;
}

// biome-ignore lint/suspicious/noExplicitAny: test wiring
function join(server: any, entrant: { player: any }, lobbyId: string): void {
  server.players.set(entrant.player.id, entrant.player);
  server.handleLobbyJoin(entrant.player, lobbyId);
}

// biome-ignore lint/suspicious/noExplicitAny: test wiring
function host(server: any, gametype = "duel"): { lobby: any; owner: { player: any; sent: any[] } } {
  const owner = makePlayer();
  server.players.set(owner.player.id, owner.player);
  server.handleLobbyCreate(owner.player, gametype);
  return { lobby: [...server.lobbies.values()].at(-1), owner };
}

const seatIds = (lobby: { players: Map<string, unknown> }): string[] => [...lobby.players.keys()];
const errors = (sent: { type: string; error?: string }[]): string[] =>
  sent.filter((m) => m.type === "lobby:error").map((m) => m.error ?? "");

describe("a player returning to a full room", () => {
  it("is let in on its account's own seat", () => {
    const server = setup();
    const { lobby, owner } = host(server);
    const other = makePlayer();
    join(server, other, lobby.id);
    expect(lobby.players.size).toBe(2);

    // The same account, on the socket the reloaded page opened
    const returning = makePlayer({ accountId: owner.player.accountId, name: owner.player.name });
    join(server, returning, lobby.id);

    expect(errors(returning.sent)).toEqual([]);
    expect(seatIds(lobby)).toEqual([other.player.id, returning.player.id]);
    expect(returning.player.lobbyId).toBe(lobby.id);
  });

  it("leaves the connection it replaced outside the room", () => {
    const server = setup();
    const { lobby, owner } = host(server);
    const returning = makePlayer({ accountId: owner.player.accountId });
    join(server, returning, lobby.id);

    expect(owner.player.lobbyId).toBeNull();
    expect(owner.player.status).toBe("online");
    expect(owner.sent.filter((m) => m.type === "lobby:kicked")).toHaveLength(1);
  });

  it("tells the room the old seat is gone", () => {
    const server = setup();
    const { lobby, owner } = host(server);
    const watcher = makePlayer();
    join(server, watcher, lobby.id);
    const returning = makePlayer({ accountId: owner.player.accountId });
    join(server, returning, lobby.id);

    const left = watcher.sent.filter((m) => m.type === "lobby:player_left");
    expect(left).toEqual([{ type: "lobby:player_left", playerId: owner.player.id }]);
    expect(watcher.sent.some((m) => m.type === "lobby:player_joined" && m.player.id === returning.player.id)).toBe(
      true,
    );
  });

  it("keeps the side it was playing on", () => {
    const server = setup();
    const { lobby, owner } = host(server, "snd");
    join(server, makePlayer(), lobby.id);
    join(server, makePlayer(), lobby.id);
    const side = lobby.players.get(owner.player.id).team;

    const returning = makePlayer({ accountId: owner.player.accountId });
    join(server, returning, lobby.id);
    expect(lobby.players.get(returning.player.id).team).toBe(side);
  });

  it("comes back unready, so the room does not start without it", () => {
    const server = setup();
    const { lobby, owner } = host(server);
    lobby.setReady(owner.player.id, true);
    const returning = makePlayer({ accountId: owner.player.accountId });
    join(server, returning, lobby.id);
    expect(lobby.players.get(returning.player.id).ready).toBe(false);
  });
});

describe("a room that really is full", () => {
  it("still turns away a different account", () => {
    const server = setup();
    const { lobby } = host(server);
    join(server, makePlayer(), lobby.id);
    const third = makePlayer();
    join(server, third, lobby.id);

    expect(errors(third.sent)).toEqual(["That room is full."]);
    expect(lobby.players.size).toBe(2);
  });

  it("seats bots one by one, account or no account", () => {
    const server = setup();
    const { lobby } = host(server, "snd");
    const first = makePlayer({ isBot: true, accountId: null });
    const second = makePlayer({ isBot: true, accountId: null });
    join(server, first, lobby.id);
    join(server, second, lobby.id);
    expect(lobby.players.size).toBe(3);
  });
});

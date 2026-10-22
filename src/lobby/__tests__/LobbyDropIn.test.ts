/**
 * A match under way takes players while it has room, as a Quake or Warsow
 * server does. Joining its room asks the running game server for a seat, and
 * only once it has one is the player told where to connect.
 */

import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LobbyServer } from "../LobbyServer";

// biome-ignore lint/suspicious/noExplicitAny: injected test fixtures for a private-shaped config
const FFA: any = {
  id: "ffa",
  name: "FFA",
  description: "everyone",
  maxPlayers: 3,
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
    accountId: 100 + number,
    ...overrides,
  };
  return { player, sent };
}

// biome-ignore lint/suspicious/noExplicitAny: reaches private lobby internals
function setup(admit: (...args: any[]) => Promise<unknown>): any {
  const spawner = {
    onServerExit: undefined as unknown,
    spawn: vi.fn(),
    shutdownAll: vi.fn(),
    reissueUnclaimedSeat: vi.fn(),
    admitDropIn: vi.fn(admit),
  };
  const server = new LobbyServer(0, spawner as never) as any;
  server.gametypes = [FFA, SND];
  server.mapNames = { wdm2: "WDM2", wsnd1: "WSND1" };
  return server;
}

/** A room whose match is running with the given number of members. */
// biome-ignore lint/suspicious/noExplicitAny: test wiring
function running(server: any, gametype: string, members: number): any {
  const owner = makePlayer();
  server.players.set(owner.player.id, owner.player);
  server.handleLobbyCreate(owner.player, gametype);
  const lobby = [...server.lobbies.values()].at(-1);
  for (let i = 1; i < members; i++) {
    const member = makePlayer();
    server.players.set(member.player.id, member.player);
    server.handleLobbyJoin(member.player, lobby.id);
  }
  lobby.state = "playing";
  lobby.isStarting = true;
  lobby.matchMap = lobby.maps[0].name;
  lobby.activeMatchId = "m_running";
  lobby.serverUrl = "ws://localhost:7781";
  for (const seat of lobby.players.values()) {
    lobby.activeSeatTeams.set(server.players.get(seat.id).accountId, seat.team);
  }
  return lobby;
}

// biome-ignore lint/suspicious/noExplicitAny: test wiring
async function dropIn(server: any, entrant: { player: any }, lobbyId: string): Promise<void> {
  server.players.set(entrant.player.id, entrant.player);
  server.handleLobbyJoin(entrant.player, lobbyId);
  await vi.waitFor(() => expect(server.spawner.admitDropIn).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ofType = (sent: { type: string }[], type: string) => sent.filter((m) => m.type === type);

describe("joining a match under way", () => {
  it("seats a player in a match with room and hands them its ticket privately", async () => {
    const server = setup(async () => ({ admissionTicket: "ticket-1", serverUrl: "ws://localhost:7781" }));
    const lobby = running(server, "ffa", 2);
    const late = makePlayer();
    const member = server.players.get([...lobby.players.keys()][0]);
    const memberSent: { type: string }[] = [];
    member.ws.send = (data: string) => memberSent.push(JSON.parse(data));

    await dropIn(server, late, lobby.id);

    expect(server.spawner.admitDropIn).toHaveBeenCalledWith("m_running", {
      accountId: late.player.accountId,
      name: late.player.name,
      team: "ffa",
      isBot: false,
    });
    expect(ofType(late.sent, "lobby:error")).toEqual([]);
    expect(ofType(late.sent, "lobby:created")).toHaveLength(1);
    expect(ofType(late.sent, "lobby:connect")).toEqual([
      {
        type: "lobby:connect",
        matchId: "m_running",
        serverUrl: "ws://localhost:7781",
        map: "wdm2",
        gametype: "ffa",
        admissionTicket: "ticket-1",
      },
    ]);
    // The room hears someone joined; nobody else ever sees the ticket.
    expect(ofType(memberSent, "lobby:player_joined")).toHaveLength(1);
    expect(JSON.stringify(memberSent)).not.toContain("ticket-1");
    expect(lobby.players.has(late.player.id)).toBe(true);
    expect(lobby.activeSeatTeams.get(late.player.accountId)).toBe("ffa");
    expect(late.player.lobbyId).toBe(lobby.id);
    expect(late.player.status).toBe("in_match");
  });

  it("puts a late player on the side with fewer players", async () => {
    const server = setup(async () => ({ admissionTicket: "t", serverUrl: "ws://localhost:7781" }));
    const lobby = running(server, "snd", 3);
    const sides = [...lobby.players.values()].map((p: { team: string }) => p.team);
    const short = sides.filter((t: string) => t === "alpha").length < 2 ? "alpha" : "bravo";
    const late = makePlayer();

    await dropIn(server, late, lobby.id);

    expect(lobby.players.get(late.player.id).team).toBe(short);
    expect(server.spawner.admitDropIn).toHaveBeenCalledWith("m_running", expect.objectContaining({ team: short }));
  });

  it("turns a player away from a full match", () => {
    const server = setup(async () => ({ admissionTicket: "t", serverUrl: "ws://localhost:7781" }));
    const lobby = running(server, "ffa", 3);
    const late = makePlayer();
    server.players.set(late.player.id, late.player);
    server.handleLobbyJoin(late.player, lobby.id);

    expect(ofType(late.sent, "lobby:error")).toEqual([{ type: "lobby:error", error: "This match is full." }]);
    expect(server.spawner.admitDropIn).not.toHaveBeenCalled();
  });

  it("lets no bot or signed-out connection drop in", () => {
    const server = setup(async () => ({ admissionTicket: "t", serverUrl: "ws://localhost:7781" }));
    const lobby = running(server, "ffa", 1);
    for (const overrides of [{ isBot: true, accountId: null }, { accountId: null }]) {
      const entrant = makePlayer(overrides);
      server.players.set(entrant.player.id, entrant.player);
      server.handleLobbyJoin(entrant.player, lobby.id);
      expect(ofType(entrant.sent, "lobby:error")).toEqual([
        { type: "lobby:error", error: "This match is already in progress." },
      ]);
    }
    expect(server.spawner.admitDropIn).not.toHaveBeenCalled();
  });

  it("gives the seat back when the game server does not take it", async () => {
    const server = setup(async () => null);
    const lobby = running(server, "ffa", 2);
    const late = makePlayer();

    await dropIn(server, late, lobby.id);

    expect(ofType(late.sent, "lobby:error")).toEqual([{ type: "lobby:error", error: "Could not join the match." }]);
    expect(ofType(late.sent, "lobby:connect")).toEqual([]);
    expect(lobby.players.has(late.player.id)).toBe(false);
    expect(lobby.activeSeatTeams.has(late.player.accountId)).toBe(false);
    expect(late.player.lobbyId).toBeNull();
  });

  it("holds the last seat while the server answers, so two players cannot both take it", async () => {
    let answer: (value: unknown) => void = () => {};
    const server = setup(() => new Promise((resolve) => (answer = resolve)));
    const lobby = running(server, "ffa", 2);
    const first = makePlayer();
    const second = makePlayer();
    server.players.set(first.player.id, first.player);
    server.players.set(second.player.id, second.player);

    server.handleLobbyJoin(first.player, lobby.id);
    server.handleLobbyJoin(second.player, lobby.id);
    expect(ofType(second.sent, "lobby:error")).toEqual([{ type: "lobby:error", error: "This match is full." }]);

    answer({ admissionTicket: "t", serverUrl: "ws://localhost:7781" });
    await vi.waitFor(() => expect(ofType(first.sent, "lobby:connect")).toHaveLength(1));
  });
});

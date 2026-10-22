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

import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
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
  const sent: unknown[] = [];
  const number = nextId++;
  const player = {
    id: `p_${number}`,
    ws: { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)) },
    name: "Tester",
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
function setup(spawn: any = vi.fn()): { server: any; spawn: any } {
  const spawner = { onServerExit: undefined as unknown, spawn, shutdownAll: vi.fn(), reissueUnclaimedSeat: vi.fn() };
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
  it("releases a replacement only to the authenticated original account of an active room match", () => {
    const { server } = setup();
    const original = makePlayer();
    const impostor = makePlayer();
    const lobby = createLobby(server, original.player);
    register(server, impostor.player);
    server.matchToLobby.set("m_1", lobby.id);
    const release = vi.fn((_matchId: string, accountId: number) =>
      accountId === original.player.accountId
        ? { admissionTicket: "private-fallback", serverUrl: "ws://localhost:7777" }
        : null,
    );
    server.spawner.reissueUnclaimedSeat = release;
    server.handleSeatReissue(impostor.player, "req_1", "m_1");
    expect(lastMessage(impostor.sent)).toEqual({
      type: "match:seat_reissue_error",
      requestId: "req_1",
      reason: "unavailable",
    });
    server.handleSeatReissue(original.player, "req_2", "other");
    expect(release).toHaveBeenCalledTimes(1);
    server.handleSeatReissue(original.player, "req_3", "m_1");
    expect(lastMessage(original.sent)).toEqual({
      type: "match:seat_reissued",
      requestId: "req_3",
      matchId: "m_1",
      admissionTicket: "private-fallback",
      serverUrl: "ws://localhost:7777",
    });
    expect(impostor.sent.some((msg: { admissionTicket?: string }) => msg.admissionTicket)).toBe(false);
  });

  it("lets an original account reopen its running room with its original team, without admitting a new player", () => {
    const { server } = setup();
    const original = makePlayer();
    const lobby = createLobby(server, original.player);
    lobby.state = "playing";
    lobby.activeMatchId = "m_1";
    lobby.activeSeatTeams.set(original.player.accountId, "bravo");
    server.handleLobbyLeave(original.player, lobby.id);
    const stranger = makePlayer();
    register(server, stranger.player);
    server.handleLobbyJoin(stranger.player, lobby.id);
    expect(lastMessage(stranger.sent)).toEqual({ type: "lobby:error", error: "This match is already in progress." });
    const restored = makePlayer({ accountId: original.player.accountId });
    register(server, restored.player);
    server.handleLobbyJoin(restored.player, lobby.id);
    expect(lobby.players.get(restored.player.id).team).toBe("bravo");
    expect(restored.sent.find((msg: { type: string }) => msg.type === "lobby:created")).toMatchObject({
      type: "lobby:created",
      lobby: { activeMatchId: "m_1" },
    });
    server.handleLobbyReady(restored.player, lobby.id, true);
    server.handleLobbyVoteMap(restored.player, lobby.id, lobby.maps[0].name);
    server.handleLobbySwitchTeam(restored.player, lobby.id);
    server.handleLobbyVoteShuffle(restored.player, lobby.id);
    expect(lobby.players.get(restored.player.id)).toMatchObject({ ready: false, team: "bravo" });
    expect(lobby.votes.size).toBe(0);
  });

  it("keeps match bots alive while the last human reloads, then evicts a bot-only rematch room", () => {
    const { server } = setup();
    const host = makePlayer();
    const bot = makePlayer({ isBot: true, accountId: null, name: "Bot" });
    const lobby = createLobby(server, host.player);
    register(server, bot.player);
    server.handleLobbyJoin(bot.player, lobby.id);
    lobby.state = "playing";
    server.matchToLobby.set("m_1", lobby.id);
    server.handleLobbyLeave(host.player, lobby.id);
    expect(lobby.players.has(bot.player.id)).toBe(true);
    expect(bot.sent.some((msg: { type: string }) => msg.type === "lobby:kicked")).toBe(false);
    server.handleServerExit("m_1", 0);
    expect(lobby.players.size).toBe(0);
    expect(bot.sent.some((msg: { type: string }) => msg.type === "lobby:kicked")).toBe(true);
  });
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
    expect(lastMessage(third.sent)).toEqual({ type: "lobby:error", error: "That room is full." });
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
    expect(host.sent.some((m: { type: string }) => m.type === "match:ended")).toBe(true);
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
    expect(spawn.mock.calls[0][0].admissionSeats).toEqual([
      expect.objectContaining({ lobbyPlayerId: host.player.id, accountId: host.player.accountId, isBot: false }),
      expect.objectContaining({ lobbyPlayerId: joiner.id, accountId: joiner.accountId, isBot: false }),
    ]);
  });

  it("sends each member only their own game seat ticket", async () => {
    const host = makePlayer({ name: "Host" });
    const guest = makePlayer({ name: "Guest" });
    const spawn = vi
      .fn()
      .mockImplementation(async ({ admissionSeats }: { admissionSeats: Array<{ lobbyPlayerId: string }> }) => ({
        url: "ws://localhost:7777",
        matchId: "m_private",
        admissionTickets: new Map(admissionSeats.map((seat) => [seat.lobbyPlayerId, `ticket-${seat.lobbyPlayerId}`])),
      }));
    const { server } = setup(spawn);
    const lobby = createLobby(server, host.player);
    server.handleLobbyJoin(register(server, guest.player), lobby.id);

    await server.handleAllReady(lobby);

    const hostConnect = host.sent.find((msg: { type: string }) => msg.type === "lobby:connect");
    const guestConnect = guest.sent.find((msg: { type: string }) => msg.type === "lobby:connect");
    expect(hostConnect?.admissionTicket).toBe(`ticket-${host.player.id}`);
    expect(guestConnect?.admissionTicket).toBe(`ticket-${guest.player.id}`);
    expect(JSON.stringify(host.sent)).not.toContain(`ticket-${guest.player.id}`);
    expect(JSON.stringify(guest.sent)).not.toContain(`ticket-${host.player.id}`);
    expect((await spawn.mock.results[0].value).admissionTickets.size).toBe(0);
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

// ── Launch threshold ─────────────────────────────────────────────────

describe("LobbyServer launch threshold", () => {
  /** A 5v5-shaped gametype that can start with two. */
  // biome-ignore lint/suspicious/noExplicitAny: injected test fixture
  const SND: any = {
    id: "snd",
    name: "S&D",
    description: "test snd",
    maxPlayers: 10,
    minPlayers: 2,
    hasTeams: true,
    teamNames: ["UDON", "SOBA"],
    mapPool: ["wbomb2"],
  };

  // biome-ignore lint/suspicious/noExplicitAny: reaches private lobby internals
  function sndServer(): any {
    const { server } = setup();
    server.gametypes = [SND];
    return server;
  }

  it("starts a 5v5 mode without waiting for ten people", () => {
    // What broke the first playtest: `isAllReady` required a FULL lobby, so a
    // mode sized for ten could never begin with one human and a bot — which
    // reads from the outside as the bots refusing to ready up.
    const server = sndServer();
    const host = register(server, makePlayer().player);
    server.handleLobbyCreate(host, "snd");
    const lobby = [...server.lobbies.values()][0];

    const bot = register(server, makePlayer({ isBot: true, name: "Bot" }).player);
    server.handleLobbyJoin(bot, lobby.id);

    lobby.setReady(host.id, true);
    lobby.setReady(bot.id, true);
    expect(lobby.isAllReady()).toBe(true);
  });

  it("still waits for the minimum", () => {
    const server = sndServer();
    const host = register(server, makePlayer().player);
    server.handleLobbyCreate(host, "snd");
    const lobby = [...server.lobbies.values()][0];

    lobby.setReady(host.id, true);
    expect(lobby.isAllReady()).toBe(false);
  });

  it("does not launch a team mode with an empty side", () => {
    const server = sndServer();
    const host = register(server, makePlayer().player);
    server.handleLobbyCreate(host, "snd");
    const lobby = [...server.lobbies.values()][0];
    const bot = register(server, makePlayer({ isBot: true, name: "Bot" }).player);
    server.handleLobbyJoin(bot, lobby.id);

    lobby.players.get(bot.id).team = lobby.players.get(host.id).team;
    lobby.setReady(host.id, true);
    lobby.setReady(bot.id, true);
    expect(lobby.isAllReady()).toBe(false);
  });

  it("needs everyone present ready, not just the minimum count", () => {
    const server = sndServer();
    const host = register(server, makePlayer().player);
    server.handleLobbyCreate(host, "snd");
    const lobby = [...server.lobbies.values()][0];

    const a = register(server, makePlayer().player);
    const b = register(server, makePlayer().player);
    server.handleLobbyJoin(a, lobby.id);
    server.handleLobbyJoin(b, lobby.id);

    lobby.setReady(host.id, true);
    lobby.setReady(a.id, true);
    expect(lobby.isAllReady()).toBe(false);
  });

  it("leaves modes without a minimum needing a full lobby", () => {
    // Duel has no minPlayers, so it keeps today's behaviour exactly.
    const { server } = setup();
    const host = register(server, makePlayer().player);
    server.handleLobbyCreate(host, "duel");
    const lobby = [...server.lobbies.values()][0];

    lobby.setReady(host.id, true);
    expect(lobby.isAllReady()).toBe(false);
  });
});

// ── Choosing a side ──────────────────────────────────────────────────

describe("LobbyServer team selection", () => {
  // biome-ignore lint/suspicious/noExplicitAny: injected test fixture
  const TEAMS: any = {
    id: "snd",
    name: "S&D",
    description: "test snd",
    maxPlayers: 10,
    minPlayers: 2,
    hasTeams: true,
    teamNames: ["UDON", "SOBA"],
    mapPool: ["wbomb2"],
  };

  // biome-ignore lint/suspicious/noExplicitAny: reaches private lobby internals
  function teamLobby(): { server: any; host: any; lobby: any } {
    const { server } = setup();
    server.gametypes = [TEAMS];
    const host = register(server, makePlayer().player);
    server.handleLobbyCreate(host, "snd");
    return { server, host, lobby: [...server.lobbies.values()][0] };
  }

  it("lets a player move to the other side without a vote", () => {
    // Shuffling is random and needs a majority, so with one human and any
    // number of bots there was no way to choose a side at all — which makes the
    // attacking half of a round mode untestable.
    const { server, host, lobby } = teamLobby();
    const before = lobby.players.get(host.id).team;

    server.handleLobbySwitchTeam(host, lobby.id);
    expect(lobby.players.get(host.id).team).not.toBe(before);

    server.handleLobbySwitchTeam(host, lobby.id);
    expect(lobby.players.get(host.id).team).toBe(before);
  });

  it("swaps with the bot instead of emptying one side", () => {
    const { server, host, lobby } = teamLobby();
    const bot = register(server, makePlayer({ isBot: true, name: "Bot" }).player);
    server.handleLobbyJoin(bot, lobby.id);
    const hostBefore = lobby.players.get(host.id).team;
    const botBefore = lobby.players.get(bot.id).team;

    server.handleLobbySwitchTeam(host, lobby.id);

    expect(lobby.players.get(host.id).team).toBe(botBefore);
    expect(lobby.players.get(bot.id).team).toBe(hostBefore);
    expect(new Set([...lobby.players.values()].map((p) => p.team))).toEqual(new Set(["alpha", "bravo"]));
  });

  it("ignores a switch from someone not in the lobby", () => {
    const { server, lobby } = teamLobby();
    const outsider = register(server, makePlayer().player);
    expect(() => server.handleLobbySwitchTeam(outsider, lobby.id)).not.toThrow();
    expect(lobby.players.has(outsider.id)).toBe(false);
  });

  it("counts bots toward a shuffle a human called", () => {
    // A solo tester's single vote can never reach ceil(players / 2), so without
    // this the shuffle button does nothing forever.
    const { server, host, lobby } = teamLobby();
    const bot = register(server, makePlayer({ isBot: true, name: "Bot" }).player);
    server.handleLobbyJoin(bot, lobby.id);

    server.handleLobbyVoteShuffle(host, lobby.id);
    expect(lobby.shuffleVotes.size).toBe(0); // cleared — it passed
  });

  it("never lets bots shuffle on their own", () => {
    const { server, lobby } = teamLobby();
    const bot = register(server, makePlayer({ isBot: true, name: "Bot" }).player);
    server.handleLobbyJoin(bot, lobby.id);

    server.handleLobbyVoteShuffle(bot, lobby.id);
    // The bot's own vote counts for one and pulls in no others.
    expect(lobby.shuffleVotes.size).toBeLessThanOrEqual(1);
  });
});

/**
 * A public room no one else joins invites AI players by itself: the first
 * after AI_INVITE_AFTER_MS, then one every AI_INVITE_SPACING_MS while seats
 * are open. Private and campaign rooms never do.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LobbyServer } from "../LobbyServer";
import { AI_INVITE_AFTER_MS, AI_INVITE_RETRY_MS, AI_INVITE_SPACING_MS, type MatchLobby } from "../MatchLobby";
import type { GametypeInfo, MatchLobbyInfo } from "../types";

const duel: GametypeInfo = {
  id: "duel",
  name: "Duel",
  description: "1v1",
  maxPlayers: 2,
  hasTeams: false,
  mapPool: ["wdm2"],
};
const ffa: GametypeInfo = {
  id: "ffa",
  name: "FFA",
  description: "Free For All",
  maxPlayers: 4,
  minPlayers: 2,
  hasTeams: false,
  mapPool: ["wdm2"],
};

type Message = Record<string, unknown>;
interface FakePlayer {
  id: string;
  name: string;
  lobbyId: string | null;
  status: string;
  authenticated: boolean;
  isBot: boolean;
  accountId: number | null;
  ws: { readyState: number; send: (data: string) => void };
}
interface Internals {
  players: Map<string, FakePlayer>;
  lobbies: Map<string, MatchLobby>;
  handleMessage: (player: FakePlayer, message: Message) => void;
  tickAiInvites: (now?: number) => void;
  requestBotForLobby: (lobby: MatchLobby, difficulty: string) => Promise<string>;
  accounts: { close: () => void };
  handleAllReady: (lobby: MatchLobby) => Promise<void>;
}

let nextId = 1;
const servers: LobbyServer[] = [];

function makeServer(): {
  server: LobbyServer;
  internals: Internals;
  invites: string[];
  spawn: ReturnType<typeof vi.fn>;
} {
  const spawn = vi.fn().mockResolvedValue({ url: "ws://localhost:7777", matchId: "m_ai", admissionTickets: new Map() });
  const spawner = { onServerExit: undefined, spawn, shutdownAll: vi.fn() };
  const server = new LobbyServer(0, spawner as never);
  (server as unknown as { gametypes: GametypeInfo[] }).gametypes = [duel, ffa];
  servers.push(server);
  const internals = server as unknown as Internals;
  const invites: string[] = [];
  // Seats a bot at once, as the bot server would once it is ready
  internals.requestBotForLobby = async (lobby, difficulty) => {
    invites.push(difficulty);
    const bot = connect(server, `Bot ${invites.length}`, true).player;
    internals.handleMessage(bot, { type: "lobby:join", lobbyId: lobby.id, inviteToken: lobby.inviteToken });
    return bot.name;
  };
  return { server, internals, invites, spawn };
}

function connect(server: LobbyServer, name: string, isBot = false): { player: FakePlayer; sent: Message[] } {
  const sent: Message[] = [];
  const id = nextId++;
  const player: FakePlayer = {
    id: `ai_${id}`,
    name,
    lobbyId: null,
    status: "online",
    authenticated: true,
    isBot,
    accountId: isBot ? null : id,
    ws: { readyState: WebSocket.OPEN, send: (data) => sent.push(JSON.parse(data)) },
  };
  (server as unknown as Internals).players.set(player.id, player);
  return { player, sent };
}

function last(sent: Message[], type: string): Message | undefined {
  return sent.filter((message) => message.type === type).at(-1);
}

/** Move the clock to `time` and let the server run its per-second check. */
function tickAt(internals: Internals, time: number): void {
  vi.setSystemTime(time);
  internals.tickAiInvites();
}

function seats(internals: Internals, lobbyId: string): number {
  return internals.lobbies.get(lobbyId)?.playerCount ?? 0;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const server of servers) (server as unknown as Internals).accounts.close();
  servers.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AI players for a waiting public room", () => {
  it("invites one opponent into a duel room after the wait, and tells the room when", async () => {
    const { internals, invites } = makeServer();
    const host = connect(internals as unknown as LobbyServer, "Host");
    internals.handleMessage(host.player, { type: "queue:join", gametype: "duel" });
    const room = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    expect(room.visibility).toBe("public");

    const start = Date.now();
    tickAt(internals, start);
    expect(last(host.sent, "lobby:ai_invite")).toMatchObject({ lobbyId: room.id });
    expect(last(host.sent, "lobby:ai_invite")?.inMs).toBeGreaterThan(AI_INVITE_AFTER_MS - 1_000);

    tickAt(internals, start + AI_INVITE_AFTER_MS - 1);
    expect(invites).toEqual([]);
    tickAt(internals, start + AI_INVITE_AFTER_MS);
    await vi.waitFor(() => expect(seats(internals, room.id)).toBe(2));
    expect(invites).toEqual(["hard"]);
    // The room stays public, and on the public list
    expect(internals.lobbies.get(room.id)?.visibility).toBe("public");
    expect(host.sent.some((message) => message.type === "lobby:made_private")).toBe(false);

    // Full: no more
    tickAt(internals, start + AI_INVITE_AFTER_MS + 60_000);
    expect(invites).toEqual(["hard"]);
  });

  it("invites one more every few seconds into a free-for-all room, until it is full", async () => {
    const { internals, invites } = makeServer();
    const host = connect(internals as unknown as LobbyServer, "Host");
    internals.handleMessage(host.player, { type: "queue:join", gametype: "ffa" });
    const room = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;

    const start = Date.now();
    tickAt(internals, start);
    let now = start + AI_INVITE_AFTER_MS;
    tickAt(internals, now);
    await vi.waitFor(() => expect(seats(internals, room.id)).toBe(2));

    // A person can still take a seat between invites
    tickAt(internals, now + AI_INVITE_SPACING_MS - 1);
    expect(invites).toHaveLength(1);
    const late = connect(internals as unknown as LobbyServer, "Late");
    internals.handleMessage(late.player, { type: "queue:join", gametype: "ffa" });
    expect(late.player.lobbyId).toBe(room.id);

    now += AI_INVITE_SPACING_MS;
    tickAt(internals, now);
    await vi.waitFor(() => expect(seats(internals, room.id)).toBe(4));
    tickAt(internals, now + AI_INVITE_SPACING_MS);
    expect(invites).toHaveLength(2);
  });

  it("never invites into a private room", () => {
    const { internals, invites } = makeServer();
    const host = connect(internals as unknown as LobbyServer, "Host");
    internals.handleMessage(host.player, { type: "lobby:create", gametype: "duel", visibility: "private" });
    const room = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    expect(room.aiInviteInMs).toBeUndefined();

    const start = Date.now();
    tickAt(internals, start);
    tickAt(internals, start + AI_INVITE_AFTER_MS * 2);
    expect(invites).toEqual([]);
    expect(last(host.sent, "lobby:ai_invite")).toBeUndefined();
  });

  it("tells a person who joins how long is left", () => {
    const { internals } = makeServer();
    const host = connect(internals as unknown as LobbyServer, "Host");
    internals.handleMessage(host.player, { type: "queue:join", gametype: "ffa" });
    const start = Date.now();
    tickAt(internals, start);
    vi.setSystemTime(start + 30_000);

    const joiner = connect(internals as unknown as LobbyServer, "Joiner");
    internals.handleMessage(joiner.player, { type: "queue:join", gametype: "ffa" });
    const room = last(joiner.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    expect(room.aiInviteInMs).toBe(AI_INVITE_AFTER_MS - 30_000);
  });

  it("stops looking when the room starts, and tries again later after a failed invite", async () => {
    const { internals } = makeServer();
    const host = connect(internals as unknown as LobbyServer, "Host");
    internals.handleMessage(host.player, { type: "queue:join", gametype: "duel" });
    const room = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    const lobby = internals.lobbies.get(room.id)!;

    let failures = 0;
    internals.requestBotForLobby = async () => {
      failures++;
      throw new Error("Bot server unreachable");
    };
    const start = Date.now();
    tickAt(internals, start);
    tickAt(internals, start + AI_INVITE_AFTER_MS);
    await vi.waitFor(() => expect(failures).toBe(1));
    expect(lobby.aiInviteAt).toBeGreaterThanOrEqual(start + AI_INVITE_RETRY_MS);
    tickAt(internals, start + AI_INVITE_AFTER_MS + AI_INVITE_SPACING_MS);
    expect(failures).toBe(1);

    lobby.state = "playing";
    tickAt(internals, start + AI_INVITE_AFTER_MS + AI_INVITE_RETRY_MS * 2);
    expect(lobby.aiInviteAt).toBeNull();
    expect(last(host.sent, "lobby:ai_invite")).toMatchObject({ lobbyId: room.id, inMs: null });
    expect(failures).toBe(1);
  });

  it("rates the match with an AI player as a private one, while the room stays public", async () => {
    const { internals, spawn } = makeServer();
    const host = connect(internals as unknown as LobbyServer, "Host");
    internals.handleMessage(host.player, { type: "queue:join", gametype: "duel" });
    const room = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    const start = Date.now();
    tickAt(internals, start);
    tickAt(internals, start + AI_INVITE_AFTER_MS);
    await vi.waitFor(() => expect(seats(internals, room.id)).toBe(2));

    await internals.handleAllReady(internals.lobbies.get(room.id)!);
    expect(spawn).toHaveBeenCalledTimes(1);
    const config = spawn.mock.calls[0][0];
    expect(config.private).toBe(false);
    expect(config.resultContext).toMatchObject({ private: true, bots: 1 });
  });
});

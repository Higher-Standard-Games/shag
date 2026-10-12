import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LobbyServer } from "../LobbyServer";
import type { GametypeInfo, MatchLobbyInfo } from "../types";

const duel: GametypeInfo = {
  id: "duel",
  name: "Duel",
  description: "1v1",
  maxPlayers: 2,
  hasTeams: true,
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
  accountId: number;
  ws: { readyState: number; send: (data: string) => void };
}

let nextId = 1;
const servers: LobbyServer[] = [];

function makeServer(): LobbyServer {
  const spawner = { onServerExit: undefined, spawn: vi.fn(), shutdownAll: vi.fn() };
  const server = new LobbyServer(0, spawner as never);
  (server as unknown as { gametypes: GametypeInfo[] }).gametypes = [duel];
  servers.push(server);
  return server;
}

function connect(server: LobbyServer, name: string): { player: FakePlayer; sent: Message[] } {
  const sent: Message[] = [];
  const player: FakePlayer = {
    id: `private_${nextId++}`,
    name,
    lobbyId: null,
    status: "online",
    authenticated: true,
    isBot: false,
    accountId: nextId,
    ws: { readyState: WebSocket.OPEN, send: (data) => sent.push(JSON.parse(data)) },
  };
  (server as unknown as { players: Map<string, FakePlayer> }).players.set(player.id, player);
  return { player, sent };
}

function send(server: LobbyServer, player: FakePlayer, message: Message): void {
  (server as unknown as { handleMessage: (player: FakePlayer, message: Message) => void }).handleMessage(
    player,
    message,
  );
}

function last(sent: Message[], type: string): Message | undefined {
  return sent.filter((message) => message.type === type).at(-1);
}

afterEach(() => {
  for (const server of servers) (server as unknown as { accounts: { close: () => void } }).accounts.close();
  servers.length = 0;
  vi.restoreAllMocks();
});

describe("private match rooms", () => {
  it("hides the room from public lists and queue, and requires the invite secret", () => {
    const server = makeServer();
    const host = connect(server, "Host");
    const stranger = connect(server, "Stranger");
    const invited = connect(server, "Invited");

    send(server, host.player, { type: "lobby:create", gametype: "duel", visibility: "private" });
    const room = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    const invite = new URL(room.shareUrl, "https://example.invalid").searchParams.get("invite");
    expect(room.visibility).toBe("private");
    expect(invite).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(room.shareUrl).toContain(`lobby=${room.id}`);
    expect((server as unknown as { getLiveMatches: () => unknown[] }).getLiveMatches()).toEqual([]);
    expect(
      (server as unknown as { findWaitingLobby: (id: string) => unknown }).findWaitingLobby("duel"),
    ).toBeUndefined();
    expect(
      (server as unknown as { getOnlinePlayers: () => Array<{ lobbyId?: string }> }).getOnlinePlayers()[0].lobbyId,
    ).toBeUndefined();
    expect((last(stranger.sent, "matches:update")?.matches as unknown[]) ?? []).toEqual([]);

    send(server, stranger.player, { type: "lobby:join", lobbyId: room.id });
    expect(last(stranger.sent, "lobby:error")?.error).toBe("That room is gone, or the invite link is wrong.");
    send(server, stranger.player, { type: "lobby:join", lobbyId: room.id, inviteToken: "wrong" });
    expect(stranger.player.lobbyId).toBeNull();

    send(server, invited.player, { type: "lobby:join", lobbyId: room.id, inviteToken: invite });
    expect(invited.player.lobbyId).toBe(room.id);
    expect((last(invited.sent, "lobby:created")?.lobby as MatchLobbyInfo).shareUrl).toBe(room.shareUrl);
    expect((server as unknown as { getLiveMatches: () => unknown[] }).getLiveMatches()).toEqual([]);

    send(server, stranger.player, { type: "lobby:join", lobbyId: room.id, inviteToken: invite });
    expect(last(stranger.sent, "lobby:error")?.error).toBe("That room is full.");
  });

  it("keeps the invite usable for reconnect while the room exists and expires it when empty", () => {
    const server = makeServer();
    const host = connect(server, "Host");
    const invited = connect(server, "Invited");
    send(server, host.player, { type: "lobby:create", gametype: "duel", visibility: "private" });
    const room = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    const inviteToken = new URL(room.shareUrl, "https://example.invalid").searchParams.get("invite");

    send(server, invited.player, { type: "lobby:join", lobbyId: room.id, inviteToken });
    send(server, invited.player, { type: "lobby:leave", lobbyId: room.id });
    send(server, invited.player, { type: "lobby:join", lobbyId: room.id, inviteToken });
    expect(invited.player.lobbyId).toBe(room.id);

    send(server, invited.player, { type: "lobby:leave", lobbyId: room.id });
    send(server, host.player, { type: "lobby:leave", lobbyId: room.id });
    send(server, invited.player, { type: "lobby:join", lobbyId: room.id, inviteToken });
    expect(last(invited.sent, "lobby:error")?.error).toBe("That room is gone, or the invite link is wrong.");
  });

  it("places public queue traffic in a separate room", () => {
    const server = makeServer();
    const host = connect(server, "Host");
    const searching = connect(server, "Searching");
    send(server, host.player, { type: "lobby:create", gametype: "duel", visibility: "private" });
    const privateRoom = last(host.sent, "lobby:created")?.lobby as MatchLobbyInfo;

    send(server, searching.player, { type: "queue:join", gametype: "duel" });
    const publicRoom = last(searching.sent, "lobby:created")?.lobby as MatchLobbyInfo;
    expect(publicRoom.id).not.toBe(privateRoom.id);
    expect(publicRoom.visibility).toBe("public");
    expect(
      (server as unknown as { getLiveMatches: () => Array<{ id: string }> }).getLiveMatches().map((m) => m.id),
    ).toEqual([publicRoom.id]);
  });
});

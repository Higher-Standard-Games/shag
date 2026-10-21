import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LobbyServer } from "../LobbyServer";
import type { GametypeInfo } from "../types";

const duel: GametypeInfo = {
  id: "duel",
  name: "Duel",
  description: "1v1",
  maxPlayers: 2,
  hasTeams: true,
  mapPool: ["wdm2"],
};

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

function connect(server: LobbyServer, name: string): { player: FakePlayer; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  const player: FakePlayer = {
    id: `room_chat_${nextId++}`,
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

function send(server: LobbyServer, player: FakePlayer, message: Record<string, unknown>): void {
  (
    server as unknown as { handleMessage: (player: FakePlayer, message: Record<string, unknown>) => void }
  ).handleMessage(player, message);
}

function messages(sent: Record<string, unknown>[], type: string): Record<string, unknown>[] {
  return sent.filter((message) => message.type === type);
}

function createRoom(server: LobbyServer, player: FakePlayer, sent: Record<string, unknown>[]): string {
  send(server, player, { type: "lobby:create", gametype: "duel" });
  return (messages(sent, "lobby:created").at(-1)!.lobby as { id: string }).id;
}

afterEach(() => {
  for (const server of servers) (server as unknown as { accounts: { close: () => void } }).accounts.close();
  servers.length = 0;
  vi.restoreAllMocks();
});

describe("room chat", () => {
  it("masks lobby chat for everyone including the sender and stores only the masked history", () => {
    const server = makeServer();
    const alice = connect(server, "Alice");
    const bob = connect(server, "Bob");
    send(server, alice.player, { type: "chat:send", text: "  fuckj shot  " });
    for (const peer of [alice, bob]) {
      expect(messages(peer.sent, "chat:message")).toMatchObject([{ from: "Alice", text: "***j shot" }]);
    }
    const history = (server as unknown as { chatHistory: Array<{ text: string }> }).chatHistory;
    expect(history).toMatchObject([{ text: "***j shot" }]);
  });

  it("masks room chat and returning-member history without leaking to outsiders", () => {
    const server = makeServer();
    const alice = connect(server, "Alice");
    const bob = connect(server, "Bob");
    send(server, alice.player, { type: "lobby:create", gametype: "duel", visibility: "private" });
    const created = messages(alice.sent, "lobby:created").at(-1)?.lobby as { id: string; shareUrl: string };
    const room = created.id;
    send(server, alice.player, { type: "lobby:chat_send", lobbyId: room, text: "shit shot" });
    expect(messages(alice.sent, "lobby:chat_message")).toMatchObject([{ text: "*** shot" }]);
    expect(messages(bob.sent, "lobby:chat_message")).toEqual([]);
    const inviteToken = new URL(created.shareUrl, "https://example.invalid").searchParams.get("invite");
    send(server, bob.player, { type: "lobby:join", lobbyId: room, inviteToken });
    const snapshot = messages(bob.sent, "lobby:created").at(-1)?.lobby as { chatHistory: Array<{ text: string }> };
    expect(snapshot.chatHistory).toMatchObject([{ text: "*** shot" }]);
  });

  it("delivers messages only to members and rejects cross-room sends", () => {
    const server = makeServer();
    const alice = connect(server, "Alice");
    const bob = connect(server, "Bob");
    const cara = connect(server, "Cara");
    const roomA = createRoom(server, alice.player, alice.sent);
    const roomB = createRoom(server, cara.player, cara.sent);
    send(server, bob.player, { type: "lobby:join", lobbyId: roomA });

    send(server, alice.player, { type: "lobby:chat_send", lobbyId: roomA, text: "  hello room  " });
    expect(messages(alice.sent, "lobby:chat_message")).toMatchObject([
      { lobbyId: roomA, from: "Alice", text: "hello room" },
    ]);
    expect(messages(bob.sent, "lobby:chat_message")).toMatchObject([
      { lobbyId: roomA, from: "Alice", text: "hello room" },
    ]);
    expect(messages(cara.sent, "lobby:chat_message")).toEqual([]);
    expect(messages(alice.sent, "chat:message")).toEqual([]);

    send(server, cara.player, { type: "lobby:chat_send", lobbyId: roomA, text: "intrusion" });
    expect(messages(cara.sent, "lobby:error").at(-1)?.error).toBe("You are not in that room.");
    expect(messages(alice.sent, "lobby:chat_message")).toHaveLength(1);
    send(server, cara.player, { type: "lobby:leave", lobbyId: roomA });
    expect(cara.player.lobbyId).toBe(roomB);
    send(server, cara.player, { type: "lobby:chat_send", lobbyId: roomB, text: "own room" });
    expect(messages(cara.sent, "lobby:chat_message")).toMatchObject([{ lobbyId: roomB, text: "own room" }]);
    expect(messages(alice.sent, "lobby:chat_message")).toHaveLength(1);
  });

  it("sends bounded history to a returning member and stops delivery after leave", () => {
    const server = makeServer();
    const alice = connect(server, "Alice");
    const bob = connect(server, "Bob");
    const room = createRoom(server, alice.player, alice.sent);
    send(server, bob.player, { type: "lobby:join", lobbyId: room });
    for (let index = 0; index < 52; index++) {
      send(server, alice.player, { type: "lobby:chat_send", lobbyId: room, text: `message ${index}` });
    }
    send(server, bob.player, { type: "lobby:leave", lobbyId: room });
    const before = messages(bob.sent, "lobby:chat_message").length;
    send(server, alice.player, { type: "lobby:chat_send", lobbyId: room, text: "later" });
    expect(messages(bob.sent, "lobby:chat_message")).toHaveLength(before);
    send(server, bob.player, { type: "lobby:chat_send", lobbyId: room, text: "after leave" });
    expect(messages(bob.sent, "lobby:error").at(-1)?.error).toBe("You are not in that room.");

    const reconnect = connect(server, "Bob");
    send(server, reconnect.player, { type: "lobby:join", lobbyId: room });
    const snapshot = messages(reconnect.sent, "lobby:created").at(-1)?.lobby as {
      chatHistory: Array<{ text: string }>;
    };
    expect(snapshot.chatHistory).toHaveLength(50);
    expect(snapshot.chatHistory[0].text).toBe("message 3");
    expect(snapshot.chatHistory.at(-1)?.text).toBe("later");
  });

  it("ignores empty or malformed text and caps a long message", () => {
    const server = makeServer();
    const alice = connect(server, "Alice");
    const room = createRoom(server, alice.player, alice.sent);
    send(server, alice.player, { type: "lobby:chat_send", lobbyId: room, text: "   " });
    send(server, alice.player, { type: "lobby:chat_send", lobbyId: room, text: 42 });
    expect(messages(alice.sent, "lobby:chat_message")).toEqual([]);
    send(server, alice.player, { type: "lobby:chat_send", lobbyId: room, text: "x".repeat(600) });
    expect((messages(alice.sent, "lobby:chat_message")[0].text as string).length).toBe(500);
  });
});

/**
 * Lobby login: accounts, renames, and who counts as a bot.
 *
 * Every player has an account: a key opens it, and no key makes a new one
 * named Player_<number>. A bot has to connect from the lobby's own machine and
 * present the secret the lobby shares with its bot server, and gets no account.
 *
 * Uses the fake-ws harness from LobbyLifecycle.test.ts: no port is bound, sent
 * JSON is captured. Each server keeps its accounts in memory.
 */

import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { botReference } from "../../shared/ranking/__tests__/_botReference";
import { clientAddress, LobbyServer } from "../LobbyServer";

const SECRET = "test-bot-secret";
let nextId = 1;

// biome-ignore lint/suspicious/noExplicitAny: fake ConnectedPlayer
function connect(server: any, address = "127.0.0.1"): { player: any; sent: any[] } {
  const sent: unknown[] = [];
  const player = {
    id: `p_${nextId++}`,
    ws: { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)) },
    name: "",
    status: "online",
    lobbyId: null,
    authenticated: false,
    address,
    isBot: false,
    accountId: null,
  };
  server.players.set(player.id, player);
  return { player, sent };
}

// biome-ignore lint/suspicious/noExplicitAny: reaches private handlers
function makeServer(options: { botSecret?: string } = { botSecret: SECRET }): any {
  const spawner = { onServerExit: undefined as unknown, spawn: vi.fn(), shutdownAll: vi.fn() };
  return new LobbyServer(0, spawner as never, options);
}

// biome-ignore lint/suspicious/noExplicitAny: captured JSON
const last = (sent: any[]): any => sent[sent.length - 1];
// biome-ignore lint/suspicious/noExplicitAny: captured JSON
const ofType = (sent: any[], type: string): any[] => sent.filter((m) => m.type === type);
// biome-ignore lint/suspicious/noExplicitAny: captured JSON
const welcomeOf = (sent: any[]): any => ofType(sent, "welcome")[0];

/** A player who logged in with no key: a fresh account. */
// biome-ignore lint/suspicious/noExplicitAny: test wiring
function newPlayer(server: any, address = "198.51.100.1"): { player: any; sent: any[]; key: string } {
  const conn = connect(server, address);
  server.handleAuth(conn.player, { type: "auth" });
  return { ...conn, key: last(conn.sent).key };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LobbyServer accounts", () => {
  it("gives a player without a key a new Player_<number> account and its key, once", () => {
    const server = makeServer();
    const { player, sent, key } = newPlayer(server);
    const welcome = last(sent);
    expect(welcome.type).toBe("welcome");
    expect(welcome.identity).toEqual({ id: expect.any(String), name: expect.stringMatching(/^Player_\d{4}$/) });
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
    expect(player.authenticated).toBe(true);
    expect(player.name).toBe(welcome.identity.name);
  });

  it("logs a key back in to the same account, without sending the key again", () => {
    const server = makeServer();
    const first = newPlayer(server);
    const again = connect(server, "198.51.100.2");
    server.handleAuth(again.player, { type: "auth", key: first.key });
    const welcome = last(again.sent);
    expect(welcome.identity).toEqual(welcomeOf(first.sent).identity);
    expect(welcome.key).toBeUndefined();
    expect(again.player.accountId).toBe(first.player.accountId);
  });

  it("answers an unknown key with unknown_key and creates nothing; the connection can still log in", () => {
    const server = makeServer();
    const { player, sent } = connect(server);
    server.handleAuth(player, { type: "auth", key: "0123456789ABCDEFGHJKMNPQ" });
    expect(last(sent)).toEqual({ type: "auth:error", code: "unknown_key" });
    expect(player.authenticated).toBe(false);
    expect(player.accountId).toBeNull();

    server.handleAuth(player, { type: "auth" });
    expect(last(sent).type).toBe("welcome");
  });

  it("ignores a name sent with a player's login, so a stale tab can't claim it", () => {
    const server = makeServer();
    const { player, sent } = connect(server);
    server.handleAuth(player, { type: "auth", name: "Sundflux" });
    expect(last(sent).identity.name).toMatch(/^Player_\d+$/);
    expect(player.name).not.toBe("Sundflux");
  });

  it("refuses a second login on the same connection", () => {
    const server = makeServer();
    const { player, sent } = newPlayer(server);
    server.handleAuth(player, { type: "auth" });
    expect(last(sent)).toEqual({ type: "auth:error", code: "already_authenticated" });
  });

  it("slows down someone guessing keys", () => {
    const server = makeServer();
    const { player, sent } = connect(server, "203.0.113.9");
    for (let i = 0; i < 20; i++) server.handleAuth(player, { type: "auth", key: "0123456789ABCDEFGHJKMNPQ" });
    expect(ofType(sent, "auth:error").every((m) => m.code === "unknown_key")).toBe(true);
    server.handleAuth(player, { type: "auth", key: "0123456789ABCDEFGHJKMNPQ" });
    expect(last(sent)).toEqual({ type: "auth:error", code: "rate_limited" });
  });

  it("slows down one address making many accounts", () => {
    const server = makeServer();
    for (let i = 0; i < 30; i++) newPlayer(server, "203.0.113.10");
    const { sent } = newPlayer(server, "203.0.113.10");
    expect(last(sent)).toEqual({ type: "auth:error", code: "rate_limited" });
    expect(last(newPlayer(server, "203.0.113.11").sent).type).toBe("welcome");
  });

  it("never writes a key to the log", () => {
    const lines: unknown[][] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args));
    }
    const server = makeServer();
    const { key } = newPlayer(server);
    server.handleAuth(connect(server).player, { type: "auth", key });
    server.handleAuth(connect(server).player, { type: "auth", key: "0123456789ABCDEFGHJKMNPQ" });
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain(key);
  });
});

describe("LobbyServer renames", () => {
  it("renames the account, tells every tab logged in to it, and tells everyone else", () => {
    const server = makeServer();
    const me = newPlayer(server);
    const myOtherTab = connect(server, "198.51.100.3");
    server.handleAuth(myOtherTab.player, { type: "auth", key: me.key });
    const someoneElse = newPlayer(server, "198.51.100.4");

    server.handleIdentityRename(me.player, "Sundflux");

    const identity = { id: String(me.player.accountId), name: "Sundflux" };
    expect(ofType(me.sent, "identity:renamed")).toEqual([{ type: "identity:renamed", identity }]);
    expect(ofType(myOtherTab.sent, "identity:renamed")).toEqual([{ type: "identity:renamed", identity }]);
    expect(ofType(someoneElse.sent, "player:renamed")).toEqual([
      { type: "player:renamed", playerId: me.player.id, name: "Sundflux" },
      { type: "player:renamed", playerId: myOtherTab.player.id, name: "Sundflux" },
    ]);
    expect(me.player.name).toBe("Sundflux");
    expect(myOtherTab.player.name).toBe("Sundflux");
  });

  it("keeps the new name for the next login", () => {
    const server = makeServer();
    const me = newPlayer(server);
    server.handleIdentityRename(me.player, "Sundflux");
    const later = connect(server);
    server.handleAuth(later.player, { type: "auth", key: me.key });
    expect(last(later.sent).identity.name).toBe("Sundflux");
  });

  it("refuses a taken name, a reserved one and a broken one", () => {
    const server = makeServer();
    const first = newPlayer(server);
    const second = newPlayer(server, "198.51.100.5");
    server.handleIdentityRename(first.player, "Sundflux");
    server.handleIdentityRename(second.player, "sundflux");
    expect(last(second.sent)).toEqual({ type: "identity:error", code: "name_taken" });
    server.handleIdentityRename(second.player, "Nova");
    expect(last(second.sent)).toEqual({ type: "identity:error", code: "name_reserved" });
    server.handleIdentityRename(second.player, "no spaces");
    expect(last(second.sent)).toEqual({ type: "identity:error", code: "name_invalid" });
    server.handleIdentityRename(second.player, 42);
    expect(last(second.sent)).toEqual({ type: "identity:error", code: "name_invalid" });
  });

  it("refuses a rename while in a room", () => {
    const server = makeServer();
    const me = newPlayer(server);
    me.player.lobbyId = "l_1";
    server.handleIdentityRename(me.player, "Sundflux");
    expect(last(me.sent)).toEqual({ type: "identity:error", code: "in_lobby" });
  });

  it("slows down rename spam", () => {
    const server = makeServer();
    const me = newPlayer(server);
    for (let i = 0; i < 10; i++) server.handleIdentityRename(me.player, `Name${i}`);
    server.handleIdentityRename(me.player, "OneTooMany");
    expect(last(me.sent)).toEqual({ type: "identity:error", code: "rate_limited" });
  });
});

describe("LobbyServer bot login", () => {
  it("takes a connection from this machine with the secret for a bot, with no account", () => {
    const server = makeServer();
    const { player, sent } = connect(server);
    server.handleAuth(player, { type: "auth", name: "Nova", isBot: true, botSecret: SECRET });
    expect(player.authenticated).toBe(true);
    expect(player.isBot).toBe(true);
    expect(player.name).toBe("Nova");
    expect(player.accountId).toBeNull();
    expect(last(sent).identity).toBeUndefined();
    expect(last(sent).key).toBeUndefined();
  });

  it("gives a bot claim with the wrong secret, or none, a player account", () => {
    const server = makeServer();
    const wrong = connect(server);
    server.handleAuth(wrong.player, { type: "auth", name: "Nova", isBot: true, botSecret: "guess" });
    const none = connect(server);
    server.handleAuth(none.player, { type: "auth", name: "Nova", isBot: true });
    for (const { player, sent } of [wrong, none]) {
      expect(player.isBot).toBe(false);
      expect(welcomeOf(sent).identity.name).toMatch(/^Player_\d+$/);
    }
  });

  it("gives a bot claim from another machine a player account, even with the secret", () => {
    const server = makeServer();
    const { player } = connect(server, "203.0.113.7");
    server.handleAuth(player, { type: "auth", name: "Nova", isBot: true, botSecret: SECRET });
    expect(player.isBot).toBe(false);
    expect(player.accountId).not.toBeNull();
  });

  it("has no bots at all when no secret is configured", () => {
    const server = makeServer({});
    const { player } = connect(server);
    server.handleAuth(player, { type: "auth", name: "Nova", isBot: true, botSecret: "" });
    expect(player.isBot).toBe(false);
  });

  it("ignores a rename from a bot", () => {
    const server = makeServer();
    const { player, sent } = connect(server);
    server.handleAuth(player, { type: "auth", name: "Nova", isBot: true, botSecret: SECRET });
    const before = sent.length;
    server.handleIdentityRename(player, "Sundflux");
    expect(sent.length).toBe(before);
    expect(player.name).toBe("Nova");
  });

  it("fails a bot invite without calling the bot server when no secret is configured", async () => {
    const server = makeServer({});
    await expect(server.requestBotForLobby({ id: "l_1", gametype: { id: "duel" } })).rejects.toThrow(
      /secret not configured/,
    );
  });
});

describe("trusted bot reference handoff", () => {
  it("accepts bounded metadata only for an authenticated local bot", () => {
    const server = makeServer();
    const bot = connect(server);
    const reference = botReference();
    server.handleAuth(bot.player, { type: "auth", isBot: true, botSecret: SECRET, botReference: reference });
    reference.difficulty.aimAccuracy = 0;
    expect(bot.player.botReference.difficulty.aimAccuracy).toBe(0.5);
    const human = connect(server);
    server.handleAuth(human.player, { type: "auth", botReference: reference });
    expect(human.player.botReference).toBeUndefined();
    server.handleMessage(human.player, { type: "bot:reference", reference });
    expect(last(human.sent)).toMatchObject({ type: "lobby:error" });
    expect(human.player.botReference).toBeUndefined();
  });

  it("refuses malformed service metadata without authenticating or copying it", () => {
    const server = makeServer();
    const bot = connect(server);
    server.handleAuth(bot.player, { type: "auth", isBot: true, botSecret: SECRET, botReference: { path: "private" } });
    expect(last(bot.sent)).toEqual({ type: "auth:error", code: "invalid_bot_reference" });
    expect(bot.player.authenticated).toBe(false);
    expect(bot.player.botReference).toBeUndefined();
  });

  it("allows waiting-room changes but latches changes and reversions after handoff", () => {
    const server = makeServer();
    const bot = connect(server);
    server.handleAuth(bot.player, { type: "auth", isBot: true, botSecret: SECRET, botReference: botReference() });
    const lobby = { state: "waiting", isStarting: false, activeMatchId: "match", botReferenceChanged: false };
    const context = { private: true, ranked: false, bots: 1, botReferenceChanged: false };
    bot.player.lobbyId = "room";
    server.lobbies.set("room", lobby);
    server.matchRecords.set("match", context);
    const changed = { ...botReference(), goalArbiter: "legacy" };
    server.handleMessage(bot.player, { type: "bot:reference", reference: changed });
    expect(context.botReferenceChanged).toBe(false);
    lobby.state = "playing";
    server.handleMessage(bot.player, { type: "bot:reference", reference: changed });
    expect(context.botReferenceChanged).toBe(false); // Identical retries do not disqualify a match.
    server.handleMessage(bot.player, { type: "bot:reference", reference: botReference() });
    server.handleMessage(bot.player, { type: "bot:reference", reference: changed });
    expect(context.botReferenceChanged).toBe(true);
    expect(lobby.botReferenceChanged).toBe(true);
  });

  it("detects changes while spawning and failed metadata updates", () => {
    const server = makeServer();
    const bot = connect(server);
    server.handleAuth(bot.player, { type: "auth", isBot: true, botSecret: SECRET, botReference: botReference() });
    const lobby = { state: "playing", isStarting: true, activeMatchId: null, botReferenceChanged: false };
    bot.player.lobbyId = "room";
    server.lobbies.set("room", lobby);
    server.handleMessage(bot.player, { type: "bot:reference", reference: {} });
    expect(lobby.botReferenceChanged).toBe(true);
    expect(bot.player.botReference).toEqual(botReference());
  });
});

describe("clientAddress", () => {
  const request = (remoteAddress: string, forwarded?: string | string[]) =>
    ({ socket: { remoteAddress }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} }) as IncomingMessage;

  it("uses the forwarded address from a proxy on this machine", () => {
    expect(clientAddress(request("127.0.0.1", "198.51.100.8"))).toBe("198.51.100.8");
    expect(clientAddress(request("::1", "10.0.0.1, 198.51.100.8"))).toBe("198.51.100.8");
    expect(clientAddress(request("::ffff:127.0.0.1", ["10.0.0.1", "198.51.100.8"]))).toBe("198.51.100.8");
  });

  it("ignores the header from anyone else", () => {
    expect(clientAddress(request("203.0.113.7", "127.0.0.1"))).toBe("203.0.113.7");
  });

  it("uses the connection's own address when nothing was forwarded", () => {
    expect(clientAddress(request("127.0.0.1"))).toBe("127.0.0.1");
  });
});

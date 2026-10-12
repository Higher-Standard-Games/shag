/**
 * The lobby's player cap: players over it are told the lobby is full and when
 * to try again, then disconnected. Bots don't count and are never turned away,
 * and a player who has just left gets back in, so "Return to lobby" (a page
 * reload) can't lose its slot.
 *
 * Fake-ws harness as in LobbyAuth.test.ts: no port is bound, sent JSON is captured.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { DEFAULT_MAX_PLAYERS, LOBBY_FULL_CLOSE_CODE, LobbyServer } from "../LobbyServer";

const SECRET = "test-bot-secret";
let nextId = 1;
let nextAddress = 1;

// biome-ignore lint/suspicious/noExplicitAny: fake ConnectedPlayer
function connect(server: any, address = `198.51.100.${nextAddress++}`): { player: any; sent: any[]; close: any } {
  const sent: unknown[] = [];
  const close = vi.fn();
  const player = {
    id: `p_${nextId++}`,
    ws: { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)), close },
    name: "",
    status: "online",
    lobbyId: null,
    authenticated: false,
    address,
    isBot: false,
    accountId: null,
  };
  server.players.set(player.id, player);
  return { player, sent, close };
}

// biome-ignore lint/suspicious/noExplicitAny: reaches private handlers
function makeServer(maxPlayers?: number): any {
  const spawner = { onServerExit: undefined as unknown, spawn: vi.fn(), shutdownAll: vi.fn() };
  return new LobbyServer(0, spawner as never, { botSecret: SECRET, maxPlayers });
}

// biome-ignore lint/suspicious/noExplicitAny: captured JSON
const last = (sent: any[]): any => sent[sent.length - 1];

/** Log a new player in with no key. */
// biome-ignore lint/suspicious/noExplicitAny: test wiring
function logIn(server: any, key?: string) {
  const conn = connect(server);
  server.handleAuth(conn.player, { type: "auth", key });
  return { ...conn, answer: last(conn.sent) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LobbyServer player cap", () => {
  it("defaults to DEFAULT_MAX_PLAYERS", () => {
    expect(makeServer().maxPlayers).toBe(DEFAULT_MAX_PLAYERS);
    expect(DEFAULT_MAX_PLAYERS).toBe(64);
  });

  it("turns a new player away at the cap with when to try again, and closes the connection", () => {
    const server = makeServer(2);
    logIn(server);
    logIn(server);
    const third = logIn(server);
    expect(third.answer).toEqual({
      type: "auth:error",
      code: "lobby_full",
      online: 2,
      maxPlayers: 2,
      retryAfterSec: 60,
    });
    expect(third.close).toHaveBeenCalledWith(LOBBY_FULL_CLOSE_CODE, "Lobby full");
    expect(third.player.authenticated).toBe(false);
    expect(third.player.accountId).toBeNull();
  });

  it("turns away a known key too, once its grace is over, and logs it in to nothing", () => {
    const server = makeServer(1);
    const old = logIn(server);
    server.handleDisconnect(old.player);
    server.recentlyLeft.clear();
    logIn(server);
    const back = logIn(server, old.answer.key);
    expect(back.answer.code).toBe("lobby_full");
    expect(back.player.accountId).toBeNull();
  });

  it("does not count connections that have not logged in", () => {
    const server = makeServer(1);
    connect(server);
    connect(server);
    expect(logIn(server).answer.type).toBe("welcome");
  });

  it("lets the next player in once someone leaves", () => {
    const server = makeServer(1);
    const first = logIn(server);
    expect(logIn(server).answer.code).toBe("lobby_full");
    server.handleDisconnect(first.player);
    expect(logIn(server).answer.type).toBe("welcome");
  });

  it("never counts or turns away bots", () => {
    const server = makeServer(1);
    logIn(server);
    const bot = connect(server, "127.0.0.1");
    server.handleAuth(bot.player, { type: "auth", isBot: true, botSecret: SECRET });
    expect(last(bot.sent).type).toBe("welcome");
    expect(server.onlinePlayerCount()).toBe(1);
  });

  it("lets a player who just left back in over the cap, once, within the grace", () => {
    vi.useFakeTimers();
    const server = makeServer(1);
    const returning = logIn(server);
    server.handleDisconnect(returning.player);
    logIn(server); // someone takes the slot during the reload
    const back = logIn(server, returning.answer.key);
    expect(back.answer.type).toBe("welcome");
    expect(back.player.accountId).toBe(returning.player.accountId);

    // The grace is used up, and it runs out
    server.handleDisconnect(back.player);
    vi.advanceTimersByTime(61_000);
    logIn(server);
    expect(logIn(server, returning.answer.key).answer.code).toBe("lobby_full");
  });

  it("has no cap at 0", () => {
    const server = makeServer(0);
    for (let i = 0; i < 5; i++) expect(logIn(server).answer.type).toBe("welcome");
  });
});

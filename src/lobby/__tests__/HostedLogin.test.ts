/**
 * Hosted builds (an itch.io page) log in with a token instead of the key.
 *
 * The token comes back from every hosted login and replaces the last one. A
 * replaced token still works for a short grace period; after that it means
 * someone has a copy, and its chain ends. Logging in with the key starts a new
 * chain and ends the account's other chains on that host.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LobbyServer } from "../LobbyServer";
import { hashKey, PlayerStore, TOKEN_GRACE_MS } from "../PlayerStore";

let nextId = 1;

// biome-ignore lint/suspicious/noExplicitAny: fake ConnectedPlayer
function connect(server: any, address = "198.51.100.1"): { player: any; sent: any[] } {
  const sent: unknown[] = [];
  const player = {
    id: `p_${nextId++}`,
    ws: { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)), close: vi.fn() },
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
function makeServer(): any {
  const spawner = { onServerExit: undefined as unknown, spawn: vi.fn(), shutdownAll: vi.fn() };
  return new LobbyServer(0, spawner as never, { botSecret: "secret" });
}

// biome-ignore lint/suspicious/noExplicitAny: captured JSON
const last = (sent: any[]): any => sent[sent.length - 1];

// biome-ignore lint/suspicious/noExplicitAny: test wiring
function auth(server: any, message: Record<string, unknown>, address?: string) {
  const conn = connect(server, address);
  server.handleAuth(conn.player, { type: "auth", ...message });
  return { ...conn, answer: last(conn.sent) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("hosted login tokens", () => {
  it("gives a new hosted player the key once and a token; the web client gets no token", () => {
    const server = makeServer();
    const hosted = auth(server, { hosted: "itch" });
    expect(hosted.answer.type).toBe("welcome");
    expect(hosted.answer.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
    expect(hosted.answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth(server, {}).answer.token).toBeUndefined();
  });

  it("logs a token in to its account, never with the key, and replaces the token", () => {
    const server = makeServer();
    const first = auth(server, { hosted: "itch" });
    const again = auth(server, { hosted: "itch", token: first.answer.token });
    expect(again.answer.type).toBe("welcome");
    expect(again.player.accountId).toBe(first.player.accountId);
    expect(again.answer.key).toBeUndefined();
    expect(again.answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(again.answer.token).not.toBe(first.answer.token);
    // The new token works in turn
    expect(auth(server, { hosted: "itch", token: again.answer.token }).player.accountId).toBe(first.player.accountId);
  });

  it("refuses a token without its host, for another host, or made up", () => {
    const server = makeServer();
    const { answer } = auth(server, { hosted: "itch" });
    expect(auth(server, { token: answer.token }).answer.code).toBe("unknown_token");
    expect(auth(server, { hosted: "other", token: answer.token }).answer.code).toBe("unknown_token");
    expect(auth(server, { hosted: "itch", token: "x".repeat(43) }).answer.code).toBe("unknown_token");
    expect(auth(server, { hosted: "ITCH!", token: answer.token }).answer.code).toBe("unknown_token");
  });

  it("lets a replaced token in during the grace period, then ends its chain as copied", () => {
    vi.useFakeTimers();
    const server = makeServer();
    const first = auth(server, { hosted: "itch" });
    const thief = auth(server, { hosted: "itch", token: first.answer.token });
    expect(thief.answer.type).toBe("welcome");
    // Two tabs at once: the old token still opens the account
    expect(auth(server, { hosted: "itch", token: first.answer.token }).answer.type).toBe("welcome");
    vi.advanceTimersByTime(TOKEN_GRACE_MS + 1);
    expect(auth(server, { hosted: "itch", token: first.answer.token }).answer.code).toBe("token_reused");
    // The whole chain is gone: the copy no longer works either
    expect(auth(server, { hosted: "itch", token: thief.answer.token }).answer.code).toBe("unknown_token");
  });

  it("starts a new chain when the key logs in, ending the host's other chains for that account", () => {
    const server = makeServer();
    const first = auth(server, { hosted: "itch" });
    const otherBrowser = auth(server, { hosted: "itch", key: first.answer.key });
    expect(otherBrowser.answer.type).toBe("welcome");
    expect(otherBrowser.answer.key).toBeUndefined();
    expect(otherBrowser.answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth(server, { hosted: "itch", token: first.answer.token }).answer.code).toBe("unknown_token");
    expect(auth(server, { hosted: "itch", token: otherBrowser.answer.token }).answer.type).toBe("welcome");
  });

  it("rate-limits made-up tokens like made-up keys", () => {
    const server = makeServer();
    let code = "";
    for (let i = 0; i < 40 && code !== "rate_limited"; i++) {
      code = auth(server, { hosted: "itch", token: `${String(i).padStart(2, "0")}${"y".repeat(41)}` }, "203.0.113.9")
        .answer.code;
    }
    expect(code).toBe("rate_limited");
  });
});

describe("PlayerStore tokens", () => {
  it("forgets an account's tokens when it is deleted, and a host's tokens on request", () => {
    const store = new PlayerStore(":memory:");
    const { account, key } = store.create();
    const token = store.startTokens(account.id, "itch");
    expect(store.findToken(token, "itch")?.state).toBe("current");
    expect(store.deleteAccount(account.id, key)).toBe(true);
    expect(store.findToken(token, "itch")).toBeNull();

    const other = store.create().account;
    const a = store.startTokens(other.id, "itch");
    store.startTokens(other.id, "portal");
    expect(store.revokeHostTokens("itch")).toBe(1);
    expect(store.findToken(a, "itch")).toBeNull();
    store.close();
  });

  it("brings a version 1 file up to the token layout, keeping its accounts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "players-v1-"));
    const file = path.join(dir, "players.db");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE players (id INTEGER PRIMARY KEY, key_hash BLOB NOT NULL UNIQUE, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);
      PRAGMA user_version = 1;
    `);
    old
      .prepare("INSERT INTO players (key_hash, name, name_key) VALUES (?, ?, ?)")
      .run(hashKey("A".repeat(24)), "Ramen", "ramen");
    old.close();

    const store = new PlayerStore(file);
    expect(store.findByKey("A".repeat(24))).toEqual({ id: 1, name: "Ramen" });
    expect(store.findToken(store.startTokens(1, "itch"), "itch")?.account.name).toBe("Ramen");
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

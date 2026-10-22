/**
 * The browser side of accounts: logging in, keeping the key, carrying over a
 * name chosen before accounts existed, renaming and deleting.
 *
 * Talks to a real LobbyServer in the same process: a fake client hands each
 * message to the server's router, and the server's replies come back
 * asynchronously the way socket messages do. localStorage is an in-memory stand-in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { PlayerProfile } from "../../engine/player/PlayerProfile";
import {
  accountIsNew,
  currentIdentity,
  deleteAccount,
  LoginError,
  logIn,
  loginFailureText,
  playerKeyIsSessionOnly,
  renameAccount,
  resetAccountSessionForTests,
  restoreAccount,
  storedPlayerKey,
  unknownPlayerKey,
} from "../AccountSession";
import type { LobbyClient } from "../LobbyClient";
import { LobbyServer } from "../LobbyServer";

let nextId = 1;

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: reaches private handlers
function makeServer(): any {
  const spawner = { onServerExit: undefined as unknown, spawn: vi.fn(), shutdownAll: vi.fn() };
  return new LobbyServer(0, spawner as never, {});
}

/** A LobbyClient stand-in wired straight into `server`, from `address`. */
// biome-ignore lint/suspicious/noExplicitAny: test wiring
function connectTo(server: any, address = "198.51.100.20"): { client: LobbyClient; sent: any[] } {
  const handlers = new Map<string, Set<(msg: unknown) => void>>();
  const sent: unknown[] = [];
  const player = {
    id: `p_${nextId++}`,
    ws: {
      readyState: WebSocket.OPEN,
      send: (data: string) =>
        queueMicrotask(() => {
          const msg = JSON.parse(data);
          for (const handler of handlers.get(msg.type) ?? []) handler(msg);
        }),
      close: vi.fn(),
    },
    name: "",
    status: "online",
    lobbyId: null,
    authenticated: false,
    address,
    isBot: false,
    accountId: null,
  };
  server.players.set(player.id, player);
  const client = {
    connected: true,
    on(type: string, handler: (msg: unknown) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)?.add(handler);
      return () => handlers.get(type)?.delete(handler);
    },
    auth(key?: string) {
      sent.push({ type: "auth", key });
      server.handleMessage(player, { type: "auth", key });
    },
    rename(name: string) {
      sent.push({ type: "identity:rename", name });
      server.handleMessage(player, { type: "identity:rename", name });
    },
    deleteAccount(key: string, confirmed: boolean) {
      sent.push({ type: "identity:delete", key, confirmed });
      server.handleMessage(player, { type: "identity:delete", key, confirmed });
    },
  };
  return { client: client as unknown as LobbyClient, sent };
}

/** Let queued replies arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setProfileName(name: string): void {
  const profile = PlayerProfile.load();
  profile.name = name;
  profile.save();
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetAccountSessionForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountSession.logIn", () => {
  it("distinguishes account restore capacity errors from rate limiting", () => {
    expect(loginFailureText("lobby_full")).toContain("Servers are full");
    expect(loginFailureText("lobby_full")).toContain("key is unchanged");
    expect(loginFailureText("rate_limited")).toContain("Too many tries");
    expect(loginFailureText("unknown_key")).toContain("No player has that key");
  });
  it("keeps an exportable session key through reconnect when storage writes fail, then saves it when available", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    const server = makeServer();
    const first = await logIn(connectTo(server).client);
    expect(storedPlayerKey()).toBe(first.key);
    expect(playerKeyIsSessionOnly()).toBe(true);
    const reconnect = connectTo(server, "198.51.100.21");
    expect((await logIn(reconnect.client)).identity).toEqual(first.identity);
    expect(reconnect.sent[0]).toEqual({ type: "auth", key: first.key });
    write.mockRestore();
    await logIn(connectTo(server, "198.51.100.22").client);
    expect(playerKeyIsSessionOnly()).toBe(false);
    expect(storage.getItem("shag_player_key")).toBe(first.key);
  });

  it("keeps a cached key if storage reads become blocked", async () => {
    const server = makeServer();
    const first = await logIn(connectTo(server).client);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect((await logIn(connectTo(server, "198.51.100.21").client)).identity).toEqual(first.identity);
    expect(storedPlayerKey()).toBe(first.key);
    expect(playerKeyIsSessionOnly()).toBe(true);
  });
  it("makes a new browser an account, stores its key and shows its name", async () => {
    const server = makeServer();
    const { client, sent } = connectTo(server);
    const welcome = await logIn(client);

    expect(welcome.identity?.name).toMatch(/^Player_\d{4}$/);
    expect(storedPlayerKey()).toBe(welcome.key);
    expect(currentIdentity()).toEqual(welcome.identity);
    expect(PlayerProfile.load().name).toBe(welcome.identity?.name);
    // PlayerProfile's own made-up name isn't worth asking for
    expect(sent.filter((m) => m.type === "identity:rename")).toEqual([]);
  });

  it("knows when the lobby has just made this browser an account nobody has named", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    expect(accountIsNew()).toBe(true);

    // The same browser, logging in again with its key
    resetAccountSessionForTests();
    await logIn(connectTo(server, "198.51.100.24").client);
    expect(accountIsNew()).toBe(false);
  });

  it("doesn't ask a browser that already had a name who it is", async () => {
    setProfileName("Sundflux");
    const server = makeServer();
    await logIn(connectTo(server).client);
    expect(accountIsNew()).toBe(false);
  });

  it("logs back in to the same account with the stored key", async () => {
    const server = makeServer();
    const first = await logIn(connectTo(server).client);
    resetAccountSessionForTests();
    const again = await logIn(connectTo(server, "198.51.100.21").client);
    expect(again.identity).toEqual(first.identity);
    expect(again.key).toBeUndefined();
  });

  it("asks for the name a browser chose before accounts existed", async () => {
    setProfileName("Sundflux");
    const server = makeServer();
    await logIn(connectTo(server).client);
    await settle();
    expect(currentIdentity()?.name).toBe("Sundflux");
    expect(PlayerProfile.load().name).toBe("Sundflux");
  });

  it("keeps the Player_<number> name when that earlier name is taken", async () => {
    const server = makeServer();
    setProfileName("Sundflux");
    await logIn(connectTo(server).client);
    await settle();

    // Another browser, which also called itself Sundflux before accounts
    vi.stubGlobal("localStorage", memoryStorage());
    resetAccountSessionForTests();
    setProfileName("Sundflux");
    const welcome = await logIn(connectTo(server, "198.51.100.22").client);
    await settle();
    expect(currentIdentity()).toEqual(welcome.identity);
    expect(currentIdentity()?.name).toMatch(/^Player_\d+$/);
  });

  it("sets an unknown key aside and starts a new account", async () => {
    const oldServer = makeServer();
    await logIn(connectTo(oldServer).client);
    const oldKey = storedPlayerKey();

    // The lobby's accounts are gone
    resetAccountSessionForTests();
    const welcome = await logIn(connectTo(makeServer()).client);
    expect(unknownPlayerKey()).toBe(oldKey);
    expect(storedPlayerKey()).toBe(welcome.key);
    expect(welcome.key).not.toBe(oldKey);
  });

  it("rejects with the lobby's reason when it refuses", async () => {
    const server = makeServer();
    for (let i = 0; i < 30; i++) {
      vi.stubGlobal("localStorage", memoryStorage());
      await logIn(connectTo(server, "203.0.113.30").client);
    }
    vi.stubGlobal("localStorage", memoryStorage());
    await expect(logIn(connectTo(server, "203.0.113.30").client)).rejects.toEqual(new LoginError("rate_limited"));
  });

  it("rejects a full lobby with its wait, and keeps the stored key for the next try", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    vi.stubGlobal("localStorage", memoryStorage());
    await logIn(connectTo(server, "198.51.100.21").client);
    const key = storedPlayerKey();

    // Full: the same browser in another tab is turned away
    server.maxPlayers = 2;
    const error = await logIn(connectTo(server, "198.51.100.21").client).catch((err) => err);
    expect(error).toBeInstanceOf(LoginError);
    expect(error.code).toBe("lobby_full");
    expect(error.retryAfterSec).toBe(60);
    expect(storedPlayerKey()).toBe(key);
    expect(unknownPlayerKey()).toBeNull();
  });
});

describe("AccountSession.restoreAccount", () => {
  it("keeps an accepted restored key when storage still contains the previous account", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const server = makeServer();
    const first = await logIn(connectTo(server).client);
    const second = server.accounts.create();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    const restored = await restoreAccount(connectTo(server, "198.51.100.23").client, second.key);
    expect(restored.identity?.id).not.toBe(first.identity?.id);
    expect(storedPlayerKey()).toBe(second.key);
    expect(playerKeyIsSessionOnly()).toBe(true);
    const reconnect = connectTo(server, "198.51.100.24");
    const welcome = await logIn(reconnect.client);
    expect(welcome.identity?.id).toBe(restored.identity?.id);
    expect(reconnect.sent[0]).toEqual({ type: "auth", key: second.key });
  });
  it("restores an account in another browser from its pasted key", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    await renameAccount("Sundflux");
    const key = storedPlayerKey() ?? "";

    // A second browser: its own account first, then the pasted key
    vi.stubGlobal("localStorage", memoryStorage());
    resetAccountSessionForTests();
    await logIn(connectTo(server, "198.51.100.23").client);
    const pasted = `washoi-${key.slice(0, 12).toLowerCase()} ${key.slice(12)}`;
    const welcome = await restoreAccount(connectTo(server, "198.51.100.23").client, pasted);

    expect(welcome.identity?.name).toBe("Sundflux");
    expect(accountIsNew()).toBe(false);
    expect(storedPlayerKey()).toBe(key);
    expect(currentIdentity()?.name).toBe("Sundflux");
    expect(PlayerProfile.load().name).toBe("Sundflux");
  });

  it("leaves the stored key alone when the pasted one is wrong", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    const mine = storedPlayerKey();
    await expect(restoreAccount(connectTo(server).client, "0123456789ABCDEFGHJKMNPQ")).rejects.toEqual(
      new LoginError("unknown_key"),
    );
    await expect(restoreAccount(connectTo(server).client, "not a key")).rejects.toEqual(new LoginError("unknown_key"));
    expect(storedPlayerKey()).toBe(mine);
    expect(unknownPlayerKey()).toBeNull();
  });
});

describe("AccountSession.renameAccount", () => {
  it("renames the account and the profile follows", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    const outcome = await renameAccount("Sundflux");
    expect(outcome).toEqual({ ok: true, identity: { id: currentIdentity()?.id, name: "Sundflux" } });
    expect(PlayerProfile.load().name).toBe("Sundflux");
  });

  it("passes on the lobby's reason for a refusal", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    expect(await renameAccount("Ramen")).toEqual({ ok: false, code: "name_reserved" });
  });

  it("says so when not logged in", async () => {
    expect(await renameAccount("Sundflux")).toEqual({ ok: false, code: "not_connected" });
  });
});

describe("AccountSession.deleteAccount", () => {
  it("deletes the account, then forgets its key and name so the next visit is a new player", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    await renameAccount("Sundflux");
    const key = storedPlayerKey()!;
    expect(await deleteAccount(key, true)).toEqual({ ok: true });
    expect(storedPlayerKey()).toBeNull();
    expect(currentIdentity()).toBeNull();
    expect(PlayerProfile.load().name).toMatch(/^Player_[a-z0-9]{4}$/);

    // The next login is a fresh account, which doesn't take the old name back
    const next = await logIn(connectTo(server, "198.51.100.21").client);
    expect(next.identity?.name).toMatch(/^Player_\d+$/);
    expect(storedPlayerKey()).not.toBe(key);
  });

  it("keeps everything when the key is wrong or the box isn't ticked", async () => {
    const server = makeServer();
    await logIn(connectTo(server).client);
    const key = storedPlayerKey()!;
    expect(await deleteAccount("0123456789ABCDEFGHJKMNPQ", true)).toEqual({ ok: false, code: "wrong_key" });
    expect(await deleteAccount(key, false)).toEqual({ ok: false, code: "not_confirmed" });
    expect(storedPlayerKey()).toBe(key);
    expect(currentIdentity()).not.toBeNull();
  });

  it("says so when not logged in", async () => {
    expect(await deleteAccount("0123456789ABCDEFGHJKMNPQ", true)).toEqual({ ok: false, code: "not_connected" });
  });
});

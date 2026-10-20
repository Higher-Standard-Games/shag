/**
 * Synced settings: what follows an account, how the lobby keeps it in its own
 * settings.db, and how a browser decides between its own settings and the
 * account's on login.
 *
 * The flow tests run a real LobbyServer in the same process, with a fake
 * client that hands each message to the server's router; localStorage is an
 * in-memory stand-in, swapped to play a second browser.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { Cvar } from "../../engine/core/Cvar";
import { InputSystem } from "../../engine/input/InputSystem";
import {
  isSyncedCvar,
  isSyncedStorageKey,
  MAX_SETTINGS_BYTES,
  parseSyncedSettings,
  serializeSyncedSettings,
} from "../../shared/settings/SyncedSettings";
import { LobbyClient } from "../LobbyClient";
import { LobbyServer } from "../LobbyServer";
import { SettingsStore } from "../SettingsStore";
import { BACKUP_STORAGE_KEY, decideSync, type SyncState, startSettingsSync, stopSettingsSync } from "../SettingsSync";
import type { WelcomeMessage } from "../types";

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

let nextId = 1;

// biome-ignore lint/suspicious/noExplicitAny: reaches private handlers
function makeServer(): any {
  const spawner = { onServerExit: undefined as unknown, spawn: vi.fn(), shutdownAll: vi.fn() };
  return new LobbyServer(0, spawner as never, {});
}

// biome-ignore lint/suspicious/noExplicitAny: fake ConnectedPlayer and captured JSON
function connect(server: any, isBot = false): { player: any; sent: any[]; handlers: Map<string, Set<any>> } {
  const sent: unknown[] = [];
  const handlers = new Map<string, Set<(msg: unknown) => void>>();
  const player = {
    id: `p_${nextId++}`,
    ws: {
      readyState: WebSocket.OPEN,
      send: (data: string) => {
        const msg = JSON.parse(data);
        sent.push(msg);
        queueMicrotask(() => {
          for (const handler of handlers.get(msg.type) ?? []) handler(msg);
        });
      },
      close: vi.fn(),
    },
    name: "",
    status: "online",
    lobbyId: null,
    authenticated: false,
    address: "198.51.100.40",
    isBot,
    accountId: null,
  };
  server.players.set(player.id, player);
  return { player, sent, handlers };
}

/** A logged-in browser: its welcome, and a LobbyClient whose socket is the server's router. */
// biome-ignore lint/suspicious/noExplicitAny: test wiring
function logIn(server: any, key?: string): { client: LobbyClient; welcome: WelcomeMessage; sent: any[] } {
  const { player, sent, handlers } = connect(server);
  server.handleMessage(player, { type: "auth", key });
  const welcome = sent.find((m) => m.type === "welcome");
  const client = Object.create(LobbyClient.prototype) as LobbyClient;
  Object.defineProperty(client, "connected", { get: () => true });
  Object.assign(client, {
    on(type: string, handler: (msg: unknown) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)?.add(handler);
      return () => handlers.get(type)?.delete(handler);
    },
    send(msg: unknown) {
      server.handleMessage(player, msg);
    },
  });
  return { client, welcome, sent };
}

const blobText = (cvars: Record<string, string | number | boolean>, storage: Record<string, string> = {}) =>
  serializeSyncedSettings({ v: 1, cvars, storage });

describe("which settings follow the account", () => {
  it("syncs game preferences and leaves graphics, debug and device settings alone", () => {
    for (const name of ["cl_fov", "cg_bob", "s_volume", "m_sensitivity", "cl_team_enemy_color"]) {
      expect(isSyncedCvar(name)).toBe(true);
    }
    for (const name of [
      "r_bloom",
      "quality_number",
      "developer",
      "sv_cheats",
      "cl_debugbbox",
      "cl_name",
      "cl_interp",
    ]) {
      expect(isSyncedCvar(name)).toBe(false);
    }
  });

  it("copies bindings, HUD, theme and loadouts, never the account key", () => {
    for (const key of ["shag_keybindings", "engine_binds", "hud-user-prefs", "ui_theme_mode", "shag.loadout.sd"]) {
      expect(isSyncedStorageKey(key)).toBe(true);
    }
    for (const key of ["shag_player_key", "engine.renderVars", "engine_cvars", "shag_player_profile"]) {
      expect(isSyncedStorageKey(key)).toBe(false);
    }
  });

  it("drops anything in a downloaded blob that should not sync", () => {
    const text = JSON.stringify({
      v: 1,
      cvars: { cl_fov: 100, r_bloom: 0 },
      storage: { shag_keybindings: "{}", shag_player_key: "secret" },
    });
    expect(parseSyncedSettings(text)).toEqual({ v: 1, cvars: { cl_fov: 100 }, storage: { shag_keybindings: "{}" } });
    expect(parseSyncedSettings(JSON.stringify({ v: 2, cvars: {}, storage: {} }))).toBeNull();
  });

  it("serializes the same settings the same way whatever their order", () => {
    expect(blobText({ cl_fov: 100, cg_bob: 0 })).toBe(blobText({ cg_bob: 0, cl_fov: 100 }));
  });
});

describe("SettingsStore", () => {
  it("keeps settings in settings.db across restarts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-settings-"));
    try {
      const store = SettingsStore.open(dir);
      expect(store.get(7)).toBeNull();
      expect(store.save(7, '{"v":1}', 1000)).toEqual({ ok: true, updatedAt: 1000 });
      store.close();
      expect(fs.existsSync(path.join(dir, "settings.db"))).toBe(true);
      const reopened = SettingsStore.open(dir);
      expect(reopened.get(7)).toEqual({ settings: '{"v":1}', updatedAt: 1000 });
      expect(reopened.save(7, '{"v":2}', 2000).ok).toBe(true);
      expect(reopened.get(7)).toEqual({ settings: '{"v":2}', updatedAt: 2000 });
      reopened.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses what is not a JSON object, and what is too big", () => {
    const store = new SettingsStore(":memory:");
    expect(store.save(1, "[]")).toEqual({ ok: false, code: "invalid" });
    expect(store.save(1, "not json")).toEqual({ ok: false, code: "invalid" });
    expect(store.save(1, 42)).toEqual({ ok: false, code: "invalid" });
    expect(store.save(1, JSON.stringify({ pad: "x".repeat(MAX_SETTINGS_BYTES) }))).toEqual({
      ok: false,
      code: "too_large",
    });
    expect(store.get(1)).toBeNull();
    store.close();
  });
});

describe("LobbyServer settings", () => {
  it("says it keeps settings, and hands an account's settings to its other logins", () => {
    const server = makeServer();
    const first = logIn(server);
    expect(first.welcome.features?.syncedSettings).toBe(true);
    const player = server.players.get([...server.players.keys()].pop());

    server.handleMessage(player, { type: "settings:get", requestId: "a" });
    expect(first.sent.at(-1)).toEqual({ type: "settings:data", requestId: "a", settings: null, updatedAt: null });

    server.handleMessage(player, { type: "settings:save", requestId: "b", settings: blobText({ cl_fov: 100 }) });
    expect(first.sent.at(-1)).toMatchObject({ type: "settings:saved", requestId: "b", updatedAt: expect.any(Number) });

    const again = logIn(server, first.welcome.key);
    const other = server.players.get([...server.players.keys()].pop());
    server.handleMessage(other, { type: "settings:get", requestId: "c" });
    expect(again.sent.at(-1)).toMatchObject({ type: "settings:data", settings: blobText({ cl_fov: 100 }) });

    const stranger = logIn(server);
    const strangerPlayer = server.players.get([...server.players.keys()].pop());
    server.handleMessage(strangerPlayer, { type: "settings:get", requestId: "d" });
    expect(stranger.sent.at(-1)).toMatchObject({ type: "settings:data", settings: null });
  });

  it("refuses bad blobs and too many requests", () => {
    const server = makeServer();
    const { sent } = logIn(server);
    const player = server.players.get([...server.players.keys()].pop());
    server.handleMessage(player, { type: "settings:save", requestId: "x", settings: "[]" });
    expect(sent.at(-1)).toEqual({ type: "settings:error", requestId: "x", code: "invalid" });
    for (let i = 0; i < 40; i++) server.handleMessage(player, { type: "settings:get", requestId: `r${i}` });
    expect(sent.at(-1)).toEqual({ type: "settings:error", requestId: "r39", code: "rate_limited" });
  });

  it("ignores bots and connections that have not logged in", () => {
    const server = makeServer();
    const bot = connect(server, true);
    bot.player.authenticated = true;
    server.handleMessage(bot.player, { type: "settings:get", requestId: "b" });
    expect(bot.sent).toEqual([]);
    const anonymous = connect(server);
    server.handleMessage(anonymous.player, { type: "settings:get", requestId: "a" });
    expect(anonymous.sent.at(-1).type).toBe("lobby:error");
  });
});

describe("deciding on login", () => {
  const remote = (settings: string | null, updatedAt: number | null = settings ? 100 : null) => ({
    settings,
    updatedAt,
  });
  const local = blobText({ cl_fov: 90 });
  const theirs = blobText({ cl_fov: 110 });
  const synced = (over: Partial<SyncState> = {}): SyncState => ({
    accountId: "1",
    synced: local,
    syncedAt: 100,
    ...over,
  });

  it("uploads to an account that has no settings yet", () => {
    expect(decideSync(local, null, "1", remote(null))).toBe("upload");
  });

  it("takes the account's settings on a browser that never synced with it", () => {
    expect(decideSync(local, null, "1", remote(theirs))).toBe("apply");
    expect(decideSync(local, synced({ accountId: "2" }), "1", remote(theirs))).toBe("apply");
  });

  it("takes the account's settings when only the account changed", () => {
    expect(decideSync(local, synced(), "1", remote(theirs, 200))).toBe("apply");
  });

  it("uploads when only this browser changed", () => {
    expect(decideSync(local, synced({ synced: theirs }), "1", remote(theirs, 100))).toBe("upload");
  });

  it("picks the newer side when both changed", () => {
    const both = synced({ synced: blobText({}), syncedAt: 50 });
    expect(decideSync(local, { ...both, editedAt: 300 }, "1", remote(theirs, 200))).toBe("upload");
    expect(decideSync(local, { ...both, editedAt: 150 }, "1", remote(theirs, 200))).toBe("apply");
  });

  it("does nothing when both agree, and leaves a copy it cannot read alone", () => {
    expect(decideSync(local, null, "1", remote(local))).toBe("none");
    expect(decideSync(local, null, "1", remote(JSON.stringify({ v: 9 })))).toBe("keep");
  });
});

describe("syncing two browsers", () => {
  const browserA = memoryStorage();
  const browserB = memoryStorage();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible" });
    Cvar.register("cl_fov", 90, { type: "int", min: 60, max: 130 });
    Cvar.register("r_bloom", 1, { type: "int" });
  });

  afterEach(() => {
    stopSettingsSync();
    vi.unstubAllGlobals();
  });

  it("carries game settings and bindings to a new browser and keeps its graphics", async () => {
    const server = makeServer();

    vi.stubGlobal("localStorage", browserA);
    Cvar.set("cl_fov", 110);
    Cvar.set("r_bloom", 0);
    browserA.setItem("shag_keybindings", JSON.stringify({ move_forward: [{ key: "KeyI" }] }));
    browserA.setItem("shag.loadout.sd", '{"primary":"rifle"}');
    const a = logIn(server);
    await startSettingsSync(a.client, a.welcome);
    await settle();
    expect(a.sent.some((m) => m.type === "settings:saved")).toBe(true);

    // Browser B: same account, its own graphics and FOV.
    vi.stubGlobal("localStorage", browserB);
    Cvar.set("cl_fov", 90);
    Cvar.set("r_bloom", 1);
    browserB.setItem("shag.loadout.dm", '{"primary":"smg"}');
    const b = logIn(server, a.welcome.key);
    await startSettingsSync(b.client, b.welcome);

    expect(Cvar.get("cl_fov")).toBe(110);
    expect(Cvar.get("r_bloom")).toBe(1);
    expect(JSON.parse(browserB.getItem("engine_cvars") ?? "{}")).toEqual({ cl_fov: 110 });
    expect(InputSystem.getInstance().getBindingsForAction("move_forward")).toEqual([{ key: "KeyI" }]);
    expect(browserB.getItem("shag.loadout.sd")).toBe('{"primary":"rifle"}');
    expect(browserB.getItem("shag.loadout.dm")).toBeNull();
    // What browser B had before is kept.
    expect(parseSyncedSettings(browserB.getItem(BACKUP_STORAGE_KEY) ?? "")?.storage).toEqual({
      "shag.loadout.dm": '{"primary":"smg"}',
    });
    expect(browserB.getItem("shag_player_key")).toBeNull();
  });
});

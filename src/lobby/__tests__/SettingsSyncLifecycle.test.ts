// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cvar } from "../../engine/core/Cvar";
import type { LobbyClient } from "../LobbyClient";
import {
  applySettings,
  collectSettings,
  SYNC_STATE_STORAGE_KEY,
  startSettingsSync,
  stopSettingsSync,
} from "../SettingsSync";
import type { SettingsDataMessage, SettingsSavedMessage, WelcomeMessage } from "../types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const welcome = (id: string) =>
  ({
    identity: { id, name: `Player_${id}` },
    features: { syncedSettings: true },
  }) as WelcomeMessage;

const emptyRemote: SettingsDataMessage = {
  type: "settings:data",
  requestId: "test",
  settings: null,
  updatedAt: null,
};
const saved: SettingsSavedMessage = { type: "settings:saved", requestId: "test", updatedAt: 100 };

function client(
  requestSettings = vi.fn(async () => emptyRemote),
  saveSettings = vi.fn(async (_text: string) => saved),
) {
  return { requestSettings, saveSettings, on: vi.fn(() => () => {}) };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Reflect.set(Cvar, "cvars", new Map());
  Reflect.set(Cvar, "initialized", false);
  Reflect.set(Cvar, "consoleIntegration", null);
});

afterEach(() => {
  stopSettingsSync();
  vi.useRealTimers();
});

describe("account settings lifecycle", () => {
  it("does not upload browser edits before the initial account download settles", async () => {
    const download = deferred<SettingsDataMessage>();
    const c = client(vi.fn(() => download.promise));
    const starting = startSettingsSync(c as unknown as LobbyClient, welcome("1"));
    localStorage.setItem("shag.loadout.duel", "browser edit");
    await vi.advanceTimersByTimeAsync(7_000);
    const prematureSaves = c.saveSettings.mock.calls.length;
    download.resolve(emptyRemote);
    await starting;
    expect(prematureSaves).toBe(0);
    expect(JSON.parse(c.saveSettings.mock.calls[0][0]).storage["shag.loadout.duel"]).toBe("browser edit");
  });

  it("ignores a save response from the account that was stopped", async () => {
    const save = deferred<SettingsSavedMessage>();
    const a = client(
      undefined,
      vi.fn((_text: string) => save.promise),
    );
    const first = startSettingsSync(a as unknown as LobbyClient, welcome("1"));
    await Promise.resolve();
    const b = client();
    await startSettingsSync(b as unknown as LobbyClient, welcome("2"));
    save.resolve(saved);
    await first;
    expect(JSON.parse(localStorage.getItem(SYNC_STATE_STORAGE_KEY) ?? "{}").accountId).toBe("2");
  });

  it("uses downloaded values when a lazy subsystem registers its cvar later", () => {
    Cvar.init();
    applySettings({ v: 1, cvars: { cl_team_enemy_color: "0 1 0" }, storage: {} });
    Cvar.register("cl_team_enemy_color", "1 0 0");
    expect(Cvar.get("cl_team_enemy_color")).toBe("0 1 0");
  });

  it("keeps preloaded preferences in the upload before their subsystem registers", () => {
    localStorage.setItem("engine_cvars", JSON.stringify({ cl_team_enemy_color: "0 1 0" }));
    Cvar.init();
    expect(collectSettings().cvars.cl_team_enemy_color).toBe("0 1 0");
  });

  it("does not erase a lazy preference when another cvar is saved", () => {
    localStorage.setItem("engine_cvars", JSON.stringify({ cl_team_enemy_color: "0 1 0" }));
    Cvar.init();
    Cvar.register("cl_fov", 90);
    Cvar.set("cl_fov", 110);
    expect(JSON.parse(localStorage.getItem("engine_cvars") ?? "{}").cl_team_enemy_color).toBe("0 1 0");
  });

  it("replaces stale lazy values and keeps device preferences and declared defaults", () => {
    localStorage.setItem("engine_cvars", JSON.stringify({ cl_team_enemy_color: "0 1 0", r_bloom: 0 }));
    Cvar.init();
    applySettings({ v: 1, cvars: { cl_fov: 999 }, storage: {} });
    Cvar.register("cl_team_enemy_color", "1 0 0");
    Cvar.register("r_bloom", 1);
    Cvar.register("cl_fov", 90, { type: "int", min: 60, max: 130 });
    expect(Cvar.get("cl_team_enemy_color")).toBe("1 0 0");
    expect(Cvar.get("r_bloom")).toBe(0);
    expect(Cvar.get("cl_fov")).toBe(130);
    Cvar.reset("cl_fov");
    expect(Cvar.get("cl_fov")).toBe(90);
  });

  it("cancels polling and ignores an account download after logout", async () => {
    const download = deferred<SettingsDataMessage>();
    const c = client(vi.fn(() => download.promise));
    const starting = startSettingsSync(c as unknown as LobbyClient, welcome("1"));
    stopSettingsSync();
    download.resolve(emptyRemote);
    await starting;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.saveSettings).not.toHaveBeenCalled();
    expect(localStorage.getItem(SYNC_STATE_STORAGE_KEY)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["one", "all"])("can reset %s pending preference before its owner loads", (scope) => {
    localStorage.setItem("engine_cvars", JSON.stringify({ cl_team_enemy_color: "0 1 0" }));
    Cvar.init();
    if (scope === "one") Cvar.reset("cl_team_enemy_color");
    else Cvar.resetAll();
    Cvar.register("cl_team_enemy_color", "1 0 0");
    expect(Cvar.get("cl_team_enemy_color")).toBe("1 0 0");
    expect(JSON.parse(localStorage.getItem("engine_cvars") ?? "{}")).toEqual({});
  });
});

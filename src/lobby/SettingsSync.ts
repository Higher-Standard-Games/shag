/**
 * SettingsSync — keeps this browser's key bindings and game preferences in
 * step with the logged-in account, so a player gets their setup on any
 * browser. What follows the account is decided in shared/settings/SyncedSettings.ts;
 * graphics stay on this device.
 *
 * On login: an account with saved settings hands them to this browser, unless
 * this browser changed its settings since it last synced and the account's copy
 * is older than that change; an account with none takes this browser's. While
 * logged in, changes upload a moment after they settle and when the page hides.
 *
 * Settings still live in localStorage as before; the lobby holds a copy. The
 * first time an account's settings replace a browser's own, the browser's are
 * kept under BACKUP_STORAGE_KEY.
 */

import { Cvar } from "../engine/core/Cvar";
import { writePreference } from "../engine/core/PreferenceStorage";
import { CommandBindings } from "../engine/input/CommandBindings";
import { InputSystem } from "../engine/input/InputSystem";
import {
  CVAR_STORAGE_KEY,
  isSyncedCvar,
  isSyncedStorageKey,
  MAX_SETTINGS_BYTES,
  parseSyncedSettings,
  SYNCED_SETTINGS_VERSION,
  type SyncedCvarValue,
  type SyncedSettingsBlob,
  serializeSyncedSettings,
} from "../shared/settings/SyncedSettings";
import type { LobbyClient } from "./LobbyClient";
import type { WelcomeMessage } from "./types";

/** What this browser last agreed with the lobby, per account. */
export const SYNC_STATE_STORAGE_KEY = "shag_settings_sync";
/** This browser's own settings from before an account's first replaced them. */
export const BACKUP_STORAGE_KEY = "shag_settings_backup";

const CHECK_INTERVAL_MS = 5_000;
const UPLOAD_DELAY_MS = 2_000;

export interface SyncState {
  accountId: string;
  /** The settings both sides held after the last sync, serialized. */
  synced: string;
  /** The lobby's save time for `synced`. */
  syncedAt: number;
  /** When this browser last changed its settings without managing to upload them. */
  editedAt?: number;
}

export type SyncDecision = "apply" | "upload" | "none" | "keep";

/**
 * What to do on login, given this browser's settings, what it last agreed with
 * the lobby, and the account's saved copy. "keep" means neither side changes
 * and nothing more is uploaded: a copy this client cannot read is left alone.
 */
export function decideSync(
  local: string,
  state: SyncState | null,
  accountId: string,
  remote: { settings: string | null; updatedAt: number | null },
): SyncDecision {
  if (remote.settings === null) return "upload";
  const parsed = parseSyncedSettings(remote.settings);
  if (!parsed) return "keep";
  const remoteText = serializeSyncedSettings(parsed);
  if (remoteText === local) return "none";
  if (state?.accountId !== accountId) return "apply";
  const editedHere = local !== state.synced;
  if (!editedHere) return "apply";
  const changedElsewhere = remote.updatedAt !== state.syncedAt;
  if (!changedElsewhere) return "upload";
  return (state.editedAt ?? 0) > (remote.updatedAt ?? 0) ? "upload" : "apply";
}

function readJson(key: string): unknown {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function storedCvars(): Record<string, SyncedCvarValue> {
  const data = readJson(CVAR_STORAGE_KEY);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, SyncedCvarValue>) : {};
}

function storageKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) keys.push(key);
    }
  } catch {
    /* no storage: nothing to sync */
  }
  return keys;
}

/** This browser's synced settings, from storage and the live cvars. */
export function collectSettings(): SyncedSettingsBlob {
  const blob: SyncedSettingsBlob = { v: SYNCED_SETTINGS_VERSION, cvars: {}, storage: {} };
  for (const [name, value] of Object.entries(storedCvars())) {
    if (isSyncedCvar(name)) blob.cvars[name] = value;
  }
  // Live values win: a slider's write to storage may still be pending.
  for (const cvar of Cvar.list()) {
    if (!cvar.flags.persist || !isSyncedCvar(cvar.name)) continue;
    if (cvar.value === cvar.defaultValue) delete blob.cvars[cvar.name];
    else blob.cvars[cvar.name] = cvar.value;
  }
  for (const key of storageKeys()) {
    if (!isSyncedStorageKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) blob.storage[key] = value;
  }
  return blob;
}

/**
 * Make `blob` this browser's synced settings, in storage and live. Cvars and
 * bindings change at once; the HUD layout and theme take effect where they are
 * next read, at the latest on the next page load.
 */
export function applySettings(blob: SyncedSettingsBlob): void {
  for (const cvar of Cvar.list()) {
    if (!cvar.flags.persist || cvar.flags.readonly || !isSyncedCvar(cvar.name)) continue;
    if (cvar.name in blob.cvars) Cvar.set(cvar.name, blob.cvars[cvar.name]);
    else if (cvar.value !== cvar.defaultValue) Cvar.reset(cvar.name);
  }
  // Cvars not registered yet still take their value when they are.
  const cvars = Object.fromEntries(Object.entries(storedCvars()).filter(([name]) => !isSyncedCvar(name)));
  writePreference(CVAR_STORAGE_KEY, JSON.stringify({ ...cvars, ...blob.cvars }));

  try {
    for (const key of storageKeys()) {
      if (isSyncedStorageKey(key) && !(key in blob.storage)) localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(blob.storage)) localStorage.setItem(key, value);
  } catch {
    /* storage refused: the live cvars above still changed */
  }
  InputSystem.getInstance().reloadBindingsFromStorage();
  CommandBindings.reload();
}

function readState(): SyncState | null {
  const data = readJson(SYNC_STATE_STORAGE_KEY) as Partial<SyncState> | null;
  if (!data || typeof data.accountId !== "string" || typeof data.synced !== "string") return null;
  if (typeof data.syncedAt !== "number") return null;
  return data as SyncState;
}

function writeState(state: SyncState): void {
  try {
    localStorage.setItem(SYNC_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* the next login compares against the lobby's copy instead */
  }
}

function writeBackup(text: string): void {
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, text);
  } catch {
    /* no room for a backup: the account's settings still apply */
  }
}

let active: { stop: () => void } | null = null;

/** Stop following the account, as on logout or before switching accounts. */
export function stopSettingsSync(): void {
  active?.stop();
  active = null;
}

/**
 * Follow the account `welcome` logged `client` in to. Does nothing for bots and
 * on a lobby that keeps no settings. Resolves once the login sync is done.
 */
export async function startSettingsSync(client: LobbyClient, welcome: WelcomeMessage): Promise<void> {
  stopSettingsSync();
  const accountId = welcome.identity?.id;
  if (!accountId || !welcome.features?.syncedSettings || typeof window === "undefined") return;

  let stopped = false;
  let state = readState();
  let last = serializeSyncedSettings(collectSettings());
  let uploadTimer: ReturnType<typeof setTimeout> | undefined;
  let warnedTooLarge = false;

  const upload = async (text: string) => {
    if (new TextEncoder().encode(text).length > MAX_SETTINGS_BYTES) {
      if (!warnedTooLarge) console.warn("[SettingsSync] Settings too large to sync; they stay on this browser");
      warnedTooLarge = true;
      return;
    }
    try {
      const saved = await client.saveSettings(text);
      state = { accountId, synced: text, syncedAt: saved.updatedAt };
    } catch {
      const known = state?.accountId === accountId ? state : { accountId, synced: "", syncedAt: 0 };
      state = { ...known, editedAt: Date.now() };
    }
    writeState(state);
  };

  const check = () => {
    if (stopped) return;
    const text = serializeSyncedSettings(collectSettings());
    if (text === last) return;
    last = text;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => void upload(text), UPLOAD_DELAY_MS);
  };
  const flush = () => {
    check();
    if (uploadTimer === undefined) return;
    clearTimeout(uploadTimer);
    uploadTimer = undefined;
    if (state?.synced !== last) void upload(last);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };

  const interval = setInterval(check, CHECK_INTERVAL_MS);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onVisibility);
  const unsubscribe = client.on("_disconnected", () => stopSettingsSync());
  const session = {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(uploadTimer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    },
  };
  active = session;

  try {
    const remote = await client.requestSettings();
    if (stopped) return;
    const decision = decideSync(last, state, accountId, remote);
    if (decision === "keep") {
      session.stop();
      return;
    }
    if (decision === "apply") {
      const blob = parseSyncedSettings(remote.settings as string) as SyncedSettingsBlob;
      if (state?.accountId !== accountId && !readJson(BACKUP_STORAGE_KEY)) writeBackup(last);
      applySettings(blob);
      last = serializeSyncedSettings(collectSettings());
      state = { accountId, synced: last, syncedAt: remote.updatedAt ?? 0 };
      writeState(state);
    } else if (decision === "upload") {
      await upload(last);
    } else {
      state = { accountId, synced: last, syncedAt: remote.updatedAt ?? 0 };
      writeState(state);
    }
  } catch (e) {
    // Offline or refused: this browser keeps its own settings and tries again next login.
    console.warn("[SettingsSync] Could not sync settings:", e);
  }
}

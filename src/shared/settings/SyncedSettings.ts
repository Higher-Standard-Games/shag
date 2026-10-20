/**
 * SyncedSettings — which of a browser's settings follow the player's account,
 * and the blob the lobby keeps for them (see lobby/SettingsStore.ts).
 *
 * Synced: key and command bindings, game preferences (the cl_, cg_, s_ and m_
 * cvars, and colour-blindness correction), HUD layout, UI theme and the
 * remembered loadouts. Graphics stay per device: other r_* and quality cvars
 * and engine.renderVars never leave the browser, nor do developer, server and debug cvars, settings that depend on this
 * device's speed or connection, the account key, caches or editor state.
 *
 * Pure data and filters, shared by the lobby (size cap) and the client.
 */

/** Largest blob the lobby stores, well inside its 64 KB message limit. */
export const MAX_SETTINGS_BYTES = 32 * 1024;

export const SYNCED_SETTINGS_VERSION = 1;

/** The localStorage entry holding persisted cvars; only some of them sync. */
export const CVAR_STORAGE_KEY = "engine_cvars";

/** localStorage entries copied whole. */
export const SYNCED_STORAGE_KEYS: readonly string[] = [
  "shag_keybindings",
  "engine_binds",
  "hud-user-prefs",
  "ui_theme_mode",
];

/** Prefix of the per-mode remembered loadouts (`shag.loadout.<gametype>`). */
export const LOADOUT_KEY_PREFIX = "shag.loadout.";

const SYNCED_CVAR_PREFIXES = ["cl_", "cg_", "s_", "m_"];

/** Cvars under a synced prefix that still belong to this device. */
const DEVICE_CVARS = new Set([
  "cl_name", // the account's name is the lobby's, not a setting
  "cl_interp", // tuned to this connection
  "cl_timenudge",
  "cl_netgraph",
  "cl_player_pose_hz", // tuned to this machine's speed
  "cl_player_outline_proxy",
  "cl_animdebug",
  "cl_remotehitbox",
]);

/** Renderer cvars that are about the player's eyes, not this device's speed. */
const PLAYER_RENDER_CVARS = new Set(["r_colorcorrection", "r_colorcorrection_strength"]);

/** Whether a persisted cvar follows the account rather than staying on this device. */
export function isSyncedCvar(name: string): boolean {
  const lower = name.toLowerCase();
  if (PLAYER_RENDER_CVARS.has(lower)) return true;
  if (DEVICE_CVARS.has(lower) || lower.startsWith("cl_debug")) return false;
  return SYNCED_CVAR_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Whether a localStorage entry is copied whole into the blob. */
export function isSyncedStorageKey(key: string): boolean {
  return SYNCED_STORAGE_KEYS.includes(key) || key.startsWith(LOADOUT_KEY_PREFIX);
}

export type SyncedCvarValue = string | number | boolean;

export interface SyncedSettingsBlob {
  v: number;
  /** Synced cvars that differ from their defaults. */
  cvars: Record<string, SyncedCvarValue>;
  /** Synced localStorage entries, by key, as stored. */
  storage: Record<string, string>;
}

/** Read a blob the lobby returned; null when it is not one this client understands. */
export function parseSyncedSettings(text: string): SyncedSettingsBlob | null {
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const { v, cvars, storage } = data as Partial<SyncedSettingsBlob>;
    if (v !== SYNCED_SETTINGS_VERSION) return null;
    const blob: SyncedSettingsBlob = { v, cvars: {}, storage: {} };
    if (cvars && typeof cvars === "object" && !Array.isArray(cvars)) {
      for (const [name, value] of Object.entries(cvars)) {
        const valid =
          (typeof value === "number" && Number.isFinite(value)) ||
          typeof value === "string" ||
          typeof value === "boolean";
        if (valid && isSyncedCvar(name)) blob.cvars[name] = value;
      }
    }
    if (storage && typeof storage === "object" && !Array.isArray(storage)) {
      for (const [key, value] of Object.entries(storage)) {
        if (typeof value === "string" && isSyncedStorageKey(key)) blob.storage[key] = value;
      }
    }
    return blob;
  } catch {
    return null;
  }
}

/** The same blob always serializes the same way, so it can be compared as text. */
export function serializeSyncedSettings(blob: SyncedSettingsBlob): string {
  const sorted = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify({ v: blob.v, cvars: sorted(blob.cvars), storage: sorted(blob.storage) });
}

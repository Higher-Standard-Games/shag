/**
 * SettingsStore — each account's synced client settings: key bindings and game
 * preferences, kept so a player gets their setup on any browser. Graphics stay
 * per device and never reach it (see shared/settings/SyncedSettings.ts).
 *
 * Its own file, `settings.db`, beside players.db: settings are rewritten as
 * often as players change them, which should neither contend with result and
 * rating writes nor share their backups. Deleting the file loses nothing that
 * matters; every browser still has its own copy and uploads it on next login.
 *
 * The blob is opaque here beyond being a JSON object within the size cap. The
 * account id is the one PlayerStore issued; the lobby only reads or writes the
 * row of the account a connection logged in to.
 *
 * Node-only, like PlayerStore.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { MAX_SETTINGS_BYTES } from "../shared/settings/SyncedSettings";

export interface StoredSettings {
  /** The settings JSON as the client sent it. */
  settings: string;
  /** When the lobby saved it, in ms since the epoch. */
  updatedAt: number;
}

export type SaveSettingsResult = { ok: true; updatedAt: number } | { ok: false; code: "invalid" | "too_large" };

/** A JSON object no bigger than the cap; other values are refused, not stored. */
export function checkSettingsBlob(value: unknown): "invalid" | "too_large" | null {
  if (typeof value !== "string") return "invalid";
  if (Buffer.byteLength(value, "utf8") > MAX_SETTINGS_BYTES) return "too_large";
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? null : "invalid";
  } catch {
    return "invalid";
  }
}

export class SettingsStore {
  private readonly db: DatabaseSync;
  private readonly selectSettings: StatementSync;
  private readonly upsertSettings: StatementSync;

  /** The store in `<dataDir>/settings.db`, created on first use. */
  static open(dataDir: string): SettingsStore {
    fs.mkdirSync(dataDir, { recursive: true });
    return new SettingsStore(path.join(dataDir, "settings.db"));
  }

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS player_settings (
        account_id INTEGER PRIMARY KEY,
        settings   TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.selectSettings = this.db.prepare("SELECT settings, updated_at FROM player_settings WHERE account_id = ?");
    this.upsertSettings = this.db.prepare(
      `INSERT INTO player_settings (account_id, settings, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    );
  }

  /** The account's saved settings, or null if it never saved any. */
  get(accountId: number): StoredSettings | null {
    const row = this.selectSettings.get(accountId);
    return row ? { settings: String(row.settings), updatedAt: Number(row.updated_at) } : null;
  }

  /** Replace the account's settings. */
  save(accountId: number, settings: unknown, now = Date.now()): SaveSettingsResult {
    const problem = checkSettingsBlob(settings);
    if (problem) return { ok: false, code: problem };
    this.upsertSettings.run(accountId, settings as string, now);
    return { ok: true, updatedAt: now };
  }

  close(): void {
    this.db.close();
  }
}

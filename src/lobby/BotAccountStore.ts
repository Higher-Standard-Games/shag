import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { BOT_ACCOUNT_PRESETS, type BotPreset } from "../shared/ranking/BotMatchRatingGroups";

/** The account name a preset plays its ratings under, on the Private board. */
export function botAccountName(preset: BotPreset): string {
  return `Bot · ${preset[0].toUpperCase()}${preset.slice(1)}`;
}

/**
 * One account per bot preset, rated in the Private pools like a player. Shares
 * the journal connection. The account has no key: its key hash is the hash of
 * nothing anyone holds, so it can never be logged in to.
 */
export class BotAccountStore {
  constructor(private readonly db: DatabaseSync) {}

  initialize(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS bot_accounts (
      preset TEXT PRIMARY KEY CHECK(preset IN (${BOT_ACCOUNT_PRESETS.map((p) => `'${p}'`).join(", ")})),
      account_id INTEGER NOT NULL UNIQUE REFERENCES players(id)
    )`);
  }

  /** The preset's account, made on first use. Only inside a write transaction. */
  ensure(preset: BotPreset): number {
    const existing = this.find(preset);
    if (existing !== null) return existing;
    const name = botAccountName(preset);
    const id = Number(
      this.db
        .prepare("INSERT INTO players (key_hash, name, name_key) VALUES (?, ?, ?)")
        .run(new Uint8Array(randomBytes(32)), name, name.toLowerCase()).lastInsertRowid,
    );
    this.db.prepare("INSERT INTO bot_accounts (preset, account_id) VALUES (?, ?)").run(preset, id);
    return id;
  }

  /** The preset's account; a stored result rated against it guarantees one. */
  get(preset: BotPreset): number {
    const id = this.find(preset);
    if (id === null) throw new Error(`Bot account for ${preset} is missing`);
    return id;
  }

  list(): Array<{ preset: BotPreset; accountId: number }> {
    if (!this.exists()) return [];
    return this.db
      .prepare("SELECT preset, account_id FROM bot_accounts ORDER BY account_id")
      .all()
      .map((row) => ({ preset: row.preset as BotPreset, accountId: Number(row.account_id) }));
  }

  private find(preset: BotPreset): number | null {
    if (!this.exists()) return null;
    const row = this.db.prepare("SELECT account_id FROM bot_accounts WHERE preset = ?").get(preset);
    return row ? Number(row.account_id) : null;
  }

  private exists(): boolean {
    return !!this.db.prepare("SELECT name FROM sqlite_master WHERE name = 'bot_accounts'").get();
  }
}

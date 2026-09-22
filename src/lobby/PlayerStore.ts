/**
 * PlayerStore — player accounts.
 *
 * Each account is an id, the SHA-256 of the player's key, and a name that is
 * unique regardless of capitals. The account table stores nothing else, and
 * the key itself never is. MatchResultStore adds separate result tables to the
 * same database. See docs/research/PLAYER_IDENTITY.md.
 *
 * Node-only. Backed by Node's built-in SQLite: one file in the server data
 * directory, or ":memory:" for tests.
 */

import { createHash, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { checkPlayerName, encodeKey, KEY_BYTES, type NameProblem, normalizeKey } from "./PlayerIdentity";

export interface PlayerAccount {
  id: number;
  name: string;
}

export type RenameResult = { ok: true; account: PlayerAccount } | { ok: false; code: NameProblem | "name_taken" };

/** Default names start at 4 digits and grow a digit when a size keeps colliding; 9 digits keeps them within 16 characters. */
const DEFAULT_NAME_DIGITS = { first: 4, last: 9 };
const TRIES_PER_SIZE = 10;

export function hashKey(canonicalKey: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(canonicalKey).digest());
}

/** Two accounts asked for the same name: SQLite refused the second. */
function isNameTaken(err: unknown): boolean {
  return err instanceof Error && err.message.includes("UNIQUE constraint failed: players.name_key");
}

export class PlayerStore {
  private readonly db: DatabaseSync;
  private readonly insertAccount: StatementSync;
  private readonly accountByKey: StatementSync;
  private readonly accountById: StatementSync;
  private readonly updateName: StatementSync;

  /** The store in `<dataDir>/players.db`, created on first use. */
  static open(dataDir: string): PlayerStore {
    fs.mkdirSync(dataDir, { recursive: true });
    return new PlayerStore(path.join(dataDir, "players.db"));
  }

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
    this.insertAccount = this.db.prepare("INSERT INTO players (key_hash, name, name_key) VALUES (?, ?, ?)");
    this.accountByKey = this.db.prepare("SELECT id, name FROM players WHERE key_hash = ?");
    this.accountById = this.db.prepare("SELECT id, name, name_key FROM players WHERE id = ?");
    this.updateName = this.db.prepare("UPDATE players SET name = ?, name_key = ? WHERE id = ?");
  }

  /** Brings an older file up to the current layout; `user_version` records which one a file has. */
  private migrate(): void {
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE players (
          id        INTEGER PRIMARY KEY,
          key_hash  BLOB NOT NULL UNIQUE,
          name      TEXT NOT NULL,
          name_key  TEXT NOT NULL UNIQUE
        );
        PRAGMA user_version = 1;
      `);
    }
  }

  /**
   * A new account named Player_<number>, with a number no account has, and its
   * key. The key is returned once and only its hash is kept.
   */
  create(): { account: PlayerAccount; key: string } {
    const key = encodeKey(new Uint8Array(randomBytes(KEY_BYTES)));
    const keyHash = hashKey(key);
    for (let digits = DEFAULT_NAME_DIGITS.first; digits <= DEFAULT_NAME_DIGITS.last; digits++) {
      for (let attempt = 0; attempt < TRIES_PER_SIZE; attempt++) {
        const name = `Player_${randomInt(10 ** (digits - 1), 10 ** digits)}`;
        try {
          const { lastInsertRowid } = this.insertAccount.run(keyHash, name, name.toLowerCase());
          return { account: { id: Number(lastInsertRowid), name }, key };
        } catch (err) {
          if (!isNameTaken(err)) throw err;
        }
      }
    }
    throw new Error("No free Player_<number> name left");
  }

  /** The account a key belongs to, in any form a player might paste it; null if none. */
  findByKey(input: string): PlayerAccount | null {
    const key = normalizeKey(input);
    if (!key) return null;
    const row = this.accountByKey.get(hashKey(key));
    return row ? { id: Number(row.id), name: String(row.name) } : null;
  }

  /**
   * Give account `id` a new name. Fails if the name breaks the name rules or
   * another account has it in any capitals. Changing only the capitals of your
   * own name is always allowed, a default Player_<number> name included.
   */
  rename(id: number, name: string): RenameResult {
    const current = this.accountById.get(id);
    if (!current) throw new Error(`No player account ${id}`);
    const nameKey = name.toLowerCase();
    if (nameKey !== current.name_key) {
      const problem = checkPlayerName(name);
      if (problem) return { ok: false, code: problem };
    }
    try {
      this.updateName.run(name, nameKey, id);
    } catch (err) {
      if (isNameTaken(err)) return { ok: false, code: "name_taken" };
      throw err;
    }
    return { ok: true, account: { id, name } };
  }

  close(): void {
    this.db.close();
  }
}

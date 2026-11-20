/**
 * PlayerStore — player accounts.
 *
 * Each account is an id, the SHA-256 of the player's key, and a name that is
 * unique regardless of capitals. The account table stores nothing else, and
 * the key itself never is. MatchResultStore adds separate result tables to the
 * same database. See docs/research/PLAYER_IDENTITY.md.
 *
 * A hosted build (an itch.io page) stores a login token instead of the key,
 * because every game on its host can read its storage. Tokens are kept as
 * hashes too, per account and host, and are limited: they log in and play,
 * and never return the key. Each token login replaces the token, and a
 * replaced token that comes back later means someone has a copy (findToken).
 *
 * Node-only. Backed by Node's built-in SQLite: one file in the server data
 * directory, or ":memory:" for tests.
 */

import { createHash, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { filterPlayerName, isOffensiveName } from "../engine/server/ChatFilter";
import {
  checkPlayerName,
  DELETED_ACCOUNT_NAME,
  encodeKey,
  KEY_BYTES,
  type NameProblem,
  normalizeKey,
  type PlayerNameReservation,
} from "./PlayerIdentity";

export interface PlayerAccount {
  id: number;
  name: string;
}

export type RenameResult =
  | { ok: true; account: PlayerAccount }
  | { ok: false; code: NameProblem | "name_offensive" | "name_taken" };

/** Default names start at 4 digits and grow a digit when a size keeps colliding; 9 digits keeps them within 16 characters. */
const DEFAULT_NAME_DIGITS = { first: 4, last: 9 };
const TRIES_PER_SIZE = 10;
/** A deleted account's name_key: unique per account, and no typed name lowercases to it. */
const DELETED_NAME_KEY = (id: number) => `#deleted:${id}`;

export function hashKey(canonicalKey: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(canonicalKey).digest());
}

/** Hosted-build login tokens: 32 random bytes, base64url. */
const TOKEN_BYTES = 32;
const TOKEN_FORM = /^[A-Za-z0-9_-]{43}$/;
/** A host label as a client names it: "itch". */
export const HOST_LABEL = /^[a-z][a-z0-9-]{0,31}$/;
/**
 * How long a replaced token still logs in. Two tabs opening at once, or a
 * token lost before the browser stored it, would otherwise look like a copy.
 */
export const TOKEN_GRACE_MS = 60_000;
/** Replaced tokens are kept this long to recognise a copy, then forgotten. */
const REPLACED_TOKEN_KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/** What a presented token is. */
export type TokenLookup =
  | { state: "current" | "grace"; account: PlayerAccount }
  /** Replaced longer ago than the grace period: someone else has a copy. */
  | { state: "reused"; account: PlayerAccount };

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
  private readonly eraseAccount: StatementSync;
  private readonly deletedIds: StatementSync;
  private readonly accountByNameKey: StatementSync;
  private readonly insertToken: StatementSync;
  private readonly tokenByHash: StatementSync;
  private readonly markTokenReplaced: StatementSync;
  private readonly deleteTokenFamily: StatementSync;
  private readonly deleteAccountHostTokens: StatementSync;
  private readonly deleteAccountTokens: StatementSync;
  private readonly deleteHostTokens: StatementSync;
  private readonly forgetOldTokens: StatementSync;

  /** The store in `<dataDir>/players.db`, created on first use. */
  static open(dataDir: string, isReserved?: PlayerNameReservation): PlayerStore {
    fs.mkdirSync(dataDir, { recursive: true });
    return new PlayerStore(path.join(dataDir, "players.db"), isReserved);
  }

  constructor(
    file: string,
    private readonly isReserved?: PlayerNameReservation,
  ) {
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
    this.insertAccount = this.db.prepare("INSERT INTO players (key_hash, name, name_key) VALUES (?, ?, ?)");
    this.accountByKey = this.db.prepare("SELECT id, name FROM players WHERE key_hash = ?");
    this.accountById = this.db.prepare("SELECT id, name, name_key FROM players WHERE id = ?");
    this.updateName = this.db.prepare("UPDATE players SET name = ?, name_key = ? WHERE id = ?");
    this.eraseAccount = this.db.prepare("UPDATE players SET key_hash = ?, name = ?, name_key = ? WHERE id = ?");
    this.deletedIds = this.db.prepare("SELECT id FROM players WHERE name_key LIKE '#deleted:%'");
    this.accountByNameKey = this.db.prepare("SELECT id, name FROM players WHERE name_key = ?");
    this.insertToken = this.db.prepare(
      "INSERT INTO hosted_tokens (token_hash, account_id, host, family, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    this.tokenByHash = this.db.prepare(
      `SELECT t.account_id, t.host, t.family, t.replaced_at, p.name
         FROM hosted_tokens t JOIN players p ON p.id = t.account_id
        WHERE t.token_hash = ?`,
    );
    this.markTokenReplaced = this.db.prepare(
      "UPDATE hosted_tokens SET replaced_at = ? WHERE token_hash = ? AND replaced_at IS NULL",
    );
    this.deleteTokenFamily = this.db.prepare("DELETE FROM hosted_tokens WHERE family = ?");
    this.deleteAccountHostTokens = this.db.prepare("DELETE FROM hosted_tokens WHERE account_id = ? AND host = ?");
    this.deleteAccountTokens = this.db.prepare("DELETE FROM hosted_tokens WHERE account_id = ?");
    this.deleteHostTokens = this.db.prepare("DELETE FROM hosted_tokens WHERE host = ?");
    this.forgetOldTokens = this.db.prepare(
      "DELETE FROM hosted_tokens WHERE replaced_at IS NOT NULL AND replaced_at < ?",
    );
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
    if (version < 2) {
      // A family is one browser's chain of tokens: each login replaces the last
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS hosted_tokens (
          token_hash   BLOB PRIMARY KEY,
          account_id   INTEGER NOT NULL REFERENCES players(id),
          host         TEXT NOT NULL,
          family       TEXT NOT NULL,
          created_at   INTEGER NOT NULL,
          replaced_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS hosted_tokens_account ON hosted_tokens (account_id, host);
        CREATE INDEX IF NOT EXISTS hosted_tokens_family ON hosted_tokens (family);
        PRAGMA user_version = 2;
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
    return row ? { id: Number(row.id), name: filterPlayerName(String(row.name)) } : null;
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
      const problem = checkPlayerName(name, this.isReserved) ?? (isOffensiveName(name) ? "name_offensive" : null);
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

  /**
   * Delete account `id`, if `pastedKey` is its key. The row stays so results and
   * demos keep pointing at something, but it is renamed DELETED_ACCOUNT_NAME,
   * its name is free for others, and a random hash replaces the key's, so the
   * key never opens anything again. False if the key isn't this account's.
   */
  deleteAccount(id: number, pastedKey: string): boolean {
    const owner = this.findByKey(pastedKey);
    if (!owner || owner.id !== id) return false;
    this.eraseAccount.run(new Uint8Array(randomBytes(32)), DELETED_ACCOUNT_NAME, DELETED_NAME_KEY(id), id);
    this.deleteAccountTokens.run(id);
    return true;
  }

  /**
   * Start a new token chain for account `id` on `host`, replacing every token
   * it has there: logging in with the key logs out the host's other browsers,
   * which is how a player throws out a copied token.
   */
  startTokens(id: number, host: string, now = Date.now()): string {
    this.deleteAccountHostTokens.run(id, host);
    this.forgetOldTokens.run(now - REPLACED_TOKEN_KEPT_MS);
    return this.issueToken(id, host, randomBytes(16).toString("hex"), now);
  }

  /** Which account a token presented for `host` belongs to, and whether it is still good; null if none. */
  findToken(token: string, host: string, now = Date.now()): TokenLookup | null {
    if (!TOKEN_FORM.test(token)) return null;
    const row = this.tokenByHash.get(hashKey(token));
    if (!row || row.host !== host) return null;
    const account = { id: Number(row.account_id), name: filterPlayerName(String(row.name)) };
    if (row.replaced_at === null) return { state: "current", account };
    return now - Number(row.replaced_at) <= TOKEN_GRACE_MS ? { state: "grace", account } : { state: "reused", account };
  }

  /** Replace a good token with the next one in its chain, and return that. Call after findToken. */
  rotateToken(token: string, now = Date.now()): string {
    const hash = hashKey(token);
    const row = this.tokenByHash.get(hash);
    if (!row) throw new Error("No such token");
    this.markTokenReplaced.run(now, hash);
    return this.issueToken(Number(row.account_id), String(row.host), String(row.family), now);
  }

  /** Forget a copied token's whole chain: that browser logs in with the key again. */
  endTokenChain(token: string): void {
    const row = this.tokenByHash.get(hashKey(token));
    if (row) this.deleteTokenFamily.run(String(row.family));
  }

  /** Forget every token for `host`, should that host be compromised. Returns how many went. */
  revokeHostTokens(host: string): number {
    return Number(this.deleteHostTokens.run(host).changes);
  }

  private issueToken(id: number, host: string, family: string, now: number): string {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    this.insertToken.run(hashKey(token), id, host, family, now);
    return token;
  }

  /** Whether an account with this id exists (deleted ones included). */
  exists(id: number): boolean {
    return Number.isSafeInteger(id) && this.accountById.get(id) !== undefined;
  }

  /** An account's current name, or null when there is no such account. */
  nameOf(id: number): string | null {
    if (!Number.isSafeInteger(id)) return null;
    const row = this.accountById.get(id);
    return row ? String(row.name) : null;
  }

  /** The account with this name, regardless of capitals. */
  findByName(name: string): PlayerAccount | null {
    const row = this.accountByNameKey.get(name.toLowerCase());
    return row ? { id: Number(row.id), name: String(row.name) } : null;
  }

  /** Every deleted account's id. */
  deletedAccountIds(): Set<number> {
    return new Set(this.deletedIds.all().map((row) => Number(row.id)));
  }

  close(): void {
    this.db.close();
  }
}

/**
 * FairPlayStore — what the lobby keeps for fair play: each lobby match's
 * per-account counters from its game server (FairPlayReport), player
 * reports, and the sanctions a person decided on.
 *
 * Its own file, `fairplay.db`, beside players.db, so it has its own retention
 * and backups and can be cleared without touching results or ratings.
 *
 * Data rules (the project's security and GDPR review):
 * - Legitimate interest, used for anticheat only.
 * - Aggregates per match, never raw input.
 * - Counters and reports that led to no action are deleted RETENTION_MS after
 *   they were made (prune runs at open and once a day).
 * - What backs a sanction is kept for the sanction plus APPEAL_PERIOD_MS after
 *   it ends, then deleted with it.
 * - Nothing here acts on its own: sanctions are only ever written by a person
 *   (the fair-play CLI), with a reason the player is shown.
 * - Address bans keep a keyed hash of the address, never the address, and
 *   always expire (at most MAX_ADDRESS_BAN_MS).
 * - Deleting an account deletes its counters and reports, except what an
 *   active sanction needs.
 *
 * Node-only, like PlayerStore.
 */

import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { FairPlayReport } from "../engine/server/network/FairPlayReport";

const DAY_MS = 24 * 60 * 60_000;
/** How long counters and reports are kept when nothing came of them. */
export const RETENTION_MS = 90 * DAY_MS;
/** How long a sanction and its evidence are kept after it ends, for an appeal. */
export const APPEAL_PERIOD_MS = 30 * DAY_MS;
/** Longest an address ban may last. */
export const MAX_ADDRESS_BAN_MS = 90 * DAY_MS;
/** Longest a report's reason may be. */
export const MAX_REPORT_REASON = 200;
/** Reports one account may file in REPORT_WINDOW_MS. */
export const REPORT_LIMIT = 10;
export const REPORT_WINDOW_MS = DAY_MS;

/** `ban`: cannot log in. `ranked`: cannot play public (rated) rooms or the queue. */
export type SanctionKind = "ban" | "ranked";

export interface StoredFairPlay {
  matchId: string;
  gametype: string;
  endedAt: number;
  signals: Record<string, number>;
}

export interface Sanction {
  id: number;
  accountId: number;
  kind: SanctionKind;
  reason: string;
  createdAt: number;
  /** Null for no end date. */
  expiresAt: number | null;
  liftedAt: number | null;
  by: string;
}

export interface PlayerReport {
  id: number;
  reporterId: number;
  reportedId: number;
  matchId: string | null;
  reason: string;
  createdAt: number;
  closed: boolean;
}

export type ReportResult = { ok: true; id: number } | { ok: false; code: "invalid" | "rate_limited" | "duplicate" };

/** Accounts with a sanction that is in force or ended within the appeal period, as SQL. */
const SANCTION_HOLDS = `SELECT account_id FROM sanctions
  WHERE COALESCE(lifted_at, expires_at, 9223372036854775807) >= ?`;

function sanctionOf(row: Record<string, unknown>): Sanction {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    kind: String(row.kind) as SanctionKind,
    reason: String(row.reason),
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    liftedAt: row.lifted_at === null ? null : Number(row.lifted_at),
    by: String(row.by),
  };
}

function reportOf(row: Record<string, unknown>): PlayerReport {
  return {
    id: Number(row.id),
    reporterId: Number(row.reporter_id),
    reportedId: Number(row.reported_id),
    matchId: row.match_id === null ? null : String(row.match_id),
    reason: String(row.reason),
    createdAt: Number(row.created_at),
    closed: Number(row.closed) === 1,
  };
}

/** Report text made safe to keep: control characters out, spaces collapsed, capped. */
function cleanReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let cleaned = "";
  for (const ch of raw.slice(0, MAX_REPORT_REASON * 4)) {
    const code = ch.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? " " : ch;
  }
  return cleaned.replace(/ {2,}/g, " ").trim().slice(0, MAX_REPORT_REASON);
}

export class FairPlayStore {
  private readonly db: DatabaseSync;
  private readonly addressKey: Uint8Array;
  private readonly statements: Record<string, StatementSync>;

  /** The store in `<dataDir>/fairplay.db`, created on first use. */
  static open(dataDir: string): FairPlayStore {
    fs.mkdirSync(dataDir, { recursive: true });
    return new FairPlayStore(path.join(dataDir, "fairplay.db"));
  }

  constructor(
    file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS match_signals (
        match_id   TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        gametype   TEXT NOT NULL,
        ended_at   INTEGER NOT NULL,
        signals    TEXT NOT NULL,
        PRIMARY KEY (match_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS match_signals_account ON match_signals (account_id, ended_at);
      CREATE INDEX IF NOT EXISTS match_signals_ended ON match_signals (ended_at);
      CREATE TABLE IF NOT EXISTS sanctions (
        id         INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('ban', 'ranked')),
        reason     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        lifted_at  INTEGER,
        by         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sanctions_account ON sanctions (account_id);
      CREATE TABLE IF NOT EXISTS address_bans (
        address_hash TEXT PRIMARY KEY,
        reason       TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id          INTEGER PRIMARY KEY,
        reporter_id INTEGER NOT NULL,
        reported_id INTEGER NOT NULL,
        match_id    TEXT,
        reason      TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        closed      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS reports_reported ON reports (reported_id);
      CREATE INDEX IF NOT EXISTS reports_reporter ON reports (reporter_id, created_at);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
    `);
    this.addressKey = this.loadAddressKey();
    const prepare = (sql: string) => this.db.prepare(sql);
    this.statements = {
      insertSignals: prepare(
        `INSERT INTO match_signals (match_id, account_id, gametype, ended_at, signals) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(match_id, account_id) DO NOTHING`,
      ),
      selectSignals: prepare(
        "SELECT match_id, gametype, ended_at, signals FROM match_signals WHERE account_id = ? ORDER BY ended_at DESC",
      ),
      pruneSignals: prepare(`DELETE FROM match_signals WHERE ended_at < ? AND account_id NOT IN (${SANCTION_HOLDS})`),
      pruneReports: prepare(`DELETE FROM reports WHERE created_at < ? AND reported_id NOT IN (${SANCTION_HOLDS})`),
      pruneSanctions: prepare("DELETE FROM sanctions WHERE COALESCE(lifted_at, expires_at, 9223372036854775807) < ?"),
      pruneAddressBans: prepare("DELETE FROM address_bans WHERE expires_at <= ?"),
      insertSanction: prepare(
        "INSERT INTO sanctions (account_id, kind, reason, created_at, expires_at, by) VALUES (?, ?, ?, ?, ?, ?)",
      ),
      liftSanction: prepare("UPDATE sanctions SET lifted_at = ? WHERE id = ? AND lifted_at IS NULL"),
      activeSanctions: prepare(
        `SELECT * FROM sanctions WHERE account_id = ? AND lifted_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`,
      ),
      allSanctions: prepare("SELECT * FROM sanctions ORDER BY created_at DESC"),
      bannedAccounts: prepare(
        `SELECT DISTINCT account_id FROM sanctions WHERE kind = 'ban' AND lifted_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
      ),
      upsertAddressBan: prepare(
        `INSERT INTO address_bans (address_hash, reason, created_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(address_hash) DO UPDATE SET reason = excluded.reason, expires_at = excluded.expires_at`,
      ),
      selectAddressBan: prepare(
        "SELECT reason, expires_at FROM address_bans WHERE address_hash = ? AND expires_at > ?",
      ),
      deleteAddressBan: prepare("DELETE FROM address_bans WHERE address_hash = ?"),
      insertReport: prepare(
        "INSERT INTO reports (reporter_id, reported_id, match_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
      ),
      reportsSince: prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at >= ?"),
      duplicateReport: prepare(
        "SELECT 1 FROM reports WHERE reporter_id = ? AND reported_id = ? AND COALESCE(match_id, '') = ? LIMIT 1",
      ),
      openReports: prepare("SELECT * FROM reports WHERE closed = 0 ORDER BY created_at ASC"),
      reportsAbout: prepare("SELECT * FROM reports WHERE reported_id = ? ORDER BY created_at DESC"),
      closeReport: prepare("UPDATE reports SET closed = 1 WHERE id = ?"),
      heldBySanction: prepare(
        `SELECT 1 FROM sanctions WHERE account_id = ? AND lifted_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
      ),
      deleteSignals: prepare("DELETE FROM match_signals WHERE account_id = ?"),
      deleteReportsBy: prepare("DELETE FROM reports WHERE reporter_id = ?"),
      deleteReportsAbout: prepare("DELETE FROM reports WHERE reported_id = ?"),
      deleteSanctions: prepare("DELETE FROM sanctions WHERE account_id = ?"),
    };
    this.prune();
  }

  /** The key address hashes are made with, created once per store. */
  private loadAddressKey(): Uint8Array {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'address_key'").get();
    if (row?.value instanceof Uint8Array) return Uint8Array.from(row.value);
    const key = Uint8Array.from(randomBytes(32));
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('address_key', ?)").run(key);
    return key;
  }

  private addressHash(address: string): string {
    return createHmac("sha256", this.addressKey).update(address.trim().toLowerCase()).digest("hex");
  }

  // ── Counters ───────────────────────────────────────────────

  /** Keep a verified report's counters. A repeated report for the same match changes nothing. */
  recordMatch(report: FairPlayReport): void {
    const endedAt = Math.min(report.endedAt, this.now());
    for (const account of report.accounts) {
      this.statements.insertSignals.run(
        report.matchId,
        account.accountId,
        report.gametype,
        endedAt,
        JSON.stringify(account.signals),
      );
    }
  }

  /** An account's kept counters, newest match first. */
  signalsFor(accountId: number): StoredFairPlay[] {
    return this.statements.selectSignals.all(accountId).map((row) => ({
      matchId: String(row.match_id),
      gametype: String(row.gametype),
      endedAt: Number(row.ended_at),
      signals: JSON.parse(String(row.signals)) as Record<string, number>,
    }));
  }

  // ── Sanctions ──────────────────────────────────────────────

  /**
   * Record a sanction a person decided on. `durationMs` null means until
   * lifted. The reason is shown to the player.
   */
  addSanction(accountId: number, kind: SanctionKind, reason: string, durationMs: number | null, by: string): Sanction {
    const text = reason.trim();
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("Invalid account id");
    if (kind !== "ban" && kind !== "ranked") throw new Error("Invalid sanction kind");
    if (!text) throw new Error("A sanction needs a reason the player is shown");
    if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs <= 0)) throw new Error("Invalid duration");
    const now = this.now();
    const expiresAt = durationMs === null ? null : now + Math.round(durationMs);
    const { lastInsertRowid } = this.statements.insertSanction.run(accountId, kind, text, now, expiresAt, by);
    return {
      id: Number(lastInsertRowid),
      accountId,
      kind,
      reason: text,
      createdAt: now,
      expiresAt,
      liftedAt: null,
      by,
    };
  }

  /** End a sanction now (an appeal was upheld, or it was a mistake). False if it was not in force. */
  liftSanction(id: number): boolean {
    return Number(this.statements.liftSanction.run(this.now(), id).changes) > 0;
  }

  /** The account's sanctions in force now, newest first. */
  activeSanctions(accountId: number): Sanction[] {
    return this.statements.activeSanctions.all(accountId, this.now()).map(sanctionOf);
  }

  /** The ban in force on the account, if any. */
  activeBan(accountId: number): Sanction | null {
    return this.activeSanctions(accountId).find((sanction) => sanction.kind === "ban") ?? null;
  }

  /** The sanction keeping the account out of public rooms: a ban or a ranked restriction. */
  rankedRestriction(accountId: number): Sanction | null {
    return this.activeSanctions(accountId)[0] ?? null;
  }

  /** Every account banned now. */
  bannedAccountIds(): Set<number> {
    return new Set(this.statements.bannedAccounts.all(this.now()).map((row) => Number(row.account_id)));
  }

  /** Every sanction kept, newest first. */
  sanctions(): Sanction[] {
    return this.statements.allSanctions.all().map(sanctionOf);
  }

  /** Refuse logins from an address for `durationMs` (at most MAX_ADDRESS_BAN_MS). */
  banAddress(address: string, reason: string, durationMs: number): void {
    const text = reason.trim();
    if (!address.trim() || !text) throw new Error("An address ban needs an address and a reason");
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_ADDRESS_BAN_MS) {
      throw new Error(`An address ban lasts more than 0 and at most ${MAX_ADDRESS_BAN_MS / DAY_MS} days`);
    }
    const now = this.now();
    this.statements.upsertAddressBan.run(this.addressHash(address), text, now, now + Math.round(durationMs));
  }

  liftAddressBan(address: string): boolean {
    return Number(this.statements.deleteAddressBan.run(this.addressHash(address)).changes) > 0;
  }

  /** The address ban in force on this address, if any. */
  addressBan(address: string): { reason: string; expiresAt: number } | null {
    if (!address) return null;
    const row = this.statements.selectAddressBan.get(this.addressHash(address), this.now());
    return row ? { reason: String(row.reason), expiresAt: Number(row.expires_at) } : null;
  }

  // ── Reports ────────────────────────────────────────────────

  /** A player reports another, optionally about one match. Rate-limited per reporter. */
  addReport(reporterId: number, reportedId: number, matchId: string | null, reason: unknown): ReportResult {
    const text = cleanReason(reason);
    if (
      !Number.isSafeInteger(reporterId) ||
      !Number.isSafeInteger(reportedId) ||
      reporterId === reportedId ||
      reportedId <= 0 ||
      (matchId !== null && (typeof matchId !== "string" || matchId.length > 64))
    )
      return { ok: false, code: "invalid" };
    const now = this.now();
    const recent = Number(this.statements.reportsSince.get(reporterId, now - REPORT_WINDOW_MS)?.n ?? 0);
    if (recent >= REPORT_LIMIT) return { ok: false, code: "rate_limited" };
    if (this.statements.duplicateReport.get(reporterId, reportedId, matchId ?? "")) {
      return { ok: false, code: "duplicate" };
    }
    const { lastInsertRowid } = this.statements.insertReport.run(reporterId, reportedId, matchId, text, now);
    return { ok: true, id: Number(lastInsertRowid) };
  }

  /** Reports nobody has reviewed yet, oldest first. */
  openReports(): PlayerReport[] {
    return this.statements.openReports.all().map(reportOf);
  }

  reportsAbout(accountId: number): PlayerReport[] {
    return this.statements.reportsAbout.all(accountId).map(reportOf);
  }

  closeReport(id: number): boolean {
    return Number(this.statements.closeReport.run(id).changes) > 0;
  }

  // ── Retention ──────────────────────────────────────────────

  /**
   * Delete what the retention rules no longer allow: counters and reports
   * older than RETENTION_MS that back no sanction, sanctions ended more than
   * APPEAL_PERIOD_MS ago, and expired address bans. Returns rows deleted.
   */
  prune(): number {
    const now = this.now();
    const appealCutoff = now - APPEAL_PERIOD_MS;
    let deleted = 0;
    this.db.exec("BEGIN");
    try {
      deleted += Number(this.statements.pruneSignals.run(now - RETENTION_MS, appealCutoff).changes);
      deleted += Number(this.statements.pruneReports.run(now - RETENTION_MS, appealCutoff).changes);
      deleted += Number(this.statements.pruneSanctions.run(appealCutoff).changes);
      deleted += Number(this.statements.pruneAddressBans.run(now).changes);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return deleted;
  }

  /**
   * Forget an account (it was deleted): its counters, the reports it filed
   * and the reports about it. A sanction in force keeps itself, its counters
   * and the reports about it until it ends and its appeal period passes.
   */
  deleteAccount(accountId: number): void {
    this.statements.deleteReportsBy.run(accountId);
    if (this.statements.heldBySanction.get(accountId, this.now())) return;
    this.statements.deleteSignals.run(accountId);
    this.statements.deleteReportsAbout.run(accountId);
    this.statements.deleteSanctions.run(accountId);
  }

  close(): void {
    this.db.close();
  }
}

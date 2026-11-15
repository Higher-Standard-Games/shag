/**
 * CampaignStore — the campaign missions each account has cleared, with its
 * best clear of each.
 *
 * Its own file, `campaign.db`, beside players.db, like settings.db: a clear is
 * written only from a verified match result, and keeping it apart keeps the
 * result and rating files to themselves. Rows are keyed by the account id
 * PlayerStore issued and the mission id from `config/campaign.json`.
 *
 * Node-only, like PlayerStore.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { betterClear } from "./Campaign";
import type { CampaignClear } from "./types";

export class CampaignStore {
  private readonly db: DatabaseSync;
  private readonly selectClears: StatementSync;
  private readonly selectClear: StatementSync;
  private readonly upsertClear: StatementSync;
  private readonly deleteClears: StatementSync;
  private readonly selectCompleted: StatementSync;
  private readonly insertCompleted: StatementSync;
  private readonly deleteCompleted: StatementSync;

  /** The store in `<dataDir>/campaign.db`, created on first use. */
  static open(dataDir: string): CampaignStore {
    fs.mkdirSync(dataDir, { recursive: true });
    return new CampaignStore(path.join(dataDir, "campaign.db"));
  }

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_clears (
        account_id   INTEGER NOT NULL,
        mission_id   TEXT NOT NULL,
        cleared_at   INTEGER NOT NULL,
        best_time_ms INTEGER NOT NULL,
        best_frags   INTEGER NOT NULL,
        PRIMARY KEY (account_id, mission_id)
      );
      CREATE TABLE IF NOT EXISTS campaign_completions (
        account_id   INTEGER PRIMARY KEY,
        completed_at INTEGER NOT NULL
      );
    `);
    this.selectClears = this.db.prepare(
      "SELECT mission_id, cleared_at, best_time_ms, best_frags FROM campaign_clears WHERE account_id = ? ORDER BY cleared_at",
    );
    this.selectClear = this.db.prepare(
      "SELECT cleared_at, best_time_ms, best_frags FROM campaign_clears WHERE account_id = ? AND mission_id = ?",
    );
    this.upsertClear = this.db.prepare(
      `INSERT INTO campaign_clears (account_id, mission_id, cleared_at, best_time_ms, best_frags) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, mission_id) DO UPDATE SET best_time_ms = excluded.best_time_ms, best_frags = excluded.best_frags`,
    );
    this.deleteClears = this.db.prepare("DELETE FROM campaign_clears WHERE account_id = ?");
    this.selectCompleted = this.db.prepare("SELECT completed_at FROM campaign_completions WHERE account_id = ?");
    this.insertCompleted = this.db.prepare(
      "INSERT OR IGNORE INTO campaign_completions (account_id, completed_at) VALUES (?, ?)",
    );
    this.deleteCompleted = this.db.prepare("DELETE FROM campaign_completions WHERE account_id = ?");
  }

  /** The account's cleared missions, first cleared first. */
  clears(accountId: number): CampaignClear[] {
    return this.selectClears.all(accountId).map((row) => ({
      missionId: String(row.mission_id),
      clearedAt: Number(row.cleared_at),
      bestTimeMs: Number(row.best_time_ms),
      bestFrags: Number(row.best_frags),
    }));
  }

  /** Record a winning match of a mission; a replay keeps the first clear's date and the best time and frags. */
  recordClear(accountId: number, missionId: string, timeMs: number, frags: number, now = Date.now()): CampaignClear {
    const row = this.selectClear.get(accountId, missionId);
    const previous = row
      ? { clearedAt: Number(row.cleared_at), bestTimeMs: Number(row.best_time_ms), bestFrags: Number(row.best_frags) }
      : null;
    const best = betterClear(previous, { timeMs: Math.max(0, Math.round(timeMs)), frags: Math.max(0, frags) });
    const clearedAt = previous?.clearedAt ?? now;
    this.upsertClear.run(accountId, missionId, clearedAt, best.bestTimeMs, best.bestFrags);
    return { missionId, clearedAt, ...best };
  }

  /** When the account first finished the whole campaign, or null if it has not. */
  completedAt(accountId: number): number | null {
    const row = this.selectCompleted.get(accountId);
    return row ? Number(row.completed_at) : null;
  }

  /** Mark the whole campaign finished; the first time is the one kept. */
  markCompleted(accountId: number, now = Date.now()): number {
    this.insertCompleted.run(accountId, now);
    return this.completedAt(accountId) ?? now;
  }

  /** Forget the account's progress, for a deleted account. */
  delete(accountId: number): void {
    this.deleteClears.run(accountId);
    this.deleteCompleted.run(accountId);
  }

  close(): void {
    this.db.close();
  }
}

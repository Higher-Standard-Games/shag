/** Private verification context and a child-written outbox, separate from demos. */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AdmissionGrant } from "../engine/server/network/MatchAdmission";
import { type MatchResultReport, verifyMatchResult } from "../engine/server/network/MatchResultReport";
import type { ResultContext } from "./ResultSnapshot";

type Expected = Parameters<typeof verifyMatchResult>[2];
export interface DeliverySummary {
  delivered: number;
  waiting: number;
  rejected: number;
  failed: number;
}

export class ResultDeliveryStore {
  private retryCursor = 0;
  constructor(
    private readonly db: DatabaseSync,
    private readonly databaseFile: string,
    private readonly commit: (report: MatchResultReport, context: ResultContext) => unknown,
    initialize = true,
  ) {
    if (!initialize) return;
    db.exec(`CREATE TABLE IF NOT EXISTS result_delivery (
      match_id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version = 1),
      expected TEXT NOT NULL, secret TEXT NOT NULL, context TEXT NOT NULL,
      closed_at INTEGER
    )`);
    const columns = this.db
      .prepare("PRAGMA table_info(result_delivery)")
      .all()
      .map((row) => String(row.name));
    for (const column of ["closed_at"])
      if (!columns.includes(column)) this.db.exec(`ALTER TABLE result_delivery ADD COLUMN ${column} INTEGER`);
  }

  private outboxFile(matchId: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(matchId) || this.databaseFile === ":memory:")
      throw new Error("Durable result delivery requires a named match and on-disk database");
    const root = path.join(path.dirname(path.resolve(this.databaseFile)), "result-outbox");
    if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink())
      throw new Error("Outbox directory must not be a link");
    return path.join(root, `${matchId}.result`);
  }

  private regularFile(file: string): boolean {
    return fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
  }

  closeMatch(matchId: string, now = Date.now()): void {
    this.db
      .prepare("UPDATE result_delivery SET closed_at = COALESCE(closed_at, ?) WHERE match_id = ?")
      .run(now, matchId);
  }

  prepare(expected: Expected, secret: string, context: ResultContext): string {
    const file = this.outboxFile(expected.matchId);
    if (!secret || expected.admission.matchId !== expected.matchId || !context.startingRoster)
      throw new Error("Incomplete delivery verification context");
    this.db
      .prepare("INSERT INTO result_delivery (match_id, version, expected, secret, context) VALUES (?, 1, ?, ?, ?)")
      .run(expected.matchId, JSON.stringify(expected), secret, JSON.stringify(context));
    return file;
  }

  has(matchId: string): boolean {
    return !!this.db.prepare("SELECT 1 AS present FROM result_delivery WHERE match_id = ?").get(matchId);
  }

  context(matchId: string): ResultContext | null {
    const row = this.db.prepare("SELECT context FROM result_delivery WHERE match_id = ?").get(matchId);
    return row ? (JSON.parse(String(row.context)) as ResultContext) : null;
  }

  markBotReferenceChanged(matchId: string): void {
    if (this.db.prepare("SELECT 1 AS present FROM ranking_results WHERE match_id = ?").get(matchId)) return;
    const context = this.context(matchId);
    if (!context) return;
    context.botReferenceChanged = true;
    this.db.prepare("UPDATE result_delivery SET context = ? WHERE match_id = ?").run(JSON.stringify(context), matchId);
  }

  /** Persist before sending admission to the child: a crash cannot lose a grant it received. */
  appendGrants(matchId: string, grants: AdmissionGrant[]): void {
    const row = this.db.prepare("SELECT expected FROM result_delivery WHERE match_id = ?").get(matchId);
    if (!row) return;
    const expected = JSON.parse(String(row.expected)) as Expected;
    expected.admission.grants.push(...grants);
    this.db
      .prepare("UPDATE result_delivery SET expected = ? WHERE match_id = ?")
      .run(JSON.stringify(expected), matchId);
  }

  /** A prior lobby's bot control session cannot be proved continuous after restart. */
  loseBotControl(): void {
    for (const row of this.db.prepare("SELECT match_id, context FROM result_delivery").all()) {
      if ((JSON.parse(String(row.context)) as ResultContext).bots > 0)
        this.markBotReferenceChanged(String(row.match_id));
    }
  }

  /** Keep failed/rejected files and context for inspection and retry. Never log secrets. */
  retryAll(limit = 100): DeliverySummary {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000) throw new Error("Invalid delivery retry budget");
    const summary: DeliverySummary = { delivered: 0, waiting: 0, rejected: 0, failed: 0 };
    let rows =
      limit === 0
        ? this.db.prepare("SELECT rowid AS delivery_id, * FROM result_delivery ORDER BY rowid").all()
        : this.db
            .prepare("SELECT rowid AS delivery_id, * FROM result_delivery WHERE rowid > ? ORDER BY rowid LIMIT ?")
            .all(this.retryCursor, limit);
    if (!rows.length && limit && this.retryCursor) {
      this.retryCursor = 0;
      rows = this.db.prepare("SELECT rowid AS delivery_id, * FROM result_delivery ORDER BY rowid LIMIT ?").all(limit);
    }
    for (const row of rows) {
      this.retryCursor = Number(row.delivery_id);
      const matchId = String(row.match_id);
      try {
        const file = this.outboxFile(matchId);
        if (!fs.existsSync(file)) {
          if (this.db.prepare("SELECT 1 AS present FROM ranking_results WHERE match_id = ?").get(matchId)) {
            this.db.prepare("DELETE FROM result_delivery WHERE match_id = ?").run(matchId);
            summary.delivered++;
          } else summary.waiting++;
          continue;
        }
        if (!this.regularFile(file) || fs.statSync(file).size > 65536) {
          summary.rejected++;
          continue;
        }
        const report = verifyMatchResult(
          fs.readFileSync(file, "utf8"),
          String(row.secret),
          JSON.parse(String(row.expected)) as Expected,
        );
        if (!report) {
          summary.rejected++;
          continue;
        }
        this.commit(report, JSON.parse(String(row.context)) as ResultContext);
        // Commit precedes acknowledgement; a crash between them replays a duplicate.
        fs.unlinkSync(file);
        this.db.prepare("DELETE FROM result_delivery WHERE match_id = ?").run(matchId);
        summary.delivered++;
      } catch {
        summary.failed++;
      }
    }
    return summary;
  }

  acknowledge(matchId: string): void {
    // Only committed receipts acknowledge a live stdout delivery.
    if (
      !this.has(matchId) ||
      !this.db.prepare("SELECT 1 AS present FROM ranking_results WHERE match_id = ?").get(matchId)
    )
      return;
    const file = this.outboxFile(matchId);
    if (fs.existsSync(file) && !this.regularFile(file)) throw new Error("Outbox report must be a regular file");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    this.db.prepare("DELETE FROM result_delivery WHERE match_id = ?").run(matchId);
  }

  /** Bounded operational read. It never returns manifests, tickets, keys or raw report lines. */
  inspect(offset = 0, limit = 100) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid delivery inspection page");
    const rows = this.db.prepare("SELECT * FROM result_delivery ORDER BY rowid LIMIT ? OFFSET ?").all(limit, offset);
    const entries = rows.map((row) => {
      const matchId = String(row.match_id);
      let fileState: "waiting" | "ready" | "rejected" | "committed" | "error" = "waiting";
      let mode = "unknown",
        map = "unknown",
        startedAt = 0;
      try {
        const expected = JSON.parse(String(row.expected)) as Expected;
        mode = expected.gametype.slice(0, 32);
        map = expected.map.slice(0, 96);
        startedAt = expected.startedAt;
        const file = this.outboxFile(matchId);
        if (this.db.prepare("SELECT 1 AS present FROM ranking_results WHERE match_id = ?").get(matchId))
          fileState = "committed";
        else if (fs.existsSync(file))
          fileState =
            !this.regularFile(file) ||
            fs.statSync(file).size > 65536 ||
            !verifyMatchResult(fs.readFileSync(file, "utf8"), String(row.secret), expected)
              ? "rejected"
              : "ready";
      } catch {
        fileState = "error";
      }
      return {
        matchId,
        mode,
        map,
        startedAt,
        closedAt: row.closed_at === undefined || row.closed_at === null ? null : Number(row.closed_at),
        fileState,
      };
    });
    return {
      total: Number(this.db.prepare("SELECT COUNT(*) AS n FROM result_delivery").get()?.n ?? 0),
      offset,
      entries,
    };
  }

  /** Cleanup defaults to a preview. Unresolved reports and unknown/running children survive. */
  cleanup(olderThanMs: number, apply = false, now = Date.now()) {
    if (!Number.isSafeInteger(olderThanMs) || olderThanMs < 3600000 || !Number.isSafeInteger(now))
      throw new Error("Delivery retention must be at least one hour");
    const cutoff = now - olderThanMs;
    const removedContexts: string[] = [],
      removedFiles: string[] = [];
    const rows = this.db.prepare("SELECT match_id, closed_at FROM result_delivery").all();
    for (const row of rows) {
      const matchId = String(row.match_id),
        file = this.outboxFile(matchId);
      const committed = !!this.db.prepare("SELECT 1 AS present FROM ranking_results WHERE match_id = ?").get(matchId);
      const closed = row.closed_at !== null && row.closed_at !== undefined && Number(row.closed_at) <= cutoff;
      if (!committed && (!closed || fs.existsSync(file))) continue;
      if (committed && fs.existsSync(file)) {
        if (!this.regularFile(file)) continue;
        removedFiles.push(path.basename(file));
        if (apply) fs.unlinkSync(file);
      }
      removedContexts.push(matchId);
      if (apply) this.db.prepare("DELETE FROM result_delivery WHERE match_id = ?").run(matchId);
    }
    const root = path.dirname(this.outboxFile("maintenance"));
    if (fs.existsSync(root))
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const match = /^([A-Za-z0-9_-]{1,64})\.result\.[0-9a-f]{16}\.tmp$/.exec(entry.name);
        if (!match || !entry.isFile() || entry.isSymbolicLink()) continue;
        const context = rows.find((row) => row.match_id === match[1]);
        if (
          context &&
          (context.closed_at === null || context.closed_at === undefined || Number(context.closed_at) > cutoff)
        )
          continue;
        const file = path.join(root, entry.name);
        if (fs.lstatSync(file).mtimeMs > cutoff) continue;
        removedFiles.push(entry.name);
        if (apply) fs.unlinkSync(file);
      }
    return { applied: apply, olderThanMs, removedContexts, removedFiles };
  }
}

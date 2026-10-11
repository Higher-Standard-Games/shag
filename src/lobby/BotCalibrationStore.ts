import type { DatabaseSync } from "node:sqlite";
import { type BotCalibration, canonicalCalibration } from "../shared/ranking/BotRatingReferences";
import { type BotReference, canonicalBotReference } from "../shared/ranking/BotReference";
import { RATING_POLICY, type RatingMode } from "../shared/ranking/RatingPolicy";

/** Shares the journal connection; registry entries are immutable within a policy. */
export class BotCalibrationStore {
  constructor(private readonly db: DatabaseSync) {}
  initialize(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS bot_calibrations (
      id TEXT PRIMARY KEY, policy_version TEXT NOT NULL REFERENCES ranking_policies(version),
      mode TEXT NOT NULL, reference TEXT NOT NULL, artifact TEXT NOT NULL,
      UNIQUE(policy_version, mode, reference)
    )`);
  }
  private exists(): boolean {
    return !!this.db.prepare("SELECT name FROM sqlite_master WHERE name = 'bot_calibrations'").get();
  }
  private read(row: Record<string, unknown>): BotCalibration {
    const value = canonicalCalibration(JSON.parse(String(row.artifact)));
    if (
      JSON.stringify(value) !== row.artifact ||
      value.id !== row.id ||
      value.policyVersion !== row.policy_version ||
      value.mode !== row.mode ||
      JSON.stringify(value.reference) !== row.reference
    )
      throw new Error("Bot calibration registry is inconsistent");
    return value;
  }
  list(): BotCalibration[] {
    return this.exists()
      ? this.db
          .prepare("SELECT * FROM bot_calibrations ORDER BY id")
          .all()
          .map((row) => this.read(row))
      : [];
  }
  get(id: string): BotCalibration | null {
    if (!this.exists()) return null;
    const row = this.db.prepare("SELECT * FROM bot_calibrations WHERE id = ?").get(id);
    return row ? this.read(row) : null;
  }
  resolve(mode: RatingMode, reference: BotReference): BotCalibration | null {
    if (!this.exists()) return null;
    const row = this.db
      .prepare("SELECT * FROM bot_calibrations WHERE policy_version = ? AND mode = ? AND reference = ?")
      .get(RATING_POLICY.version, mode, JSON.stringify(canonicalBotReference(reference)));
    return row ? this.read(row) : null;
  }
  register(input: unknown): "registered" | "duplicate" {
    const value = canonicalCalibration(input);
    const artifact = JSON.stringify(value);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db.prepare("SELECT parameters FROM ranking_policies WHERE version = ?").get(RATING_POLICY.version)
          ?.parameters !== JSON.stringify(RATING_POLICY)
      )
        throw new Error("Calibration policy differs from the pinned implementation");
      const prior = this.get(value.id);
      if (prior) {
        if (JSON.stringify(prior) !== artifact) throw new Error("A calibration version cannot be overwritten");
        this.db.exec("COMMIT");
        return "duplicate";
      }
      if (this.resolve(value.mode, value.reference))
        throw new Error("Changing an active bot reference requires a new rating policy and ordered replay");
      this.db
        .prepare("INSERT INTO bot_calibrations (id, policy_version, mode, reference, artifact) VALUES (?, ?, ?, ?, ?)")
        .run(value.id, value.policyVersion, value.mode, JSON.stringify(value.reference), artifact);
      this.db.exec("COMMIT");
      return "registered";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

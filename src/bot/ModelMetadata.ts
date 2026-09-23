/**
 * What a set of trained weights was trained on, written beside them.
 *
 * Weights alone say nothing about the features they expect. Change
 * `BotInputNormalizer` and an old model keeps loading happily while reading
 * garbage, because a dense layer accepts any vector of the right length and a
 * length is all it checks. This records the shapes and the provenance so the
 * mismatch is caught at load instead of showing up as a bot that plays badly
 * for reasons nobody can trace.
 *
 * TF-10 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { COMBAT_INPUT_SIZE, TACTICAL_INPUT_SIZE } from "./BotInputNormalizer";
import {
  COMBAT_TARGET_SIZE as COMBAT_OUTPUT_SIZE,
  TACTICAL_TARGET_SIZE as TACTICAL_OUTPUT_SIZE,
} from "./CloningTargets";

export const METADATA_FILE = "metadata.json";

export interface ModelMetadata {
  /** Feature vector sizes the weights were trained against. */
  tacticalInputSize: number;
  combatInputSize: number;
  /**
   * Output widths, which fix what each index means. Absent in metadata written
   * before the heads were reshaped.
   */
  tacticalOutputSize?: number;
  combatOutputSize?: number;
  /** When, and by which engine version. */
  trainedAt: string;
  engineVersion?: string;
  /** What it learned from. */
  matches: number;
  trainFrames: number;
  validationFrames: number;
  /** Whether bot players were included rather than people only. */
  includedBots: boolean;
  /** Match ids, so a later run can skip what it already counted. */
  matchIds: string[];
}

export function describeCurrentFeatures(): Pick<
  ModelMetadata,
  "tacticalInputSize" | "combatInputSize" | "tacticalOutputSize" | "combatOutputSize"
> {
  return {
    tacticalInputSize: TACTICAL_INPUT_SIZE,
    combatInputSize: COMBAT_INPUT_SIZE,
    tacticalOutputSize: TACTICAL_OUTPUT_SIZE,
    combatOutputSize: COMBAT_OUTPUT_SIZE,
  };
}

export function writeMetadata(modelDir: string, metadata: ModelMetadata): void {
  fs.mkdirSync(path.resolve(modelDir), { recursive: true });
  fs.writeFileSync(path.join(path.resolve(modelDir), METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`);
}

export function readMetadata(modelDir: string): ModelMetadata | null {
  try {
    const raw = fs.readFileSync(path.join(path.resolve(modelDir), METADATA_FILE), "utf-8");
    return JSON.parse(raw) as ModelMetadata;
  } catch {
    return null;
  }
}

/**
 * Whether weights described by this metadata can be fed today's features.
 *
 * Metadata that is missing is not an error — models trained before this existed
 * have none — but it is worth saying, because it is the case where a mismatch
 * would pass unnoticed.
 */
export function checkCompatibility(metadata: ModelMetadata | null): { ok: boolean; reason?: string } {
  const current = describeCurrentFeatures();
  if (!metadata) {
    return { ok: true, reason: "no metadata beside these weights — the feature vector they expect is unknown" };
  }
  if (metadata.tacticalInputSize !== current.tacticalInputSize) {
    return {
      ok: false,
      reason: `trained on ${metadata.tacticalInputSize} tactical features, this build produces ${current.tacticalInputSize}`,
    };
  }
  if (metadata.combatInputSize !== current.combatInputSize) {
    return {
      ok: false,
      reason: `trained on ${metadata.combatInputSize} combat features, this build produces ${current.combatInputSize}`,
    };
  }
  // An output width is what fixes the meaning of each index. Weights that
  // predict eight numbers read through a five-output map are not wrong by a
  // little: index 0 is a different question entirely.
  if (typeof metadata.tacticalOutputSize === "number" && metadata.tacticalOutputSize !== current.tacticalOutputSize) {
    return {
      ok: false,
      reason: `trained with ${metadata.tacticalOutputSize} tactical outputs, this build reads ${current.tacticalOutputSize}`,
    };
  }
  if (typeof metadata.combatOutputSize === "number" && metadata.combatOutputSize !== current.combatOutputSize) {
    return {
      ok: false,
      reason: `trained with ${metadata.combatOutputSize} combat outputs, this build reads ${current.combatOutputSize}`,
    };
  }
  return { ok: true };
}

/**
 * A corpus of demos, so matches accumulate instead of evaporating.
 *
 * Behaviour cloning wants on the order of 10^5 frames and a three-minute duel
 * yields about 10k per player, so training from one file at a time was never
 * going to teach a bot to play like a person. This gathers every recording in a
 * directory, drops matches already counted, and splits a validation set off the
 * top.
 *
 * **The split is by match, not by frame.** Frames within one match are heavily
 * correlated — the same player, the same map, seconds apart — so a random frame
 * split leaks the answer into the validation set and reports a score that means
 * nothing. Whole matches go one way or the other.
 *
 * TF-10 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TrainingFrame } from "./BotEpisodeRecorder";
import { DemoTrainingExtractor, type ExtractOptions } from "./DemoTrainingExtractor";

export interface CorpusMatch {
  file: string;
  matchId?: string;
  map: string;
  players: number;
  frames: number;
}

export interface CorpusSkip {
  file: string;
  reason: string;
}

export interface Corpus {
  train: TrainingFrame[];
  validation: TrainingFrame[];
  matches: CorpusMatch[];
  skipped: CorpusSkip[];
  get totalFrames(): number;
}

export interface CorpusOptions extends ExtractOptions {
  /** Share of frames held out for validation, by match. Default 0.2. */
  validationFraction?: number;
  /** Match ids already trained on, to skip. */
  seen?: ReadonlySet<string>;
}

/** Every `.shagdemo` in a directory, or the file itself if given one. */
export function listDemoFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return [target];
  return fs
    .readdirSync(target)
    .filter((name) => name.endsWith(".shagdemo"))
    .sort()
    .map((name) => path.join(target, name));
}

/**
 * Read every demo under `target` into one training corpus.
 *
 * A demo that cannot be read, or that yields no frames once bots are dropped,
 * is skipped with a reason rather than failing the run — one bad recording in a
 * directory of fifty should not cost the other forty-nine.
 */
export async function buildCorpus(target: string, options: CorpusOptions = {}): Promise<Corpus> {
  const files = listDemoFiles(target);
  const extractor = new DemoTrainingExtractor();
  const seen = new Set(options.seen ?? []);

  const matches: CorpusMatch[] = [];
  const skipped: CorpusSkip[] = [];
  const perMatchFrames: TrainingFrame[][] = [];

  for (const file of files) {
    try {
      const dataset = await extractor.extractFromFile(file, { includeBots: options.includeBots });
      const matchId = dataset.header.matchId;

      if (matchId && seen.has(matchId)) {
        skipped.push({ file, reason: `already counted (match ${matchId})` });
        continue;
      }
      if (dataset.totalFrames === 0) {
        skipped.push({ file, reason: "no frames from a verified player" });
        continue;
      }
      if (matchId) seen.add(matchId);

      matches.push({
        file,
        matchId,
        map: dataset.header.map,
        players: dataset.players.length,
        frames: dataset.totalFrames,
      });
      perMatchFrames.push(dataset.players.flatMap((player) => player.frames));
    } catch (error) {
      skipped.push({ file, reason: (error as Error).message });
    }
  }

  const { train, validation } = splitByMatch(perMatchFrames, options.validationFraction ?? 0.2);
  return {
    train,
    validation,
    matches,
    skipped,
    get totalFrames() {
      return train.length + validation.length;
    },
  };
}

/**
 * Hold whole matches back for validation until the requested share of frames is
 * covered. With a single match there is nothing to hold back that would not
 * also empty the training set, so it all becomes training data and the caller
 * is told there is no validation.
 */
export function splitByMatch(
  perMatchFrames: readonly TrainingFrame[][],
  validationFraction: number,
): { train: TrainingFrame[]; validation: TrainingFrame[] } {
  const total = perMatchFrames.reduce((sum, frames) => sum + frames.length, 0);
  const wanted = Math.floor(total * Math.max(0, Math.min(1, validationFraction)));

  if (perMatchFrames.length < 2 || wanted === 0) {
    return { train: perMatchFrames.flat(), validation: [] };
  }

  // Smallest matches first, so the held-out share overshoots as little as
  // possible and the training set keeps the biggest recordings.
  const order = perMatchFrames.map((frames, index) => ({ index, size: frames.length })).sort((a, b) => a.size - b.size);

  const held = new Set<number>();
  let heldFrames = 0;
  for (const entry of order) {
    if (held.size === perMatchFrames.length - 1) break; // never hold back everything
    if (heldFrames + entry.size > wanted) continue; // overshooting the share is worse than undershooting it
    held.add(entry.index);
    heldFrames += entry.size;
  }

  // Every match is bigger than the share asked for. Hold the smallest one
  // anyway: a validation set that is larger than requested still measures
  // unseen play, and none at all measures nothing.
  if (held.size === 0) held.add(order[0].index);

  const train: TrainingFrame[] = [];
  const validation: TrainingFrame[] = [];
  perMatchFrames.forEach((frames, index) => {
    (held.has(index) ? validation : train).push(...frames);
  });
  return { train, validation };
}

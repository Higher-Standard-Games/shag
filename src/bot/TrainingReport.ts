/**
 * Saying what a training run achieved, per output, against a floor.
 *
 * A single mean-squared loss over a head is nearly uninformative here. The
 * outputs are different questions — three buttons, a yes/no switch, a slot — and
 * most of them are zero most of the time, so a network that answers "no" to
 * everything scores well and has learned nothing. The floor makes that visible:
 * for each output it is the error of the best answer that ignores the input
 * entirely. Error is mean absolute, so that constant is the column's median, not
 * its mean — for an output that is on one frame in ten, "never" is a better fixed
 * answer than "a tenth", and comparing against the weaker of the two would
 * flatter a network that had learned nothing. An output whose error is not below
 * its floor was not learned.
 *
 * TF-6 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

export interface OutputScore {
  name: string;
  /** Mean absolute error of the network on held-out frames. */
  error: number;
  /** Mean absolute error of the best fixed answer, which is the median. */
  floor: number;
  /** What share of frames this output was on for, as a sanity check. */
  positiveRate: number;
}

/**
 * Score every output column of a head.
 *
 * `predictions` and `targets` are frames × outputs, in the same order. Rows that
 * do not line up are a caller error rather than something to paper over, so a
 * mismatch throws: a report that silently scores the wrong pairs is worse than
 * no report.
 */
export function scoreOutputs(
  names: readonly string[],
  predictions: readonly number[][],
  targets: readonly number[][],
): OutputScore[] {
  if (predictions.length !== targets.length) {
    throw new Error(`scoreOutputs: ${predictions.length} predictions for ${targets.length} targets`);
  }
  if (targets.length === 0) return [];

  const width = names.length;
  const frames = targets.length;
  const scores: OutputScore[] = [];

  for (let column = 0; column < width; column++) {
    const values: number[] = [];
    let error = 0;
    let positives = 0;
    for (let row = 0; row < frames; row++) {
      const target = targets[row][column] ?? 0;
      values.push(target);
      error += Math.abs((predictions[row][column] ?? 0) - target);
      if (target > 0.5) positives++;
    }

    const constant = median(values);
    let floor = 0;
    for (const value of values) floor += Math.abs(constant - value);

    scores.push({
      name: names[column],
      error: error / frames,
      floor: floor / frames,
      positiveRate: positives / frames,
    });
  }

  return scores;
}

/** The value that minimises mean absolute error, which is what a floor needs. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** One line per output: what it scored, and whether that beat ignoring the input. */
export function formatScores(label: string, scores: readonly OutputScore[]): string[] {
  if (scores.length === 0) return [`[Trainer] ${label}: nothing held out to score against`];
  return [
    `[Trainer] ${label} per output (error / floor, lower is better; floor = best fixed answer):`,
    ...scores.map((score) => {
      const verdict = score.error < score.floor ? "learned" : "no better than a fixed answer";
      return (
        `[Trainer]   ${score.name.padEnd(10)} ${score.error.toFixed(4)} / ${score.floor.toFixed(4)}` +
        `  on in ${(score.positiveRate * 100).toFixed(1)}% of frames — ${verdict}`
      );
    }),
  ];
}

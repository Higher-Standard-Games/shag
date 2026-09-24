/**
 * Saying what a training run achieved, per output, against a floor.
 *
 * A single mean-squared loss over a head is nearly uninformative here. The
 * outputs are different questions — three buttons, a yes/no switch, a slot — and
 * most of them are zero most of the time, so a network that answers "no" to
 * everything scores well and has learned nothing. The floor makes that visible:
 * for each output it is the error of the best answer that ignores the input
 * entirely. An output whose error is not below its floor was not learned.
 *
 * Error is squared, because squared error is what both heads are trained on, and
 * what it teaches a sigmoid output to be is a probability: for a button pressed
 * one frame in thirty, the honest answer is "about a thirtieth", not "never".
 * The best fixed answer under squared error is the column's mean, so the floor
 * is its variance. A lazy "never" still loses to it — its error is the pressed
 * share p, the floor p(1 − p) — while a network that has learned *when* the
 * button is pressed beats it. An earlier version scored absolute error against
 * the median, which rewards hard yes-or-no answers and would have called a
 * well-calibrated network useless.
 *
 * TF-6 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

export interface OutputScore {
  name: string;
  /** Mean squared error of the network on held-out frames. */
  error: number;
  /** Mean squared error of the best fixed answer — the column's mean — which is its variance. */
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
    let sum = 0;
    let error = 0;
    let positives = 0;
    for (let row = 0; row < frames; row++) {
      const target = targets[row][column] ?? 0;
      sum += target;
      const miss = (predictions[row][column] ?? 0) - target;
      error += miss * miss;
      if (target > 0.5) positives++;
    }

    const mean = sum / frames;
    let floor = 0;
    for (let row = 0; row < frames; row++) {
      const miss = mean - (targets[row][column] ?? 0);
      floor += miss * miss;
    }

    scores.push({
      name: names[column],
      error: error / frames,
      floor: floor / frames,
      positiveRate: positives / frames,
    });
  }

  return scores;
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

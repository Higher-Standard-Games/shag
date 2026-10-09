/** Babylon 9.17 publishes these engine-frame totals before onEndFrameObservable. */
export interface TimedemoBundleCounters {
  created: number;
  reused: number;
}

export function readTimedemoBundleCounters(value: unknown): TimedemoBundleCounters | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { numBundleCreationNonCompatMode?: unknown; numBundleReuseNonCompatMode?: unknown };
  const created = raw.numBundleCreationNonCompatMode,
    reused = raw.numBundleReuseNonCompatMode;
  if (
    typeof created !== "number" ||
    typeof reused !== "number" ||
    !Number.isSafeInteger(created) ||
    !Number.isSafeInteger(reused) ||
    created < 0 ||
    reused < 0
  )
    return null;
  return { created, reused };
}

/** Missing or inapplicable observations stay null, distinct from genuine zero work. */
export function summarizeTimedemoBundles(samples: readonly { bundles?: TimedemoBundleCounters | null }[]) {
  const values = samples.flatMap((s) => (s.bundles ? [s.bundles] : []));
  if (!values.length) return null;
  const created = values.reduce((total, s) => total + s.created, 0);
  const reused = values.reduce((total, s) => total + s.reused, 0);
  const framesWithCreation = values.filter((s) => s.created > 0).length;
  return {
    sampledFrames: values.length,
    missingFrames: samples.length - values.length,
    created,
    reused,
    createdPerFrame: created / values.length,
    reusedPerFrame: reused / values.length,
    creationSharePercent: created + reused > 0 ? (100 * created) / (created + reused) : null,
    framesWithCreation,
    framesWithCreationPercent: (100 * framesWithCreation) / values.length,
  };
}

/**
 * log — thin leveled logging façade (QA-15 / QA-WO10).
 *
 * The runtime had ~1,700 bare `console.log`s and no levels/tags; a minified
 * production failure had neither breadcrumbs nor a place to hook reporting.
 * This is deliberately minimal: tagged wrappers over the console plus a
 * rate-limited warn for hot paths (per-snapshot / per-frame code that must
 * never spam). Production builds strip `console.log`/`console.debug` as pure
 * (vite esbuild config), so `log.debug`/`log.info` vanish from prod bundles
 * while `log.warn`/`log.error` survive.
 *
 * Bonus safety: because `log.debug`/`log.info` are ordinary (non-pure) function
 * calls, their arguments are always evaluated at the call site — so
 * `log.debug("Net", queue.shift())` keeps the shift() in prod even though the
 * console output is stripped. A bare `console.log(queue.shift())` would have the
 * whole call (and the shift) deleted by the minifier — prefer `log.*` for any
 * log whose argument computes something or has a side effect.
 *
 * Migration is incremental: new code uses `log.*`; existing `console.log`s
 * move over when their file is touched.
 */

const RATE_LIMIT_MS = 5000;
const lastAt = new Map<string, number>();

/** True at most once per key per window. Each level counts separately. */
function due(key: string): boolean {
  const now = Date.now();
  if (now - (lastAt.get(key) ?? 0) < RATE_LIMIT_MS) return false;
  lastAt.set(key, now);
  return true;
}

export const log = {
  /** Verbose diagnostics — stripped from production builds. */
  debug(tag: string, ...args: unknown[]): void {
    console.log(`[${tag}]`, ...args);
  },

  /** Notable but expected events — stripped from production builds. */
  info(tag: string, ...args: unknown[]): void {
    console.log(`[${tag}]`, ...args);
  },

  /** Something is wrong but recoverable. Survives production stripping. */
  warn(tag: string, ...args: unknown[]): void {
    console.warn(`[${tag}]`, ...args);
  },

  /** Failure. Survives production stripping. */
  error(tag: string, ...args: unknown[]): void {
    console.error(`[${tag}]`, ...args);
  },

  /**
   * Warn at most once per tag per 5s — for hot paths (per-snapshot,
   * per-frame) where a persistent fault must be visible but not a firehose.
   */
  warnRateLimited(tag: string, ...args: unknown[]): void {
    if (!due(`warn:${tag}`)) return;
    console.warn(`[${tag}]`, ...args);
  },

  /**
   * Error at most once per tag per 5s — for a failure that repeats every tick
   * or frame, where each occurrence is the same fault and the flood would bury
   * everything else.
   */
  errorRateLimited(tag: string, ...args: unknown[]): void {
    if (!due(`error:${tag}`)) return;
    console.error(`[${tag}]`, ...args);
  },
};

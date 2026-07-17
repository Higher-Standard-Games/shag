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
 * Migration is incremental: new code uses `log.*`; existing `console.log`s
 * move over when their file is touched.
 */

const RATE_LIMIT_MS = 5000;
const lastWarnAt = new Map<string, number>();

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
    const now = Date.now();
    if (now - (lastWarnAt.get(tag) ?? 0) < RATE_LIMIT_MS) return;
    lastWarnAt.set(tag, now);
    console.warn(`[${tag}]`, ...args);
  },
};

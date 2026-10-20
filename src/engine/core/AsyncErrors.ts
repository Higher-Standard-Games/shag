/**
 * Background promises: work started without awaiting it (a lazy chunk, a
 * model load, a playlist fetch). Their failures are logged with a context
 * label instead of surfacing as an anonymous unhandled rejection, and a
 * failed chunk load offers to reload the page (see {@link onChunkLoadError}).
 *
 * Usage:
 *   background(this.loadModel(), "DroppedWeapon");
 *   import("./DamageNumbers").then((m) => m.show(...)).catch(logRejection("DamageNumbers"));
 */

/** True when an error says a lazy chunk could not be fetched or evaluated. */
export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /Failed to fetch dynamically imported module/i.test(message) || // Chromium
    /error loading dynamically imported module/i.test(message) || // Firefox
    /Importing a module script failed/i.test(message) || // Safari
    /Unable to preload CSS/i.test(message) // Vite's CSS preload
  );
}

/** A `.catch` handler that logs the failure under `context`. */
export function logRejection(context: string): (err: unknown) => void {
  return (err: unknown) => {
    if (isChunkLoadError(err)) chunkLoadErrorHandler?.();
    console.error(`[${context}]`, err);
  };
}

/**
 * Run a promise in the background; a failure is logged under `context`.
 * Tolerates a non-promise (a mocked or synchronous stand-in) as well.
 */
export function background(promise: Promise<unknown> | unknown, context: string): void {
  Promise.resolve(promise).catch(logRejection(context));
}

let chunkLoadErrorHandler: (() => void) | null = null;

/**
 * What to do when a lazy chunk fails to load. The browser client registers
 * the "new version available" notice (`installStaleBuildNotice`); servers
 * and tools register nothing and only log.
 */
export function onChunkLoadError(handler: () => void): void {
  chunkLoadErrorHandler = handler;
}

/** Stop waiting for shared asset work without cancelling another consumer's request. */
export function waitForMapAsset<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
    if (signal.aborted) aborted();
  });
}

/** Release owned timers and abort listeners after every terminal outcome. */
export function waitForMapReady(ready: Promise<unknown>, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: boolean, error?: unknown, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      if (failed) reject(error);
      else resolve(value);
    };
    const aborted = () => finish(false, signal.reason, true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal.addEventListener("abort", aborted, { once: true });
    ready.then(
      () => finish(true),
      (error) => finish(false, error, true),
    );
    if (signal.aborted) aborted();
  });
}

export function waitForMapVisibility(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener("visibilitychange", visible);
      signal.removeEventListener("abort", aborted);
    };
    const visible = () => {
      if (!document.hidden) {
        cleanup();
        resolve();
      }
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    document.addEventListener("visibilitychange", visible);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else visible();
  });
}

/** Stop one consumer waiting without cancelling shared work; late rejection is consumed. */
export function waitForAsync<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (failed: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (failed) reject(value);
      else resolve(value as T);
    };
    const aborted = () => finish(true, signal?.reason ?? new Error(`Cancelled: ${stage}`));
    const timer = setTimeout(() => finish(true, new Error(`Preparation timed out: ${stage}`)), timeoutMs);
    signal?.addEventListener("abort", aborted, { once: true });
    work.then(
      (value) => finish(false, value),
      (error: unknown) => finish(true, error),
    );
    if (signal?.aborted) aborted();
  });
}

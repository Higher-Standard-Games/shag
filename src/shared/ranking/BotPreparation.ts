/** One bounded budget shared by the bot service and its lobby control client. */
export const BOT_PREPARATION_TIMEOUT_MS = 60_000;
export const BOT_LOBBY_JOIN_TIMEOUT_MS = 10_000;
export const BOT_INVITE_PREPARATION_TIMEOUT_MS = BOT_PREPARATION_TIMEOUT_MS + BOT_LOBBY_JOIN_TIMEOUT_MS + 5_000;

export function waitForBotPreparation(
  ready: Promise<void>,
  signal?: AbortSignal,
  timeoutMs = BOT_PREPARATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error("Bot preparation cancelled"));
    const timer = setTimeout(() => finish(new Error("Bot model preparation timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    ready.then(
      () => finish(),
      (error) => finish(error instanceof Error ? error : new Error("Bot preparation failed")),
    );
  });
}

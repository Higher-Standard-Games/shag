/** Optional hook installed by scripts/server-memory-preload.mjs. */
export function markServerMemory(stage: string, details: Record<string, unknown> = {}): void {
  const hook = (
    globalThis as typeof globalThis & {
      __shagServerMemory?: (stage: string, details: Record<string, unknown>) => void;
    }
  ).__shagServerMemory;
  hook?.(stage, details);
}

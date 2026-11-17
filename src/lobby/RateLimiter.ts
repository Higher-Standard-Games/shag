/**
 * RateLimiter — at most `limit` events per key within a sliding window, held in
 * memory. The lobby keys it by player address to slow account floods, key
 * guessing and rename spam.
 */
export class RateLimiter {
  private readonly events = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether `key` has used up its events in the current window. */
  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  /** Count an event for `key`. */
  record(key: string): void {
    const events = this.recent(key);
    events.push(this.now());
    this.events.set(key, events);
    this.sweep();
  }

  /** Count an event if `key` still has room, and say whether it did. */
  tryRecord(key: string): boolean {
    if (this.isBlocked(key)) return false;
    this.record(key);
    return true;
  }

  /** Release connection-scoped counters when their socket leaves. */
  forget(key: string): void {
    this.events.delete(key);
  }

  /**
   * Drop keys whose events have all expired, at most once a window. A key is
   * otherwise only pruned when it is asked about again, so every address that
   * ever connected would stay in the map.
   */
  private sweep(): void {
    const now = this.now();
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const since = now - this.windowMs;
    for (const [key, events] of this.events) {
      if (events[events.length - 1] <= since) this.events.delete(key);
    }
  }

  /** How many keys are held; for tests. */
  get size(): number {
    return this.events.size;
  }

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const events = (this.events.get(key) ?? []).filter((t) => t > since);
    if (events.length === 0) this.events.delete(key);
    else this.events.set(key, events);
    return events;
  }
}

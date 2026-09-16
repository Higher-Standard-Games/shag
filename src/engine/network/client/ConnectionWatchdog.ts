/**
 * ConnectionWatchdog — notices when a connected client stops receiving snapshots.
 *
 * A WebSocket can stay open while nothing arrives: neither side sees an error or
 * a close, and the game simply stops. Snapshots arrive many times a second, so a
 * gap of a couple of seconds already means the link is not delivering.
 *
 * A gap the client itself caused says nothing about the connection. A hidden page
 * is throttled, and a blocked main thread (a map build) leaves snapshots queued
 * unread, so the owner excuses such gaps with skipGap().
 */

/** How far a stall has gone: "warn" is a short stall, "notice" one long enough to treat the connection as lost. */
export type StallStage = "warn" | "notice";

export class ConnectionWatchdog {
  private lastDataAt: number | null = null;
  private reported: StallStage | null = null;

  constructor(
    readonly warnAfterMs = 2000,
    readonly noticeAfterMs = 8000,
  ) {}

  /** Begin watching, counting from now. */
  start(now: number): void {
    this.lastDataAt = now;
    this.reported = null;
  }

  /** Stop watching, as on a disconnect. */
  stop(): void {
    this.lastDataAt = null;
    this.reported = null;
  }

  /**
   * Record that data arrived. Returns how long the stall it ends lasted, in ms,
   * when that stall had been reported; otherwise null.
   */
  dataArrived(now: number): number | null {
    if (this.lastDataAt === null) return null;
    const stalledFor = this.reported ? now - this.lastDataAt : null;
    this.lastDataAt = now;
    this.reported = null;
    return stalledFor;
  }

  /**
   * The client was not running until now, so the gap so far is not a stall. A
   * stall already reported stays reported: it was measured while running.
   */
  skipGap(now: number): void {
    if (this.lastDataAt !== null && this.reported === null) this.lastDataAt = now;
  }

  /** The stage a check at `now` newly reaches, at most once each per stall; otherwise null. */
  check(now: number): StallStage | null {
    if (this.lastDataAt === null) return null;
    const silentFor = now - this.lastDataAt;
    if (silentFor >= this.noticeAfterMs && this.reported !== "notice") {
      this.reported = "notice";
      return "notice";
    }
    if (silentFor >= this.warnAfterMs && this.reported === null) {
      this.reported = "warn";
      return "warn";
    }
    return null;
  }

  /** Milliseconds since data last arrived; 0 when not watching. */
  silentFor(now: number): number {
    return this.lastDataAt === null ? 0 : now - this.lastDataAt;
  }
}

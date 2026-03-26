/**
 * ClockSync — NTP-like server time synchronization
 *
 * Computes the offset between the client's Date.now() and the server's Date.now()
 * so that incoming snapshot timestamps can be converted to local time for accurate
 * SnapshotBuffer interpolation.
 *
 * Algorithm (simplified NTP):
 *   Client sends Ping:   { clientSendTime = Date.now() }
 *   Server replies Pong: { clientSendTime, serverTime = Date.now() }
 *   Client receives:     clientRecvTime = Date.now()
 *
 *   RTT = clientRecvTime - clientSendTime
 *   oneWayDelay = RTT / 2
 *   offset = serverTime - clientSendTime - oneWayDelay
 *          = serverTime - (clientSendTime + clientRecvTime) / 2
 *
 * After collecting N samples, we discard the highest-RTT outliers and average the
 * rest for a stable offset. Periodic re-syncs track clock drift.
 */

import { MessageCodec } from "../../network/protocol/MessageCodec";

/** Number of ping samples per sync burst */
const SYNC_BURST_COUNT = 5;

/** Interval between bursts of pings in a sync burst (ms) */
const SYNC_BURST_INTERVAL = 100;

/** Re-sync interval (ms) — send a single ping periodically to track drift */
const RESYNC_INTERVAL = 30_000; // 30 seconds

/** Maximum samples to keep in the rolling window */
const MAX_SAMPLES = 16;

export interface ClockSyncSample {
  offset: number;
  rtt: number;
}

export class ClockSync {
  /** Estimated clock offset: serverTime ≈ Date.now() + offset */
  private _offset: number = 0;

  /** Latest measured round-trip time */
  private _rtt: number = 0;

  /** Whether we have at least one valid sync */
  private _synced: boolean = false;

  /** Rolling sample window */
  private samples: ClockSyncSample[] = [];

  /** Timer for periodic re-sync */
  private resyncTimer: ReturnType<typeof setInterval> | null = null;

  /** How many pings remain in the current sync burst */
  private burstRemaining: number = 0;

  /** Timer for burst spacing */
  private burstTimer: ReturnType<typeof setTimeout> | null = null;

  /** Transport send function — injected so ClockSync has no direct transport dependency */
  private sendFn: ((data: Uint8Array, reliable: boolean) => void) | null = null;

  /**
   * Cached offset between Date.now() and performance.now().
   * Computed once at construction to avoid per-call jitter from
   * Date.now()'s coarse ~1ms resolution vs performance.now()'s sub-ms precision.
   */
  private readonly dateToPerf: number = Date.now() - performance.now();

  // ── Setup ───────────────────────────────────────────────

  /**
   * Provide the transport send function.
   * Must be called before startSync().
   */
  setSendFunction(fn: (data: Uint8Array, reliable: boolean) => void): void {
    this.sendFn = fn;
  }

  /**
   * Kick off an initial sync burst.
   * Call once after connection is established and transport is ready.
   */
  startSync(): void {
    this.startBurst();
    this.scheduleResync();
  }

  /**
   * Stop all timers (call on disconnect).
   */
  stop(): void {
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    if (this.burstTimer) {
      clearTimeout(this.burstTimer);
      this.burstTimer = null;
    }
  }

  // ── Ping / Pong ─────────────────────────────────────────

  /**
   * Send a single ping to the server.
   */
  sendPing(): void {
    if (!this.sendFn) return;

    const now = Date.now();
    const data = MessageCodec.encodePing(now);
    this.sendFn(data, false); // Unreliable — lost pings are just skipped
  }

  /**
   * Process a pong response from the server.
   * Called by the message handler when a Pong message type is received.
   */
  processPong(clientSendTime: number, serverTime: number): void {
    const clientRecvTime = Date.now();
    const rtt = clientRecvTime - clientSendTime;

    // Reject stale / impossible pongs
    if (rtt < 0 || rtt > 5000) return;

    // NTP offset formula: offset = serverTime - midpoint(clientSend, clientRecv)
    const offset = serverTime - (clientSendTime + clientRecvTime) / 2;

    this.samples.push({ offset, rtt });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }

    this._rtt = rtt;
    this.recomputeOffset();

    if (!this._synced) {
      this._synced = true;
    }
  }

  // ── Time Conversion ─────────────────────────────────────

  /**
   * Convert a local Date.now() to estimated server time.
   */
  toServerTime(localTime: number): number {
    return localTime + this._offset;
  }

  /**
   * Convert a server Date.now() timestamp to local performance.now() time.
   *
   * This is what SnapshotBuffer uses for interpolation.
   * SnapshotBuffer.sample() computes renderTime = performance.now() - delay,
   * so snapshot timestamps must also be in performance.now() basis.
   *
   * Conversion: serverDateNow → clientDateNow → clientPerformanceNow
   *   clientDateNow = serverTime - offset
   *   clientPerformanceNow = clientDateNow - (Date.now() - performance.now())
   */
  toLocalTime(serverTime: number): number {
    const clientDateNow = serverTime - this._offset;
    // Convert from Date.now() basis to performance.now() basis
    // Uses cached dateToPerf for stable, jitter-free conversion
    return clientDateNow - this.dateToPerf;
  }

  // ── Getters ─────────────────────────────────────────────

  /** Estimated clock offset in ms (server - local) */
  getOffset(): number {
    return this._offset;
  }

  /** Latest round-trip time in ms */
  getRTT(): number {
    return this._rtt;
  }

  /** True after at least one successful sync */
  isSynced(): boolean {
    return this._synced;
  }

  /** Number of samples in the rolling window */
  getSampleCount(): number {
    return this.samples.length;
  }

  // ── Internal ────────────────────────────────────────────

  /**
   * Start a burst of SYNC_BURST_COUNT pings spaced SYNC_BURST_INTERVAL apart.
   */
  private startBurst(): void {
    this.burstRemaining = SYNC_BURST_COUNT;
    this.sendNextBurstPing();
  }

  private sendNextBurstPing(): void {
    if (this.burstRemaining <= 0) return;

    this.sendPing();
    this.burstRemaining--;

    if (this.burstRemaining > 0) {
      this.burstTimer = setTimeout(() => this.sendNextBurstPing(), SYNC_BURST_INTERVAL);
    }
  }

  /**
   * Schedule periodic re-sync (single ping every RESYNC_INTERVAL).
   */
  private scheduleResync(): void {
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    this.resyncTimer = setInterval(() => {
      this.sendPing();
    }, RESYNC_INTERVAL);
  }

  /**
   * Recompute the offset from collected samples.
   * Strategy: discard the highest-RTT samples (likely congested), average the rest.
   */
  private recomputeOffset(): void {
    if (this.samples.length === 0) return;

    // Sort by RTT ascending — lower RTT = more accurate measurement
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);

    // Keep best 75% of samples (discard worst 25%)
    const keepCount = Math.max(1, Math.ceil(sorted.length * 0.75));
    const best = sorted.slice(0, keepCount);

    // Average the offsets
    const avgOffset = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
    this._offset = avgOffset;

    // Also record best RTT for diagnostics
    this._rtt = sorted[0].rtt;
  }
}

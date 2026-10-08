/**
 * SnapshotBuffer — Time-based interpolation buffer for remote entity rendering
 *
 * Instead of fixed-factor lerp (which is framerate-dependent and jerky),
 * this buffers incoming snapshots with reception timestamps and interpolates
 * at render time between two bracketing snapshots.
 *
 * Architecture (from Q3/Warsow networking):
 * - Each snapshot arrives and is timestamped with local performance.now()
 * - Rendering happens at `now - interpDelay` (delayed to ensure buffer has data)
 * - Between two snapshots, positions/rotations are linearly interpolated
 * - If buffer runs dry, extrapolate using last known velocity
 *
 * The interpDelay auto-adjusts based on snapshot arrival jitter.
 */

import { Cvar } from "../../core/Cvar";

/** Snapshot of a single entity's state at a point in time */
export interface EntitySnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  crouching: boolean;
  sliding: boolean;
  wallJumping: boolean;
  /** Recorded camera offset from the entity origin (0 standing, negative crouched). */
  crouchViewOffset?: number;
  /**
   * Held powerups as a bitmask over POWERUP_KINDS (shared/items/Powerups).
   * Never interpolated — it is stepped, like `crouching`.
   */
  powerupMask?: number;
  /**
   * How deep in liquid: 0 dry, 1 wading, 2 swimming, 3 submerged.
   * Stepped, never interpolated — a fractional water level is not a state.
   */
  waterLevel?: 0 | 1 | 2 | 3;
  /** Attached to a ladder. Stepped like waterLevel, never interpolated. */
  onLadder?: boolean;
}

/** A timestamped snapshot for the entire frame */
export interface BufferedSnapshot {
  /** Local reception time (performance.now()) */
  receiveTime: number;
  /** Server tick number */
  tick: number;
  /** Entity states keyed by entity ID */
  entities: Map<string, EntitySnapshot>;
  /** Server timestamp (Date.now() on server) converted to local time via ClockSync, if available */
  serverLocalTime?: number;
}

/** Interpolated result for a single entity */
export interface InterpolatedEntity {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  crouching: boolean;
  sliding: boolean;
  wallJumping: boolean;
  /** Recorded camera offset from the entity origin (0 standing, negative crouched). */
  crouchViewOffset?: number;
  /**
   * Held powerups as a bitmask over POWERUP_KINDS (shared/items/Powerups).
   * Never interpolated — it is stepped, like `crouching`.
   */
  powerupMask?: number;
  /**
   * How deep in liquid: 0 dry, 1 wading, 2 swimming, 3 submerged.
   * Stepped, never interpolated — a fractional water level is not a state.
   */
  waterLevel?: 0 | 1 | 2 | 3;
  /** Attached to a ladder. Stepped like waterLevel, never interpolated. */
  onLadder?: boolean;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** A snapshot's entity as a sample, into `out` when given, or a new object. */
function copyEntity(entity: EntitySnapshot, out: InterpolatedEntity | null): InterpolatedEntity {
  if (!out) return { ...entity };
  out.x = entity.x;
  out.y = entity.y;
  out.z = entity.z;
  out.yaw = entity.yaw;
  out.vx = entity.vx;
  out.vy = entity.vy;
  out.vz = entity.vz;
  out.grounded = entity.grounded;
  out.crouching = entity.crouching;
  out.sliding = entity.sliding;
  out.wallJumping = entity.wallJumping;
  out.crouchViewOffset = entity.crouchViewOffset;
  out.waterLevel = entity.waterLevel;
  out.onLadder = entity.onLadder;
  out.powerupMask = entity.powerupMask;
  return out;
}

/** Server gravity constant (must match server physics) */
const GRAVITY = -800;

/**
 * How far past the newest snapshot a remote entity may be dead-reckoned.
 *
 * Extrapolation covers a late or dropped snapshot, and it is blind: it projects
 * the last velocity forward with no collision, so every millisecond allowed is
 * millimetres a body may travel through solid geometry before the truth arrives
 * and snaps it back. At run speed 200ms is 64 units — a full player width
 * through a wall — and 180 units off a rocket jump, which is what made remote
 * players drift into walls, sink through floors and warp.
 *
 * One snapshot interval at 30Hz plus a little margin. Past that a body freezes
 * where it was last seen, which reads as a brief stall instead of a player
 * standing inside a wall.
 */
const MAX_EXTRAPOLATION_SEC = 0.06;

/** Safe starting delay for 60Hz snapshots (~3 intervals) until jitter is measured. */
const DEFAULT_INTERP_DELAY_MS = 50;

export class SnapshotBuffer {
  private buffer: BufferedSnapshot[] = [];
  private readonly maxBufferSize = 32;

  /** Base interpolation delay in ms (auto-adjusts based on jitter) */
  private interpDelay: number = DEFAULT_INTERP_DELAY_MS;

  /** Whether CVars have been registered (once globally) */
  private static cvarsRegistered = false;

  /** Register cl_timenudge and cl_interp CVars (idempotent) */
  static registerCVars(): void {
    if (SnapshotBuffer.cvarsRegistered) return;
    SnapshotBuffer.cvarsRegistered = true;

    Cvar.register("cl_timenudge", 0, {
      type: "int",
      min: -100,
      max: 100,
      description: "Render time nudge in ms (-=safer/behind, +=aggressive/ahead)",
    });

    Cvar.register("cl_interp", 0, {
      type: "int",
      min: 0,
      max: 500,
      description: "Manual interpolation delay override in ms (0=auto)",
    });
  }

  /** Adaptive jitter tracking */
  private lastReceiveTime: number = 0;
  private jitterSamples: number[] = [];
  private readonly maxJitterSamples = 20;

  /** The frame beginFrame() started: its render time and bracketing snapshots. */
  private frame: { renderTime: number; before: BufferedSnapshot | null; after: BufferedSnapshot | null } | null = null;
  /** getLatestEntityIds' answer, for the snapshot it was built from. */
  private latestIds: { snapshot: BufferedSnapshot; ids: Set<string> } | null = null;

  /** Highest tick accepted in this session; null before the first push. */
  private lastTick: number | null = null;

  /**
   * Push a new snapshot into the buffer.
   * Call this when a server state update arrives.
   *
   * Arrival order is not server chronology. A tick that is not newer than the
   * newest one already buffered is rejected rather than appended: interpolating
   * between out-of-order samples walks remote bodies backwards, and a duplicate
   * would be read as a zero-length bracket. Ticks belong to one session, so
   * reset() must run at a connection boundary before a lower tick is legal.
   *
   * @param tick Server tick number
   * @param entities Entity snapshot data
   * @param serverLocalTime Optional server timestamp converted to local time via ClockSync
   * @returns whether the snapshot was accepted
   */
  push(tick: number, entities: Map<string, EntitySnapshot>, serverLocalTime?: number): boolean {
    if (this.lastTick !== null && tick <= this.lastTick) return false;
    this.lastTick = tick;
    const now = performance.now();

    // Track jitter for adaptive delay
    if (this.lastReceiveTime > 0) {
      const interval = now - this.lastReceiveTime;
      this.jitterSamples.push(interval);
      if (this.jitterSamples.length > this.maxJitterSamples) {
        this.jitterSamples.shift();
      }
      this.updateInterpDelay();
    }
    this.lastReceiveTime = now;

    this.buffer.push({
      receiveTime: now,
      tick,
      entities,
      serverLocalTime,
    });

    // Evict old snapshots
    while (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
    return true;
  }

  /**
   * Drop everything tied to the previous connection.
   *
   * Entity ids and ticks are only meaningful inside one session, so a reconnect
   * that kept them would bracket a new body against whoever last held its id and
   * would carry the disconnect gap into the jitter window as a lasting interp
   * delay. Call this when a session starts, not when a player respawns.
   */
  reset(): void {
    this.buffer.length = 0;
    this.jitterSamples.length = 0;
    this.lastReceiveTime = 0;
    this.lastTick = null;
    this.interpDelay = DEFAULT_INTERP_DELAY_MS;
  }

  /**
   * Sample interpolated state for a given entity at the current render time.
   * Returns null if entity is not found in any buffered snapshot.
   *
   * @param entityId The entity to interpolate
   * @param clInterpOverride Optional manual interp delay override (ms)
   */
  sample(entityId: string, clInterpOverride?: number): InterpolatedEntity | null {
    if (this.buffer.length === 0) return null;
    const renderTime = this.renderTime(clInterpOverride);
    const { before, after } = this.bracket(renderTime);
    return this.sampleBetween(entityId, renderTime, before, after, null);
  }

  /**
   * Start sampling a frame: the settings, the render time and the two
   * snapshots around it, found once for every entity `sampleInFrame` is asked
   * for instead of once per entity. Every entity is then sampled at the same
   * instant, as the server simulated them, where `sample` reads the clock anew
   * for each.
   */
  beginFrame(): void {
    if (this.buffer.length === 0) {
      this.frame = null;
      return;
    }
    const renderTime = this.renderTime();
    const { before, after } = this.bracket(renderTime);
    this.frame = { renderTime, before, after };
  }

  /**
   * Sample an entity in the frame `beginFrame` started, into `out`, which is
   * returned (null when the entity is not in the buffer). Nothing is
   * allocated, so a caller sampling every player every frame makes no garbage;
   * the caller must not keep `out` past its use, as the next call overwrites it.
   */
  sampleInFrame(entityId: string, out: InterpolatedEntity): InterpolatedEntity | null {
    const frame = this.frame;
    if (!frame) return null;
    return this.sampleBetween(entityId, frame.renderTime, frame.before, frame.after, out);
  }

  private renderTime(clInterpOverride?: number): number {
    const clInterp = Cvar.getNumber("cl_interp");
    const delay = clInterpOverride ?? (clInterp > 0 ? clInterp : this.interpDelay);
    const timenudge = Cvar.getNumber("cl_timenudge");
    return performance.now() - delay + timenudge;
  }

  /** The two snapshots bracketing renderTime (serverLocalTime when available, for more accurate timing). */
  private bracket(renderTime: number): { before: BufferedSnapshot | null; after: BufferedSnapshot | null } {
    let before: BufferedSnapshot | null = null;
    let after: BufferedSnapshot | null = null;

    for (let i = 0; i < this.buffer.length; i++) {
      const snapTime = this.getSnapTime(this.buffer[i]);
      if (snapTime <= renderTime) {
        before = this.buffer[i];
      } else {
        after = this.buffer[i];
        break;
      }
    }
    return { before, after };
  }

  /** Sample between two snapshots, into `out` when given, or a new object. */
  private sampleBetween(
    entityId: string,
    renderTime: number,
    before: BufferedSnapshot | null,
    after: BufferedSnapshot | null,
    out: InterpolatedEntity | null,
  ): InterpolatedEntity | null {
    // Case 1: We have both brackets — interpolate
    if (before && after) {
      const beforeEntity = before.entities.get(entityId);
      const afterEntity = after.entities.get(entityId);

      if (beforeEntity && afterEntity) {
        const range = this.getSnapTime(after) - this.getSnapTime(before);
        const t = range > 0 ? (renderTime - this.getSnapTime(before)) / range : 0;
        return this.lerpEntity(beforeEntity, afterEntity, t, out);
      }

      // Entity exists in only one snapshot — use whichever has it
      if (beforeEntity) return copyEntity(beforeEntity, out);
      if (afterEntity) return copyEntity(afterEntity, out);
      return null;
    }

    // Case 2: renderTime is past all snapshots — extrapolate from last
    if (before && !after) {
      const entity = before.entities.get(entityId);
      if (!entity) return null;

      // Extrapolate using velocity + gravity (capped to prevent flying off)
      const elapsed = Math.min((renderTime - this.getSnapTime(before)) / 1000, MAX_EXTRAPOLATION_SEC);
      // Apply gravity to Y velocity for parabolic arc (not constant velocity)
      const extraY = entity.grounded
        ? entity.y // Grounded: don't extrapolate Y (stay on surface)
        : entity.y + entity.vy * elapsed + 0.5 * GRAVITY * elapsed * elapsed;
      const result = out ?? ({} as InterpolatedEntity);
      result.x = entity.x + entity.vx * elapsed;
      result.y = extraY;
      result.z = entity.z + entity.vz * elapsed;
      result.yaw = entity.yaw;
      result.vx = entity.vx;
      result.vy = entity.grounded ? entity.vy : entity.vy + GRAVITY * elapsed;
      result.vz = entity.vz;
      result.grounded = entity.grounded;
      result.crouching = entity.crouching;
      result.sliding = entity.sliding;
      if (out) {
        // Not carried over by extrapolation, as before frame sampling existed;
        // carrying wallJumping would change the animation, so it is its own change.
        out.wallJumping = undefined as unknown as boolean;
        out.crouchViewOffset = undefined;
      }
      result.waterLevel = entity.waterLevel;
      result.onLadder = entity.onLadder;
      result.powerupMask = entity.powerupMask;
      return result;
    }

    // Case 3: renderTime is before all snapshots — use earliest
    if (!before && after) {
      const entity = after.entities.get(entityId);
      if (!entity) return null;
      return copyEntity(entity, out);
    }

    return null;
  }

  /**
   * Get all entity IDs present in the most recent snapshot.
   */
  getLatestEntityIds(): ReadonlySet<string> {
    if (this.buffer.length === 0) return EMPTY_IDS;
    const latest = this.buffer[this.buffer.length - 1];
    // Built once per snapshot, not once per call: the renderer asks every frame.
    if (this.latestIds?.snapshot !== latest) {
      this.latestIds = { snapshot: latest, ids: new Set(latest.entities.keys()) };
    }
    return this.latestIds.ids;
  }

  /**
   * Get the current interpolation delay in ms.
   */
  getInterpDelay(): number {
    return this.interpDelay;
  }

  /**
   * Get the current number of buffered snapshots.
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Flush stale buffer entries, keeping only the latest snapshot as baseline.
   * Called on tab-return to prevent interpolation through stale data.
   */
  flush(): void {
    if (this.buffer.length > 1) {
      this.buffer = [this.buffer[this.buffer.length - 1]];
    }
    this.jitterSamples = [];
    this.lastReceiveTime = 0;
  }

  // ── Internal ─────────────────────────────────────────────

  /**
   * Get the effective timestamp for a snapshot.
   * Prefers server-synced local time (more accurate) with fallback to receiveTime.
   * Sanity-checks serverLocalTime: if it drifts >500ms from receiveTime,
   * it's likely corrupted by clock conversion issues — fall back to receiveTime.
   */
  private getSnapTime(snap: BufferedSnapshot): number {
    if (snap.serverLocalTime !== undefined) {
      const drift = Math.abs(snap.serverLocalTime - snap.receiveTime);
      if (drift < 500) {
        return snap.serverLocalTime;
      }
      // Drift too large — serverLocalTime is unreliable
    }
    return snap.receiveTime;
  }

  /** Inter-snapshot jump beyond this = teleport: snap instead of streaking across the map. */
  private static readonly TELEPORT_SNAP_DIST = 256;

  private lerpEntity(
    a: EntitySnapshot,
    b: EntitySnapshot,
    t: number,
    out: InterpolatedEntity | null = null,
  ): InterpolatedEntity {
    const clampedT = Math.max(0, Math.min(1, t));

    // Teleport discontinuity: interpolating across a huge inter-snapshot jump
    // would streak the entity across the map. Snap to the newer snapshot
    // instead (same idea as Q3's EF_TELEPORT_BIT no-lerp).
    const jumpSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2;
    if (jumpSq > SnapshotBuffer.TELEPORT_SNAP_DIST * SnapshotBuffer.TELEPORT_SNAP_DIST) {
      return copyEntity(b, out);
    }

    // Lerp position
    const x = a.x + (b.x - a.x) * clampedT;
    const y = a.y + (b.y - a.y) * clampedT;
    const z = a.z + (b.z - a.z) * clampedT;

    // Shortest-path angle interpolation for yaw
    let yawDelta = b.yaw - a.yaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    const yaw = a.yaw + yawDelta * clampedT;

    // Lerp velocity (for animation)
    const vx = a.vx + (b.vx - a.vx) * clampedT;
    const vy = a.vy + (b.vy - a.vy) * clampedT;
    const vz = a.vz + (b.vz - a.vz) * clampedT;

    const near = clampedT < 0.5 ? a : b;
    const result = out ?? ({} as InterpolatedEntity);
    result.x = x;
    result.y = y;
    result.z = z;
    result.yaw = yaw;
    result.vx = vx;
    result.vy = vy;
    result.vz = vz;
    result.grounded = near.grounded;
    result.crouching = near.crouching;
    result.sliding = near.sliding;
    result.wallJumping = near.wallJumping;
    if (out) out.crouchViewOffset = undefined; // not interpolated, as before
    result.waterLevel = near.waterLevel;
    result.onLadder = near.onLadder;
    // Take the NEWER mask rather than the nearer one: a quad expiring or
    // being grabbed should read the moment the server says so.
    result.powerupMask = b.powerupMask ?? a.powerupMask;
    return result;
  }

  /**
   * Auto-adjust interp delay based on observed snapshot jitter.
   * delay = avgInterval + 1 * jitter (tight buffer for competitive play)
   */
  private updateInterpDelay(): void {
    if (this.jitterSamples.length < 3) return;

    const avg = this.jitterSamples.reduce((s, v) => s + v, 0) / this.jitterSamples.length;
    const variance = this.jitterSamples.reduce((s, v) => s + (v - avg) ** 2, 0) / this.jitterSamples.length;
    const stddev = Math.sqrt(variance);

    // Interp delay = 1 snapshot interval + 1 stddev jitter margin
    // Clamped between 16ms (60Hz) and 150ms (high-jitter territory)
    this.interpDelay = Math.max(16, Math.min(150, avg + stddev));
  }
}

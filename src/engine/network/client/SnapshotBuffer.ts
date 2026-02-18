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

import { Cvar } from '../../core/Cvar';

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
}

export class SnapshotBuffer {
    private buffer: BufferedSnapshot[] = [];
    private readonly maxBufferSize = 32;

    /** Base interpolation delay in ms (auto-adjusts based on jitter) */
    private interpDelay: number = 100; // 100ms = safe default for 30Hz snapshots

    /** Whether CVars have been registered (once globally) */
    private static cvarsRegistered = false;

    /** Register cl_timenudge and cl_interp CVars (idempotent) */
    static registerCVars(): void {
        if (SnapshotBuffer.cvarsRegistered) return;
        SnapshotBuffer.cvarsRegistered = true;

        Cvar.register('cl_timenudge', 0, {
            type: 'int',
            min: -100,
            max: 100,
            description: 'Render time nudge in ms (-=safer/behind, +=aggressive/ahead)',
        });

        Cvar.register('cl_interp', 0, {
            type: 'int',
            min: 0,
            max: 500,
            description: 'Manual interpolation delay override in ms (0=auto)',
        });
    }

    /** Adaptive jitter tracking */
    private lastReceiveTime: number = 0;
    private jitterSamples: number[] = [];
    private readonly maxJitterSamples = 20;

    /**
     * Push a new snapshot into the buffer.
     * Call this when a server state update arrives.
     *
     * @param tick Server tick number
     * @param entities Entity snapshot data
     * @param serverLocalTime Optional server timestamp converted to local time via ClockSync
     */
    push(tick: number, entities: Map<string, EntitySnapshot>, serverLocalTime?: number): void {
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

        const clInterp = Cvar.getNumber('cl_interp');
        const delay = clInterpOverride ?? (clInterp > 0 ? clInterp : this.interpDelay);
        const timenudge = Cvar.getNumber('cl_timenudge');
        const renderTime = performance.now() - delay + timenudge;

        // Find the two snapshots bracketing renderTime
        // Use serverLocalTime when available for more accurate timing
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

        // Case 1: We have both brackets — interpolate
        if (before && after) {
            const beforeEntity = before.entities.get(entityId);
            const afterEntity = after.entities.get(entityId);

            if (beforeEntity && afterEntity) {
                const range = this.getSnapTime(after) - this.getSnapTime(before);
                const t = range > 0 ? (renderTime - this.getSnapTime(before)) / range : 0;
                return this.lerpEntity(beforeEntity, afterEntity, t);
            }

            // Entity exists in only one snapshot — use whichever has it
            if (beforeEntity) return { ...beforeEntity };
            if (afterEntity) return { ...afterEntity };
            return null;
        }

        // Case 2: renderTime is past all snapshots — extrapolate from last
        if (before && !after) {
            const entity = before.entities.get(entityId);
            if (!entity) return null;

            // Extrapolate using velocity (capped to prevent flying off)
            const elapsed = Math.min((renderTime - this.getSnapTime(before)) / 1000, 0.2); // Max 200ms extrapolation
            return {
                x: entity.x + entity.vx * elapsed,
                y: entity.y + entity.vy * elapsed,
                z: entity.z + entity.vz * elapsed,
                yaw: entity.yaw,
                vx: entity.vx,
                vy: entity.vy,
                vz: entity.vz,
                grounded: entity.grounded,
            };
        }

        // Case 3: renderTime is before all snapshots — use earliest
        if (!before && after) {
            const entity = after.entities.get(entityId);
            if (!entity) return null;
            return { ...entity };
        }

        return null;
    }

    /**
     * Get all entity IDs present in the most recent snapshot.
     */
    getLatestEntityIds(): Set<string> {
        if (this.buffer.length === 0) return new Set();
        const latest = this.buffer[this.buffer.length - 1];
        return new Set(latest.entities.keys());
    }

    /**
     * Get the current interpolation delay in ms.
     */
    getInterpDelay(): number {
        return this.interpDelay;
    }

    /**
     * Get buffer size for diagnostics.
     */
    getBufferSize(): number {
        return this.buffer.length;
    }

    // ── Internal ─────────────────────────────────────────────

    /**
     * Get the effective timestamp for a snapshot.
     * Prefers server-synced local time (more accurate) with fallback to receiveTime.
     */
    private getSnapTime(snap: BufferedSnapshot): number {
        return snap.serverLocalTime ?? snap.receiveTime;
    }

    private lerpEntity(a: EntitySnapshot, b: EntitySnapshot, t: number): InterpolatedEntity {
        const clampedT = Math.max(0, Math.min(1, t));

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

        return { x, y, z, yaw, vx, vy, vz, grounded: clampedT < 0.5 ? a.grounded : b.grounded };
    }

    /**
     * Auto-adjust interp delay based on observed snapshot jitter.
     * delay = avgInterval + 2 * jitter (provides a safe buffer)
     */
    private updateInterpDelay(): void {
        if (this.jitterSamples.length < 3) return;

        const avg = this.jitterSamples.reduce((s, v) => s + v, 0) / this.jitterSamples.length;
        const variance = this.jitterSamples.reduce((s, v) => s + (v - avg) ** 2, 0) / this.jitterSamples.length;
        const stddev = Math.sqrt(variance);

        // Interp delay = 1 snapshot interval + 2 stddev jitter margin
        // Clamped between 33ms (30Hz) and 200ms (aggressive extrapolation territory)
        this.interpDelay = Math.max(33, Math.min(200, avg + stddev * 2));
    }
}

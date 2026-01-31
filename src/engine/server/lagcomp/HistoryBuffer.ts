/**
 * History Buffer
 * 
 * Circular buffer storing world state snapshots for lag compensation.
 * Allows rewinding the world to any point within the stored history.
 */

import type { WorldState } from '../core/WorldState';
import type { TickNumber } from '../ecs/types';

// ═══════════════════════════════════════════════════════════════════
// HISTORY ENTRY
// ═══════════════════════════════════════════════════════════════════

export interface HistoryEntry {
    tick: TickNumber;
    state: WorldState;
    checksum: number;
}

// ═══════════════════════════════════════════════════════════════════
// HISTORY BUFFER
// ═══════════════════════════════════════════════════════════════════

export class HistoryBuffer {
    private buffer: HistoryEntry[] = [];
    private capacity: number;
    private head: number = 0;
    private count: number = 0;

    constructor(capacityMs: number, tickRateHz: number = 125) {
        // Calculate how many snapshots we need
        this.capacity = Math.ceil((capacityMs / 1000) * tickRateHz);
    }

    /**
     * Store a snapshot in the history
     */
    push(state: WorldState): void {
        const entry: HistoryEntry = {
            tick: state.tick,
            state: state.clone(), // Deep clone for history
            checksum: state.checksum(),
        };

        if (this.count < this.capacity) {
            // Buffer not full yet
            this.buffer.push(entry);
            this.count++;
        } else {
            // Overwrite oldest entry
            this.buffer[this.head] = entry;
        }

        // Advance head
        this.head = (this.head + 1) % this.capacity;
    }

    /**
     * Get state at a specific tick
     * Returns null if tick is not in history
     */
    getStateAtTick(tick: TickNumber): Readonly<WorldState> | null {
        for (let i = 0; i < this.count; i++) {
            const index = (this.head - 1 - i + this.capacity) % this.capacity;
            const entry = this.buffer[index];
            if (entry.tick === tick) {
                return entry.state;
            }
        }
        return null;
    }

    /**
     * Get the closest state to a given tick
     * Prefers earlier ticks if exact match not found
     */
    getClosestState(tick: TickNumber): Readonly<WorldState> | null {
        let closest: HistoryEntry | null = null;
        let closestDist = Infinity;

        for (let i = 0; i < this.count; i++) {
            const index = (this.head - 1 - i + this.capacity) % this.capacity;
            const entry = this.buffer[index];

            const dist = Math.abs((entry.tick as number) - (tick as number));

            // Prefer earlier tick if same distance
            if (dist < closestDist || (dist === closestDist && entry.tick < (closest?.tick ?? Infinity))) {
                closest = entry;
                closestDist = dist;
            }
        }

        return closest?.state ?? null;
    }

    /**
     * Get state interpolated between two ticks
     * For subframe lag compensation
     */
    getInterpolatedState(tick: TickNumber, fraction: number = 0): {
        before: Readonly<WorldState> | null;
        after: Readonly<WorldState> | null;
        fraction: number;
    } {
        let before: HistoryEntry | null = null;
        let after: HistoryEntry | null = null;

        for (let i = 0; i < this.count; i++) {
            const index = (this.head - 1 - i + this.capacity) % this.capacity;
            const entry = this.buffer[index];

            if (entry.tick <= tick) {
                if (!before || entry.tick > before.tick) {
                    before = entry;
                }
            }
            if (entry.tick > tick) {
                if (!after || entry.tick < after.tick) {
                    after = entry;
                }
            }
        }

        return {
            before: before?.state ?? null,
            after: after?.state ?? null,
            fraction,
        };
    }

    /**
     * Get the oldest tick in history
     */
    get oldestTick(): TickNumber | null {
        if (this.count === 0) return null;

        // Find oldest entry
        const oldestIndex = (this.head - this.count + this.capacity) % this.capacity;
        return this.buffer[oldestIndex]?.tick ?? null;
    }

    /**
     * Get the newest tick in history
     */
    get newestTick(): TickNumber | null {
        if (this.count === 0) return null;
        const newestIndex = (this.head - 1 + this.capacity) % this.capacity;
        return this.buffer[newestIndex]?.tick ?? null;
    }

    /**
     * Check if a tick is within the stored history
     */
    containsTick(tick: TickNumber): boolean {
        const oldest = this.oldestTick;
        const newest = this.newestTick;

        if (oldest === null || newest === null) return false;
        return tick >= oldest && tick <= newest;
    }

    /**
     * Get current count of stored snapshots
     */
    get size(): number {
        return this.count;
    }

    /**
     * Get buffer capacity
     */
    get maxSize(): number {
        return this.capacity;
    }

    /**
     * Clear all history
     */
    clear(): void {
        this.buffer = [];
        this.head = 0;
        this.count = 0;
    }
}

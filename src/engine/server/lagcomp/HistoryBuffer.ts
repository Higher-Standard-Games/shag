/**
 * History Buffer (Stub)
 * Circular buffer for storing world state history
 * TODO: Implement in Phase 4
 */

import type { WorldState } from '../core/WorldState';

export class HistoryBuffer {
    private buffer: WorldState[] = [];
    private maxSize: number;

    constructor(maxSize: number = 128) {
        this.maxSize = maxSize;
    }

    /**
     * Add state to buffer
     */
    push(state: WorldState): void {
        this.buffer.push(state);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    /**
     * Get state at specific tick
     */
    getAt(_tick: number): WorldState | undefined {
        // TODO: Implement binary search
        return undefined;
    }

    /**
     * Get buffer size
     */
    get size(): number {
        return this.buffer.length;
    }
}

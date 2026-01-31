/**
 * Subsystem - Base class for simulation subsystems
 * 
 * Subsystems are pure functions that:
 * 1. Take current state + inputs
 * 2. Modify state (via COW getEntityMut)
 * 3. No side effects (no I/O, no randomness without seed)
 */

import type { WorldState } from './WorldState';
import type { TickNumber } from '../ecs/types';

export interface SubsystemConfig {
    /** Subsystem name for debugging */
    name: string;

    /** Priority order (lower = runs first) */
    priority: number;

    /** Tick rate in Hz (0 = every frame) */
    tickRate: number;
}

/**
 * Abstract subsystem base class
 */
export abstract class Subsystem {
    readonly config: SubsystemConfig;

    constructor(config: SubsystemConfig) {
        this.config = config;
    }

    /**
     * Get subsystem name
     */
    get name(): string {
        return this.config.name;
    }

    /**
     * Get subsystem priority
     */
    get priority(): number {
        return this.config.priority;
    }

    /**
     * Get tick rate (Hz)
     */
    get tickRate(): number {
        return this.config.tickRate;
    }

    /**
     * Initialize subsystem (called once at start)
     * Override to set up any initial state
     */
    initialize(_state: WorldState): void {
        // Default: no-op
    }

    /**
     * Update subsystem for one tick
     * 
     * @param state - Current world state (use getEntityMut for writes)
     * @param dt - Delta time in seconds
     * @param tick - Current tick number
     */
    abstract update(state: WorldState, dt: number, tick: TickNumber): void;

    /**
     * Cleanup subsystem (called on shutdown)
     * Override to clean up any resources
     */
    cleanup(): void {
        // Default: no-op
    }
}

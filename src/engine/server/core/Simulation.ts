/**
 * Simulation - Main deterministic simulation loop
 * 
 * Orchestrates subsystems and maintains world state.
 * Pure and deterministic: same inputs always produce same outputs.
 */

import { WorldState } from './WorldState';
import { Subsystem } from './Subsystem';
import type { TickNumber } from '../ecs/types';
import { tickNumber } from '../ecs/types';

export interface SimulationConfig {
    /** Fixed tick duration in milliseconds */
    tickMs: number;
}

const DEFAULT_CONFIG: SimulationConfig = {
    tickMs: 8, // 125 Hz
};

export class Simulation {
    private config: SimulationConfig;
    private subsystems: Subsystem[] = [];
    private state: WorldState;

    constructor(config: Partial<SimulationConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = new WorldState(tickNumber(0));
    }

    // ═══════════════════════════════════════════════════════════════════
    // SUBSYSTEM MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Register a subsystem
     */
    addSubsystem(subsystem: Subsystem): void {
        this.subsystems.push(subsystem);
        // Sort by priority
        this.subsystems.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Get all subsystems
     */
    getSubsystems(): readonly Subsystem[] {
        return this.subsystems;
    }

    /**
     * Initialize all subsystems
     */
    initialize(): void {
        for (const subsystem of this.subsystems) {
            subsystem.initialize(this.state);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STATE ACCESS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Get current world state (read-only)
     */
    getState(): Readonly<WorldState> {
        return this.state;
    }

    /**
     * Get mutable state (for setup/testing)
     */
    getStateMut(): WorldState {
        return this.state;
    }

    /**
     * Get current tick number
     */
    get currentTick(): TickNumber {
        return this.state.tick;
    }

    /**
     * Get tick duration in milliseconds
     */
    get tickMs(): number {
        return this.config.tickMs;
    }

    /**
     * Get tick duration in seconds
     */
    get tickSec(): number {
        return this.config.tickMs / 1000;
    }

    // ═══════════════════════════════════════════════════════════════════
    // SIMULATION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Run one simulation tick
     * 
     * This is the core deterministic function:
     * (state, tick) → new state
     */
    tick(): void {
        const dt = this.tickSec;
        const tickNum = this.state.tick;

        // Create next tick state (COW - shares unmodified entities)
        this.state = this.state.nextTick();

        // Run all subsystems in priority order
        for (const subsystem of this.subsystems) {
            subsystem.update(this.state, dt, tickNum);
        }
    }

    /**
     * Run multiple ticks
     */
    runTicks(count: number): void {
        for (let i = 0; i < count; i++) {
            this.tick();
        }
    }

    /**
     * Run simulation for given duration (in milliseconds)
     * Returns number of ticks run
     */
    runForDuration(durationMs: number): number {
        const tickCount = Math.floor(durationMs / this.config.tickMs);
        this.runTicks(tickCount);
        return tickCount;
    }

    // ═══════════════════════════════════════════════════════════════════
    // DETERMINISM
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Get state checksum for determinism verification
     */
    checksum(): number {
        return this.state.checksum();
    }

    /**
     * Reset simulation to initial state
     */
    reset(): void {
        this.state = new WorldState(tickNumber(0));
        for (const subsystem of this.subsystems) {
            subsystem.initialize(this.state);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Cleanup all subsystems
     */
    cleanup(): void {
        for (const subsystem of this.subsystems) {
            subsystem.cleanup();
        }
    }
}

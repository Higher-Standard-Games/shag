/**
 * TickOrchestrator - Multi-rate tick management
 * 
 * Manages subsystems running at different tick rates using
 * the accumulator pattern for fixed timestep.
 */

import type { TickConfig } from './TickConfig';

export interface TickCallback {
    (dt: number): void;
}

export class TickOrchestrator {
    private config: TickConfig;
    private accumulators: Map<string, number> = new Map();
    private running: boolean = false;
    private intervalId: ReturnType<typeof setInterval> | null = null;

    constructor(config: TickConfig) {
        this.config = config;

        // Initialize accumulators for each subsystem
        for (const [name, hz] of Object.entries(config)) {
            if (hz > 0) {
                this.accumulators.set(name, 0);
            }
        }
    }

    /**
     * Start the tick loop
     */
    start(callback: TickCallback, intervalMs: number = 1): void {
        if (this.running) return;
        this.running = true;

        let lastTime = performance.now();

        const loop = () => {
            if (!this.running) return;

            const now = performance.now();
            const realDt = (now - lastTime) / 1000; // Convert to seconds
            lastTime = now;

            // Call the callback which will handle subsystem updates
            callback(realDt);
        };

        // Use setInterval for consistent timing
        this.intervalId = setInterval(loop, intervalMs);
    }

    /**
     * Stop the tick loop
     */
    stop(): void {
        this.running = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Check if a subsystem should tick this frame
     * Returns number of ticks to run
     */
    shouldTick(subsystem: keyof TickConfig, realDt: number): number {
        const hz = this.config[subsystem];
        if (hz === 0) return 0;

        const tickTime = 1 / hz;
        const current = this.accumulators.get(subsystem) || 0;
        const accumulated = current + realDt;

        // Count how many ticks should run
        let ticks = 0;
        let remaining = accumulated;
        while (remaining >= tickTime) {
            ticks++;
            remaining -= tickTime;
        }

        this.accumulators.set(subsystem, remaining);
        return ticks;
    }

    /**
     * Get tick duration for subsystem (in seconds)
     */
    getTickDuration(subsystem: keyof TickConfig): number {
        const hz = this.config[subsystem];
        return hz > 0 ? 1 / hz : 0;
    }

    /**
     * Reset accumulators
     */
    reset(): void {
        for (const name of this.accumulators.keys()) {
            this.accumulators.set(name, 0);
        }
    }

    /**
     * Check if running
     */
    get isRunning(): boolean {
        return this.running;
    }
}

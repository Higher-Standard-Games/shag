/**
 * ViewportEffect - Base interface for all viewport effects
 *
 * Effects are self-contained processors that take player state and produce
 * camera modifications (ViewportDelta). They can be:
 * - Continuous (update every frame based on movement)
 * - Triggered (activated by events, play out over time)
 */

import type { PlayerState } from './PlayerState';
import type { ViewportDelta } from './ViewportDelta';

export interface ViewportEffect {
    /** Unique identifier for this effect */
    readonly name: string;

    /** Is this effect currently enabled? */
    enabled: boolean;

    /**
     * Called every frame to compute the effect's contribution
     * @param deltaTime Time since last frame in seconds
     * @param state Current player movement state
     * @returns Delta to apply to viewport
     */
    update(deltaTime: number, state: PlayerState): ViewportDelta;

    /**
     * Called to trigger event-based effects (optional)
     * @param event Event name (e.g., 'damage', 'explosion')
     * @param data Event payload
     */
    trigger?(event: string, data: unknown): void;

    /**
     * Reset effect state (e.g., on map change or respawn)
     */
    reset(): void;

    /**
     * Clean up any resources (called when effect is unregistered)
     */
    dispose?(): void;
}

/**
 * Base class for effects with common boilerplate
 */
export abstract class BaseViewportEffect implements ViewportEffect {
    abstract readonly name: string;
    enabled: boolean = true;

    abstract update(deltaTime: number, state: PlayerState): ViewportDelta;

    trigger?(event: string, data: unknown): void;

    reset(): void {
        // Override in subclasses if needed
    }

    dispose(): void {
        // Override in subclasses if needed
    }
}

/**
 * Lag Compensation System (Stub)
 * TODO: Implement in Phase 4
 */

import type { WorldState } from '../core/WorldState';

export interface LagCompensationConfig {
    /** Max rewind time in ms */
    maxRewindMs: number;
    /** Allow defensive abilities to override hits */
    allowAbilityOverride: boolean;
    /** History buffer size in ticks */
    historyBufferSize: number;
}

export const DEFAULT_LAG_COMP_CONFIG: LagCompensationConfig = {
    maxRewindMs: 150,
    allowAbilityOverride: true,
    historyBufferSize: 128,
};

export class LagCompensation {
    private config: LagCompensationConfig;

    constructor(config: LagCompensationConfig = DEFAULT_LAG_COMP_CONFIG) {
        this.config = config;
    }

    /**
     * Record current world state for future rewind
     */
    recordSnapshot(_state: WorldState): void {
        // TODO: Implement in Phase 4
    }

    /**
     * Get config
     */
    getConfig(): LagCompensationConfig {
        return this.config;
    }
}

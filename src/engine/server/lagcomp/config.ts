/**
 * Lag Compensation Configuration
 */

export interface LagCompensationConfig {
    /** Max rewind time in ms */
    maxRewindMs: number;
    /** Allow defensive abilities to override hits */
    allowAbilityOverride: boolean;
    /** History buffer size in ticks */
    historyBufferSize: number;
}

export const CASUAL_CONFIG: LagCompensationConfig = {
    maxRewindMs: 200,
    allowAbilityOverride: true,
    historyBufferSize: 256,
};

export const COMPETITIVE_CONFIG: LagCompensationConfig = {
    maxRewindMs: 100,
    allowAbilityOverride: true,
    historyBufferSize: 128,
};

export const TOURNAMENT_CONFIG: LagCompensationConfig = {
    maxRewindMs: 50,
    allowAbilityOverride: true,
    historyBufferSize: 64,
};

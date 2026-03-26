/**
 * Lag Compensation Configuration
 */

export interface LagCompensationConfig {
  /** Max rewind time in ms */
  maxCompensationMs: number;
  /** Server tick rate in Hz */
  tickRate: number;
  /** Allow defensive abilities to override hits */
  allowAbilityOverride: boolean;
}

export const CASUAL_CONFIG: LagCompensationConfig = {
  maxCompensationMs: 200,
  tickRate: 125,
  allowAbilityOverride: true,
};

export const COMPETITIVE_CONFIG: LagCompensationConfig = {
  maxCompensationMs: 100,
  tickRate: 125,
  allowAbilityOverride: true,
};

export const TOURNAMENT_CONFIG: LagCompensationConfig = {
  maxCompensationMs: 50,
  tickRate: 125,
  allowAbilityOverride: true,
};

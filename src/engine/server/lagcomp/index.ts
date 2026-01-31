/**
 * Lag Compensation module
 */
export { LagCompensation, type Ray, type Capsule, type HitResult } from './LagCompensation';
export { HistoryBuffer, type HistoryEntry } from './HistoryBuffer';
export {
    type LagCompensationConfig,
    CASUAL_CONFIG,
    COMPETITIVE_CONFIG,
    TOURNAMENT_CONFIG,
} from './config';

/**
 * Lag Compensation Configuration
 */

export interface LagCompensationConfig {
  /** Max rewind time in ms */
  maxCompensationMs: number;
  /** Server tick rate in Hz */
  tickRate: number;
}

/**
 * The rewind budget, for every server.
 *
 * 100ms covers the great majority of real connections while keeping the cost
 * paid by the person being shot at — "I was already behind that corner" —
 * bounded. Raising it favours the shooter, lowering it favours the target;
 * there is no setting that is fair to both, so this is a deliberate choice
 * rather than something to tune per match.
 *
 * A server whose tick rate differs spreads over this and overrides `tickRate`:
 * the ms/tick conversion inside LagCompensation depends on it being truthful.
 */
export const LAG_COMPENSATION: LagCompensationConfig = {
  maxCompensationMs: 100,
  tickRate: 125,
};

/**
 * Tick configuration for subsystems
 */

export interface TickConfig {
  /** Physics tick rate (Hz) - Default: 125 */
  physics: number;

  /** Collision tick rate (Hz) - Usually same as physics */
  collision: number;

  /** AI tick rate (Hz) - Default: 20 */
  ai: number;

  /** Network snapshot rate (Hz) - Default: 60 */
  networking: number;

  /** Economy tick rate (Hz) - For RTS, Default: 4 */
  economy: number;

  /** Pathfinding tick rate (Hz) - For RTS, Default: 10 */
  pathfinding: number;
}

/** Default FPS tick configuration */
export const FPS_TICK_CONFIG: TickConfig = {
  physics: 125,
  collision: 125,
  ai: 30,
  networking: 60,
  economy: 0, // Not used
  pathfinding: 0, // Not used
};

/** Default RTS tick configuration */
export const RTS_TICK_CONFIG: TickConfig = {
  physics: 30,
  collision: 30,
  ai: 10,
  networking: 20,
  economy: 4,
  pathfinding: 10,
};

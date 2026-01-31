/**
 * Physics constants (Quake 3 / Warsow inspired)
 */

// ═══════════════════════════════════════════════════════════════════
// MOVEMENT CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Gravity in units/sec² (Q3 default: 800) */
export const GRAVITY = 800;

/** Max ground speed in units/sec (Q3: 320, Warsow: 320) */
export const MAX_GROUND_SPEED = 320;

/** Max air speed for acceleration (Q3: 320) */
export const MAX_AIR_SPEED = 320;

/** Run speed multiplier (when sprint is held) */
export const RUN_MULTIPLIER = 1.5;

/** Ground acceleration (Q3: 10) */
export const GROUND_ACCELERATION = 10;

/** Air acceleration (Q3: 1) */
export const AIR_ACCELERATION = 1;

/** Ground friction (Q3: 6) */
export const GROUND_FRICTION = 6;

/** Stop speed threshold (Q3: 100) */
export const STOP_SPEED = 100;

/** Jump velocity in units/sec (Q3: ~270) */
export const JUMP_VELOCITY = 270;

// ═══════════════════════════════════════════════════════════════════
// PLAYER DIMENSIONS
// ═══════════════════════════════════════════════════════════════════

/** Player bounding box half-width (Q3: 15) */
export const PLAYER_HALF_WIDTH = 15;

/** Player height standing (Q3: 56) */
export const PLAYER_HEIGHT = 56;

/** Player height crouching (Q3: 32) */
export const PLAYER_CROUCH_HEIGHT = 32;

/** Step height for climbing stairs (Q3: 18) */
export const STEP_HEIGHT = 18;

// ═══════════════════════════════════════════════════════════════════
// TICK RATES
// ═══════════════════════════════════════════════════════════════════

/** Default physics tick rate (Hz) */
export const DEFAULT_PHYSICS_TICK_RATE = 125;

/** Default physics tick duration (ms) */
export const DEFAULT_TICK_MS = 1000 / DEFAULT_PHYSICS_TICK_RATE; // 8ms

/** Default network snapshot rate (Hz) */
export const DEFAULT_SNAPSHOT_RATE = 60;

/** Default input send rate (Hz) */
export const DEFAULT_INPUT_RATE = 125;

// ═══════════════════════════════════════════════════════════════════
// COMBAT
// ═══════════════════════════════════════════════════════════════════

/** Base player health */
export const MAX_HEALTH = 100;

/** Max armor */
export const MAX_ARMOR = 100;

/** Respawn time in seconds */
export const RESPAWN_TIME = 3;

// ═══════════════════════════════════════════════════════════════════
// NETWORKING
// ═══════════════════════════════════════════════════════════════════

/** Max lag compensation rewind (ms) */
export const MAX_LAG_COMP_MS = 150;

/** History buffer size (ticks) */
export const HISTORY_BUFFER_SIZE = 128;

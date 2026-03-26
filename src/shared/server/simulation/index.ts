/**
 * Simulation shared types and components
 */

export * from "./components";
// Re-export physics, but exclude GRAVITY from constants to avoid clash
// (types/index.ts exports GRAVITY as AccelerationPerSec2 vector,
//  physics/constants.ts exports GRAVITY as a plain number — both can't coexist)
export {
  AIR_ACCELERATION,
  DEFAULT_INPUT_RATE,
  DEFAULT_PHYSICS_TICK_RATE,
  DEFAULT_SNAPSHOT_RATE,
  DEFAULT_TICK_MS,
  // constants (excluding GRAVITY — use the branded version from types)
  FALLING_GRAVITY_MULTIPLIER,
  GROUND_ACCELERATION,
  GROUND_FRICTION,
  HISTORY_BUFFER_SIZE,
  JUMP_VELOCITY,
  MAX_AIR_SPEED,
  MAX_ARMOR,
  MAX_GROUND_SPEED,
  MAX_HEALTH,
  MAX_LAG_COMP_MS,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  RESPAWN_TIME,
  RUN_MULTIPLIER,
  STEP_HEIGHT,
  STOP_SPEED,
} from "./physics/constants";
export {
  accelerate,
  applyFriction,
  applyGravity,
  applyJump,
  calculateWishDir,
  moveAir,
  moveGround,
  vec3Add,
  vec3Dot,
  // movement functions
  vec3HorizontalLength,
  vec3Normalize,
  vec3Scale,
} from "./physics/movement";
export * from "./types";

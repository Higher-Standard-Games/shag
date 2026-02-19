/**
 * Simulation shared types and components
 */
export * from './types';
export * from './components';
// Re-export physics, but exclude GRAVITY from constants to avoid clash
// (types/index.ts exports GRAVITY as AccelerationPerSec2 vector,
//  physics/constants.ts exports GRAVITY as a plain number — both can't coexist)
export {
    // constants (excluding GRAVITY — use the branded version from types)
    FALLING_GRAVITY_MULTIPLIER,
    MAX_GROUND_SPEED,
    MAX_AIR_SPEED,
    RUN_MULTIPLIER,
    GROUND_ACCELERATION,
    AIR_ACCELERATION,
    GROUND_FRICTION,
    STOP_SPEED,
    JUMP_VELOCITY,
    PLAYER_HALF_WIDTH,
    PLAYER_HEIGHT,
    PLAYER_CROUCH_HEIGHT,
    STEP_HEIGHT,
    DEFAULT_PHYSICS_TICK_RATE,
    DEFAULT_TICK_MS,
    DEFAULT_SNAPSHOT_RATE,
    DEFAULT_INPUT_RATE,
    MAX_HEALTH,
    MAX_ARMOR,
    RESPAWN_TIME,
    MAX_LAG_COMP_MS,
    HISTORY_BUFFER_SIZE,
} from './physics/constants';
export {
    // movement functions
    vec3HorizontalLength,
    vec3Normalize,
    vec3Dot,
    vec3Scale,
    vec3Add,
    applyFriction,
    accelerate,
    moveGround,
    moveAir,
    applyGravity,
    applyJump,
    calculateWishDir,
} from './physics/movement';

/**
 * SpeedConstants - Common speed thresholds for viewport effects
 * 
 * All speed-based effects should use these constants to ensure
 * consistent behavior (FOV, lean, bob intensity, etc.)
 * 
 * The gradient formula is:
 *   speedRatio = (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)
 *   speedRatio = clamp(speedRatio, 0, 1)
 * 
 * This gives:
 *   - 0% effect at BASE_SPEED or below
 *   - 50% effect at 1.5x BASE_SPEED
 *   - 100% effect at 2x BASE_SPEED (MAX_SPEED)
 */

// Base walking speed - effects start above this
export const BASE_SPEED = 320;

// Maximum effect speed - effects max out at 2x base
export const MAX_SPEED = BASE_SPEED * 2;  // 640

/**
 * Calculate a normalized speed ratio for effect scaling
 * Returns 0 at BASE_SPEED, 1 at MAX_SPEED, clamped 0-1
 */
export function getSpeedRatio(horizontalSpeed: number): number {
    if (horizontalSpeed <= BASE_SPEED) return 0;
    if (horizontalSpeed >= MAX_SPEED) return 1;
    return (horizontalSpeed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
}

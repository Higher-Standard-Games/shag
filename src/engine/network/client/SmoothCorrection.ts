/**
 * SmoothCorrection — Smoothly corrects prediction errors instead of jarring snaps.
 *
 * HOW IT WORKS:
 *
 *   1. reconcilePrediction() finds error: we predicted (100, 50, 200) but server says (102, 50, 198)
 *   2. Error = (2, 0, -2). Instead of teleporting 2 units, we store this as "correction needed"
 *   3. Each frame, getCorrection() returns 10% of remaining error and decays the stored amount
 *   4. Over ~10-20 frames, we smoothly drift to the correct position
 *
 * The decay factor (0.1) means each frame we apply 10% of the error and keep 90%.
 * After 10 frames: 0.9^10 ≈ 35% remains. After 20: 0.9^20 ≈ 12% remains.
 * This creates a smooth exponential ease-out curve.
 *
 * WHY NOT JUST SNAP?
 *   Snapping causes visible jitter. Players hate it. Smooth correction is invisible
 *   unless the error is large (> 100 units = teleport/death, then we DO snap).
 */
export class SmoothCorrection {
  private correctionX: number = 0;
  private correctionY: number = 0;
  private correctionZ: number = 0;
  private correctionDecay: number = 0.1; // 10% applied per frame, 90% kept for next

  /**
   * Add a correction offset (difference between predicted and server position)
   */
  addCorrection(dx: number, dy: number, dz: number): void {
    this.correctionX += dx;
    this.correctionY += dy;
    this.correctionZ += dz;
  }

  /**
   * Get current correction WITHOUT side effects.
   * Safe to call multiple times per frame (for camera, rendering, etc.)
   */
  getCorrection(): { x: number; y: number; z: number } {
    return {
      x: this.correctionX * this.correctionDecay,
      y: this.correctionY * this.correctionDecay,
      z: this.correctionZ * this.correctionDecay,
    };
  }

  /**
   * Apply decay to stored correction. Call ONCE per frame in update() loop.
   * This prevents flickering from multiple getCorrection() calls per frame.
   */
  applyDecay(): void {
    // Decay the stored correction
    this.correctionX *= 1 - this.correctionDecay;
    this.correctionY *= 1 - this.correctionDecay;
    this.correctionZ *= 1 - this.correctionDecay;

    // Zero out small corrections to avoid perpetual micro-corrections
    const epsilon = 0.01;
    if (Math.abs(this.correctionX) < epsilon) this.correctionX = 0;
    if (Math.abs(this.correctionY) < epsilon) this.correctionY = 0;
    if (Math.abs(this.correctionZ) < epsilon) this.correctionZ = 0;
  }

  /**
   * Check if there's significant correction remaining
   */
  hasCorrection(): boolean {
    const epsilon = 0.01;
    return (
      Math.abs(this.correctionX) > epsilon ||
      Math.abs(this.correctionY) > epsilon ||
      Math.abs(this.correctionZ) > epsilon
    );
  }

  /**
   * Reset all corrections (for large teleports)
   */
  reset(): void {
    this.correctionX = 0;
    this.correctionY = 0;
    this.correctionZ = 0;
  }
}

/**
 * The view kick of our own shots: the camera jumps up (and a little sideways)
 * on each shot and settles back.
 *
 * Visual only. The controller adds `pitch`/`yaw` to the rendered camera and
 * takes them back out of the angles it sends to the server, so a kick never
 * moves where the next shot goes.
 */
export class ViewKick {
  /** Current offsets in radians; negative pitch is up (Babylon). */
  pitch = 0;
  yaw = 0;
  private recoverRate = 0;

  /**
   * One shot: up by `pitchDegrees`, sideways by `yawDegrees` (signed), settling
   * over about `recoverSeconds`. Kicks stack under fast fire, capped so a long
   * burst shakes rather than climbs.
   */
  kick(pitchDegrees: number, yawDegrees: number, recoverSeconds: number): void {
    const toRadians = Math.PI / 180;
    const maxPitch = Math.max(pitchDegrees * 2.5, 0.5) * toRadians;
    this.pitch = Math.max(-maxPitch, this.pitch - pitchDegrees * toRadians);
    this.yaw += yawDegrees * toRadians;
    // Exponential settle, about 98% gone after recoverSeconds.
    this.recoverRate = 4 / Math.max(0.02, recoverSeconds);
  }

  /** Settle toward zero by `deltaTime` seconds. */
  settle(deltaTime: number): void {
    if (this.pitch === 0 && this.yaw === 0) return;
    const factor = Math.exp(-this.recoverRate * deltaTime);
    this.pitch = Math.abs(this.pitch * factor) < 1e-5 ? 0 : this.pitch * factor;
    this.yaw = Math.abs(this.yaw * factor) < 1e-5 ? 0 : this.yaw * factor;
  }

  reset(): void {
    this.pitch = 0;
    this.yaw = 0;
    this.recoverRate = 0;
  }
}

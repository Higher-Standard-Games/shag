/** Blade charge progress, shake, outline and a smoothly lowered holding pose. */

import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
// Side effect: registers the OutlineRenderer scene component — required for
// mesh.renderOutline (charge outline flash) to draw.
import "@babylonjs/core/Rendering/outlineRenderer";

// ── Public results ──────────────────────────────────────────────────

export interface ChargeShake {
  /** Horizontal shake offset */
  x: number;
  /** Vertical shake offset */
  y: number;
}

// ── Class ───────────────────────────────────────────────────────────

export class WeaponCharge {
  // Charge tracking
  private active = false;
  private startTime = 0;
  progress = 0; // 0-1, public so WeaponViewManager can read
  private poseBlend = 0;
  private poseUpdatedAt: number | undefined;

  // Saved outline state (restored on release)
  private savedOutlineWidth = 0;
  private savedOutlineColor = new Color3(0, 0, 0);
  private savedOutlineEnabled = false;

  /**
   * Update charge effects for the current frame.
   *
   * @param isCharging     Whether the weapon is currently charging
   * @param chargeTime     Total charge time in seconds (from weapon def)
   * @param meshes         Weapon meshes to apply outline to
   * @param unitsOf        World units one unit of a mesh spans; outline widths are in mesh units
   * @param outlineWidth   Current outline width setting
   * @param outlineColor   Current outline color setting
   * @param outlineEnabled Current outline enabled setting
   * @returns Shake offsets and whether outlines need restoring
   */
  update(
    isCharging: boolean,
    chargeTime: number,
    meshes: AbstractMesh[],
    unitsOf: (mesh: AbstractMesh) => number,
    outlineWidth: number,
    outlineColor: Color3,
    outlineEnabled: boolean,
  ): {
    shake: ChargeShake;
    needsOutlineRestore: boolean;
    savedWidth: number;
    savedColor: Color3;
    savedEnabled: boolean;
    pitchOffset: number;
  } {
    const now = performance.now();
    const elapsedPose = this.poseUpdatedAt === undefined ? 0 : Math.max(0, now - this.poseUpdatedAt);
    this.poseUpdatedAt = now;
    const poseTarget = isCharging ? 1 : 0;
    this.poseBlend = poseTarget + (this.poseBlend - poseTarget) * Math.exp(-elapsedPose / 70);
    let shakeX = 0,
      shakeY = 0;
    let needsOutlineRestore = false;

    if (isCharging) {
      if (!this.active) {
        // Just started charging — save current outline state
        this.active = true;
        this.startTime = now;
        this.savedOutlineWidth = outlineWidth;
        this.savedOutlineColor = outlineColor.clone();
        this.savedOutlineEnabled = outlineEnabled;
      }

      // Calculate charge progress (0-1 over chargeTime)
      const chargeMs = chargeTime * 1000;
      const elapsed = now - this.startTime;
      this.progress = Math.min(1.0, elapsed / chargeMs);

      // Shake: sinusoidal noise, intensity scales with charge
      const shakeIntensity = this.progress * 2.5;
      const shakeFreq = 20 + this.progress * 30;
      shakeX = Math.sin(now * 0.001 * shakeFreq) * shakeIntensity;
      shakeY = Math.cos(now * 0.001 * shakeFreq * 1.3) * shakeIntensity * 0.7;

      // Turquoise pulsing outline, in world units: from the normal weapon
      // outline width to four times it at full charge
      const outlineMin = 0.15,
        outlineMax = 0.6;
      const scaledWidth = outlineMin + this.progress * (outlineMax - outlineMin);
      const pulseRate = 4 + this.progress * 8;
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.001 * pulseRate * Math.PI * 2);
      const turquoise = new Color3(0.05 * pulse, 1.0 * pulse, 0.9 * pulse);

      for (const mesh of meshes) {
        mesh.renderOutline = true;
        mesh.outlineWidth = scaledWidth / unitsOf(mesh);
        mesh.outlineColor = turquoise;
      }
    } else if (this.active) {
      // Charge released — signal outline restore needed
      this.active = false;
      this.progress = 0;
      needsOutlineRestore = true;
    }

    return {
      shake: { x: shakeX, y: shakeY },
      needsOutlineRestore,
      savedWidth: this.savedOutlineWidth,
      savedColor: this.savedOutlineColor,
      savedEnabled: this.savedOutlineEnabled,
      pitchOffset: -0.25 * this.poseBlend,
    };
  }

  /** Reset charge state (e.g. on weapon switch). */
  reset(): void {
    this.active = false;
    this.progress = 0;
    this.poseBlend = 0;
    this.poseUpdatedAt = undefined;
  }
}

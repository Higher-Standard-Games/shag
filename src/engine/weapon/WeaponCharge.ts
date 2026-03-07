/**
 * WeaponCharge — Blade/melee weapon charge-up effects.
 *
 * Extracted from WeaponViewManager to keep charge shake and outline
 * logic self-contained.
 *
 * Manages:
 *   - Charge progress tracking (0 → 1 over chargeTime)
 *   - Sinusoidal weapon shake (intensity scales with charge)
 *   - Red pulsing outline on weapon meshes during charge
 *   - Outline state save/restore on charge start/end
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

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
    progress = 0;  // 0-1, public so WeaponViewManager can read

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
     * @param rootScaleX     Root node X scale (for outline width normalisation)
     * @param outlineWidth   Current outline width setting
     * @param outlineColor   Current outline color setting
     * @param outlineEnabled Current outline enabled setting
     * @returns Shake offsets and whether outlines need restoring
     */
    update(
        isCharging: boolean,
        chargeTime: number,
        meshes: AbstractMesh[],
        rootScaleX: number,
        outlineWidth: number,
        outlineColor: Color3,
        outlineEnabled: boolean,
    ): { shake: ChargeShake; needsOutlineRestore: boolean; savedWidth: number; savedColor: Color3; savedEnabled: boolean } {
        let shakeX = 0, shakeY = 0;
        let needsOutlineRestore = false;

        if (isCharging) {
            const now = performance.now();

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

            // Red pulsing outline
            const outlineMin = 0.3, outlineMax = 0.8;
            const scaledWidth = outlineMin + this.progress * (outlineMax - outlineMin);
            const scale = rootScaleX || 1;
            const pulseRate = 4 + this.progress * 8;
            const pulse = 0.6 + 0.4 * Math.sin(now * 0.001 * pulseRate * Math.PI * 2);
            const red = new Color3(1.0 * pulse, 0.1 * pulse, 0.05 * pulse);

            for (const mesh of meshes) {
                mesh.renderOutline = true;
                mesh.outlineWidth = scaledWidth / scale;
                mesh.outlineColor = red;
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
        };
    }

    /** Reset charge state (e.g. on weapon switch). */
    reset(): void {
        this.active = false;
        this.progress = 0;
    }
}

/**
 * SpeedFOVEffect - FOV widens at high speeds
 *
 * Creates a sense of velocity by increasing FOV proportionally
 * above a base speed threshold. Common in racing and fast-paced games.
 *
 * Cvars:
 * - cl_speedfov: Max FOV increase (multiplier, e.g., 0.15 = +15%)
 * - cl_speedfovspeed: FOV interpolation speed
 */

import { Cvar } from '../../core/Cvar';
import { BaseViewportEffect } from '../ViewportEffect';
import type { PlayerState } from '../PlayerState';
import { ViewportDelta, createNeutralDelta } from '../ViewportDelta';

export class SpeedFOVEffect extends BaseViewportEffect {
    readonly name = 'speedfov';

    // Current FOV multiplier (smoothed)
    private currentFOV: number = 1.0;

    // Wall jump FOV state
    private wasWallJumping: boolean = false;
    private wallJumpBurstTime: number = 0;

    constructor() {
        super();
        this.registerCvars();
    }

    private registerCvars(): void {
        if (!Cvar.exists('cl_speedfov')) {
            Cvar.register('cl_speedfov', 0.38, {
                type: 'float',
                min: 0,
                max: 0.5,
                description: 'Max FOV increase at speed (multiplier)',
                persist: true,
            });
        }

        if (!Cvar.exists('cl_speedfovspeed')) {
            Cvar.register('cl_speedfovspeed', 5, {
                type: 'float',
                min: 1,
                max: 15,
                description: 'FOV interpolation speed',
                persist: true,
            });
        }
    }

    update(deltaTime: number, state: PlayerState): ViewportDelta {
        const delta = createNeutralDelta();

        const maxFOVIncrease = Cvar.getNumber('cl_speedfov') ?? 0.15;
        const fovSpeed = Cvar.getNumber('cl_speedfovspeed') ?? 5;

        // Skip if no FOV effect configured
        if (maxFOVIncrease === 0) {
            this.currentFOV = 1.0;
            return delta;
        }

        // === WALL JUMP FOV EFFECT ===
        // Charging: squeeze FOV in (-10%)
        // Just pushed: burst FOV out (+20% momentarily)
        const wallState = state.wallJumpState ?? 'none';

        if (wallState === 'charging') {
            // Squeeze in during charge - coiling up
            const targetFOV = 0.90;  // -10% FOV
            const lerpFactor = Math.min(1, deltaTime * 8);  // Fast squeeze
            this.currentFOV = this.currentFOV + (targetFOV - this.currentFOV) * lerpFactor;
            this.wasWallJumping = true;
            delta.fovMultiplier = this.currentFOV;
            return delta;
        } else if (this.wasWallJumping && wallState === 'none') {
            // Just released from wall jump - burst effect!
            this.wallJumpBurstTime = 0.2;  // 0.2s burst duration
            this.wasWallJumping = false;
        }

        // Handle wall jump burst decay
        if (this.wallJumpBurstTime > 0) {
            this.wallJumpBurstTime -= deltaTime;
            // Burst: +20% FOV, decaying quickly
            const burstRatio = Math.max(0, this.wallJumpBurstTime / 0.2);
            const burstFOV = 1.0 + 0.20 * burstRatio;  // +20% at start, decays to normal
            const lerpFactor = Math.min(1, deltaTime * 12);  // Fast transition
            this.currentFOV = this.currentFOV + (burstFOV - this.currentFOV) * lerpFactor;
            delta.fovMultiplier = this.currentFOV;
            return delta;
        }

        // === NORMAL SPEED-BASED FOV ===
        // SpeedFOV uses extended range: starts at 280, maxes at 800
        // This gives more FOV increase at high bunny hop speeds
        const BASE = 280;
        const MAX = 800;  // Extended beyond other effects for dramatic high-speed feel
        const speed = state.horizontalSpeed;
        let speedRatio = 0;
        if (speed > BASE) {
            speedRatio = Math.min(1, (speed - BASE) / (MAX - BASE));
        }

        // Target FOV multiplier
        const targetFOV = 1.0 + speedRatio * maxFOVIncrease;

        // Smooth interpolation
        const lerpFactor = Math.min(1, deltaTime * fovSpeed);
        this.currentFOV = this.currentFOV + (targetFOV - this.currentFOV) * lerpFactor;

        delta.fovMultiplier = this.currentFOV;

        return delta;
    }

    reset(): void {
        this.currentFOV = 1.0;
    }
}

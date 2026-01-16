/**
 * SpeedFOVEffect - FOV widens at high speeds
 *
 * Creates a sense of velocity by increasing FOV proportionally
 * above a base speed threshold. Common in racing and fast-paced games.
 *
 * Cvars:
 * - cg_speedfov: Max FOV increase (multiplier, e.g., 0.15 = +15%)
 * - cg_speedfovspeed: FOV interpolation speed
 */

import { Cvar } from '../../core/Cvar';
import { BaseViewportEffect } from '../ViewportEffect';
import type { PlayerState } from '../PlayerState';
import { ViewportDelta, createNeutralDelta } from '../ViewportDelta';

export class SpeedFOVEffect extends BaseViewportEffect {
    readonly name = 'speedfov';

    // Current FOV multiplier (smoothed)
    private currentFOV: number = 1.0;

    constructor() {
        super();
        this.registerCvars();
    }

    private registerCvars(): void {
        if (!Cvar.exists('cg_speedfov')) {
            Cvar.register('cg_speedfov', 0.25, {
                type: 'float',
                min: 0,
                max: 0.5,
                description: 'Max FOV increase at speed (multiplier)',
                persist: true,
            });
        }

        if (!Cvar.exists('cg_speedfovspeed')) {
            Cvar.register('cg_speedfovspeed', 5, {
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

        const maxFOVIncrease = Cvar.getNumber('cg_speedfov') ?? 0.15;
        const fovSpeed = Cvar.getNumber('cg_speedfovspeed') ?? 5;

        // Skip if no FOV effect configured
        if (maxFOVIncrease === 0) {
            this.currentFOV = 1.0;
            return delta;
        }

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

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
import { getSpeedRatio } from '../SpeedConstants';

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
            Cvar.register('cg_speedfov', 0.15, {
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

        // Calculate speed ratio using shared gradient (0 at base, 1 at 2x base)
        const speedRatio = getSpeedRatio(state.horizontalSpeed);

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

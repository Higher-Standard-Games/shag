/**
 * WalkBobEffect - Realistic view bobbing while moving
 *
 * Creates a vertical sine wave (up/down) synced to footstep cycle,
 * with horizontal sway and forward lean when running.
 * 
 * Features:
 * - Vertical bob (up/down) synced to footsteps
 * - Horizontal sway (left/right) for realistic running
 * - Forward lean (pitch down) when sprinting - like a cheetah!
 * - Speed-based frequency matching stride
 *
 * Cvars:
 * - cg_bob: Enable view bobbing (0/1)
 * - cg_bobamplitude: Vertical bob strength (units)
 * - cg_bobfrequency: Bob cycle speed base
 * - cg_bobroll: Roll tilt during bob (degrees)
 * - cg_boblean: Forward lean when running (degrees)
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Cvar } from '../../core/Cvar';
import { BaseViewportEffect } from '../ViewportEffect';
import type { PlayerState } from '../PlayerState';
import { ViewportDelta, createNeutralDelta } from '../ViewportDelta';
import { BASE_SPEED, getSpeedRatio } from '../SpeedConstants';

export class WalkBobEffect extends BaseViewportEffect {
    readonly name = 'walkbob';

    // Bob cycle accumulator (increases with distance traveled)
    private bobCycle: number = 0;
    // Current forward lean (smoothed)
    private currentLean: number = 0;

    constructor() {
        super();
        this.registerCvars();
    }

    private registerCvars(): void {
        if (!Cvar.exists('cg_bob')) {
            Cvar.register('cg_bob', 1, {
                type: 'int',
                min: 0,
                max: 1,
                description: 'Enable view bobbing while walking',
                persist: true,
            });
        }

        if (!Cvar.exists('cg_bobamplitude')) {
            Cvar.register('cg_bobamplitude', 1.0, {
                type: 'float',
                min: 0,
                max: 5,
                description: 'Vertical bob strength (units)',
                persist: true,
            });
        }

        if (!Cvar.exists('cg_bobfrequency')) {
            Cvar.register('cg_bobfrequency', 0.028, {
                type: 'float',
                min: 0.01,
                max: 0.06,
                description: 'Bob cycle speed - higher = faster footsteps',
                persist: true,
            });
        }

        if (!Cvar.exists('cg_bobroll')) {
            Cvar.register('cg_bobroll', 0.35, {
                type: 'float',
                min: 0,
                max: 2,
                description: 'Roll tilt during bob (degrees)',
                persist: true,
            });
        }

        if (!Cvar.exists('cg_boblean')) {
            Cvar.register('cg_boblean', 1.0, {
                type: 'float',
                min: 0,
                max: 5,
                description: 'Forward lean when running fast (degrees)',
                persist: true,
            });
        }
    }

    update(deltaTime: number, state: PlayerState): ViewportDelta {
        const delta = createNeutralDelta();

        // Check if bobbing is enabled
        const bobEnabled = Cvar.getNumber('cg_bob') !== 0;
        if (!bobEnabled) return delta;

        // Only bob when grounded and moving
        if (!state.isGrounded || state.horizontalSpeed < 10) {
            // Smoothly decay bob cycle and lean when stopping
            this.bobCycle *= 0.9;
            this.currentLean *= 0.9;
            return delta;
        }

        // Get cvar values
        const amplitude = Cvar.getNumber('cg_bobamplitude') ?? 1.5;
        const frequency = Cvar.getNumber('cg_bobfrequency') ?? 0.015;
        const rollAmount = Cvar.getNumber('cg_bobroll') ?? 0.5;
        const leanAmount = Cvar.getNumber('cg_boblean') ?? 1.5;

        // Speed factor: scale bob intensity with movement speed
        // Walking = 1.0, Fast = up to 2.0
        const speedFactor = Math.min(state.horizontalSpeed / BASE_SPEED, 2.0);

        // Speed ratio: 0 at base, 1 at 2x base (using shared gradient)
        const speedRatio = getSpeedRatio(state.horizontalSpeed);

        // Update bob cycle based on distance traveled
        // Frequency scales with speed for realistic footstep cadence
        const effectiveFrequency = frequency * (1 + speedRatio * 0.3);
        this.bobCycle += state.horizontalSpeed * deltaTime * effectiveFrequency;

        // === VERTICAL BOB (primary) ===
        // Up/down motion synced to footsteps
        const offsetY = Math.sin(this.bobCycle * 2) * amplitude * speedFactor;

        // === HORIZONTAL SWAY (secondary) ===
        // Left/right sway for realistic running feel - 90° phase offset from bob
        // More pronounced when running fast
        const swayAmount = amplitude * 0.4 * speedFactor * (1 + speedRatio * 0.5);
        const offsetX = Math.sin(this.bobCycle) * swayAmount;

        // === ROLL TILT ===
        // Subtle shoulder rotation matching horizontal sway
        const roll = Math.sin(this.bobCycle) * rollAmount * speedFactor;

        // === FORWARD LEAN ===
        // Lean forward when going fast - uses shared gradient (BASE_SPEED to MAX_SPEED)
        const targetLean = speedRatio * leanAmount;
        const leanSpeed = 5;  // How fast we lean forward/back
        this.currentLean += (targetLean - this.currentLean) * Math.min(1, deltaTime * leanSpeed);

        // Build delta
        delta.positionOffset = new Vector3(offsetX, offsetY, 0);
        delta.rotationOffset = new Vector3(this.currentLean, 0, roll);

        return delta;
    }

    reset(): void {
        this.bobCycle = 0;
        this.currentLean = 0;
    }
}

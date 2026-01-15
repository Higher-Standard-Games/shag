/**
 * LandingImpactEffect - Camera dip on landing
 *
 * Triggered when player transitions from airborne to grounded.
 * Impact strength scales with fall velocity.
 * Quick ease-out drop, slower spring recovery.
 *
 * Cvars:
 * - cg_landing: Enable landing effect (0/1)
 * - cg_landingamplitude: Max landing dip (units)
 * - cg_landingspeed: Landing animation speed
 * - cg_landingreset: Time to reset landing state (ms) - helps with bunny hopping
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Cvar } from '../../core/Cvar';
import { BaseViewportEffect } from '../ViewportEffect';
import type { PlayerState } from '../PlayerState';
import { ViewportDelta, createNeutralDelta } from '../ViewportDelta';
import { Easing } from '../Easing';

export class LandingImpactEffect extends BaseViewportEffect {
    readonly name = 'landing';

    // Animation state
    private impactOffset: number = 0;  // Max dip for current landing
    private impactPhase: number = 1;   // 0 = just landed, 1 = done
    /** Last landing velocity (for debugging/display) */
    public lastLandingVelocity: number = 0;

    constructor() {
        super();
        this.registerCvars();
    }

    private registerCvars(): void {
        if (!Cvar.exists('cg_landing')) {
            Cvar.register('cg_landing', 1, {
                type: 'int',
                min: 0,
                max: 1,
                description: 'Enable landing impact effect',
                persist: true,
            });
        }

        if (!Cvar.exists('cg_landingamplitude')) {
            Cvar.register('cg_landingamplitude', 8, {
                type: 'float',
                min: 0,
                max: 20,
                description: 'Max landing dip (units)',
                persist: true,
            });
        }

        if (!Cvar.exists('cg_landingspeed')) {
            Cvar.register('cg_landingspeed', 4, {
                type: 'float',
                min: 1,
                max: 10,
                description: 'Landing animation speed',
                persist: true,
            });
        }
    }

    update(deltaTime: number, state: PlayerState): ViewportDelta {
        const delta = createNeutralDelta();

        // Check if landing is enabled
        const landingEnabled = Cvar.getNumber('cg_landing') !== 0;
        if (!landingEnabled) return delta;

        // Detect landing: was airborne, now grounded
        const justLanded = state.isGrounded && !state.wasGroundedLastFrame;

        if (justLanded) {
            // Calculate impact strength from landing velocity
            const landingVelocity = state.landingVelocity ?? state.velocity.y;
            this.lastLandingVelocity = landingVelocity;

            // Impact strength: normalize velocity to 0-1 range
            // Typical fall: -200 to -800 u/s
            const impactStrength = Math.min(Math.abs(landingVelocity) / 800, 1);

            // Calculate dip amount
            const amplitude = Cvar.getNumber('cg_landingamplitude') ?? 8;
            this.impactOffset = impactStrength * amplitude;
            this.impactPhase = 0;
        }

        // Animate the landing
        if (this.impactPhase < 1 && this.impactOffset > 0) {
            const speed = Cvar.getNumber('cg_landingspeed') ?? 4;
            this.impactPhase += deltaTime * speed;

            let offsetY: number;

            if (this.impactPhase < 0.3) {
                // Quick drop phase (0 -> 0.3): ease-out to max dip
                const t = this.impactPhase / 0.3;
                offsetY = -this.impactOffset * Easing.easeOutQuad(t);
            } else if (this.impactPhase < 1.0) {
                // Recovery phase (0.3 -> 1.0): ease-in-out back to zero
                const t = (this.impactPhase - 0.3) / 0.7;
                offsetY = -this.impactOffset * (1 - Easing.easeInOutQuad(t));
            } else {
                // Done
                offsetY = 0;
                this.impactPhase = 1;
            }

            delta.positionOffset = new Vector3(0, offsetY, 0);
        }

        return delta;
    }

    /**
     * Can also be triggered via EventBus: viewport:landing
     */
    trigger(event: string, data: unknown): void {
        if (event === 'landing') {
            const { velocity } = data as { velocity?: number };
            if (typeof velocity === 'number') {
                const amplitude = Cvar.getNumber('cg_landingamplitude') ?? 8;
                const impactStrength = Math.min(Math.abs(velocity) / 800, 1);
                this.impactOffset = impactStrength * amplitude;
                this.impactPhase = 0;
            }
        }
    }

    reset(): void {
        this.impactOffset = 0;
        this.impactPhase = 1;
        this.lastLandingVelocity = 0;
    }
}

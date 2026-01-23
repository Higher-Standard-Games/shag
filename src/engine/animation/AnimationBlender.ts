/**
 * Animation Blender - Handles smooth blending between animation states
 *
 * Provides weighted blending and crossfade transitions for animation groups.
 */

import { AnimationGroup } from "@babylonjs/core";

/**
 * Blend state for an animation
 */
interface BlendState {
    group: AnimationGroup;
    weight: number;
    targetWeight: number;
    speed: number;
}

/**
 * Blend configuration
 */
export interface BlendConfig {
    /** Time in seconds to blend to new animation */
    blendTime: number;
    /** Default animation speed multiplier */
    defaultSpeed: number;
}

const DEFAULT_CONFIG: BlendConfig = {
    blendTime: 0.15,
    defaultSpeed: 1.0,
};

/**
 * AnimationBlender - Manages weighted animation blending
 */
export class AnimationBlender {
    private animations: Map<string, BlendState> = new Map();
    private currentAnimation: string | null = null;
    private config: BlendConfig;

    constructor(config?: Partial<BlendConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Register an animation group for blending
     */
    registerAnimation(name: string, group: AnimationGroup, startWeight: number = 0): void {
        // Stop and reset the animation
        group.stop();
        group.reset();

        // Start with initial weight
        group.play(true); // Loop by default
        group.setWeightForAllAnimatables(startWeight);

        this.animations.set(name, {
            group,
            weight: startWeight,
            targetWeight: startWeight,
            speed: this.config.defaultSpeed,
        });

        // If this is the first animation, make it current
        if (this.animations.size === 1) {
            this.currentAnimation = name;
            this.setTargetWeight(name, 1.0);
        }
    }

    /**
     * Unregister an animation
     */
    unregisterAnimation(name: string): void {
        const state = this.animations.get(name);
        if (state) {
            state.group.stop();
            this.animations.delete(name);
        }
    }

    /**
     * Play an animation, blending from current
     */
    play(name: string): void {
        if (!this.animations.has(name)) {
            console.warn(`[AnimationBlender] Animation not registered: ${name}`);
            return;
        }

        // If same animation, do nothing
        if (this.currentAnimation === name) {
            return;
        }

        // Fade out current animation
        if (this.currentAnimation) {
            this.setTargetWeight(this.currentAnimation, 0);
        }

        // Fade in new animation
        this.setTargetWeight(name, 1.0);
        this.currentAnimation = name;

        // Reset the new animation if it was stopped
        const state = this.animations.get(name);
        if (state && !state.group.isPlaying) {
            state.group.reset();
            state.group.play(true);
        }
    }

    /**
     * Set target weight for blending
     */
    private setTargetWeight(name: string, weight: number): void {
        const state = this.animations.get(name);
        if (state) {
            state.targetWeight = Math.max(0, Math.min(1, weight));
        }
    }

    /**
     * Set animation speed
     */
    setSpeed(name: string, speed: number): void {
        const state = this.animations.get(name);
        if (state) {
            state.speed = speed;
            state.group.speedRatio = speed;
        }
    }

    /**
     * Set speed for all animations
     */
    setGlobalSpeed(speed: number): void {
        for (const state of this.animations.values()) {
            state.speed = speed;
            state.group.speedRatio = speed;
        }
    }

    /**
     * Update blend weights - call every frame
     */
    update(deltaTime: number): void {
        const blendSpeed = 1.0 / this.config.blendTime;

        for (const [name, state] of this.animations) {
            // Interpolate weight toward target
            const diff = state.targetWeight - state.weight;

            if (Math.abs(diff) < 0.001) {
                // Close enough, snap to target
                state.weight = state.targetWeight;
            } else {
                // Blend toward target
                const change = Math.sign(diff) * Math.min(Math.abs(diff), blendSpeed * deltaTime);
                state.weight += change;
            }

            // Apply weight to animation group
            state.group.setWeightForAllAnimatables(state.weight);

            // Stop animations that are fully blended out
            if (state.weight <= 0 && state.group.isPlaying && name !== this.currentAnimation) {
                state.group.pause();
            }
        }
    }

    /**
     * Get current animation name
     */
    getCurrentAnimation(): string | null {
        return this.currentAnimation;
    }

    /**
     * Get weight of an animation
     */
    getWeight(name: string): number {
        return this.animations.get(name)?.weight ?? 0;
    }

    /**
     * Check if blending is in progress
     */
    isBlending(): boolean {
        for (const state of this.animations.values()) {
            if (Math.abs(state.weight - state.targetWeight) > 0.001) {
                return true;
            }
        }
        return false;
    }

    /**
     * Stop all animations
     */
    stopAll(): void {
        for (const state of this.animations.values()) {
            state.group.stop();
            state.weight = 0;
            state.targetWeight = 0;
        }
        this.currentAnimation = null;
    }

    /**
     * Dispose all animations
     */
    dispose(): void {
        this.stopAll();
        this.animations.clear();
    }
}

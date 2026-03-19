/**
 * BotBrain - AI decision interface
 *
 * Defines the contract between BotClient and AI logic.
 * The brain receives game state each tick and returns input commands.
 *
 * Phase 1: StateMachineBrain (rule-based)
 * Phase 3: NeuralBrain (brain.js ML — future)
 */

import type { BotGameState } from './BotGameState';
import type { BotDifficulty } from './BotConfig';
import type { BotVision, VisionResult } from './BotVision';

// ── Bot Input (what the brain outputs) ──────────────────────────────────

export interface BotInput {
    /** Movement direction (view-relative: z=forward, x=strafe) */
    direction: { x: number; y: number; z: number };
    /** Look pitch (radians, positive = up) */
    pitch: number;
    /** Look yaw (radians) */
    yaw: number;
    /** Button bitmask (from InputButtons) */
    buttons: number;
    /** Weapon slot to switch to (0 = no change, 1-indexed) */
    weaponSlot: number;
}

// ── Bot Brain States ────────────────────────────────────────────────────

export enum BotState {
    SPAWN = 'SPAWN',
    FIGHT = 'FIGHT',
    CHASE = 'CHASE',
    HUNT = 'HUNT',
    ITEM_RUN = 'ITEM_RUN',
    DODGE = 'DODGE',
    RETREAT = 'RETREAT',
    IDLE = 'IDLE',
}

// ── Abstract Base Class ─────────────────────────────────────────────────

export abstract class BotBrain {
    protected difficulty: BotDifficulty;
    protected currentState: BotState = BotState.SPAWN;

    constructor(difficulty: BotDifficulty) {
        this.difficulty = difficulty;
    }

    /**
     * Make a decision based on current game state and optional vision data.
     *
     * @param state - Raw game state from snapshot
     * @param vision - Optional spatial awareness (null if BSP not loaded)
     * @param visionResult - Optional pre-computed vision query result
     */
    abstract decide(state: BotGameState, vision?: BotVision | null, visionResult?: VisionResult | null): BotInput;

    /** Get current AI state (for debugging/logging) */
    getState(): BotState {
        return this.currentState;
    }

    /** Update difficulty settings */
    setDifficulty(difficulty: BotDifficulty): void {
        this.difficulty = difficulty;
    }
}
